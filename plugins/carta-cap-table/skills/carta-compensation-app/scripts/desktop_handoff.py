"""Hand a refresh plan to Claude Desktop by file, not by clipboard.

The review step used to copy a prompt for the user to paste. This writes the plan
to a file Claude Desktop can read and opens a session that names it, so the full
list arrives without a paste.

WHY A FILE RATHER THAN THE URL
The prompt travels inside the claude:// link, so plan size becomes URL length. A
real saved scenario (94 employees) url-encodes to 4,865 characters and the full
Meetly cohort to 6,620, against the 4,000-character cap the sibling launcher
(fa-financial-reporting/.../launch_session.py) uses to stay under OS URL-handler
limits. A large plan is exactly when this automation matters most, so the payload
cannot live in the link. The link names a file instead and stays ~600 characters
whether the plan holds three people or five hundred.

WHY THIS PARTICULAR DIRECTORY
Claude Desktop's config declares `coworkUserFilesPath` (~/Documents/Claude) and,
on the machine this was built against, carries NO filesystem MCP server -- only
`carta-test`. So an arbitrary path is unreachable and the console's own data dir
under ~/.cache/ is out of the question. Verified empirically before building: a
session opened through claude:// read a file from that directory and wrote one
back, with no permission prompt, despite being rooted in an unrelated working
directory. That last part is what makes this work at all.

WHAT THE USER STILL HAS TO DO
The link PRE-FILLS the composer; it does not send. Nothing runs until the user
presses enter. The caller must say so rather than implying the handoff is already
under way -- a user who clicks and walks away would otherwise return to an unsent
prompt believing grants were being drafted.

Every failure here RAISES rather than reporting a hollow success, because the
caller's fallback (copy to clipboard) is genuinely useful and can only be offered
if it knows this route failed.
"""

from __future__ import annotations

import json
import os
import platform
import re
import subprocess
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

# Claude Desktop's settings file, which declares where its readable user-files
# directory lives. Read at call time rather than cached: the user can change it,
# and a stale path fails as a silent write to nowhere.
_DESKTOP_CONFIG = (
    Path.home() / "Library/Application Support/Claude/claude_desktop_config.json"
)

# Where plans go when the config declares nothing. Same default Desktop itself
# uses, so this is a reasonable guess rather than an invention -- but it is only
# ever used after confirming the directory actually exists (see plan_dir).
_DEFAULT_COWORK_DIR = Path.home() / "Documents/Claude"

# Plans are written under this name plus a timestamp. The prefix makes them
# greppable and makes it obvious to a user browsing the directory where they came
# from -- these files persist, and an opaque name in a personal folder is litter.
_FILE_PREFIX = "ctc-refresh-plan"

# Keep a corporation's name usable in a filename without inviting a traversal or a
# shell surprise. Anything outside this set becomes a hyphen.
_UNSAFE_IN_NAME = re.compile(r"[^A-Za-z0-9._-]+")

# How many plan files to keep in the user's directory. These are handoff records,
# useful to look back at, but this is someone's Documents folder and not a log
# store -- so old ones are pruned rather than accumulating forever.
_KEEP_PLANS = 20


def cowork_dir(config_path: "Path | None" = None) -> "Path | None":
    """Claude Desktop's readable user-files directory, or None if unusable.

    Returns None rather than raising or guessing when the setting is missing, the
    config is unreadable, or the directory does not exist -- all three are normal
    on someone else's machine, and each means the file route is unavailable so the
    caller should fall back to the clipboard.

    The directory is NOT created when absent. Its existence is Desktop's signal
    that the feature is configured; making one ourselves would produce a path
    Desktop has no reason to read.
    """
    path = config_path or _DESKTOP_CONFIG
    declared = None
    try:
        cfg = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(cfg, dict):
            value = cfg.get("coworkUserFilesPath")
            if isinstance(value, str) and value.strip():
                declared = Path(value.strip()).expanduser()
    except (OSError, ValueError):
        # No config, unreadable config, or malformed JSON. The default below is
        # still worth trying -- Desktop uses the same one -- but only if it exists.
        declared = None

    for candidate in (declared, _DEFAULT_COWORK_DIR):
        if candidate and candidate.is_dir():
            return candidate
    return None


def plan_filename(corporation: "str | None", now: "datetime | None" = None) -> str:
    """A dated, corporation-stamped filename for one plan.

    Timestamped to the second so two handoffs in a session do not overwrite each
    other -- the earlier file is the record of what was actually handed over, and
    silently replacing it would destroy the audit trail this route otherwise gives
    us for free.
    """
    stamp = (now or datetime.now()).strftime("%Y%m%d-%H%M%S")
    # Dots are legal in a filename but a run of them is not worth carrying: the
    # separators in "../../etc" are already gone by here, yet the leftover ".." is a
    # hazard to anything that later resolves this name as a path. Collapse them, and
    # strip the result so a name made entirely of punctuation degrades to no name at
    # all rather than to a bare "-" or ".".
    name = _UNSAFE_IN_NAME.sub("-", (corporation or "").strip())
    name = re.sub(r"\.+", ".", name).strip("-.")
    return f"{_FILE_PREFIX}-{name}-{stamp}.md" if name else f"{_FILE_PREFIX}-{stamp}.md"


def prune_old_plans(directory: Path, keep: int = _KEEP_PLANS) -> None:
    """Delete all but the newest `keep` plan files.

    Scoped hard to this module's own prefix so nothing else in a user's directory
    can be caught by it -- notably Desktop's own Artifacts/ subdirectory, which is
    skipped by the glob and by the is_file() check.

    Failures are swallowed: pruning is housekeeping, and a plan that was written
    successfully must not be reported as failed because an old file would not
    delete.
    """
    try:
        plans = sorted(
            (p for p in directory.glob(f"{_FILE_PREFIX}-*.md") if p.is_file()),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        for stale in plans[keep:]:
            stale.unlink(missing_ok=True)
    except OSError:
        pass


def write_plan(prompt: str, corporation: "str | None", directory: Path,
               now: "datetime | None" = None) -> Path:
    """Write `prompt` into `directory` and return the path.

    Written via a temp file plus os.replace so a crash mid-write cannot leave a
    truncated plan behind -- the same rule the scenarios save follows. A half-written
    plan is worse than none: it would name real employees with some of their share
    counts missing, and nothing downstream would flag it.
    """
    path = directory / plan_filename(corporation, now)
    tmp = path.with_suffix(".md.tmp")
    tmp.write_text(prompt, encoding="utf-8")
    os.replace(tmp, path)
    return path


def build_prompt(plan_path: Path, corporation: "str | None", employees: int,
                 total_shares: "int | None" = None) -> str:
    """The SHORT prompt that goes in the URL, naming the file that holds the plan.

    Deliberately not a summary of the plan. Its whole job is to get the session to
    open the file and start the issuance flow; the figures it does carry are there
    so the user can see at a glance that the right plan was handed over, and so a
    session that cannot read the file can still say what it was meant to receive.

    The read instruction is first and explicit. A session that starts drafting from
    the three figures in this prompt rather than the file would issue a plan it
    never actually read.
    """
    who = corporation or "this corporation"
    lines = [
        f"Read the refresh grant plan at {plan_path} and draft the option grants"
        f" it describes in Carta for {who}.",
        "",
        f"That file holds the full plan — {employees}"
        f" employee{'' if employees == 1 else 's'}"
        + (f", {total_shares:,} shares in total" if total_shares else "")
        + ". Read it before doing anything else; do not work from this message"
        " alone, which is only a pointer to it.",
        "",
        "The file states which terms are deliberately absent and must be asked"
        " for rather than guessed.",
        "",
        "Draft only — do not issue.",
    ]
    return "\n".join(lines)


def build_url(prompt: str) -> str:
    """The claude:// deep link that opens a new session with `prompt` pre-filled.

    `errors="replace"` keeps a lone UTF-16 surrogate -- mojibake in an employee
    name that survives a JSON round-trip -- from raising out of quote(). The
    session still opens, with the bad character substituted, rather than the
    handoff failing over one byte in one name. Same guard as the sibling launcher.
    """
    return "claude://code/new?q=" + quote(prompt, errors="replace")


def open_url(url: str) -> None:
    """Open `url` with the OS handler (Claude Desktop registers claude://).

    Every branch raises on failure so the caller can offer the clipboard instead of
    reporting a success that never happened. On macOS and Linux we WAIT for the
    opener and check its exit status -- it only hands the URL to the OS launcher and
    returns in milliseconds, so this does not block on Desktop itself; `timeout` is
    a backstop for an opener that hangs.
    """
    system = platform.system()
    if system == "Darwin":
        subprocess.run(["open", url], check=True, timeout=30)
    elif system == "Windows":
        os.startfile(url)  # type: ignore[attr-defined]  # Windows-only, guarded above
    else:
        subprocess.run(["xdg-open", url], check=True, timeout=30)


def hand_off(full_prompt: str, corporation: "str | None", employees: int,
             total_shares: "int | None" = None, config_path: "Path | None" = None,
             now: "datetime | None" = None, opener=None) -> dict:
    """Write the plan and open a session pointed at it.

    Returns {"path": str, "url": str} on success. Raises on every failure, so the
    caller knows to fall back to the clipboard and can say which step failed --
    "Claude Desktop did not open" and "the plan could not be written" send the user
    to different places.

    `opener` is injectable so tests can exercise the whole path without spawning a
    real window.
    """
    directory = cowork_dir(config_path)
    if directory is None:
        raise FileNotFoundError(
            "Claude Desktop's user-files directory was not found. It is set as"
            " 'coworkUserFilesPath' in Claude Desktop's config and must exist."
        )

    path = write_plan(full_prompt, corporation, directory, now=now)
    # Prune AFTER writing, so a pruning failure can never cost us the new plan and
    # the file we just wrote is the newest one kept.
    prune_old_plans(directory)

    url = build_url(build_prompt(path, corporation, employees, total_shares))
    (opener or open_url)(url)
    return {"path": str(path), "url": url}
