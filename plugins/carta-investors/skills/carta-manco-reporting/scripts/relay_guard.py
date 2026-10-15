"""The sharing session's PreToolUse hook: a Carta call goes through only when it runs
the one command the relay asked for.

share_bridge.Session starts `claude -p` with this as the hook for call_tool, and
share_bridge.Bridge names the command it expects in a file before each prompt
(empty between calls). Usage: relay_guard.py <expected-command-file>, with the
hook's JSON on stdin. Exit 0 lets the call run; exit 2 blocks it, and Claude
shows the model the reason printed on stderr.

Python-stdlib only, 3.9-safe.
"""
from __future__ import annotations

import json
import sys
from typing import List

BLOCKED = 2


def main(argv: List[str]) -> int:
    try:
        event = json.load(sys.stdin)
    except ValueError:
        event = None
    tool_input = event.get("tool_input") if isinstance(event, dict) else None
    name = tool_input.get("name") if isinstance(tool_input, dict) else None
    try:
        with open(argv[1], encoding="utf-8") as f:
            expected = f.read().strip()
    except (IndexError, OSError, ValueError):
        expected = ""
    if expected and name == expected:
        return 0
    if expected:
        sys.stderr.write("Blocked: this call may only run %s. Make no other Carta call.\n" % expected)
    else:
        sys.stderr.write("Blocked: no Carta call is expected right now. Make no tool call.\n")
    return BLOCKED


if __name__ == "__main__":
    sys.exit(main(sys.argv))
