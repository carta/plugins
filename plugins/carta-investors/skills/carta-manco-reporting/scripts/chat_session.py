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

# Appended to the chat agent's system prompt so it knows where report screens
# live and treats report figures as read-only. Paths are relative to the chat
# subprocess's cwd (the per-firm src dir, SRC_DIR — see serve.py's _chat),
# which already IS the view root, so there's no "app/src/" prefix to strip
# here even though the pinpoint anchor's own stamps (below) carry one — that
# prefix comes from where the pinpoint capture script runs in the browser
# build (app/src/...), not from this subprocess's filesystem layout. Keep this
# in sync by hand with the app's own layout.
MANCO_APP_NOTE = (
    "This is a ManCo (management company) budget-vs-actuals reporting console. Report "
    "screens live under views/*.jsx (e.g. DashboardView.jsx, BudgetActualsView.jsx, "
    "MonthlyActualsView.jsx); shared chart/table primitives are under charts/ and ui/. "
    "Report figures are read via state/useReports.js, but the chat session has no "
    "filesystem access to the JSON they come from or to anything else outside this "
    "source tree (its --add-dir is scoped to SRC_DIR alone) — it can only see report "
    "figures already rendered into a screen, never the underlying data files. Only edit "
    "how a screen presents those figures (layout, columns, formatting, added "
    "breakdowns); never claim to have changed a figure itself."
)

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
