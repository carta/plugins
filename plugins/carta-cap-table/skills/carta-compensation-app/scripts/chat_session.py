"""Long-lived `claude` stream-json process manager for the CTC console's ask box.

Pure-Python-stdlib. Containment (no Bash, no MCP, scoped dirs) is baked into
build_argv rather than left to the caller.

No pinpoint anchor rendering and no model catalog: this console has a single
textfield, not a chat surface with a model picker, so neither has anything to
drive it.

The browser never talks to Anthropic. serve.py spawns one `claude` subprocess per
session and relays its stream-json output as SSE; auth comes from whatever
environment launched serve.py, so no key is handled here.
"""
import json
import os
import queue
import subprocess
import threading
import uuid
from typing import List, Optional

# NO Bash, and no MCP tools. The skill's own session is what refetches from Carta;
# this subprocess only ever sees the two directories passed as --add-dir, which
# preserves the console's "the browser never triggers a Carta call" invariant.
# Seconds to wait after SIGTERM, and again after SIGKILL, when closing a session.
# Shutdown blocks on this, so it is short: long enough for a healthy process to
# flush and exit, not long enough to make quitting feel hung.
TERMINATE_TIMEOUT = 5

ALLOWED_TOOLS = "Read,Edit,Write,Grep,Glob"

# Appended to the ask-box agent's system prompt. This is the load-bearing part of
# the port: the subprocess is a FRESH Claude that has never read SKILL.md, so every
# rule it needs about deriving values has to be restated here or it will produce an
# unlabelled number that looks exactly like a fetched one.
#
# The rules themselves are SKILL.md's ("Changing the app when the user asks") and
# the header of app/src/views/Scorecard.jsx — keep the three in step.
CTC_APP_NOTE = (
    "You are editing a local read-only console for one corporation's Carta Total "
    "Compensation data. Source is at app/src (views/ = one file per tab, ui/ = theme "
    "tokens and shared components, model/ = pure functions with NO React imports). "
    "Edits to app/src take effect on the next page load - there is no build step, so "
    "never run a build and never suggest one.\n"
    "\n"
    "The data dir holds one JSON file per view. Each row's fields are the authoritative "
    "list: do not assume a field exists because a sibling file has it, and do not "
    "assume it does NOT exist without grepping the JSON or the builder in "
    "scripts/build_datadir.py.\n"
    "\n"
    "* Scorecard (views/Scorecard.jsx) reads roster.json. Per-employee snapshot; row "
    "fields include externalId, name, title, jobArea, focus, level, leader, bands, "
    "metrics, compaRatios, targetVariable, totalCash, equity, ntmEquity. Built by "
    "_build_roster in scripts/build_datadir.py:754.\n"
    "* Benchmarks (views/Benchmarks.jsx) reads benchmarks.json. Percentile bands per "
    "role/level/geo; row fields include job, level, ladder, geo, currency, salary, "
    "tcc, equity (each a P25/P50/P75/P90 map), plus provenance / provenanceNote for "
    "user-added or interpolated rows. Percentile registry is model/taxonomy.js "
    "PERCENTILES; `fetched: false` percentiles are interpolated.\n"
    "* Refresh Planner (views/RefreshPlanner.jsx + views/planner/*.jsx) reads "
    "planner.json. Per-employee refresh candidates; row fields include external_id, "
    "full_name, job_title, job_area, job_focus, job_level, job_track, location, "
    "hire_date, total_vested_shares, total_unvested_shares, live_award_count, "
    "four_year_grant_benchmark_num_shares, date_of_final_vest, plus top-level "
    "poolAvailableShares, poolReservedShares, poolUsedShares, poolFullyDilutedShares, "
    "equityUnits, policy, availability. Built by _build_planner in "
    "scripts/build_datadir.py:838; the `availability` map at lines 881-892 is the "
    "definitive list of which fields THIS build actually captured.\n"
    "* Shared: snapshot.json, taxonomy.json, corporation_info.json, scenarios.json "
    "(config, as-of, job/level labels, corp identity, saved planner scenarios).\n"
    "\n"
    "Before claiming a field is missing: grep the relevant JSON file for it AND grep "
    "scripts/build_datadir.py / scripts/save_*.py for it. `total_unvested_shares` on "
    "the Refresh Planner is a first-class field, not a computed value.\n"
    "\n"
    "This console must never SILENTLY disagree with the CTC product UI, so:\n"
    "* NEVER edit anything in the data dir. It is a fetched cache, not a working file. "
    "Change how data is displayed, never the data itself.\n"
    "* You MAY interpolate between two percentiles the server returned (P25, P50, P75, "
    "P90 are all real fetched values) - a P60 from P50 and P75 is arithmetic bounded by "
    "two real numbers.\n"
    "* NEVER extrapolate past the fetched range. A P95 or P99 from P90, or anything below "
    "P25, has no second bound to sit between and is a guess wearing a percentile's name.\n"
    "* NEVER recompute a field the API already returns - compa-ratios and LOW/MID/HIGH "
    "bands come from the API precisely so this console agrees with the product UI.\n"
    "* NEVER invent a location/geo adjustment. No command returns scalars across the "
    "supported locations, so a location control would have to fabricate them.\n"
    "\n"
    "Adding a column, filter, sort, tag, restyling a table, adding a user-supplied "
    "external benchmark or reference row, or any UI change the user asks for is IN "
    "SCOPE - act on it. The rules above are about silently passing off non-CTC values "
    "as CTC values, not a general refusal license.\n"
    "\n"
    "Three allowed paths for a value the user asks to display:\n"
    "1. The row already carries the field - render it. No marker needed. "
    "(e.g. `total_unvested_shares` on planner rows.)\n"
    "2. Arithmetic bounded by two real fields on the same row (e.g. total - vested "
    "when both are present) - render it. No marker needed.\n"
    "3. User-supplied external data, or interpolation between two real percentiles - "
    "render it WITH the <SparkleAI/> component from ui/components.jsx (icon-only, "
    "matching the usage at planner/FilterBox.jsx:259), placed next to the value or "
    "on the column header, visible on first render (not behind a toggle or legend). "
    "The parent element carries a `title` tooltip naming the source, e.g. "
    "title=\"Claude estimated - interpolated between P50 and P75\" or "
    "title=\"User-added - Radford, Q3 2026\". SparkleAI + a source tooltip is what "
    "makes non-CTC values safe to display; the whole point of the icon is that "
    "refusing an external-source row because it isn't a CTC value is the specific "
    "mistake this rule exists to prevent. DO NOT use the older "
    "<Tag tone=\"notice\">Estimated</Tag> pattern for AI/user-provided content - it "
    "is being retired in favor of SparkleAI. The <Tag tone=\"notice\" pill> component "
    "itself stays right for non-AI notices (feature-flag gates, cache staleness, "
    "unsaved-change markers, save conflicts, in-console calculation notes) - do not "
    "touch those.\n"
    "\n"
    "Refuse only when a value is genuinely inventable (no user source, not a field, "
    "not arithmetic on two real fields), or when it would extrapolate past the "
    "fetched percentile range with no second bound. Those are the narrow cases the "
    "fabrication rule actually covers.\n"
    "\n"
    "Match the surrounding code: inline style objects using the C/FS/RADIUS tokens from "
    "ui/theme.js (never hardcoded hex, never CSS classes), relative imports WITH file "
    "extensions, and Title Case for anything a user reads (jobLabel/levelLabel from "
    "model/taxonomy.js) - UPPER_SNAKE is for machine handoff only. Absent values render "
    "as an em dash, never 0.\n"
    "\n"
    "Keep replies to a sentence or two: they appear under a single-line textfield, not in "
    "a chat transcript. Say what you changed, not how you did it."
)


# Prepended to each turn's prompt so a new AskBar file/field lands here alongside
# the matching CTC_APP_NOTE update. Serve.py resolves the page via page_hint_for().
_PAGE_HINTS = {
    "Scorecard": (
        "Current view: Scorecard → app/src/views/Scorecard.jsx, backed by "
        "roster.json. Row fields include externalId, name, title, jobArea, focus, "
        "level, leader, bands, metrics, compaRatios, targetVariable, totalCash, "
        "equity, ntmEquity."
    ),
    "Benchmarks": (
        "Current view: Benchmarks → app/src/views/Benchmarks.jsx, backed by "
        "benchmarks.json. Row fields: job, level, ladder, geo, currency, salary, "
        "tcc, equity (each a percentile map), provenance, provenanceNote. "
        "Interpolated percentiles and user-added rows render with <SparkleAI/> plus "
        "a source-naming title tooltip."
    ),
    "RefreshPlanner": (
        "Current view: Refresh Planner → app/src/views/RefreshPlanner.jsx, backed "
        "by planner.json. Row fields include external_id, full_name, job_title, "
        "job_area, job_focus, job_level, job_track, location, hire_date, "
        "total_vested_shares, total_unvested_shares, live_award_count, "
        "four_year_grant_benchmark_num_shares, date_of_final_vest."
    ),
    "RefreshPlanner:SettingsStep": (
        "Current view: Refresh Planner → Settings step → "
        "app/src/views/planner/SettingsStep.jsx (a sub-step of RefreshPlanner.jsx), "
        "backed by planner.json. Edit SettingsStep.jsx for changes scoped to this "
        "step. Row fields as for RefreshPlanner; the step's own state is refresh "
        "policy inputs."
    ),
}


def page_hint_for(page):
    # type: (Optional[str]) -> Optional[str]
    """Per-view hint for `page`, or None on absent/unknown (a wrong hint would steer
    the model at a file the user is not on)."""
    if not page:
        return None
    return _PAGE_HINTS.get(page)


def build_argv(claude_bin, add_dirs, model=None, allowed_tools=None, system_prompt=None):
    # type: (str, List[str], Optional[str], Optional[str], Optional[str]) -> List[str]
    tools = allowed_tools or ALLOWED_TOOLS
    argv = [
        claude_bin, "-p",
        "--input-format", "stream-json",
        "--output-format", "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--permission-mode", "acceptEdits",
        # --tools decides which tools EXIST; --allowedTools only auto-approves ones
        # that already do. Passing allowedTools alone leaves Bash, Task, Workflow and
        # WebFetch loaded and merely un-approved, which is not containment — verified
        # against a live CLI, where the init frame listed all of them.
        "--tools", tools,
        "--allowedTools", tools,
        # Without this the subprocess inherits the user's own MCP servers (Carta
        # included), which would let a prompt typed in the browser reach Carta and
        # break the console's "the browser never triggers a Carta call" invariant.
        # No --mcp-config is passed, so strict mode resolves to no servers at all.
        "--strict-mcp-config",
    ]
    prompt = CTC_APP_NOTE if system_prompt is None else system_prompt
    if prompt:
        argv += ["--append-system-prompt", prompt]
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


def touched_app_source(event):
    # type: (dict) -> bool
    """True if this event is Claude editing a file under the app's source tree.

    The console reloads itself after a turn that changed source, and only then --
    a reload costs the user their tab and filters, so a question that changed
    nothing must not trigger one. Read as: an assistant tool_use for a writing
    tool, whose target path is a .js/.jsx file.

    Tool names are matched case-insensitively because the CLI has shipped both
    `Edit`/`Write` and lowercase variants; a missed match here means a silently
    stale page, which is worse than an unnecessary reload.
    """
    if event.get("type") != "assistant":
        return False
    for block in event.get("message", {}).get("content", []):
        if block.get("type") != "tool_use":
            continue
        if str(block.get("name", "")).lower() not in ("edit", "write", "multiedit", "notebookedit"):
            continue
        path = str((block.get("input") or {}).get("file_path") or "")
        if path.endswith(".jsx") or path.endswith(".js") or path.endswith(".css"):
            return True
    return False


class ChatSession(object):
    def __init__(self, cwd, add_dirs, claude_bin=None, model=None,
                 allowed_tools=None, system_prompt=None):
        # type: (str, List[str], Optional[str], Optional[str], Optional[str], Optional[str]) -> None
        self.cwd = cwd
        self.add_dirs = add_dirs
        self.claude_bin = claude_bin or os.environ.get("CTC_CLAUDE_BIN", "claude")
        self.model = model
        self.allowed_tools = allowed_tools
        self.system_prompt = system_prompt
        self.proc = None
        self._q = queue.Queue()
        self._reader = None
        self._closed = False
        # send() runs on the thread streaming a turn; interrupt() runs on another
        # request thread while that turn is still in flight. Both write a whole
        # frame + newline to the same pipe, so they serialize on this.
        self._stdin_lock = threading.Lock()

    def start(self):
        argv = build_argv(self.claude_bin, self.add_dirs, self.model,
                          allowed_tools=self.allowed_tools, system_prompt=self.system_prompt)
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
            with self._stdin_lock:
                self.proc.stdin.write(user_message_json(text) + "\n")
                self.proc.stdin.flush()
        except (BrokenPipeError, OSError, ValueError):
            self._closed = True
            raise RuntimeError("chat session is closed")

    def interrupt(self):
        # type: () -> bool
        """Abort the turn in flight, keeping the session and its context alive.

        The CLI accepts a `control_request` on stdin in stream-json input mode
        (which build_argv always uses) and answers with a `control_response`. It
        then ends the aborted turn with an ordinary `result` frame carrying
        terminal_reason `aborted_streaming` / `aborted_tools` — so the turn's SSE
        reader still latches turn-end via is_turn_end() and the subprocess is
        deliberately NOT reaped. `cancel_queued` sweeps any user message accepted
        but not yet dispatched, so Stop means stop rather than "stop, then run the
        next one".

        Returns False when there is no live subprocess left to signal; callers
        treat that as "already finished", not as an error. Deliberately does not
        flip _closed: the thread streaming the turn owns that transition, and
        racing it here would evict a session that is still perfectly usable.
        """
        if self._closed or self.proc is None or self.proc.poll() is not None:
            return False
        frame = json.dumps({
            "type": "control_request",
            "request_id": "interrupt-" + uuid.uuid4().hex[:12],
            "request": {"subtype": "interrupt", "cancel_queued": True},
        })
        try:
            with self._stdin_lock:
                self.proc.stdin.write(frame + "\n")
                self.proc.stdin.flush()
        except (BrokenPipeError, OSError, ValueError):
            return False
        return True

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
            # SIGTERM, then SIGKILL if it is ignored. `claude` mid-stream or blocked
            # on I/O can outlive the polite signal, and swallowing the timeout here
            # leaves it running for as long as the machine is up — the exact orphan
            # _close_all_sessions in serve.py exists to prevent.
            self.proc.terminate()
            try:
                self.proc.wait(timeout=TERMINATE_TIMEOUT)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                try:
                    self.proc.wait(timeout=TERMINATE_TIMEOUT)
                except (subprocess.TimeoutExpired, OSError):
                    # Unreapable after SIGKILL means the process is already gone or
                    # is an unkillable zombie; either way there is nothing further
                    # this process can do, and shutdown must not block on it.
                    pass
            except OSError:
                pass
        self._closed = True
