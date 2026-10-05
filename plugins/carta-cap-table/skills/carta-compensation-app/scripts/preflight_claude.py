#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# ///
"""Locate or install the `claude` CLI for the ask box (Step 0.5).

Also imported by serve.py, which uses find_claude() and probe() to decide whether
the console's Claude features can run at all.
"""
from __future__ import annotations

import glob
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Dict, List, Optional

_WIN = sys.platform == "win32"
_BIN = "claude.exe" if _WIN else "claude"

# Anthropic's official installers. The native install is preferred over npm: it
# needs no Node toolchain, which most of this skill's users do not have.
_NATIVE_INSTALL_SH = "https://claude.ai/install.sh"
_NATIVE_INSTALL_PS1 = "https://claude.ai/install.ps1"

# Why the console's Claude features cannot run. Only these reach the browser;
# anything more specific goes to the server log.
REASON_OK = "ok"
REASON_NOT_INSTALLED = "not_installed"
REASON_NOT_LOGGED_IN = "not_logged_in"


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


def find_claude():
    # type: () -> Optional[str]
    """Return the absolute path to the claude binary, or None."""

    # 1. Explicit override via env var (matches chat_session.py).
    env_bin = os.environ.get("CTC_CLAUDE_BIN", "").strip()
    if env_bin:
        p = Path(env_bin).expanduser().absolute()
        if _is_executable(p):
            return str(p)

    # 2. Standard PATH lookup.
    which = shutil.which(_BIN)
    if which:
        return str(Path(which).absolute())

    # 3. Well-known locations (native installer, npm global, Homebrew, manual).
    for c in _known_locations():
        if _is_executable(c):
            return str(c.absolute())

    # 4. The binary of the Claude Code session that launched this skill. Every user
    #    of this skill is inside one, so this finds a working, logged-in CLI even
    #    when nothing is on PATH (IDE and desktop installs). It comes after the
    #    stable locations above because the path names a version: a Claude Code
    #    auto-update can delete it while the dashboard is still running.
    exec_path = os.environ.get("CLAUDE_CODE_EXECPATH", "").strip()
    if exec_path:
        p = Path(exec_path).expanduser().absolute()
        if _is_executable(p):
            return str(p)

    # 5. NVM-managed Node installations (Unix only).
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


def auth_status(claude_bin):
    # type: (str) -> Optional[bool]
    """True if logged in, False if not, None if the CLI could not say.

    `claude auth status` prints JSON with a `loggedIn` field and makes no model
    request, so it is cheap enough to run on every server start. None covers an
    older CLI without the subcommand, a timeout, or unreadable output; callers
    treat it as "probably fine" rather than blocking a working setup on a probe.
    """
    try:
        result = subprocess.run(
            [claude_bin, "auth", "status"],
            capture_output=True, text=True, timeout=15,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    try:
        logged_in = json.loads(result.stdout).get("loggedIn")
    except (ValueError, AttributeError):
        return None
    return logged_in if isinstance(logged_in, bool) else None


def probe(claude_bin=None):
    # type: (Optional[str]) -> Dict[str, Optional[str]]
    """Whether the console's Claude features can run: {"bin", "reason"}.

    `claude_bin` is the caller's explicit choice (serve.py --claude-bin). It is
    used only while it still exists; otherwise the normal search runs, so a path
    removed by an update falls back to whatever is installed now.
    """
    found = None
    if claude_bin:
        p = Path(claude_bin).expanduser()
        if _is_executable(p):
            found = str(p.absolute())
    found = found or find_claude()
    if not found:
        return {"bin": None, "reason": REASON_NOT_INSTALLED}
    if auth_status(found) is False:
        return {"bin": found, "reason": REASON_NOT_LOGGED_IN}
    return {"bin": found, "reason": REASON_OK}


def cmd_check():
    # type: () -> int
    found = find_claude()
    if found:
        version = _get_version(found)
        print("claude_bin=%s" % found)
        if version:
            print("claude_version=%s" % version)
        logged_in = auth_status(found)
        print("claude_auth=%s" % (
            "unknown" if logged_in is None else "logged_in" if logged_in else "logged_out"))
        return 0
    print("claude_bin=none")
    return 1


def _run_installer(argv, label):
    # type: (List[str], str) -> bool
    print("[preflight] installing Claude Code via %s …" % label, file=sys.stderr)
    try:
        result = subprocess.run(argv, capture_output=True, text=True, timeout=300)
    except subprocess.TimeoutExpired:
        print("[preflight] %s install timed out" % label, file=sys.stderr)
        return False
    except OSError as exc:
        print("[preflight] %s install error: %s" % (label, exc), file=sys.stderr)
        return False
    if result.returncode != 0:
        print("[preflight] %s install failed (exit %d)" % (label, result.returncode),
              file=sys.stderr)
        if result.stderr.strip():
            print(result.stderr.strip(), file=sys.stderr)
        return False
    return True


def _native_installer_argv():
    # type: () -> Optional[List[str]]
    if _WIN:
        shell = shutil.which("powershell") or shutil.which("pwsh")
        if not shell:
            return None
        return [shell, "-NoProfile", "-Command", "irm %s | iex" % _NATIVE_INSTALL_PS1]
    if not (shutil.which("curl") and shutil.which("bash")):
        return None
    return ["bash", "-c", "curl -fsSL %s | bash" % _NATIVE_INSTALL_SH]


def cmd_install():
    # type: () -> int
    """Install the CLI. The skill asks the user before calling this — never run it
    unprompted: it installs software on their machine."""
    installed = False
    native = _native_installer_argv()
    if native:
        installed = _run_installer(native, "the native installer")
    if not installed:
        npm = shutil.which("npm")
        if npm:
            installed = _run_installer(
                [npm, "install", "-g", "@anthropic-ai/claude-code"], "npm")
        elif not native:
            print("[preflight] no installer available (needs curl+bash, PowerShell, or npm)",
                  file=sys.stderr)
    return cmd_check()


def main():
    # type: () -> None
    if len(sys.argv) < 2 or sys.argv[1] not in ("check", "install"):
        print("usage: preflight_claude.py {check|install}", file=sys.stderr)
        sys.exit(2)

    sys.exit(cmd_check() if sys.argv[1] == "check" else cmd_install())


if __name__ == "__main__":
    main()
