"""Turn a typed phrase into a cohort filter, via Claude, without touching source.

The ask box on Benchmarks and Scorecard edits the app's own code: "add a P60
column" is a lasting change to a view, and a source edit is the honest form of
it. On the refresh planner's cohort step it is the wrong instrument. "Show only
engineering" is not a change to the app, it is a filter over the rows on screen —
expressed as code it becomes durable, invisible in the UI, and undoable only by
asking again or editing the file back.

So this module answers a different question. It asks Claude for a PREDICATE: a
small JSON object over a closed vocabulary, which the browser then validates,
previews, applies, renders in words and can remove with one click. The filter
behaves like the preset controls beside it because it is the same kind of thing.

WHAT CLAUDE RETURNS IS UNTRUSTED INPUT
It is JSON, never code. Nothing here executes what comes back, and nothing
resolves a property path from a string. `model/predicate.js` validates every
predicate against its own FIELDS and OPS before evaluating it, and a predicate
that fails validation is refused rather than applied — an invalid filter that
degraded to "matches everything" would silently add people to a grant cycle.
This module's job is to get a candidate; the browser's job is to disbelieve it.

THE SUBPROCESS GETS NO TOOLS AT ALL
The app-editing session needs Read, Edit and Glob. This one needs to emit a JSON
object and nothing else, so it is started with an empty tool set: no file access,
no Bash, no MCP. A session that cannot read a file cannot leak one.

THE VOCABULARY IS THE COHORT'S OWN
The prompt carries the real job areas, levels and locations read off the rows on
screen — not taxonomy.json, which is `source: "observed"` and was missing 2 of 22
job areas on a real corporation. A model told "Engineering" exists when the data
says "Engineering & Product" writes a filter that matches nobody.
"""

from __future__ import annotations

import json
import re

# Fields a predicate may name. Kept in lockstep with FIELDS in
# app/src/model/predicate.js -- that file is the enforcement, this list is what
# the model is told about. A field described here but absent there is refused by
# validate(), which is the safe direction: the browser never widens its own
# vocabulary on the say-so of a prompt.
FIELD_NOTES = [
    ("job_area", "text", "e.g. Engineering, Sales"),
    ("job_focus", "text", "specialization within an area"),
    ("job_track", "text", "IC, MANAGER or EXECUTIVE"),
    ("job_title", "text", "free text"),
    ("location", "text", 'e.g. "London,ENG,GB"'),
    ("full_name", "text", "the employee's name"),
    ("job_level", "ordinal", "compare with a NUMBER: 3 is IC 3 / MGR 3"),
    ("tenure_months", "months", "whole months since hire"),
    ("hire_date", "date", "ISO YYYY-MM-DD"),
    ("date_of_final_vest", "date", "when their current equity finishes vesting"),
    ("total_vested_shares", "number", ""),
    ("total_unvested_shares", "number", "0 means nothing still vesting"),
    ("live_award_count", "number", "prior grants; 0 means none"),
    ("four_year_grant_benchmark_num_shares", "number", "new-hire equity benchmark"),
    ("refresh_grant_num_shares", "number", "the report's own refresh figure"),
]

OPS_NOTE = (
    "and, or (lists of conditions) | not (one condition) | "
    "eq, neq, lt, lte, gt, gte (field, value) | "
    "in, nin (field, [values]) | isNull, notNull (field name)"
)

SYSTEM_PROMPT = """\
You turn a request about a group of employees into a FILTER, expressed as JSON.

Reply with ONE JSON object and nothing else. No prose, no explanation, no
markdown fence. Two shapes are allowed:

  {"predicate": <predicate>, "name": "<a short label for it>"}
  {"refusal": "<one sentence saying what you could not express>"}

A predicate is built only from these operators:
%(ops)s

and only these fields:
%(fields)s

Examples:
  "engineering"
      {"predicate": {"eq": ["job_area", "Engineering"]}, "name": "Engineering"}
  "engineering hired before 2023"
      {"predicate": {"and": [{"eq": ["job_area", "Engineering"]},
                             {"lt": ["hire_date", "2023-01-01"]}]},
       "name": "Engineering, pre-2023"}
  "no prior grants"
      {"predicate": {"eq": ["live_award_count", 0]}, "name": "Never granted"}
  "IC 5 and above"
      {"predicate": {"gte": ["job_level", 5]}, "name": "IC 5+"}
  "not in London"
      {"predicate": {"not": {"eq": ["location", "London,ENG,GB"]}}, "name": "Outside London"}
  "managers only"
      {"predicate": {"eq": ["job_track", "MANAGER"]}, "name": "Managers"}

Rules that matter:

* USE THE EXACT VALUES LISTED BELOW for job area, level, track and location.
  They are read from the employees actually on screen. A value you invent
  matches nobody, and the filter will look broken rather than empty.
* job_level compares as a NUMBER, never a string: "senior" is not a value, 5 is.
* THE NAME IS A LABEL, not a summary and not a restatement. It goes on a
  dropdown in a row of filters, beside "Prior grants" and "Job area", so write
  what a person would call this group: "Managers", not "track is MANAGER";
  "Never granted", not "live award count equals 0". Two to four words, no
  trailing punctuation, sentence case.
* THE NAME MUST NOT CLAIM MORE THAN THE PREDICATE DOES. It sits on the control
  that decides who is in a grant cycle, so a name describing a filter you did
  not write is worse than an ugly one. If the request was broader than what you
  could express, name what you EXPRESSED — "Engineering" for a filter that only
  checks job area, even if they asked for "engineering who are underpaid".
* A filter DESCRIBES WHO TO KEEP. "Remove people with prior grants" keeps those
  without them: {"eq": ["live_award_count", 0]}.
* REFUSE rather than approximate. If the request needs a field that is not in
  the list -- performance, manager, salary, promotion history -- say so in the
  refusal. A filter that quietly answers a different question is worse than
  none, because the user cannot see that it did.
* Refuse anything that is not a filter at all ("delete these people", "change
  the target to 40%%"). This box only narrows the list.
"""


def _fields_block():
    # type: () -> str
    lines = []
    for name, kind, note in FIELD_NOTES:
        suffix = "  -- %s" % note if note else ""
        lines.append("  %s (%s)%s" % (name, kind, suffix))
    return "\n".join(lines)


def system_prompt():
    # type: () -> str
    """The standing instructions. Cohort values are sent per-request, not here,
    because they change with every filter the user applies."""
    return SYSTEM_PROMPT % {"ops": OPS_NOTE, "fields": _fields_block()}


def _values_block(vocabulary):
    # type: (dict) -> str
    """The cohort's real values, as the model is allowed to use them.

    Capped per field: a 500-person cohort can carry hundreds of distinct job
    titles, and a prompt that long crowds out the instructions above it. The
    capped fields are the ones where an invented value is most damaging (area,
    track, level, location); free text like job_title is not listed at all,
    since there is nothing to enumerate usefully.
    """
    if not isinstance(vocabulary, dict):
        return ""
    out = []
    for key in ("job_area", "job_track", "job_level", "location", "job_focus"):
        values = vocabulary.get(key)
        if not isinstance(values, list) or not values:
            continue
        shown = [str(v) for v in values[:40] if v is not None]
        if not shown:
            continue
        more = "" if len(values) <= 40 else " (and %d more)" % (len(values) - 40)
        out.append("  %s: %s%s" % (key, ", ".join(shown), more))
    if not out:
        return ""
    return "\nThe employees on screen use exactly these values:\n" + "\n".join(out)


def build_request(phrase, vocabulary=None):
    # type: (str, dict) -> str
    """The message sent to the subprocess for one filter request."""
    return "%s%s\n\nRequest: %s" % (
        "Write a filter for this request.",
        _values_block(vocabulary or {}),
        (phrase or "").strip(),
    )


# A fenced block, if the model wraps its JSON despite being asked not to. Being
# strict about the reply and lenient about its packaging is the right trade: the
# CONTENT is validated downstream either way, and refusing a correct predicate
# over three backticks would be pedantry the user pays for.
_FENCE = re.compile(r"```(?:json)?\s*(.+?)\s*```", re.DOTALL)


# A label, not a paragraph. The model is asked for two to four words; this is the
# backstop for when it writes a sentence anyway, or a name with a newline in it
# that would break the control it sits on.
_MAX_NAME_CHARS = 40


def clean_name(value):
    # type: (object) -> str
    """A usable dropdown label, or "" when there is none.

    Returning "" rather than a fallback is deliberate: the caller already has
    `describe()`, which is DERIVED from the predicate and therefore cannot claim
    something the filter does not do. A missing name means "use that", which is
    always correct if less pretty. Inventing one here would put a second unverified
    description next to the verified one.
    """
    if not isinstance(value, str):
        return ""
    # Collapse any whitespace, including the newlines a model sometimes emits.
    name = " ".join(value.split())
    if len(name) > _MAX_NAME_CHARS:
        return ""
    return name


def parse_reply(text):
    # type: (str) -> dict
    """Claude's reply as {"predicate": ...} or {"refusal": "..."}.

    Never raises. Anything unparseable becomes a refusal, because the caller's
    only safe move on a reply it cannot read is to filter nothing and say so.
    """
    if not text or not text.strip():
        return {"refusal": "Claude returned nothing."}

    raw = text.strip()
    fenced = _FENCE.search(raw)
    if fenced:
        raw = fenced.group(1).strip()
    else:
        # Prose around a bare object: take the outermost braces rather than
        # failing, same leniency as the fence.
        start, end = raw.find("{"), raw.rfind("}")
        if start > 0 and end > start:
            raw = raw[start:end + 1]

    try:
        parsed = json.loads(raw)
    except ValueError:
        return {"refusal": "Claude's reply was not valid JSON."}

    if not isinstance(parsed, dict):
        return {"refusal": "Claude's reply was not a filter."}

    if isinstance(parsed.get("refusal"), str) and parsed["refusal"].strip():
        return {"refusal": parsed["refusal"].strip()}

    if "predicate" in parsed:
        predicate = parsed["predicate"]
        # Shape only. The real gate is validate() in model/predicate.js, which
        # knows the field and operator vocabulary; duplicating that here would
        # give two places to keep in step and one of them would drift.
        if isinstance(predicate, dict) and predicate:
            out = {"predicate": predicate}
            name = clean_name(parsed.get("name"))
            if name:
                out["name"] = name
            return out
        return {"refusal": "Claude returned an empty filter."}

    return {"refusal": "Claude's reply did not contain a filter."}
