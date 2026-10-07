#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# ///
"""
Find the `location` value for a place the user named, in a saved
compensation:get:benchmark_locations result.

Usage:
    uv run find_location.py <saved_result_file> "<place>"

The list is ~444 entries (~65KB), so the client saves it to a file rather than
showing it inline. This prints the best matches, one per line:

    location=Tulsa,OK,USA	label=Tulsa, OK	international=false	currency=USD

Pass the chosen line's `location` to compensation:get:benchmark verbatim. Names
starting with the query come first, then names containing it; at most 10. The US
national average matches "national", "remote" and "US". Prints `matches=0` when
nothing matches.
"""

import json
import sys
from pathlib import Path

NATIONAL = "US National Average"
LIMIT = 10
NATIONAL_ALIASES = ("national", "national average", "remote", "remote - usa", "remote usa",
                    "us", "usa", "united states")


def load_locations(text):
    """The location entries from a saved result, whatever wrapper it came in."""
    try:
        data = json.loads(text)
    except ValueError:
        # A short preamble before the JSON, as some clients write it.
        data = json.loads(text[text.index("{"):]) if "{" in text else None
    for _ in range(4):
        if isinstance(data, dict) and isinstance(data.get("locations"), list):
            return data["locations"]
        if isinstance(data, dict) and isinstance(data.get("result"), str):
            data = json.loads(data["result"])
        elif isinstance(data, dict) and isinstance(data.get("result"), dict):
            data = data["result"]
        elif isinstance(data, list) and data and isinstance(data[0], dict) and "text" in data[0]:
            data = json.loads(data[0]["text"])
        else:
            break
    raise ValueError("no `locations` list in the saved result")


def find(locations, query, limit=LIMIT):
    q = (query or "").strip().lower()
    entries = [loc for loc in locations if isinstance(loc, dict) and loc.get("location")]
    if q in NATIONAL_ALIASES:
        return [loc for loc in entries if loc["location"] == NATIONAL][:1]
    name = lambda loc: (loc.get("label") or "").lower()
    starts = [loc for loc in entries if name(loc).startswith(q)]
    contains = [loc for loc in entries if not name(loc).startswith(q) and q in name(loc)]
    return (starts + contains)[:limit]


def main(argv):
    if len(argv) != 2:
        sys.exit(__doc__)
    try:
        locations = load_locations(Path(argv[0]).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        sys.exit("find_location: %s" % exc)
    matches = find(locations, argv[1])
    for loc in matches:
        international = loc.get("country") not in ("USA", "US")
        print("location=%s\tlabel=%s\tinternational=%s\tcurrency=%s" % (
            loc["location"], loc.get("label") or "", str(international).lower(),
            loc.get("currency_code") or ""))
    print("matches=%d" % len(matches))


if __name__ == "__main__":
    main(sys.argv[1:])
