# /// script
# requires-python = ">=3.9"
# ///
"""Find the changes a user made to their published Carta Home.

A published Carta Home is a frozen copy, and users customize it by asking Claude to edit
the live page. A rebuild publishes a fresh build over the same URL, so before it runs the
skill needs to know whether the live page still matches what was built, and if not, what
the user changed.

The build stamps a baseline into every page: one short hash per non-blank line of the page
exactly as built, in order. That is enough to line the live page up against its own
original and report every line the user added, changed or removed — without shipping a
second copy of the page, and no matter which version built it. Whitespace is ignored, so
reindenting is not a change.

Usage:
  uv run scripts/customizations.py diff <live.html>
  uv run scripts/customizations.py diff <live.html> --against <reference.html>
  uv run scripts/customizations.py diff <live.html> --release <new-build.html>
  uv run scripts/customizations.py plan <live.html> <new-build.html>

`--against` compares the live page with another page instead of its baseline. It is for a
page built before baselines existed: comparing it with a fresh build reports the user's
changes mixed in with Carta's, and the caller has to tell them apart.

`--release` turns the comparison around: it reports what Carta changed between the build
the live page came from and a new build, with line numbers in the new build. That is what
to bring into a page the user has reworked so heavily that carrying their changes onto the
new build would be backwards.

`plan` is what an update runs: the user's changes, each marked `conflict` when Carta changed
or removed the same part of the page in the new build. A change without a conflict is
carried over as it is; only a conflicting one needs the user.

Prints one JSON object:
  status   "unmodified" | "customized" | "no_baseline"
  version  the version that built the live page, when the page says
  hunks    [{line, context, added, added_truncated, removed}] — `line` is the 1-based line
           in the live file where the hunk starts, `context` the nearest unchanged line
           above it, `added` the live lines that are not in the original, `removed` how
           many original lines are gone
  summary  {hunks, lines_added, lines_removed, changed_share} — `changed_share` is the
           larger of the lines added and removed as a share of the original page, so the
           caller can tell a few tweaks from a page that is mostly the user's own
"""
import argparse
import base64
import difflib
import hashlib
import json
import re
import sys
from pathlib import Path

BASELINE_ID = "carta-home-baseline"
BASELINE_RE = re.compile(
    r'<script type="application/json" id="' + BASELINE_ID + r'">(.*?)</script>', re.S
)
# A page built before baselines still carries the version its update banner compares.
LEGACY_VERSION_RE = re.compile(r'const ARTIFACT_VERSION = "(\d+\.\d+\.\d+)"')
HASH_BYTES = 4
# Enough to recognise a change; the caller reads the live file at `line` for the rest.
MAX_ADDED_LINES = 40
MAX_LINE_CHARS = 240


def _content_lines(html):
    """(line number, stripped text) for every non-blank line outside the baseline stamp."""
    return [
        (number, line.strip())
        for number, line in enumerate(html.splitlines(), start=1)
        if line.strip() and BASELINE_ID not in line
    ]


def _line_hash(text):
    return hashlib.sha256(text.encode("utf-8")).digest()[:HASH_BYTES]


def _fingerprint(html):
    return [_line_hash(text) for _number, text in _content_lines(html)]


def stamp_baseline(html, version):
    """Return `html` with its own baseline stamped in, on a line of its own before </body>."""
    if "</body>" not in html:
        raise ValueError("page has no </body> to stamp a baseline before")
    lines = base64.b64encode(b"".join(_fingerprint(html))).decode("ascii")
    payload = json.dumps({"version": version, "lines": lines}, separators=(",", ":"))
    tag = '<script type="application/json" id="{}">{}</script>'.format(BASELINE_ID, payload)
    head, _sep, tail = html.rpartition("</body>")
    return head.rstrip("\n") + "\n" + tag + "\n</body>" + tail


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


def _result(original_hashes, compared_html, version):
    hunks = _hunks(original_hashes, compared_html)
    return {
        "status": "customized" if hunks else "unmodified",
        "version": version,
        "hunks": hunks,
        "summary": _summary(original_hashes, hunks),
    }


def release_changes(live_html, new_html):
    """What Carta changed between the build `live_html` came from and `new_html`."""
    baseline = read_baseline(live_html)
    if not baseline:
        return {"status": "no_baseline", "version": None, "hunks": []}
    return _result(baseline[1], new_html, baseline[0])


def _touched(i1, i2):
    """The original lines a change sits on. An insertion sits between two lines, so it
    touches both neighbours: Carta rewriting either one is a conflict for it."""
    return (i1 - 1, i2 + 1) if i1 == i2 else (i1, i2)


def plan(live_html, new_html):
    """The user's changes, each marked `conflict` when the new build changed the same lines."""
    baseline = read_baseline(live_html)
    if not baseline:
        return {"status": "no_baseline", "version": None, "hunks": []}
    version, original = baseline
    carta = [_touched(i1, i2) for i1, i2, _j1, _j2 in _changes(original, _content_lines(new_html))]
    hunks = _hunks(original, live_html, with_span=True)
    for hunk in hunks:
        u1, u2 = _touched(*hunk.pop("_span"))
        hunk["conflict"] = any(u1 < c2 and c1 < u2 for c1, c2 in carta)
    summary = _summary(original, hunks)
    summary["conflicts"] = sum(h["conflict"] for h in hunks)
    return {
        "status": "customized" if hunks else "unmodified",
        "version": version,
        "hunks": hunks,
        "summary": summary,
    }


def diff(live_html, reference_html=None):
    """Compare the live page with its baseline, or with `reference_html` when given."""
    baseline = read_baseline(live_html)
    if baseline:
        version = baseline[0]
    else:
        legacy = LEGACY_VERSION_RE.search(live_html)
        version = legacy.group(1) if legacy else None

    if reference_html is not None:
        original = _fingerprint(reference_html)
    elif baseline:
        original = baseline[1]
    else:
        return {"status": "no_baseline", "version": version, "hunks": []}

    return _result(original, live_html, version)


def main():
    ap = argparse.ArgumentParser(description="Find a user's changes to their Carta Home.")
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
    args = ap.parse_args()

    live_html = Path(args.live).read_text()
    if args.command == "plan":
        result = plan(live_html, Path(args.new_build).read_text())
    elif args.release:
        result = release_changes(live_html, Path(args.release).read_text())
    else:
        reference_html = Path(args.against).read_text() if args.against else None
        result = diff(live_html, reference_html)
    json.dump(result, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
