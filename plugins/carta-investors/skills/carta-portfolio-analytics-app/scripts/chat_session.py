#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# ///
"""Long-lived headless `claude` stream-json subprocess for the in-app data refresh.

serve.py owns the orchestration; this session only issues the Carta MCP calls it is
told to. Containment (no Bash, scoped dirs) is baked into build_argv. With `event_log`
set, every prompt sent and every event received is mirrored to that file (one JSON line
each, long lines cut) so a failed refresh can be read back after the fact. Stdlib-only,
3.9-safe.
"""
import json
import os
import queue
import subprocess
import threading
from typing import List, Optional

ALLOWED_TOOLS = "Read"  # unused by refresh (it passes an MCP tool set); never Bash/Write
DEFAULT_MODEL = "sonnet"
# A logged event is a diagnostic, not a copy of the data: a small inline DWH result can
# be ~100KB, so each string inside an event is clipped and the line stays valid JSON.
LOG_TEXT_MAX = 4000
# Token-by-token partial messages add nothing a post-mortem needs.
_UNLOGGED_TYPES = ("stream_event",)


def build_argv(claude_bin, add_dirs, model=None, allowed_tools=None, system_prompt=None):
    # type: (str, List[str], Optional[str], Optional[str], Optional[str]) -> List[str]
    argv = [
        claude_bin, "-p",
        "--input-format", "stream-json",
        "--output-format", "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--permission-mode", "acceptEdits",
        "--allowedTools", allowed_tools or ALLOWED_TOOLS,
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


def is_turn_end(event):
    # type: (dict) -> bool
    return event.get("type") == "result"


def clip_strings(value, limit=LOG_TEXT_MAX):
    """Copy of `value` with every string cut to `limit` characters, nested or not."""
    if isinstance(value, str):
        return value if len(value) <= limit else value[:limit] + "…[%d more]" % (len(value) - limit)
    if isinstance(value, dict):
        return {k: clip_strings(v, limit) for k, v in value.items()}
    if isinstance(value, list):
        return [clip_strings(v, limit) for v in value]
    return value


class ChatSession(object):
    def __init__(self, cwd, add_dirs, claude_bin=None, model=None,
                 allowed_tools=None, system_prompt=None, event_log=None):
        # type: (str, List[str], Optional[str], Optional[str], Optional[str], Optional[str], Optional[str]) -> None
        self.cwd = cwd
        self.add_dirs = add_dirs
        self.claude_bin = claude_bin or os.environ.get("PORTFOLIO_ANALYTICS_CLAUDE_BIN", "claude")
        self.model = model
        self.allowed_tools = allowed_tools
        self.system_prompt = system_prompt
        self.event_log = event_log
        self.proc = None
        self._q = queue.Queue()
        self._reader = None
        self._closed = False
        self._stdin_lock = threading.Lock()
        self._log_fh = None
        self._log_lock = threading.Lock()

    def open_log(self):
        """Start a fresh event log for this session (no-op without event_log)."""
        if not self.event_log:
            return
        try:
            self._log_fh = open(self.event_log, "w", encoding="utf-8")
        except OSError:
            self._log_fh = None

    def log(self, event):
        # type: (dict) -> None
        """Append one event as a JSON line, strings clipped. Never raises — the log is
        a diagnostic and must not be able to fail a refresh."""
        if self._log_fh is None or event.get("type") in _UNLOGGED_TYPES:
            return
        try:
            line = json.dumps(clip_strings(event), ensure_ascii=False)
            with self._log_lock:
                self._log_fh.write(line + "\n")
                self._log_fh.flush()
        except (OSError, ValueError, TypeError):
            pass

    def start(self):
        self.open_log()
        argv = build_argv(self.claude_bin, self.add_dirs, self.model,
                          allowed_tools=self.allowed_tools, system_prompt=self.system_prompt)
        self.proc = subprocess.Popen(
            argv, cwd=self.cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, text=True, bufsize=1)

        def pump():
            for line in self.proc.stdout:
                ev = parse_event(line)
                if ev is not None:
                    self.log(ev)
                    self._q.put(ev)
            self._q.put({"type": "_closed"})

        self._reader = threading.Thread(target=pump, daemon=True)
        self._reader.start()

    def send(self, text):
        # type: (str) -> None
        if self._closed:
            raise RuntimeError("chat session is closed")
        self.log({"type": "_sent", "text": text})
        try:
            with self._stdin_lock:
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
        if self._log_fh is not None:
            try:
                self._log_fh.close()
            except OSError:
                pass
            self._log_fh = None
