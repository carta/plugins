#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# ///
"""Fetch a Carta MCP compensation result straight to disk, never through a model.

An export page is ~17-25k characters, under the size at which Claude Code saves a
tool result to a file, so in the building session it arrives inline and the only
way onto disk would be a model writing it back out. This runs each call in a
headless `claude -p` session instead (location_fetch.run_page) and takes the raw
tool result off its event stream.

Usage:
    uv run capture_export.py sweep --server <SERVER> --args '<json>' --dest <dir>
    uv run capture_export.py call --server <SERVER> --tool <tool> --args '<json>' --out <file>

`sweep` pages compensation__export__benchmarks from job_offset 0 until
next_job_offset is null and fans every page out into <dir> exactly as
`save_benchmark_result.py --export-page` does. `--args` carries everything except
job_limit and job_offset, which the sweep owns. `call` writes one read-only
compensation__get__* / compensation__export__* result to <file>, for the save_*
scripts to read as a persisted result path.

Both take `--claude-bin <path>`; without it the CLI is found the same way as
preflight_claude.py.

Exit codes: 0 captured · 1 fetch failed or sweep incomplete · 2 bad usage.
"""
import argparse
import json
import os
import pathlib
import sys
from typing import List, Optional

import location_fetch
import preflight_claude
import save_benchmark_result

BUCKET_PARAMS = ("post_money_bucket", "headcount_bucket", "capital_raised_bucket")
REQUIRED_SWEEP_ARGS = ("corporation_id", "benchmark_version_id", "equity_quantity")
SWEEP_CALL_CEILING = 6
ATTEMPTS_PER_PAGE = 2
READ_ONLY_PREFIXES = ("compensation__get__", "compensation__export__")
NOT_RETRIED = ("server_unavailable", "wrong_arguments")


class CaptureError(Exception):
    pass


class UsageError(CaptureError):
    pass


def validate_sweep_args(args):
    # type: (dict) -> None
    missing = [k for k in REQUIRED_SWEEP_ARGS if k not in args]
    if missing:
        raise UsageError("--args is missing %s" % ", ".join(missing))
    if args["equity_quantity"] != "FOUR_YEAR_GRANT":
        raise UsageError("equity_quantity must be FOUR_YEAR_GRANT")
    buckets = [k for k in BUCKET_PARAMS if k in args]
    if len(buckets) != 1:
        raise UsageError("--args needs exactly one of %s" % ", ".join(BUCKET_PARAMS))
    paging = [k for k in ("job_limit", "job_offset") if k in args]
    if paging:
        raise UsageError("leave %s out of --args; the sweep pages itself"
                           % ", ".join(paging))


def clear_sweep(dest):
    # type: (pathlib.Path) -> None
    for p in list(dest.glob("benchmark_*.json")) + [dest / "export_pages.json"]:
        if p.exists():
            p.unlink()


def _fetch(run, claude_bin, server, args, cwd, budget, tool=location_fetch.EXPORT_TOOL):
    # type: (object, str, str, dict, str, List[int], str) -> str
    last = None  # type: Optional[location_fetch.FetchError]
    for _ in range(ATTEMPTS_PER_PAGE):
        if budget[0] <= 0:
            raise CaptureError("call ceiling reached (%d calls)" % SWEEP_CALL_CEILING)
        budget[0] -= 1
        try:
            return run(claude_bin, server, args, cwd, tool=tool)
        except location_fetch.FetchError as exc:
            if exc.reason in NOT_RETRIED:
                raise CaptureError(str(exc))
            last = exc
            print("capture_export: attempt failed: %s" % exc, flush=True)
    raise CaptureError(str(last))


def sweep(claude_bin, server, base_args, dest, run=location_fetch.run_page):
    # type: (str, str, dict, str, object) -> dict
    validate_sweep_args(base_args)
    dest = pathlib.Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    clear_sweep(dest)
    budget = [SWEEP_CALL_CEILING]
    pages = []  # type: List[dict]
    offset = 0  # type: Optional[int]
    try:
        while offset is not None:
            args = dict(base_args, job_limit=location_fetch.JOB_LIMIT, job_offset=offset)
            text = _fetch(run, claude_bin, server, args, str(dest), budget)
            try:
                page = location_fetch._parse_page(text, dest)
            except location_fetch.FetchError as exc:
                raise CaptureError(str(exc))
            if page.get("job_offset") != offset:
                raise CaptureError("asked for job_offset %s, page reports %s"
                                   % (offset, page.get("job_offset")))
            pages.append(page)
            manifest = save_benchmark_result._record_export_manifest(dest, page)
            offset = page.get("next_job_offset")
        try:
            location_fetch._check_sweep(pages, base_args["benchmark_version_id"])
        except location_fetch.FetchError as exc:
            raise CaptureError(str(exc))
    except CaptureError:
        clear_sweep(dest)
        raise
    return manifest


def call(claude_bin, server, tool, args, out, run=location_fetch.run_page):
    # type: (str, str, str, dict, str, object) -> int
    if not tool.startswith(READ_ONLY_PREFIXES):
        raise UsageError("only read-only compensation__get__/compensation__export__ "
                           "tools can be captured, not %s" % tool)
    out = pathlib.Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    text = _fetch(run, claude_bin, server, args, str(out.parent), [ATTEMPTS_PER_PAGE],
                  tool=tool)
    tmp = out.with_name(out.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(str(tmp), str(out))
    return len(text)


def _parse_args(argv):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    for name in ("sweep", "call"):
        p = sub.add_parser(name)
        p.add_argument("--server", required=True)
        p.add_argument("--args", required=True)
        p.add_argument("--claude-bin")
        if name == "sweep":
            p.add_argument("--dest", required=True)
        else:
            p.add_argument("--tool", required=True)
            p.add_argument("--out", required=True)
    return parser.parse_args(argv)


def main(argv=None):
    opts = _parse_args(argv)
    try:
        args = json.loads(opts.args)
    except ValueError:
        print("capture_export: --args is not JSON", file=sys.stderr)
        return 2
    if not isinstance(args, dict):
        print("capture_export: --args must be a JSON object", file=sys.stderr)
        return 2
    claude_bin = opts.claude_bin or preflight_claude.find_claude()
    if not claude_bin:
        print("capture_export: FAILED — no claude CLI found; run preflight_claude.py",
              file=sys.stderr)
        return 1
    try:
        if opts.cmd == "sweep":
            manifest = sweep(claude_bin, opts.server, args, opts.dest)
            print("capture_export: sweep COMPLETE — %s job areas across %d page(s) in %s"
                  % (manifest.get("total_job_areas"), len(manifest["pages"]), opts.dest))
        else:
            size = call(claude_bin, opts.server, opts.tool, args, opts.out)
            print("capture_export: %s captured to %s (%d chars)" % (opts.tool, opts.out, size))
    except UsageError as exc:
        print("capture_export: %s" % exc, file=sys.stderr)
        return 2
    except CaptureError as exc:
        print("capture_export: FAILED — %s" % exc, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
