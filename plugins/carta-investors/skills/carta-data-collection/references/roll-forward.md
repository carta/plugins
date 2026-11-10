# Roll a period's requests forward

"Ask for Q3 what we asked for in Q2" — a new period's requests mirroring the previous
period's, possibly changed ("minus the D&O policy", "add headcount, required"). The firm
is already resolved and its settings already checked — `org_pk` comes from the skill's
Steps 1 and 2.

This is the text path for repeating a whole request — its requirements included. The setup
form has no "copy last period's requirements" prefill, so a roll-forward does not open it — the
sends here go through `data_collection__send__request` and its own confirmation, exactly as
`references/send-request.md` requires.

**Only the companies repeating is not a roll-forward.** "Send to the same companies as last
time", "the ones I asked last quarter", with nothing said about what to ask them for, is the
form with `recent_companies: true` — `references/request-setup-view.md`, "Companies the prompt
picks". The view preselects the previous batch itself; do not read last period's requests or
ask the send's questions here. This file applies when the *requirements* are to carry over too:
"the same request as last quarter", "roll Q2 forward", "what we asked for last period".

## Step 0 — Settle the send's own questions first

`data_collection__send__request` requires a due date — null is rejected even for a create-only send — so ask
for it **before** reading anything, together with the audience (`company`, `firm`, both, or
nobody) and whether reminders follow up. Also say, if the user hopes to stage the requests
quietly: there is no draft state. A create-only send stamps the request `requested` with a
`sent_date`; it simply emails nobody, and its portal link works from that moment.

## Step 1 — Read what last period actually asked

One paginated read; the list returns sent requests alone, with all three requirement lists:

```
read_tool({"name": "data_collection__list__requests",
           "arguments": {"organization_pk": "<org_pk>",
                          "look_back_date": "<previous period start>",
                          "page_size": 30, "page": 1}})
```

Page until `has_more` is gone. Rows are ~1k characters each, so keep `page_size` modest
rather than retrying oversized pages.

**Fork: template sends roll forward without any of this.** If the user changes nothing and
last period was sent from each company's saved configuration, a new send with
`use_company_config_template: true` to the same companies *is* the roll-forward — skip to
Step 4 with no requirement lists at all. The explicit path below exists for modifications,
which the template branch rejects.

**Fallback source:** when the previous period has no sent requests (or the user says "what
they're normally asked for"), read `data_collection__get__requirements` instead — at most 50
`entity_ids` per call, so chunk and merge. Its rows carry sibling `requested_*` /
`required_*` code lists rather than pairs; the script below reads both shapes, and skips
rows with `enabled: false`.

## Step 2 — Resolve any modification against the vocabulary

A dropped or added document type is the INTEGER id from
`data_collection__list__document_types`; a metric is its mnemonic from
`data_collection__list__metrics`; files are the eight codes. A name with no match, or with
only a near-match, follows the creation offer in `references/request-setup-view.md` —
never guess an id.

## Step 3 — Build the payloads with the script

The grouping and modification arithmetic is deterministic, so do not do it by hand. Save
the Step 1 rows to a file and run:

```
python3 <skill>/scripts/roll_forward.py \
    --organization-pk <org_pk> \
    --period quarters:2026:3 \
    --due-date 2026-10-31 \
    --drop-document 8 \
    < rows.json > plan.json
```

`--drop-file/-metric/-document` and `--add-file/-metric/-document TYPE[:required]` repeat
as needed; `--notify company --notify firm` and `--send-follow-up` carry Step 0's answers;
`--skip-entity` takes companies Step 4 finds already served. The output is one
`data_collection__send__request` parameter object per group of companies whose requirements ended up
identical, chunked at the 100-entity ceiling, plus a summary:

- `summary.blocked_empty_requirements` — companies the change left asking for nothing; a
  send for them would be rejected, so name them and ask what they should be asked for.
- `summary.skipped_disabled` — configuration rows with collection switched off.
- `summary.modified` — how many companies the drops/adds actually changed, which is the
  number to say out loud ("D&O removed from 36 of 58").

## Step 4 — Skip what already exists, confirm, send

Read the target period once (`data_collection__list__requests` with its `look_back_date`); any company
already holding a request there goes into `--skip-entity` and the script runs again — the
send endpoints reject duplicates on entity + period + requirements, and it is cheaper to
know first than to unpick a 409's `duplicate_entities`.

Then confirm exactly as `references/send-request.md` requires — companies by count and
name, the period, the due date, who gets emailed, and what changed against last period —
**end the reply**, and on yes make one `data_collection__send__request` call per entry in `sends`. Each
returns `{sent, requested, results}`, with one `results` entry per request and its company's
`entity_id`; sum `sent` across the calls, report it against the plan's company count, and name
the companies from the roster — never their request ids.
