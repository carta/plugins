"""Long-lived `claude` stream-json process manager for the fund-modeling chat.
Pure-Python-stdlib. Containment (no Bash, scoped dirs) is baked into build_argv."""
import json
import os
import queue
import subprocess
import threading
from typing import List, Optional

ALLOWED_TOOLS = "Read,Edit,Write,Grep,Glob"  # NO Bash — ADR Branch 4b

# Curated model catalog for the in-app chat dropdown. The `claude` CLI has no
# model-discovery command, so this is hand-maintained. Values are the CLI's
# latest-resolving aliases (see `claude --help`: "Provide an alias for the
# latest model (e.g. 'fable', 'opus', or 'sonnet')"). Single source of truth:
# served to the browser via GET /api/models and used to validate the inbound
# model on POST /api/chat.
CLAUDE_MODELS = [
    {"value": "haiku", "label": "Haiku — fast"},
    {"value": "sonnet", "label": "Sonnet — balanced", "default": True},
    {"value": "opus", "label": "Opus — most capable"},
]
DEFAULT_MODEL = "sonnet"
ALLOWED_MODEL_VALUES = frozenset(m["value"] for m in CLAUDE_MODELS)


def build_argv(claude_bin, add_dirs, model=None):
    # type: (str, List[str], Optional[str]) -> List[str]
    argv = [
        claude_bin, "-p",
        "--input-format", "stream-json",
        "--output-format", "stream-json",
        "--verbose",
        "--permission-mode", "acceptEdits",
        "--allowedTools", ALLOWED_TOOLS,
    ]
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


def _rel_to_src(path):
    # The chat subprocess runs with cwd = <skill>/app/src, so the file hint must be
    # relative to that (the data-source stamp is repo-app-relative, "app/src/...").
    if path and path.startswith("app/src/"):
        return path[len("app/src/"):]
    return path


def anchor_preamble(anchor):
    # type: (dict) -> str
    """Render a pinpoint anchor (captured in the app iframe) as a short preamble
    prepended to the user's prompt, so Claude knows which view file / datum the
    user pinned. Omits any field not present on the anchor; returns "" for a
    falsy anchor or one with nothing renderable."""
    if not anchor:
        return ""
    src = (anchor.get("source") or {})
    parts = []
    view = _rel_to_src(src.get("viewFile"))
    leaf = _rel_to_src(src.get("leafFile"))
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
    for k in ("firm", "tab", "sliceName", "currency"):
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
    def __init__(self, cwd, add_dirs, claude_bin=None, model=None):
        # type: (str, List[str], Optional[str], Optional[str]) -> None
        self.cwd = cwd
        self.add_dirs = add_dirs
        self.claude_bin = claude_bin or os.environ.get("FM_CLAUDE_BIN", "claude")
        self.model = model
        self.proc = None
        self._q = queue.Queue()
        self._reader = None
        self._closed = False

    def start(self):
        argv = build_argv(self.claude_bin, self.add_dirs, self.model)
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
            self.proc.stdin.write(user_message_json(text) + "\n")
            self.proc.stdin.flush()
        except (BrokenPipeError, OSError, ValueError):
            self._closed = True
            raise RuntimeError("chat session is closed")

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
