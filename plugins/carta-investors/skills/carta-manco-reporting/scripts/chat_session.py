"""manco-reporting's thin wrapper around the shared claude_chat_session protocol.

Unlike share_bridge.Session (also in this skill), which relays exactly one
locked-down Carta MCP command under a PreToolUse guard hook, this session is
an interactive, user-facing conversation with Read/Edit/Write/Grep/Glob over
the app's own view source — the two have different security postures and are
deliberately not merged (see share_bridge.py's own docstring).

This module supplies only what's specific to manco: MANCO_APP_NOTE (the
system-prompt addition describing manco's view layout), which env var names a
pinned `claude` binary override (the same one share_bridge.py and
preflight_claude.py already use — one source of truth for the override, not a
second name), and the anchor's context keys. Everything else — the stream-json
protocol, the containment argv, anchor rendering, and the model catalog — is
plugins/carta-investors/lib/claude_chat_session.py; see that directory's
README for the import preamble below.
"""
import os
import sys
from pathlib import Path

_LIB = next(p for p in Path(__file__).resolve().parents if (p / "lib" / "live_artifact_render").is_dir()) / "lib"
sys.path.insert(0, str(_LIB))

from claude_chat_session import (  # noqa: E402
    ChatSession as _BaseChatSession,
    build_argv as _shared_build_argv,
    user_message_json,
    parse_event,
    event_text,
    is_turn_end,
    anchor_preamble as _shared_anchor_preamble,
    CLAUDE_MODELS,
    DEFAULT_MODEL,
    ALLOWED_MODEL_VALUES,
    DEFAULT_ALLOWED_TOOLS as ALLOWED_TOOLS,
)

import preflight_claude  # noqa: E402

# Fixed-name data-file routes serve.py serves from DATA_DIR (its _FILE_ROUTES
# is built from this), and the only files this chat session can read outside
# SRC_DIR: scoped_allowed_tools and the system-prompt note below both iterate
# over it, so a route added, removed or renamed here is the only place either
# one needs to change. Files served through serve.py's generic
# /api/report/<name>.json route are NOT readable by chat — a file the model
# must explain belongs here instead.
DATA_FILE_ROUTES = {
    "/api/snapshot": "snapshot.json",
    "/api/accounts": "accounts.json",
}


def _readable_data_paths(data_dir):
    # type: (str) -> dict
    base = Path(data_dir).resolve()
    return {route: str(base / name) for route, name in DATA_FILE_ROUTES.items()}


# Appended to the chat agent's system prompt so it knows where report screens
# live and where the figures they render come from. Screen paths are relative
# to the chat subprocess's cwd (the per-firm src dir, SRC_DIR — see serve.py's
# _chat), which already IS the view root, so there's no "app/src/" prefix to
# strip here even though the pinpoint anchor's own stamps (below) carry one —
# that prefix comes from where the pinpoint capture script runs in the browser
# build (app/src/...), not from this subprocess's filesystem layout. Keep the
# screen-path part in sync by hand with the app's own layout.
#
# The paths are a placeholder here — real callers always pass
# `system_prompt=manco_app_note_for(DATA_DIR)` instead (serve.py's _chat), which
# fills in this session's own absolute paths.
def _manco_app_note(paths_by_route):
    # type: (dict) -> str
    listed = "; ".join(route + " -> " + path for route, path in paths_by_route.items())
    return (
        "This is a ManCo (management company) budget-vs-actuals reporting console. Report "
        "screens live under views/*.jsx (e.g. DashboardView.jsx, BudgetActualsView.jsx, "
        "MonthlyActualsView.jsx); shared chart/table primitives are under charts/ and ui/. "
        "Report figures come from read-only JSON files, fetched in App.jsx: " + listed + ". "
        "The chat session can read those files and nothing else outside this source tree — "
        "no other file in their directory, including the server's own auth token, is "
        "reachable. Only edit how a screen presents those figures (layout, columns, "
        "formatting, added breakdowns); never edit any of those JSON files, and never claim "
        "to have changed a figure itself."
    )


MANCO_APP_NOTE = _manco_app_note(
    {route: "<data-dir>/" + name for route, name in DATA_FILE_ROUTES.items()})


def manco_app_note_for(data_dir):
    # type: (str) -> str
    """MANCO_APP_NOTE with this session's own absolute data-file paths filled
    in — a generic note the model can't resolve from its cwd is no more
    useful to an "explain the numbers" question than no note at all."""
    return _manco_app_note(_readable_data_paths(data_dir))


def _posix_to_claude_abs_rule(posix_path):
    # type: (str) -> str
    """The pure string half of _claude_abs_path_rule, split out so a test can
    exercise the Windows drive-letter rewrite without a Windows filesystem to
    resolve an actual `C:\\...` path against."""
    if len(posix_path) >= 2 and posix_path[1] == ":":  # Windows drive letter, e.g. "C:/Users/x"
        posix_path = "/" + posix_path[0].lower() + posix_path[2:]
    return "//" + posix_path.lstrip("/")


def _claude_abs_path_rule(path):
    # type: (str) -> str
    """Render `path` as a Claude Code permission rule's absolute-path form:
    `//`-prefixed, POSIX-style, and — on Windows only — a lowercased
    single-letter drive segment in place of the drive letter and colon (e.g.
    "C:\\Users\\x" -> "//c/Users/x"). See the "How path patterns match" /
    Windows-paths section of https://code.claude.com/docs/en/permissions.
    """
    return _posix_to_claude_abs_rule(Path(path).resolve().as_posix())


def scoped_allowed_tools(src_dir, data_dir):
    # type: (str, str) -> str
    """The chat subprocess's --allowedTools value: read, edit and write only
    under src_dir (the per-firm view source, already the subprocess's cwd and
    its sole --add-dir), plus read-only access to the JSON files the views
    render their figures from (DATA_FILE_ROUTES, in data_dir) — nothing else
    in data_dir, its auth token (.token) included, is ever approved.

    A bare tool name ("Read", "Edit", ...) approves every call to that tool
    on any path, so every rule here names a path. `Write(path)` and
    `Glob(path)` rules are never matched by Claude Code (only `Edit(path)`
    and `Read(path)` are): an `Edit(path)` rule also governs the Write tool,
    and a `Read(path)` rule also governs Grep and Glob, so neither tool
    needs its own entry here.
    """
    src_rule = _claude_abs_path_rule(src_dir) + "/**"
    rules = ["Edit(" + src_rule + ")", "Read(" + src_rule + ")"]
    rules += ["Read(" + _claude_abs_path_rule(p) + ")"
              for p in _readable_data_paths(data_dir).values()]
    return ",".join(rules)


# The anchor's context fields manco's pinpoint selection carries (vs. fund-modeling's
# "sliceName" for a scenario slice, which manco has no equivalent of).
_ANCHOR_CONTEXT_KEYS = ("firm", "tab", "period", "currency")


def build_argv(claude_bin, add_dirs, model=None, allowed_tools=None, system_prompt=None):
    prompt = MANCO_APP_NOTE if system_prompt is None else system_prompt
    return _shared_build_argv(claude_bin, add_dirs, model, allowed_tools=allowed_tools,
                              system_prompt=prompt)


def anchor_preamble(anchor):
    # The anchor's viewFile/leafFile stamps are the plugin's pinpoint capture
    # script's own repo-relative paths, e.g. "app/src/views/X.jsx" — that
    # prefix reflects where the browser build runs the capture script from,
    # not SRC_DIR's own layout, so it must be stripped here the same way
    # MANCO_APP_NOTE's own paths never carry it.
    return _shared_anchor_preamble(anchor, context_keys=_ANCHOR_CONTEXT_KEYS, strip_prefix="app/src/")


class ChatSession(_BaseChatSession):
    def __init__(self, cwd, add_dirs, claude_bin=None, model=None,
                 allowed_tools=None, system_prompt=None):
        # `build_argv=build_argv` is a bare-name lookup against THIS module's
        # globals, resolved fresh on every call (not frozen at class-definition
        # time) — so a test that does `chat_session.build_argv = stub` before
        # constructing a ChatSession reaches the stub inside start(), the same
        # way tests have always patched a skill's own chat_session module.
        super(ChatSession, self).__init__(
            cwd, add_dirs,
            claude_bin=claude_bin or os.environ.get(preflight_claude.CLAUDE_BIN_ENV, "claude"),
            model=model, allowed_tools=allowed_tools, system_prompt=system_prompt,
            build_argv=build_argv)
