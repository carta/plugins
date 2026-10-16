# Reference: reporting a bug or feature request (`fa:create:feedback`)

<!-- feedback-contract:begin -->
This contract is shared verbatim across `carta-manco`, `carta-manco-reporting`, and
`carta-consolidating-financial-reports` — each carries its own copy so it keeps working
standalone in Excel, where a skill can't read another skill's `references/`. Keep a change
here in sync across all three; `tests/carta-investors/test_feedback_contract.py` checks that
the text between these markers is byte-for-byte identical in every copy. `affectedSkill`
below is a placeholder on purpose — it's filled in from this skill's own name at the bottom
of this file, outside the shared block, so the block itself never needs to differ.

## Availability check

Call `search_tools("report a bug feedback")` once per session and reuse that result for the
rest of the session — don't repeat the call before every later report. Only call
`fa__create__feedback` when it appears in the results: it is feature-flagged and absent on a
default deployment. If it's not there, in-session feedback isn't enabled for this account —
say exactly that if the user asked you to file something, say nothing at all if you were
filing on your own initiative, and either way stop. Don't retry a call that came back
"Unknown tool," and don't route the report anywhere else.

## Call shape

```
call_tool({"name": "fa__create__feedback", "arguments": {
  "requestType": "bug" | "feature_request",
  "requestBody": "<what went wrong, or the capability being asked for>",
  "flowSummary": "<see below>",
  "context": "<the raw failing tool + args>",
  "affectedSkill": "<this skill's own affectedSkill value, below>",
  "source": "claude" | "user"
}})
```

Never pass identity, firm, session, or timestamp — the server captures those itself.
`source` is `"user"` when the user asked you to file something, `"claude"` when you're
filing on your own initiative (a tool errored, returned nothing usable, or the user needs
something this skill can't yet do).

`flowSummary` is written for the developer who has to fix this with only what you put here:
the relevant user prompt(s), summarized; the steps and tools this skill ran, in order; and
the actual result — especially the failing one — with values and errors quoted exactly.
Enough to reproduce, no more. `context` holds the one raw failing tool call and its
arguments.

## When to file

- a Carta tool call errors, or returns nothing usable, after this skill's own retry/check
  for that case has already run (never file instead of the retry — file once the retry is
  exhausted)
- a plugin script exits non-zero on a data problem (not a local environment problem — see
  below)
- the user says a result is wrong, or something is broken (`source: "user"`)
- the user asks for something this skill can't do (`requestType: "feature_request"`)

These are the general rules. A specific skill's own failure-contract reference (see "Where
this skill files from" below) is the authority on any one case: it can and does carve out an
exception that looks like one of the rules above but isn't — a data-shaped exit that's
actually a fact about the firm, not a defect, for instance. Defer to it over this list.

File once per distinct issue per session — don't re-file the same error on a retry loop, and
don't file a second ticket for a problem already reported this session.

## When NOT to file

- a local environment failure — a script fails to spawn, a required local tool is missing or
  its install fails. This is specific to this one run's install, not something a ticket
  reader could act on.
- a permission or access denial (403, "not authorized", BTG required)
- the user cancelling, declining, or correcting an input mid-run — nothing broke
- an input error this skill's own validation catches and the user fixes in the same turn

## Telling the user

Add one plain sentence after the skill's own response to the failure — never instead of it,
never before it: *"I've reported this to Carta's team so they can look into it."* Never name
a tool, a command, or an internal error category in that sentence — the skills' own voice and
tone rules already forbid surfacing tool names in user-facing text. Filing never blocks,
delays, or replaces this skill's own response to the failure — it only ever follows it.
<!-- feedback-contract:end -->

## Where this skill files from

`affectedSkill`: `"carta-investors:carta-manco-reporting"`

[errors.md](errors.md) marks every failure contract in this skill as **File** or **Don't
file** — that marking, not a guess from the general rules above, decides whether a given
failure in this skill gets reported.
