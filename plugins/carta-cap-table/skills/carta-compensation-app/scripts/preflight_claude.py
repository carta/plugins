#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# ///
"""Locate or install the `claude` CLI for the ask box (Step 0.5)."""
from __future__ import annotations

import glob
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import List, Optional

_WIN = sys.platform == "win32"
_BIN = "claude.exe" if _WIN else "claude"


def _is_executable(p):
    # type: (Path) -> bool
    return p.is_file() and os.access(p, os.X_OK)


def _known_locations():
    # type: () -> List[Path]
    home = Path.home()
    if _WIN:
        appdata = os.environ.get("APPDATA", "")
        return [
            home / "AppData" / "Roaming" / "npm" / _BIN,
            *([Path(appdata) / "npm" / _BIN] if appdata else []),
        ]
    return [
        home / ".local" / "bin" / _BIN,
        Path("/usr/local/bin") / _BIN,
        home / ".npm-global" / "bin" / _BIN,
    ]


def _find_claude():
    # type: () -> Optional[str]
    """Return the absolute path to the claude binary, or None."""

    # 1. Explicit override via env var (matches chat_session.py:271).
    env_bin = os.environ.get("CTC_CLAUDE_BIN", "").strip()
    if env_bin:
        p = Path(env_bin).expanduser().absolute()
        if _is_executable(p):
            return str(p)

    # 2. Standard PATH lookup.
    which = shutil.which(_BIN)
    if which:
        return str(Path(which).absolute())

    # 3. Well-known locations (npm global, Homebrew, manual).
    for c in _known_locations():
        if _is_executable(c):
            return str(c.absolute())

    # 4. NVM-managed Node installations (Unix only).
    if not _WIN:
        home = Path.home()
        nvm_pattern = str(home / ".nvm" / "versions" / "node" / "*" / "bin" / _BIN)
        for match in sorted(glob.glob(nvm_pattern), reverse=True):
            p = Path(match)
            if _is_executable(p):
                return str(p.absolute())

    return None


def _get_version(claude_bin):
    # type: (str) -> Optional[str]
    try:
        result = subprocess.run(
            [claude_bin, "--version"],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        pass
    return None


def cmd_check():
    # type: () -> int
    found = _find_claude()
    if found:
        version = _get_version(found)
        print("claude_bin=%s" % found)
        if version:
            print("claude_version=%s" % version)
        return 0
    print("claude_bin=none")
    return 1


def cmd_install():
    # type: () -> int
    npm = shutil.which("npm")
    if not npm:
        print("npm_not_found=true", file=sys.stderr)
        print("claude_bin=none")
        return 1

    print("[preflight] installing @anthropic-ai/claude-code via npm …", file=sys.stderr)
    try:
        result = subprocess.run(
            [npm, "install", "-g", "@anthropic-ai/claude-code"],
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode != 0:
            print("[preflight] npm install failed (exit %d)" % result.returncode, file=sys.stderr)
            if result.stderr.strip():
                print(result.stderr.strip(), file=sys.stderr)
    except subprocess.TimeoutExpired:
        print("[preflight] npm install timed out", file=sys.stderr)
    except OSError as exc:
        print("[preflight] npm install error: %s" % exc, file=sys.stderr)

    return cmd_check()


def main():
    # type: () -> None
    if len(sys.argv) < 2 or sys.argv[1] not in ("check", "install"):
        print("usage: preflight_claude.py {check|install}", file=sys.stderr)
        sys.exit(2)

    sys.exit(cmd_check() if sys.argv[1] == "check" else cmd_install())


if __name__ == "__main__":
    main()
