#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# ///
"""Locate the `claude` CLI for report sharing (Step 0.5). Never installs it.

serve.py uses find_claude() and probe() to decide whether sharing can run and which
binary to use; share_bridge.py reads CLAUDE_BIN_ENV for the env-var override's name.
Ported from carta-compensation-app's script of the same name. Keep probe() and
auth_status() in sync with it by hand. The lookup (find_claude_located(), and
find_claude() over it) is this copy's own, as is the absence of an `install` command:
this copy only looks, because the plugin directory does not allow the skill to
install software the user did not ask for. There is no shared scripts/ directory
across skills to import from (see
plugins/carta-investors/lib/README.md for the one that does exist, for live-artifact
rendering only).
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

# Anthropic's official installer commands. Nothing here runs them: serve.py's chat
# fix-prompt quotes them verbatim for the operator to run themselves, so this is
# the one place either changes.
_NATIVE_INSTALL_SH = "https://claude.ai/install.sh"
_NATIVE_INSTALL_PS1 = "https://claude.ai/install.ps1"
NATIVE_INSTALL_SH_CMD = "curl -fsSL %s | bash" % _NATIVE_INSTALL_SH
NATIVE_INSTALL_PS1_CMD = "irm %s | iex" % _NATIVE_INSTALL_PS1

# Why sharing cannot run. Only these reach the browser (via /api/claude-status);
# anything more specific goes to the server log.
REASON_OK = "ok"
REASON_NOT_INSTALLED = "not_installed"
REASON_NOT_LOGGED_IN = "not_logged_in"

# The env override a caller can set to pin a specific binary (matches
# share_bridge.py's Session, which reads this same name).
CLAUDE_BIN_ENV = "MANCO_CLAUDE_BIN"

# Where find_claude() located the binary. SOURCE_SESSION is the one source that
# does not survive past this Claude Code session: the path names a version that an
# auto-update can delete while the server still runs (serve-and-update.md, Step 0.5).
# probe()/auth_status() don't care: a session binary is a perfectly good binary to
# actually run commands with.
SOURCE_ENV = "env"
SOURCE_PATH = "path"
SOURCE_KNOWN = "known_location"
SOURCE_NVM = "nvm"
SOURCE_SESSION = "session"


def _is_executable(p):
    # type: (Path) -> bool
    return p.is_file() and os.access(p, os.X_OK)


def _known_locations():
    # type: () -> List[Path]
    home = Path.home()
    if _WIN:
        appdata = os.environ.get("APPDATA", "")
        return [
            # Where the native installer (install.ps1) puts claude.exe. It also adds
            # this directory to the user's PATH in the registry, but a process already
            # running (this one, and anything it launches) keeps its old PATH — so
            # a CLI the operator just installed would otherwise report claude_bin=none.
            home / ".local" / "bin" / _BIN,
            home / "AppData" / "Roaming" / "npm" / _BIN,
            *([Path(appdata) / "npm" / _BIN] if appdata else []),
        ]
    return [
        home / ".local" / "bin" / _BIN,
        Path("/usr/local/bin") / _BIN,
        home / ".npm-global" / "bin" / _BIN,
    ]


def find_claude_located():
    # type: () -> tuple
    """Return (path, source) for the claude binary, or (None, None).

    `source` is one of the SOURCE_* constants above. SOURCE_SESSION is last on
    purpose — every durable location (env, PATH, known install dirs, nvm) is
    checked first, so a durable install is never reported as session-only just
    because a session happens to be running too (nvm's own binary usually
    isn't on PATH for a GUI-launched process, so it has to be checked for
    explicitly before falling back to the session's own, non-durable, copy).
    """

    # 1. Explicit override via env var (matches share_bridge.py's Session).
    env_bin = os.environ.get(CLAUDE_BIN_ENV, "").strip()
    if env_bin:
        p = Path(env_bin).expanduser().absolute()
        if _is_executable(p):
            return str(p), SOURCE_ENV

    # 2. Standard PATH lookup.
    which = shutil.which(_BIN)
    if which:
        return str(Path(which).absolute()), SOURCE_PATH

    # 3. Well-known locations (native installer, npm global, Homebrew, manual).
    for c in _known_locations():
        if _is_executable(c):
            return str(c.absolute()), SOURCE_KNOWN

    # 4. NVM-managed Node installations (Unix only).
    if not _WIN:
        home = Path.home()
        nvm_pattern = str(home / ".nvm" / "versions" / "node" / "*" / "bin" / _BIN)
        for match in sorted(glob.glob(nvm_pattern), reverse=True):
            p = Path(match)
            if _is_executable(p):
                return str(p.absolute()), SOURCE_NVM

    # 5. The binary of the Claude Code session that launched this skill. Every user
    #    of this skill is inside one, so this finds a working, logged-in CLI even
    #    when nothing is on PATH (IDE and desktop installs). It comes after every
    #    durable location above because the path names a version: a Claude Code
    #    auto-update can delete it while the dashboard is still running.
    exec_path = os.environ.get("CLAUDE_CODE_EXECPATH", "").strip()
    if exec_path:
        p = Path(exec_path).expanduser().absolute()
        if _is_executable(p):
            return str(p), SOURCE_SESSION

    return None, None


def find_claude():
    # type: () -> Optional[str]
    """Return the absolute path to the claude binary, or None. See
    find_claude_located() for which location it came from."""
    return find_claude_located()[0]


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
    """Whether report sharing can run: {"bin", "reason"}.

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
    found, source = find_claude_located()
    if found:
        version = _get_version(found)
        print("claude_bin=%s" % found)
        print("claude_source=%s" % source)
        if version:
            print("claude_version=%s" % version)
        logged_in = auth_status(found)
        print("claude_auth=%s" % (
            "unknown" if logged_in is None else "logged_in" if logged_in else "logged_out"))
        return 0
    print("claude_bin=none")
    return 1


def main():
    # type: () -> None
    if sys.argv[1:] != ["check"]:
        print("usage: preflight_claude.py check", file=sys.stderr)
        sys.exit(2)

    sys.exit(cmd_check())


if __name__ == "__main__":
    main()
