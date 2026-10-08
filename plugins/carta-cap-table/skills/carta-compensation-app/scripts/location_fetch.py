#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# ///
"""Fetch one location's benchmarks when the Benchmarks tab's picker asks for it.

The CTC product's Benchmarks page offers every supported location (~440) and asks
the server for each one when it is picked. Pre-fetching them all at build time
would be ~1,800 calls, so the console does what the product does: it fetches on
demand. serve.py calls fetch() for a location the build did not already sweep.

How a fetch reaches Carta: serve.py has no Carta credentials and never will. It
spawns headless `claude -p` sessions, which reach Carta through the user's own
Carta MCP connection, the same one the skill used to build the dashboard. Each
session gets no built-in tools and may call only `welcome` and `call_tool` on that
one server. It is told the exact arguments to pass, and the arguments it actually
sent are checked against them before its result is used. The page comes off the
session's event stream as the raw tool result and is never retyped by a model.
That is the capture contract SKILL.md sets for the build, applied unchanged.

Only one command is ever issued, compensation:export:benchmarks, and it is
read-only. The browser picks a location value from the catalog the build saved;
it cannot choose a command or any other argument.

A location is the same 4-page export sweep as the default (22 job areas, 6 per
page), run as 4 sessions in parallel, and validated the same way the builder
validates a build-time sweep: every job area covered, one benchmark release, the
plan's release. A partial sweep is an error, never a partial dropdown entry.

Stdlib-only, 3.9-safe.
"""
import json
import os
import pathlib
import re
import shutil
import subprocess
import threading
import time
from typing import Dict, List, Optional

import build_datadir
import save_benchmark_result

EXPORT_TOOL = "compensation__export__benchmarks"
JOB_LIMIT = 6
TOTAL_JOB_AREAS = 22
PAGE_TIMEOUT = 150
MODEL = "sonnet"
LOG_NAME = "location-fetch.log"
# Where serve.py keeps fetched locations, under the data dir.
CACHE_DIR = "locations"

# The Carta plugin's hook adds this field in an interactive session. It doesn't
# run headless, and the server rejects a call without `surface` (verified: the
# welcome call bounces and costs a turn).
_INSTRUMENTATION = {"skills": ["carta-cap-table:carta-compensation-app"],
                    "surface": "sdk-cli"}

SYSTEM_PROMPT = (
    "You are a data-fetch executor for a local Carta Total Compensation console. "
    "Do ONLY the tool calls the user message lists, in order, with exactly the "
    "arguments given. Pass `arguments` and `_instrumentation_v2` as JSON objects, "
    "never as strings, and copy every value byte-for-byte. Never add a key, never "
    "call any other tool, never retry a call with different arguments. "
    "When the calls have returned, reply with exactly: DONE."
)

_KEY_RE = re.compile(r"[^a-z0-9]+")


class FetchError(Exception):
    """A location could not be fetched. `reason` is a short code for the page."""

    def __init__(self, reason, detail=""):
        super(FetchError, self).__init__("%s: %s" % (reason, detail) if detail else reason)
        self.reason = reason
        self.detail = detail


def cache_key(location, local_currency):
    # type: (str, bool) -> str
    """File-safe key for one (location, currency) pair: ",,GBR" + local -> "gbr-local"."""
    key = _KEY_RE.sub("-", (location or "").lower()).strip("-") or "unknown"
    return key + ("-local" if local_currency else "")


def export_args(config, location, local_currency, job_offset):
    # type: (dict, str, bool, int) -> dict
    """The exact arguments for one export page. Built here, never by the browser."""
    args = {
        "corporation_id": config["corporationId"],
        "benchmark_version_id": config["benchmarkVersionId"],
        config["bucketParam"]: config["bucketCode"],
        "equity_quantity": "FOUR_YEAR_GRANT",
        "job_limit": JOB_LIMIT,
        "job_offset": job_offset,
        "location": location,
    }
    if local_currency:
        args["convert_to_local_currency"] = True
    return args


def page_prompt(server, args, tool=EXPORT_TOOL):
    # type: (str, dict, str) -> str
    inst = json.dumps(_INSTRUMENTATION)
    return (
        "Do these two tool calls in order, then reply DONE:\n"
        "1. mcp__%s__welcome {\"_instrumentation_v2\": %s}\n"
        "2. mcp__%s__call_tool {\"name\": \"%s\", \"arguments\": %s, "
        "\"_instrumentation_v2\": %s}"
        % (server, inst, server, tool, json.dumps(args), inst)
    )


def build_argv(claude_bin, server):
    # type: (str, str) -> List[str]
    return [
        claude_bin, "-p",
        "--output-format", "stream-json",
        "--verbose",
        # No built-in tools at all: no Read, no Bash, no Write.
        "--tools", "",
        "--allowedTools", "mcp__%s__welcome,mcp__%s__call_tool" % (server, server),
        "--append-system-prompt", SYSTEM_PROMPT,
        "--model", MODEL,
    ]


def _env():
    env = dict(os.environ)
    # An export page is ~17-25k characters. Keep it inline in the tool result
    # rather than letting the CLI spill it to a file the session would then need
    # Read to open.
    env["MAX_MCP_OUTPUT_TOKENS"] = "200000"
    # Deferred tools would need ToolSearch, which --tools "" removes.
    env["ENABLE_TOOL_SEARCH"] = "false"
    return env


def _flatten(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(b.get("text") or "" for b in content
                       if isinstance(b, dict) and b.get("type") == "text")
    return ""


# A result over Claude Code's inline size limit reaches the session as a pointer:
# "<persisted-output>Output too large (65.7KB). Full output saved to: /…/x.txt".
# MAX_MCP_OUTPUT_TOKENS does not lift that limit (verified with a 65.7KB result).
_PERSISTED_RE = re.compile(r"saved to:?\s+(/\S+?\.(?:txt|json))", re.I)


def _unpersist(text):
    # type: (str) -> str
    """The full result text, reading it back from disk when the CLI spilled it."""
    if "<persisted-output>" not in (text or "")[:200]:
        return text
    m = _PERSISTED_RE.search(text)
    if not m or not os.path.isfile(m.group(1)):
        raise FetchError("unreadable_page", "persisted result not found")
    with open(m.group(1), encoding="utf-8") as fh:
        return fh.read()


def _tool_prefix(name):
    # type: (str) -> str
    return re.sub(r"_+", "_", re.sub(r"[^A-Za-z0-9_-]", "_", name or "")).strip("_")


def check_server(init, server):
    # type: (dict, str) -> None
    tools = init.get("tools") or []
    if "mcp__%s__call_tool" % server in tools:
        return
    for s in init.get("mcp_servers") or []:
        if _tool_prefix(s.get("name")) == server and s.get("status") == "pending":
            return
    reachable = sorted({t[len("mcp__"):-len("__call_tool")] for t in tools
                        if t.startswith("mcp__") and t.endswith("__call_tool")})
    raise FetchError("server_unavailable", "%s is not connected in a headless session; "
                     "reachable: %s" % (server, ", ".join(reachable) or "none"))


def read_export_result(events, server, args, tool=EXPORT_TOOL):
    # type: (object, str, dict, str) -> str
    """The raw text of the export call's tool result, from a stream of events.

    Raises FetchError when the session called the export with anything other than
    `args`, or the call failed. Returns as soon as the result arrives; the caller
    stops the session there rather than paying for its closing turn.
    """
    call_name = "mcp__%s__call_tool" % server
    export_ids = set()
    for ev in events:
        t = ev.get("type")
        if t == "system" and ev.get("subtype") == "init":
            check_server(ev, server)
        elif t == "assistant":
            for b in ev.get("message", {}).get("content", []) or []:
                if b.get("type") != "tool_use" or b.get("name") != call_name:
                    continue
                sent = b.get("input") or {}
                if sent.get("name") != tool or sent.get("arguments") != args:
                    raise FetchError("wrong_arguments", json.dumps(sent)[:300])
                export_ids.add(b.get("id"))
        elif t == "user":
            for b in ev.get("message", {}).get("content", []) or []:
                if not isinstance(b, dict) or b.get("type") != "tool_result":
                    continue
                if b.get("tool_use_id") not in export_ids:
                    continue
                text = _flatten(b.get("content"))
                if b.get("is_error"):
                    raise FetchError("export_failed", text[:300])
                return _unpersist(text)
        elif t == "result":
            raise FetchError("no_export_result", str(ev.get("result") or "")[:300])
    raise FetchError("no_export_result", "session ended")


def _events(proc, deadline):
    for line in proc.stdout:
        if time.time() > deadline:
            raise FetchError("timeout")
        line = line.strip()
        if not line:
            continue
        try:
            yield json.loads(line)
        except ValueError:
            continue


def _stop(proc):
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


def run_page(claude_bin, server, args, cwd, timeout=PAGE_TIMEOUT, tool=EXPORT_TOOL):
    # type: (str, str, dict, str, int, str) -> str
    """One export page through one headless session. Returns the raw result text."""
    try:
        proc = subprocess.Popen(
            build_argv(claude_bin, server), cwd=cwd, env=_env(),
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, bufsize=1)
    except OSError as exc:
        raise FetchError("start_failed", str(exc))
    # A wedged session must not hold the request thread forever.
    timer = threading.Timer(timeout, _stop, args=(proc,))
    timer.start()
    try:
        proc.stdin.write(page_prompt(server, args, tool))
        proc.stdin.close()
        return read_export_result(_events(proc, time.time() + timeout), server, args, tool)
    finally:
        timer.cancel()
        _stop(proc)


def _parse_page(text, page_dir):
    # type: (str, pathlib.Path) -> dict
    """Fan one page out into benchmark_<JOB>.json files; return its manifest entry."""
    try:
        raw = json.loads(text)
    except ValueError:
        raise FetchError("unreadable_page", text[:200])
    try:
        return save_benchmark_result._save_export_page(raw, page_dir)
    except SystemExit as exc:  # the capture helper exits rather than guess a shape
        raise FetchError("unreadable_page", str(exc.code or ""))


def _check_sweep(pages, plan_version_id):
    # type: (List[dict], object) -> None
    seen = set()
    for pg in pages:
        seen.update(pg.get("jobs_covered") or [])
        seen.update(pg.get("jobs_empty") or [])
    total = next((pg.get("total_job_areas") for pg in pages
                  if pg.get("total_job_areas") is not None), None)
    if total is None or len(seen) < total or all(pg.get("next_job_offset") is not None
                                                 for pg in pages):
        raise FetchError("incomplete_sweep", "%d of %s job areas" % (len(seen), total))
    versions = {pg.get("benchmark_version_id") for pg in pages}
    if len(versions) != 1 or (plan_version_id is not None
                              and versions != {plan_version_id}):
        raise FetchError("version_mismatch", "pages %s, plan %s"
                         % (sorted(map(str, versions)), plan_version_id))


def _entry(key, catalog_entry, rows, local_currency):
    # type: (str, dict, list, bool) -> dict
    first = next((r for r in rows if r.get("geo")), rows[0] if rows else {})
    return {
        "key": key,
        "label": first.get("geo") or catalog_entry.get("label"),
        "catalogLabel": catalog_entry.get("label"),
        "location": catalog_entry.get("location"),
        "international": bool(catalog_entry.get("international")),
        "localCurrency": local_currency,
        "salaryScalar": first.get("geoSalaryScalar"),
        "equityScalar": first.get("geoEquityScalar"),
        "currencies": sorted({r["currency"] for r in rows if r.get("currency")}),
        "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "rows": rows,
    }


def log(data_dir, line):
    print("[location_fetch] %s" % line, flush=True)
    try:
        with open(pathlib.Path(data_dir) / LOG_NAME, "a", encoding="utf-8") as fh:
            fh.write("%s %s\n" % (time.strftime("%Y-%m-%dT%H:%M:%S"), line))
    except OSError:
        pass


def cached(data_dir, key):
    # type: (pathlib.Path, str) -> Optional[dict]
    p = pathlib.Path(data_dir) / CACHE_DIR / (key + ".json")
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def fetch(data_dir, claude_bin, config, catalog_entry, local_currency, key=None,
          run=run_page):
    # type: (pathlib.Path, str, dict, dict, bool, Optional[str], object) -> dict
    """Fetch, validate and cache one location. Returns its Benchmarks entry.

    `config` is location_fetch.json plus the bucketParam/bucketCode of the peer
    group asked for. `run` is the page runner, replaceable in tests.
    """
    data_dir = pathlib.Path(data_dir)
    location = catalog_entry["location"]
    key = key or cache_key(location, local_currency)
    work = data_dir / CACHE_DIR / (key + ".partial")
    if work.exists():
        shutil.rmtree(str(work))
    work.mkdir(parents=True)

    offsets = list(range(0, TOTAL_JOB_AREAS, JOB_LIMIT))
    texts = {}  # type: Dict[int, str]
    errors = []  # type: List[FetchError]

    def one(offset):
        try:
            texts[offset] = run(claude_bin, config["mcpServer"],
                                export_args(config, location, local_currency, offset),
                                str(work))
        except FetchError as exc:
            errors.append(exc)

    started = time.time()
    threads = [threading.Thread(target=one, args=(o,)) for o in offsets]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    try:
        if errors:
            raise errors[0]
        pages = [_parse_page(texts[o], work) for o in offsets]
        _check_sweep(pages, config.get("benchmarkVersionId"))
        rows = build_datadir._collect_rows(work)[0]
        if not rows:
            raise FetchError("no_rows")
        entry = _entry(key, catalog_entry, rows, local_currency)
        out = data_dir / CACHE_DIR / (key + ".json")
        tmp = out.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(entry), encoding="utf-8")
        os.replace(str(tmp), str(out))
        log(data_dir, "fetched %s%s: %d rows in %.0fs" % (
            location, " (local currency)" if local_currency else "", len(rows),
            time.time() - started))
        return entry
    except FetchError as exc:
        log(data_dir, "failed %s: %s" % (location, exc))
        raise
    finally:
        shutil.rmtree(str(work), ignore_errors=True)
