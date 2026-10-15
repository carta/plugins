"""The headless `claude` session that talks to Carta for report sharing.

The browser never calls Carta and the local server holds no credentials: this
session inherits the operator's own Carta MCP connector, makes exactly the tool
calls it is told to, and hands each result back. It follows carta-fund-modeling's
sharing session (chat_session.py, share.py).

Which Carta connector it may use is explicit. `MANCO_SHARE_MCP_SERVER` (or
serve.py --share-mcp-server) names exactly one server — e.g. a local stack's —
and nothing else is allowlisted. Without it, the connectors for the cache's own
Carta environment are the only candidates.

Python-stdlib only, 3.9-safe.
"""
from __future__ import annotations

import json
import os
import queue
import re
import shlex
import subprocess
import sys
import threading
from typing import Any, Callable, Dict, Iterator, List, Optional, Tuple

SERVER_ENV = "MANCO_SHARE_MCP_SERVER"
CLAUDE_BIN_ENV = "MANCO_CLAUDE_BIN"

PROD_SERVERS = ("claude_ai_carta", "claude_ai_Carta", "carta", "carta_production", "carta_prod",
                # The same claude.ai Carta connector, addressed by its UUID instead of its name.
                "2827383e-1775-4df3-b6ff-04d5392f6d18")
NONPROD_SERVERS = ("Carta_Sandbox", "claude_ai_Carta_Sandbox", "carta_sandbox",
                   "carta_test", "carta_demo", "carta_preprod")

# Commands whose answers carry text other people wrote (report names, comments, their
# names). The session is reset after each, so that text never shares a context with a
# later call — above all a write.
OTHERS_TEXT_COMMANDS = frozenset({
    "fa__get__budget_reports", "fa__get__budget_report", "fa__get__budget_report_shareable_users",
})
# The session only relays Carta calls; it never needs to touch files or run commands.
LOCAL_TOOLS = ("Bash", "Write", "Edit", "MultiEdit", "NotebookEdit")

# Every call_tool the session makes passes a PreToolUse hook (relay_guard.py) that lets
# through only the command named in this file, kept in the dashboard data dir (the cwd).
GUARD_FILE = os.path.join(".reports", "relay-expected-command")
GUARD_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "relay_guard.py")
# call_tool on any server, never welcome: the welcome turn runs no Carta command.
CALL_TOOL_MATCHER = "mcp__.*__call_tool"

TURN_TIMEOUT = 180
SESSION_MODEL = "haiku"  # the session only relays tool calls; a fast model beats a large one here

SYSTEM_PROMPT = (
    "You are a report-sharing executor for a ManCo reporting console. You have a Carta MCP server "
    "whose tools are named mcp__<server>__welcome and mcp__<server>__call_tool. If a named tool is "
    "not immediately visible it may be deferred — load it with ToolSearch first, then call it in "
    "the same turn. Make exactly the tool calls the user message specifies, in order, with the "
    "given arguments, and call no other tool. Emit each tool call immediately, with no explanatory "
    "text before it. Reply with exactly DONE once they have returned."
)

# Carta MCP wants this beside `name` and `arguments` on every call. A plugin hook
# usually adds it; the sharing session states it so a call never depends on that.
INSTRUMENTATION = {
    "plugins": [{"name": "carta-investors"}],
    "skills": ["carta-investors:carta-manco-reporting"],
    # Headless `claude -p`, not an interactive terminal session.
    "surface": "sdk-cli",
}
_INSTRUMENTATION_JSON = json.dumps(INSTRUMENTATION, separators=(",", ":"))

_TOOLNAME_RE = re.compile(r"^mcp__(.+)__[a-z_]+$")


class ShareError(Exception):
    """A sharing failure the app shows. `code` is its typed state; `raw` keeps the
    original tool error for the server log only."""

    def __init__(self, message: str, code: str = "failed", raw: Optional[str] = None) -> None:
        super().__init__(message)
        self.code = code
        self.raw = raw


def candidate_servers(carta_environment: Optional[str], override: Optional[str]) -> Tuple[str, ...]:
    """The Carta connectors the session may use, most explicit first."""
    if override:
        return (override,)
    return NONPROD_SERVERS if carta_environment == "nonprod" else PROD_SERVERS


def describe_target(carta_environment: Optional[str], override: Optional[str]) -> Dict[str, Any]:
    """What the Share dialog shows about where a share goes."""
    return {
        "servers": list(candidate_servers(carta_environment, override)),
        "pinned": bool(override),
        "environment": carta_environment or "production",
    }


# The Carta connector reports a failed command as "<op> failed: <status> <reason> — <body>".
# Read the status from that fixed position rather than testing the whole text for a
# digit run — a recipient id or a byte count in the body can read as a status code it isn't.
_STATUS_RE = re.compile(r"\bfailed:\s*(\d{3})\b")


def classify(error: Optional[str]) -> Tuple[str, str]:
    """A Carta tool error → (code, message for the operator). Carta answers in plain
    HTTP statuses, carried in the MCP error text; most specific first."""
    raw = error or ""
    e = raw.lower()
    if "unknown command" in e or "unknown tool" in e or "is not enabled for this user" in e:
        return "not_enabled", "Report sharing isn't turned on for you yet."
    status_match = _STATUS_RE.search(e)
    status = status_match.group(1) if status_match else None
    if status == "409" or "changed since" in e:
        return "conflict", "Someone changed this report since you loaded it."
    if "only with its creator" in e:
        return "invalid_recipient", "A report can't be shared only with yourself — add someone else, or share with everyone."
    if "only the report's creator" in e or (status == "403" and "creator" in e):
        return "not_owner", "Only the person who shared this report can change or delete it."
    if status == "403" or "forbidden" in e or "permission" in e:
        return "not_permitted", "Sharing needs edit access to this entity's accounting."
    if "shared report limit" in e:
        return "cap_reached", "This entity has reached its limit of shared reports."
    if status == "413" or "byte limit" in e or "too large" in e or "response too large" in e:
        return "too_large", "This report is too large to share."
    if "can't view this entity's ledger" in e:
        return "invalid_recipient", "Someone you picked can no longer see this entity's accounting."
    if status == "404" or "not found" in e:
        return "not_found", "That shared report no longer exists."
    if status == "400":
        return "invalid", "Carta refused this report: " + raw.strip()[:300]
    return "failed", "Couldn't finish — try again, or run it from Claude."


def _first_json(text: Optional[str]) -> Optional[Any]:
    text = text or ""
    i = text.find("{")
    while i >= 0:
        try:
            return json.loads(text[i:])
        except ValueError:
            i = text.find("{", i + 1)
    return None


def unwrap(text: Optional[str]) -> Optional[Any]:
    """call_tool results arrive double-wrapped as {"result": "<json>"}; tolerate a flat one."""
    obj = _first_json(text)
    if isinstance(obj, dict) and isinstance(obj.get("result"), str):
        inner = _first_json(obj["result"])
        return inner if inner is not None else obj
    return obj


def flatten(content: Any) -> str:
    """A tool_result's content is a string or a list of {type: text, text} blocks."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            (b.get("text") or "") if isinstance(b, dict) and b.get("type") == "text"
            else (b if isinstance(b, str) else "")
            for b in content
        )
    return "" if content is None else json.dumps(content)


def server_of(tool_name: Optional[str]) -> Optional[str]:
    """'mcp__claude_ai_carta__call_tool' → 'claude_ai_carta'."""
    m = _TOOLNAME_RE.match(tool_name or "")
    return m.group(1) if m else None


def guard_path(cwd: str) -> str:
    return os.path.join(os.path.abspath(cwd), GUARD_FILE)


def expect_command(cwd: str, command: str) -> bool:
    """Name the one command the session's hook lets call_tool run ("" lets none);
    False when the file can't be written."""
    path = guard_path(cwd)
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(command)
    except OSError:
        return False
    return True


class Session(object):
    """One long-lived `claude -p` stream-json process."""

    def __init__(self, cwd: str, servers: Tuple[str, ...], claude_bin: Optional[str] = None,
                 model: str = SESSION_MODEL) -> None:
        self.cwd = cwd
        self.servers = servers
        self.claude_bin = claude_bin or os.environ.get(CLAUDE_BIN_ENV, "claude")
        self.model = model
        self.proc: Optional[subprocess.Popen] = None
        self._q: "queue.Queue[dict]" = queue.Queue()
        self._closed = False
        self._stdin_lock = threading.Lock()

    def denied(self) -> str:
        others = [n for n in PROD_SERVERS + NONPROD_SERVERS if n not in self.servers]
        return ",".join(list(LOCAL_TOOLS) + ["mcp__%s" % n for n in others])

    def settings(self) -> str:
        """The --settings JSON: the PreToolUse hook that blocks a call_tool for any other command."""
        guard = " ".join(shlex.quote(p) for p in (sys.executable, GUARD_SCRIPT, guard_path(self.cwd)))
        return json.dumps({"hooks": {"PreToolUse": [
            {"matcher": CALL_TOOL_MATCHER, "hooks": [{"type": "command", "command": guard}]}]}})

    def argv(self) -> List[str]:
        allowed = ",".join("mcp__%s__%s" % (s, t) for s in self.servers for t in ("welcome", "call_tool"))
        return [
            self.claude_bin, "-p",
            "--input-format", "stream-json",
            "--output-format", "stream-json",
            "--verbose",
            "--allowedTools", allowed,
            # A prompt can't stop a model reaching for another connector when the
            # chosen one fails, so every other known Carta connector is denied.
            "--disallowedTools", self.denied(),
            # The after-the-turn check in Bridge.call only reports a stray call; this stops it.
            "--settings", self.settings(),
            "--append-system-prompt", SYSTEM_PROMPT,
            "--model", self.model,
        ]

    def start(self) -> None:
        self.proc = subprocess.Popen(
            self.argv(), cwd=self.cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, text=True, bufsize=1)

        def pump() -> None:
            assert self.proc is not None and self.proc.stdout is not None
            for line in self.proc.stdout:
                line = line.strip()
                if not line:
                    continue
                try:
                    self._q.put(json.loads(line))
                except ValueError:
                    continue
            self._q.put({"type": "_closed"})

        threading.Thread(target=pump, daemon=True).start()

    def alive(self) -> bool:
        return not self._closed and self.proc is not None and self.proc.poll() is None

    def send(self, text: str) -> None:
        if self._closed or self.proc is None or self.proc.stdin is None:
            raise ShareError("The Carta session ended; try again.", "failed")
        frame = json.dumps({"type": "user", "message": {"role": "user", "content": [{"type": "text", "text": text}]}})
        try:
            with self._stdin_lock:
                self.proc.stdin.write(frame + "\n")
                self.proc.stdin.flush()
        except (BrokenPipeError, OSError, ValueError):
            self._closed = True
            raise ShareError("The Carta session ended; try again.", "failed")

    def events(self, timeout: int = TURN_TIMEOUT) -> Iterator[dict]:
        while not self._closed:
            try:
                ev = self._q.get(timeout=timeout)
            except queue.Empty:
                return
            if ev.get("type") == "_closed":
                self._closed = True
                return
            yield ev
            if ev.get("type") == "result":
                return

    def close(self) -> None:
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


def _run_turn(session: Session, prompt: str, timeout: int,
              sent: Optional[List[Any]] = None) -> Tuple[List[Any], Optional[str], Optional[str], bool]:
    """Send one prompt → (every call_tool result, the first tool error, the server used,
    whether the turn finished). A turn that didn't finish timed out or lost its session.
    `sent`, when given, collects (command name, arguments) for each call_tool actually made."""
    session.send(prompt)
    pending: Dict[str, str] = {}
    captures: List[Any] = []
    err: Optional[str] = None
    server: Optional[str] = None
    finished = False
    for ev in session.events(timeout=timeout):
        kind = ev.get("type")
        if kind == "result":
            finished = True
        elif kind == "assistant":
            for block in ev.get("message", {}).get("content", []):
                if block.get("type") == "tool_use":
                    pending[block.get("id")] = block.get("name")
                    server = server or server_of(block.get("name"))
                    if sent is not None and (block.get("name") or "").endswith("__call_tool"):
                        made = block.get("input") or {}
                        sent.append((made.get("name"), made.get("arguments")))
        elif kind == "user":
            for block in ev.get("message", {}).get("content", []):
                if block.get("type") != "tool_result":
                    continue
                if not (pending.get(block.get("tool_use_id")) or "").endswith("__call_tool"):
                    continue
                text = flatten(block.get("content"))
                if block.get("is_error"):
                    err = err or text
                else:
                    captures.append(unwrap(text))
    return captures, err, server, finished


def _same_json(sent: Any, expected: Dict[str, Any]) -> bool:
    if isinstance(sent, str):
        try:
            sent = json.loads(sent)
        except ValueError:
            return False
    return sent == expected


class Bridge(object):
    """A warm session, reused across share operations. The first call pays spawn +
    welcome; later ones reuse it. A dead session respawns on the next call."""

    def __init__(self, cwd: str, carta_environment: Optional[str], override: Optional[str] = None,
                 claude_bin: Optional[str] = None,
                 session_factory: Optional[Callable[[str, Tuple[str, ...]], Session]] = None) -> None:
        self._cwd = cwd
        self._servers = candidate_servers(carta_environment, override or os.environ.get(SERVER_ENV))
        self._claude_bin = claude_bin
        self._factory = session_factory or (lambda cwd, servers: Session(cwd, servers, claude_bin))
        self._lock = threading.Lock()
        self._session: Optional[Session] = None
        self._call_tool: Optional[str] = None

    @property
    def servers(self) -> Tuple[str, ...]:
        return self._servers

    def _connect(self, emit: Callable[[str], None]) -> Tuple[Session, str]:
        if self._session is not None and self._session.alive() and self._call_tool:
            return self._session, self._call_tool
        self.reset()
        expect_command(self._cwd, "")
        emit("Connecting to Carta…")
        session = self._factory(self._cwd, self._servers)
        try:
            session.start()
        except OSError:
            raise ShareError("Couldn't start a Claude session for sharing — is Claude Code installed?", "unreachable")
        names = ", ".join("mcp__%s__welcome" % s for s in self._servers)
        session.send(
            "Call whichever ONE of these Carta welcome tools resolves — try them in order and call "
            "no other server's welcome (load a deferred tool with ToolSearch first, then call it): "
            "%s. Pass _instrumentation_v2 = %s. Then reply DONE." % (names, _INSTRUMENTATION_JSON))
        # The connector is the first whose welcome came back without an error: a failed
        # one (say, signed out) is followed by the next in the list.
        server, finished, pending = None, False, {}
        for ev in session.events(timeout=TURN_TIMEOUT):
            kind = ev.get("type")
            if kind == "result":
                finished = True
            elif kind == "assistant":
                for block in ev.get("message", {}).get("content", []):
                    if block.get("type") == "tool_use":
                        candidate = server_of(block.get("name"))
                        if candidate in self._servers:
                            pending[block.get("id")] = candidate
            elif kind == "user":
                for block in ev.get("message", {}).get("content", []):
                    if (server is None and block.get("type") == "tool_result"
                            and not block.get("is_error") and block.get("tool_use_id") in pending):
                        server = pending[block["tool_use_id"]]
        # A welcome turn still running would answer the first call's prompt late.
        if not server or not finished:
            session.close()
            raise ShareError(
                "Couldn't reach Carta — sharing needs your Carta connector connected in Claude.",
                "unreachable")
        self._session, self._call_tool = session, "mcp__%s__call_tool" % server
        return session, self._call_tool

    def call(self, command: str, arguments: Dict[str, Any], emit: Callable[[str], None]) -> Any:
        """Run one Carta command (e.g. "fa__get__budget_reports") and return its result.
        While it runs, the session's hook lets call_tool run this command and no other."""
        with self._lock:
            session, call_tool = self._connect(emit)
            try:
                return self._relay(session, call_tool, command, arguments)
            finally:
                expect_command(self._cwd, "")

    def _relay(self, session: Session, call_tool: str, command: str, arguments: Dict[str, Any]) -> Any:
        # The small fields go first and the payload last: a model copying a long
        # object tends to fold whatever follows it into it.
        big = ("payload", "payload_compact")
        ordered = {k: v for k, v in arguments.items() if k not in big}
        ordered.update((k, arguments[k]) for k in big if k in arguments)
        args = json.dumps(ordered, separators=(",", ":"))
        prompt = ('Make exactly one tool call, then reply DONE. Call %s with three parameters: '
                  'name = "%s"; _instrumentation_v2 = %s; and arguments = the following JSON '
                  'OBJECT, exactly as given (pass it as an object, never as a quoted string, and '
                  'add nothing to it):\n%s' % (call_tool, command, _INSTRUMENTATION_JSON, args))
        # Retry only a finished turn whose command never ran (so a retry can't write
        # twice): the model searched but never called, or passed the arguments as a
        # string. A real tool error is returned, not retried.
        for _ in range(3):
            if not expect_command(self._cwd, command):
                raise ShareError("Couldn't prepare the Carta session; try again.", "failed",
                                 raw="can't write %s" % guard_path(self._cwd))
            sent: List[Any] = []
            try:
                captures, err, _server, finished = _run_turn(
                    session, prompt, TURN_TIMEOUT + len(args) // 2000, sent)
            except ShareError:
                self.reset()
                raise
            # Every call the turn made must be the one asked for: a report's text in the
            # session must never get a different command run on the person's behalf.
            strays = [name for name, _ in sent if name != command]
            if strays or len(captures) > 1:
                self.reset()
                raise ShareError("An unexpected Carta call was made. Check your shared reports "
                                 "before you try again.", "unexpected_call",
                                 raw="call_tool ran %s for %s" % ([n for n, _ in sent], command))
            garbled = bool(sent) and not any(_same_json(a, arguments) for _, a in sent)
            if captures:
                if garbled:
                    # Carta accepted values the model retyped wrong; the write may have
                    # happened, so don't retry and don't report it as the report's own.
                    self.reset()
                    raise ShareError("Carta may have saved different values than this report holds. "
                                     "Check the shared report before you try again.", "failed",
                                     raw="call_tool ran with arguments that differ from the ones given")
                if command in OTHERS_TEXT_COMMANDS:
                    self.reset()
                return captures[-1]
            if not finished:
                # The call may still be running: asking again could make it twice, and
                # its late answer would be read as the next call's. Start fresh.
                self.reset()
                raise ShareError("Carta took too long to answer. Check whether the change went "
                                 "through before you try again.", "failed", raw="turn did not finish")
            # A refusal of arguments the model got wrong is safe to retry: Carta
            # validated and rejected them, so nothing was written.
            never_ran = any(m in (err or "").lower() for m in (
                "arguments must be a dict", "valid json string", "_instrumentation_v2"))
            if err and not garbled and not never_ran:
                code, message = classify(err)
                # Carta's error text ("Do not retry it", say) stays in the session's
                # history and steers its next call away from the tool; start fresh.
                self.reset()
                raise ShareError(message, code, raw=err)
            prompt = ('That call did not go through. Call %s again (if it is not loaded, run '
                      'ToolSearch "select:%s" first, then invoke it THIS turn). Pass exactly: '
                      'name = "%s"; _instrumentation_v2 = %s (a parameter of its own, never inside '
                      'arguments); arguments = this JSON OBJECT, not a quoted string, unchanged:\n%s'
                      % (call_tool, call_tool, command, _INSTRUMENTATION_JSON, args))
        self.reset()
        detail = err or ("the model sent different arguments" if garbled else "no call was made")
        raise ShareError("Couldn't finish — try again, or run it from Claude.", "failed", raw=detail)

    def reset(self) -> None:
        session, self._session, self._call_tool = self._session, None, None
        if session is not None:
            session.close()
