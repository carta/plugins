"""Shared interactive `claude` stream-json session manager for carta-investors
skills' in-app chat features, plus anchor-preamble rendering for a pinpoint
selection.

Pure-Python-stdlib. Containment (no Bash, scoped dirs) is baked into
build_argv. What's specific to one skill — its own system-prompt note, which
env var (if any) names a pinned binary override, and which anchor context keys
it has — stays in that skill's own chat_session.py wrapper; see this
directory's README for the import preamble a wrapper uses to reach this
module, and carta-manco-reporting/scripts/chat_session.py for a worked
example of a thin wrapper around it.
"""
from __future__ import annotations

import json
import queue
import subprocess
import threading
import uuid
from typing import Callable, List, Optional

DEFAULT_ALLOWED_TOOLS = "Read,Edit,Write,Grep,Glob"  # NO Bash

# Curated model catalog for the in-app chat dropdown. The `claude` CLI has no
# model-discovery command, so this is hand-maintained. Values are the CLI's
# latest-resolving aliases (see `claude --help`: "Provide an alias for the
# latest model (e.g. 'fable', 'opus', or 'sonnet')"). carta-manco-reporting's
# chat_session.py wrapper re-exports these as the object this module defines
# (not a copy), served to the browser via GET /api/models and used to
# validate the inbound model on POST /api/chat — manco is this module's only
# consumer so far; fund-modeling and carta-valuations-goal-seek still keep
# their own separate catalogs.
CLAUDE_MODELS = [
    {"value": "haiku", "label": "Haiku — fast"},
    {"value": "sonnet", "label": "Sonnet — balanced", "default": True},
    {"value": "opus", "label": "Opus — most capable"},
]
DEFAULT_MODEL = "sonnet"
ALLOWED_MODEL_VALUES = frozenset(m["value"] for m in CLAUDE_MODELS)


def build_argv(claude_bin, add_dirs, model=None, allowed_tools=None, system_prompt=None):
    # type: (str, List[str], Optional[str], Optional[str], Optional[str]) -> List[str]
    """The containment argv every skill's chat shares. A skill's own wrapper
    decides its default system_prompt (substituting its own note when the
    caller passes None) before calling this — this function never defaults
    system_prompt on its own, since that default is the one truly
    skill-specific piece."""
    argv = [
        claude_bin, "-p",
        "--input-format", "stream-json",
        "--output-format", "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--permission-mode", "acceptEdits",
        "--allowedTools", allowed_tools or DEFAULT_ALLOWED_TOOLS,
    ]
    if system_prompt:
        argv += ["--append-system-prompt", system_prompt]
    if model:
        argv += ["--model", model]
    for d in add_dirs:
        argv += ["--add-dir", d]
    return argv


def user_message_json(text):
    # type: (str) -> str
    return json.dumps({"type": "user",
                       "message": {"role": "user",
                                   "content": [{"type": "text", "text": text}]}})


def parse_event(line):
    # type: (str) -> Optional[dict]
    line = line.strip()
    if not line:
        return None
    try:
        return json.loads(line)
    except ValueError:
        return None


def event_text(event):
    # type: (dict) -> Optional[str]
    if event.get("type") != "assistant":
        return None
    parts = []
    for block in event.get("message", {}).get("content", []):
        if block.get("type") == "text" and block.get("text"):
            parts.append(block["text"])
    return "".join(parts) or None


def is_turn_end(event):
    # type: (dict) -> bool
    return event.get("type") == "result"


def anchor_preamble(anchor, context_keys=(), strip_prefix=""):
    # type: (dict, tuple, str) -> str
    """Render a pinpoint anchor (captured in the app) as a short preamble
    prepended to the user's prompt, so Claude knows which view file / datum the
    user pinned.

    `context_keys` names which `anchor["context"]` fields to surface — each
    skill has its own vocabulary (e.g. fund-modeling's "sliceName" for a
    scenario, manco's "period" for a reporting period).

    `strip_prefix`, when given, drops a leading repo-relative segment (e.g.
    "app/src/") from viewFile/leafFile, for a skill whose chat subprocess's cwd
    is already that directory so the repo-relative stamp needs shortening to
    match. A skill whose cwd already *is* the stamped root passes "" (the
    default): no path shortening, the anchor's paths are used as given.

    Omits any field not present on the anchor; returns "" for a falsy anchor or
    one with nothing renderable."""
    if not anchor:
        return ""

    def _rel(path):
        if strip_prefix and path and path.startswith(strip_prefix):
            return path[len(strip_prefix):]
        return path

    src = (anchor.get("source") or {})
    parts = []
    view = _rel(src.get("viewFile"))
    leaf = _rel(src.get("leafFile"))
    if view:
        s = "Change target file: " + view
        if leaf and leaf != view:
            s += " (shared primitive: " + leaf + ")"
        parts.append(s)
    datum = anchor.get("datum")
    if datum and datum.get("id"):
        name = datum.get("name")
        label = str(datum.get("type") or "item") + " "
        label += (str(name) + " (" + str(datum["id"]) + ")") if name else str(datum["id"])
        parts.append("Datum: " + label)
    if anchor.get("section"):
        parts.append("Section: " + str(anchor["section"]))
    qt = str(anchor.get("quotedText") or "")[:300]
    if qt:
        parts.append('Selected text: "' + qt + '"')
    ctx = anchor.get("context") or {}
    ctxbits = []
    for k in context_keys:
        if ctx.get(k):
            ctxbits.append(k + " " + str(ctx[k]))
    if ctxbits:
        parts.append("Context: " + ", ".join(ctxbits))
    if not parts:
        return ""
    tail = ""
    if view:
        tail = (" Scope any change to this specific occurrence in " + view +
                "; do not modify the shared primitive globally unless the user asks for all instances.")
    return "[pinpoint] The user pinned a specific part of the app. " + " | ".join(parts) + "." + tail


class ChatSession(object):
    """One long-lived `claude -p` stream-json process. A skill's wrapper
    constructs this with its own `claude_bin` default resolution and its own
    `build_argv` (so a test that patches the wrapper's module-level
    `build_argv` still reaches this class's `start()` — see the README's
    worked example for why that indirection matters)."""

    def __init__(self, cwd, add_dirs, claude_bin="claude", model=None,
                 allowed_tools=None, system_prompt=None, build_argv=build_argv):
        # type: (str, List[str], str, Optional[str], Optional[str], Optional[str], Callable) -> None
        self.cwd = cwd
        self.add_dirs = add_dirs
        self.claude_bin = claude_bin
        self.model = model
        self.allowed_tools = allowed_tools
        self.system_prompt = system_prompt
        self._build_argv = build_argv
        self.proc = None
        self._q = queue.Queue()
        self._reader = None
        self._closed = False
        # send() runs on the thread streaming a turn; interrupt() runs on another
        # request thread while that turn is still in flight. Both write a whole
        # frame + newline to the same pipe, so they serialize on this.
        self._stdin_lock = threading.Lock()

    def start(self):
        argv = self._build_argv(self.claude_bin, self.add_dirs, self.model,
                                allowed_tools=self.allowed_tools, system_prompt=self.system_prompt)
        self.proc = subprocess.Popen(
            argv, cwd=self.cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, text=True, bufsize=1)

        def pump():
            for line in self.proc.stdout:
                ev = parse_event(line)
                if ev is not None:
                    self._q.put(ev)
            self._q.put({"type": "_closed"})

        self._reader = threading.Thread(target=pump, daemon=True)
        self._reader.start()

    def send(self, text):
        # type: (str) -> None
        if self._closed:
            raise RuntimeError("chat session is closed")
        try:
            with self._stdin_lock:
                self.proc.stdin.write(user_message_json(text) + "\n")
                self.proc.stdin.flush()
        except (BrokenPipeError, OSError, ValueError):
            self._closed = True
            raise RuntimeError("chat session is closed")

    def interrupt(self):
        # type: () -> bool
        """Abort the turn in flight, keeping the session and its context alive.

        The CLI accepts a `control_request` on stdin in stream-json input mode
        (which build_argv always uses) and answers with a `control_response`. It
        then ends the aborted turn with an ordinary `result` frame carrying
        terminal_reason `aborted_streaming` / `aborted_tools` — so the turn's SSE
        reader still latches turn-end via is_turn_end() and the subprocess is
        deliberately NOT reaped. `cancel_queued` sweeps any user message accepted
        but not yet dispatched, so Stop means stop rather than "stop, then run the
        next one".

        Returns False when there is no live subprocess left to signal; callers
        treat that as "already finished", not as an error. Deliberately does not
        flip _closed: the thread streaming the turn owns that transition, and
        racing it here would evict a session that is still perfectly usable.

        Whether there is actually a turn in flight to interrupt is the caller's
        job to check (a session with no in-flight turn is idle, not
        interruptible, even while its subprocess is alive) — this method only
        knows how to write the stdin frame.
        """
        if self._closed or self.proc is None or self.proc.poll() is not None:
            return False
        frame = json.dumps({
            "type": "control_request",
            "request_id": "interrupt-" + uuid.uuid4().hex[:12],
            "request": {"subtype": "interrupt", "cancel_queued": True},
        })
        try:
            with self._stdin_lock:
                self.proc.stdin.write(frame + "\n")
                self.proc.stdin.flush()
        except (BrokenPipeError, OSError, ValueError):
            return False
        return True

    def events(self, timeout=120):
        if self._closed:
            return
        while True:
            try:
                ev = self._q.get(timeout=timeout)
            except queue.Empty:
                return
            if ev.get("type") == "_closed":
                self._closed = True
                return
            yield ev
            if is_turn_end(ev):
                return

    def close(self):
        try:
            if self.proc and self.proc.stdin:
                self.proc.stdin.close()
        except (OSError, ValueError):
            pass
        if self.proc:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except (subprocess.TimeoutExpired, OSError):
                pass
        self._closed = True
