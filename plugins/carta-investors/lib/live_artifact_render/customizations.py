"""Find the changes a user made to a published Live Artifact.

A published artifact is a frozen copy, and users customize it by asking Claude to edit the
live page. A rebuild publishes a fresh page over the same URL, so before it runs the skill
needs to know whether the live page still matches what was built, and if not, what the
user changed. Carta Home, the Schedule of Investments and Fund Performance all stamp their
pages; `references/keep-customizations.md` is the procedure that reads the result.

The build stamps a baseline into every page: one short hash per non-blank line of the page
exactly as built, in order. That is enough to line the live page up against its own
original and report every line the user added, changed or removed — without shipping a
second copy of the page, and no matter which version built it. Whitespace is ignored, so
reindenting is not a change.

Skills run it through the `scripts/customizations.py` wrapper beside their own scripts:
  uv run <skill>/scripts/customizations.py diff <live.html>
  uv run <skill>/scripts/customizations.py diff <live.html> --against <reference.html>
  uv run <skill>/scripts/customizations.py diff <live.html> --release <new-build.html>
  uv run <skill>/scripts/customizations.py plan <live.html> <new-build.html>
  uv run <skill>/scripts/customizations.py stamp <page.html> [--version X.Y.Z]
  uv run <skill>/scripts/customizations.py rebase <live.html> <new-build.html> --out <page.html>
  uv run <skill>/scripts/customizations.py unwrap <live.html> --out <page.html>

`stamp` rewrites a page in place with a fresh baseline, for a page published as a
committed file rather than built.

`--against` compares the live page with another page instead of its baseline. It is for a
page built before baselines existed, and it reports only pure additions: lines the live
page has and the other page doesn't. Those include the user's additions but also lines an
older build had that Carta has since removed, and the two read the same here — telling them
apart is the caller's judgement. A changed line could be the user's edit or an older
build's version of Carta's own line, and on a real page nearly all of them are the latter —
so they are counted in `summary.skipped`, not listed, rather than risk carrying an old
build's code forward.

The page as `Artifact read` saves it is wrapped in the viewer's own document shell — an
extra first line ending in `<body>` and a closing `</body></html>`. Neither is the user's,
so neither is compared.

`rebase` and `unwrap` write a saved live page back out for republishing. `unwrap` only
takes off the viewer's shell, which would otherwise end up nested inside the page.
`rebase` also swaps the page's baseline for the new build's: once Carta's changes are in a
page the user has reworked, it matches the new build, and a later update must compare it
with that build rather than the old one.

`--release` turns the comparison around: it reports what Carta changed between the build
the live page came from and a new build, with line numbers in the new build. That is what
to bring into a page the user has reworked so heavily that carrying their changes onto the
new build would be backwards.

`plan` is what an update runs: the user's changes, each marked `conflict` when Carta changed
or removed the same part of the page in the new build. A change without a conflict is
carried over as it is; only a conflicting one needs the user.

`stamp`, `rebase` and `unwrap` print one plain-text line naming the file they wrote.
`diff` and `plan` print one JSON object:
  status   "unmodified" | "customized" | "no_baseline"
  version  the version that built the live page, when the page says
  hunks    [{line, context, added, added_truncated, removed}] — `line` is the 1-based line
           in the live file where the hunk starts, `context` the nearest unchanged line
           above it, `added` the live lines that are not in the original, `removed` how
           many original lines are gone; `plan` adds `conflict` to each
  summary  {hunks, lines_added, lines_removed, changed_share} — `changed_share` is the
           larger of the lines added and removed as a share of the original page, so the
           caller can tell a few tweaks from a page that is mostly the user's own;
           `--against` adds `skipped`, `plan` adds `conflicts`
A `no_baseline` result carries no `summary`.
"""
from __future__ import annotations

import argparse
import base64
import difflib
import hashlib
import json
import re
import sys
from pathlib import Path

BASELINE_ID = "artifact-baseline"
# Carta Home's first stamped builds used their own id; those pages still read.
BASELINE_IDS = (BASELINE_ID, "carta-home-baseline")
BASELINE_RE = re.compile(
    r'<script type="application/json" id="(?:{})">(.*?)</script>'.format("|".join(BASELINE_IDS)),
    re.S,
)
# A page built before baselines still carries the version its update banner compares.
LEGACY_VERSION_RE = re.compile(r'const ARTIFACT_VERSION = "(\d+\.\d+\.\d+)"')
HASH_BYTES = 4
# Enough to recognise a change; the caller reads the live file at `line` for the rest.
MAX_ADDED_LINES = 40
MAX_LINE_CHARS = 240
# The viewer's document shell around a page saved by `Artifact read`. The shell puts the
# doctype, <html>, <head> and <body> on one line, which no built page does.
SHELL_OPEN_RE = re.compile(r"<!doctype html><html><head>.*<body>")
SHELL_CLOSE = "</body></html>"


def _is_baseline(line):
    return any(i in line for i in BASELINE_IDS)


def _without_shell(lines):
    """`lines` — (line number, stripped text), non-blank — without the viewer's shell."""
    if lines and SHELL_OPEN_RE.fullmatch(lines[0][1]):
        lines = lines[1:]
        if lines and lines[-1][1] == SHELL_CLOSE:
            lines = lines[:-1]
    return lines


def _content_lines(html):
    """(line number, stripped text) for every non-blank line outside the baseline stamp
    and the viewer's document shell."""
    return _without_shell([
        (number, line.strip())
        for number, line in enumerate(html.splitlines(), start=1)
        if line.strip() and not _is_baseline(line)
    ])


def _line_hash(text):
    return hashlib.sha256(text.encode("utf-8")).digest()[:HASH_BYTES]


def _fingerprint(html):
    return [_line_hash(text) for _number, text in _content_lines(html)]


def stamp_baseline(html, version=None):
    """Return `html` with its own baseline stamped in, on a line of its own before </body>
    (or at the end, for a page written without one).

    A baseline already on the page is replaced, so restamping an edited file is safe.
    """
    html = _without_stamp(html)
    lines = base64.b64encode(b"".join(_fingerprint(html))).decode("ascii")
    payload = json.dumps({"version": version, "lines": lines}, separators=(",", ":"))
    tag = '<script type="application/json" id="{}">{}</script>'.format(BASELINE_ID, payload)
    return _place_stamp(html, tag)


def _without_stamp(html):
    """`html` without the line carrying its baseline stamp."""
    return "\n".join(line for line in html.split("\n") if not _is_baseline(line))


def _place_stamp(html, tag):
    """`html` with the stamp `tag` on a line of its own before </body>, or at the end."""
    if "</body>" not in html:
        return html.rstrip("\n") + "\n" + tag + "\n"
    head, _sep, tail = html.rpartition("</body>")
    return head.rstrip("\n") + "\n" + tag + "\n</body>" + tail


def unwrap(html):
    """The page inside the viewer's document shell, for republishing a saved live page.
    A page that was never wrapped comes back as it is."""
    kept = {number for number, _text in _content_lines(html)}
    dropped = {
        number for number, line in enumerate(html.splitlines(), start=1)
        if line.strip() and not _is_baseline(line) and number not in kept
    }
    if not dropped:
        return html
    return "\n".join(
        line for number, line in enumerate(html.splitlines(), start=1) if number not in dropped
    ) + "\n"


def rebase(live_html, new_html):
    """The user's page, ready to republish: outside the viewer shell and carrying the new
    build's baseline, so the next update diffs against the build it now matches."""
    match = BASELINE_RE.search(new_html)
    if not match:
        raise ValueError("the new build has no baseline to rebase onto")
    return _place_stamp(_without_stamp(unwrap(live_html)), match.group(0))


def read_baseline(html):
    """(version, [line hash]) from the page's stamp, or None when it has none or it is unreadable."""
    match = BASELINE_RE.search(html)
    if not match:
        return None
    try:
        payload = json.loads(match.group(1))
        raw = base64.b64decode(payload["lines"], validate=True)
    except (ValueError, KeyError, TypeError):
        return None
    if len(raw) % HASH_BYTES:
        return None
    hashes = [raw[i:i + HASH_BYTES] for i in range(0, len(raw), HASH_BYTES)]
    return payload.get("version"), hashes


def _changes(original_hashes, lines):
    """(i1, i2, j1, j2) for every stretch where `lines` differs from the original."""
    hashes = [_line_hash(text) for _number, text in lines]
    matcher = difflib.SequenceMatcher(None, original_hashes, hashes, autojunk=False)
    return [(i1, i2, j1, j2) for tag, i1, i2, j1, j2 in matcher.get_opcodes() if tag != "equal"]


def _hunks(original_hashes, live_html, with_span=False):
    live = _content_lines(live_html)
    hunks = []
    for i1, i2, j1, j2 in _changes(original_hashes, live):
        added = [text[:MAX_LINE_CHARS] for _number, text in live[j1:j2]]
        if j1 < len(live):
            line = live[j1][0]
        else:
            line = live[-1][0] + 1 if live else 1
        hunks.append({
            "line": line,
            "context": live[j1 - 1][1][:MAX_LINE_CHARS] if j1 else "",
            "added": added[:MAX_ADDED_LINES],
            "added_truncated": max(0, len(added) - MAX_ADDED_LINES),
            "removed": i2 - i1,
        })
        if with_span:
            hunks[-1]["_span"] = (i1, i2)
    return hunks


def _summary(original_hashes, hunks):
    added = sum(len(h["added"]) + h["added_truncated"] for h in hunks)
    removed = sum(h["removed"] for h in hunks)
    return {
        "hunks": len(hunks),
        "lines_added": added,
        "lines_removed": removed,
        "changed_share": round(max(added, removed) / max(len(original_hashes), 1), 3),
    }


def _result(original_hashes, hunks, version, **extra_summary):
    """The JSON for `hunks`, already filtered and annotated, against the original page."""
    summary = _summary(original_hashes, hunks)
    summary.update(extra_summary)
    return {
        "status": "customized" if hunks else "unmodified",
        "version": version,
        "hunks": hunks,
        "summary": summary,
    }


def _no_baseline(live_html):
    """The result for a page built before baselines, with the version its update banner
    still carries, when it has one."""
    legacy = LEGACY_VERSION_RE.search(live_html)
    return {"status": "no_baseline", "version": legacy.group(1) if legacy else None, "hunks": []}


def release_changes(live_html, new_html):
    """What Carta changed between the build `live_html` came from and `new_html`."""
    baseline = read_baseline(live_html)
    if not baseline:
        return _no_baseline(live_html)
    version, original = baseline
    return _result(original, _hunks(original, new_html), version)


def _touched(i1, i2):
    """The original lines a change sits on. An insertion sits between two lines, so it
    touches both neighbours: Carta rewriting either one is a conflict for it."""
    return (i1 - 1, i2 + 1) if i1 == i2 else (i1, i2)


def plan(live_html, new_html):
    """The user's changes, each marked `conflict` when the new build changed the same lines."""
    baseline = read_baseline(live_html)
    if not baseline:
        return _no_baseline(live_html)
    version, original = baseline
    carta = [_touched(i1, i2) for i1, i2, _j1, _j2 in _changes(original, _content_lines(new_html))]
    hunks = _hunks(original, live_html, with_span=True)
    for hunk in hunks:
        u1, u2 = _touched(*hunk.pop("_span"))
        hunk["conflict"] = any(u1 < c2 and c1 < u2 for c1, c2 in carta)
    return _result(original, hunks, version, conflicts=sum(h["conflict"] for h in hunks))


def diff(live_html, reference_html=None):
    """Compare the live page with its baseline, or with `reference_html` when given."""
    baseline = read_baseline(live_html)
    version = baseline[0] if baseline else _no_baseline(live_html)["version"]
    if reference_html is not None:
        original = _fingerprint(reference_html)
        hunks = _hunks(original, live_html)
        added = [h for h in hunks if not h["removed"]]
        return _result(original, added, version, skipped=len(hunks) - len(added))
    if not baseline:
        return _no_baseline(live_html)
    return _result(baseline[1], _hunks(baseline[1], live_html), version)


def main():
    ap = argparse.ArgumentParser(description="Find a user's changes to a published page.")
    sub = ap.add_subparsers(dest="command", required=True)
    diff_cmd = sub.add_parser("diff", help="report what changed in a live page")
    diff_cmd.add_argument("live", help="the live page, saved from Artifact read")
    mode = diff_cmd.add_mutually_exclusive_group()
    mode.add_argument("--against", metavar="REFERENCE",
                      help="compare with this page instead of the live page's baseline")
    mode.add_argument("--release", metavar="NEW_BUILD",
                      help="report what Carta changed between the live page's build and this one")
    plan_cmd = sub.add_parser("plan", help="the user's changes, marked where they conflict with a new build")
    plan_cmd.add_argument("live", help="the live page, saved from Artifact read")
    plan_cmd.add_argument("new_build", help="the page this update is about to publish")
    stamp_cmd = sub.add_parser("stamp", help="rewrite a committed page with a fresh baseline")
    stamp_cmd.add_argument("page")
    stamp_cmd.add_argument("--version", help="the version the page ships as, when it has one")
    rebase_cmd = sub.add_parser("rebase", help="ready a reworked live page to republish over a new build")
    rebase_cmd.add_argument("live", help="a working copy of the live page, with Carta's changes in")
    rebase_cmd.add_argument("new_build", help="the build whose baseline the page now matches")
    rebase_cmd.add_argument("--out", required=True, help="where to write the page to publish")
    unwrap_cmd = sub.add_parser("unwrap", help="take a saved live page out of the viewer's shell")
    unwrap_cmd.add_argument("live", help="the live page, saved from Artifact read")
    unwrap_cmd.add_argument("--out", required=True, help="where to write the page to publish")
    args = ap.parse_args()

    if args.command == "stamp":
        page = Path(args.page)
        page.write_text(stamp_baseline(page.read_text(), args.version))
        print("stamped {}".format(page))
        return

    live_html = Path(args.live).read_text()
    if args.command in ("rebase", "unwrap"):
        if args.command == "unwrap":
            page = unwrap(live_html)
        else:
            try:
                page = rebase(live_html, Path(args.new_build).read_text())
            except ValueError as error:
                sys.exit("customizations.py rebase: {}".format(error))
        Path(args.out).write_text(page)
        print("wrote {}".format(args.out))
        return
    if args.command == "plan":
        result = plan(live_html, Path(args.new_build).read_text())
    elif args.release:
        result = release_changes(live_html, Path(args.release).read_text())
    else:
        reference_html = Path(args.against).read_text() if args.against else None
        result = diff(live_html, reference_html)
    json.dump(result, sys.stdout, indent=2)
    sys.stdout.write("\n")

