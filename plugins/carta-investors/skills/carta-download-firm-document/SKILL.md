---
name: carta-download-firm-document
description: >-
  Download a document from your firm's Documents page in Carta (LPA, NDA, side letter, engagement letter, capital call notice, and so on). Finds the document by title, type, fund, company, investor or date, confirms which one when several match (or, when you ask for every match such as "all NDAs from last month", gathers the matches and confirms the batch), then saves it to your Downloads folder once you confirm (Claude Code), or gives a short-lived download link (Cowork, claude.ai). Never reads the file. TRIGGER: "download the LPA from our documents", "get me the NDA from {firm}'s documents page", "send me a link to our engagement letter in Carta", "download a document from my firm", "find and download the side letter we uploaded". NOT FOR: audit documents (use carta-download-audit-documents); documents shared with LPs or an LP's own documents (use carta-gp-lp-documents or carta-lp-dashboard); uploading a file to Carta (use carta-upload-firm-document); tear sheets (use carta-explore-data).
version: 0.1.0
model: inherit
allowed-tools:
  # Production
  - mcp__claude_ai_Carta__call_tool
  - mcp__claude_ai_Carta__welcome
  - mcp__claude_ai_Carta__get_current_user
  - mcp__claude_ai_Carta__list_contexts
  - mcp__claude_ai_Carta__skill_checkpoint
  # Local / legacy fallback
  - mcp__carta__call_tool
  - mcp__carta__welcome
  - mcp__carta__get_current_user
  - mcp__carta__list_contexts
  - mcp__carta__skill_checkpoint
  # Cowork
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__call_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__welcome
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__get_current_user
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__list_contexts
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__skill_checkpoint
  - Bash(ls -l *)
  - Bash(uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-download-firm-document/scripts/save_to_downloads.py" *)
  - Read
  - AskUserQuestion
---

<!-- carta:plugin-version -->
<carta-plugin>carta-investors:7.31.1</carta-plugin>

> **If this plugin's files can't be found:** a path that still shows an unreplaced `${…}` variable, or a "not found" when you read or run one of this skill's files, means the skill loaded before this session's computer link was ready. Invoke this skill once more with the Skill tool and use the paths that copy gives. If they're still unreplaced, tell the user Carta's plugin files aren't available in this session yet (link your computer, then ask again) and stop. Don't search the disk for them.

<!-- Part of the official Carta AI Agent Plugin -->

# Download a document from your firm's Documents page

Finds a document on a firm's Documents page in Carta and gets it to the user.
Where Claude runs on the user's own computer, it saves the file to their
Downloads folder once they confirm; elsewhere it hands them the download link.
The link is signed, lasts 15 minutes and opens without a Carta login, so it is
only ever saved to disk or given to the user — this skill never opens the saved
file or reads its contents.

## Commands

Names are verbatim. Call each through `call_tool` on whichever Carta MCP server
this session has. All three are reads. Every Carta call carries
`"_instrumentation_v2": {"skills": ["carta-investors:carta-download-firm-document"]}`;
if one is rejected for missing it, send it again with it, without telling the user.

| Step | Call |
|---|---|
| Find the firm | `list_contexts(firm_uuid="<firm_uuid>")`, `list_contexts(firm_id="<carta_id>")`, `list_contexts(firm_name="<firm_name>")`, or `list_contexts()` when nothing is named — Gate 1 |
| Look up a named fund or company | `call_tool({"name": "fa__get__firm-document-filter-options", "arguments": {"firm_uuid": "<firm_uuid>", "name": "<fund_or_company_name>"}})` — Gate 2a |
| 1. Find the document | `call_tool({"name": "fa__list__firm-documents", "arguments": {"firm_uuid": "<firm_uuid>", "document_types": ["<type_name>"], "search": "<title_text>", "page_size": 50}})`, plus the filters Gate 2a adds |
| 2. Get its link | `call_tool({"name": "fa__get__firm-document-download-url", "arguments": {"firm_uuid": "<firm_uuid>", "document_id": "<document_id>"}})` |
| 3. Save it | `save_to_downloads.py` to `~/Downloads` — Gate 3d, Claude Code only |

Every link minted in step 2 is recorded in Carta's document access log, so mint
one only for a document the user chose, at most 20 per run (the run's cap).

---

## Gate 0 — session

Call `welcome`, then `get_current_user`. Keep `base_url` for links and
`is_staff` for Gate 1.

> **Checkpoint**: Call `mcp__<SERVER>__skill_checkpoint(skill_name="carta-investors:carta-download-firm-document", checkpoint_label="skill_started")` before proceeding. `<SERVER>` is the MCP server name you called `welcome` on in this session.

Each run records each checkpoint at most once, and exactly one of `skill_finished` or `skill_failed`. A step reached again later in the same run (another document, a fresh link, the next page) does not checkpoint again.

Then decide **save mode** or **link mode** for the whole run, before asking the
user anything, and without telling the user about it. With Bash, run once:

```bash
ls -l -d ~/Downloads ~/mnt/outputs
```

**Save mode** needs all of these: `~/Downloads` is listed as a directory (its
line starts with `d`), `~/mnt/outputs` is not there, and no path in the output
starts with `/sessions/`. That is Claude Code on the user's computer, where
`~/Downloads` is theirs.

Anything else is **link mode**: claude.ai (no Bash) and Cowork (home under
`/sessions/`, with a `mnt/outputs` folder).

Do **not** stop on `fund_admin_access` or any other profile flag. Those come from
best-effort account enrichment, not from the permission check. Whether this user
may see this firm's documents is decided by `fa__list__firm-documents`, and only
its answer is reported as "no access".

## Gate 1 — the firm

Read `${CLAUDE_PLUGIN_ROOT}/references/gate-resolve-firm.md` (the plugin's own
`references/`, not this skill's — do not search for it) and follow it, with:

- `<firm_question>`: "Which firm's documents should I look in?"
- `<access_step>`: `fa__list__firm-documents` (step 1)
- `<no_uuid_stop>`: suggest the firm's Documents page in Carta

It yields `<firm_uuid>` for steps 1 and 2, plus `<firm_name>` and, when known,
`<carta_id>` for the Documents page link.

## Gate 2 — the document

### 2a — search

```
call_tool({"name": "fa__list__firm-documents", "arguments": {"firm_uuid": "<firm_uuid>", "document_types": ["<type_name>"], "fund_ids": [<fund_id>], "issuer_ids": ["<issuer_id>"], "signed_from": "<yyyy-mm-dd>", "signed_to": "<yyyy-mm-dd>", "uploaded_from": "<yyyy-mm-dd>", "uploaded_to": "<yyyy-mm-dd>", "executed": "yes", "search": "<title_text>", "page_size": 50}})
```

Send only the filters the request gives, and leave every other one out.

- `document_types` — when the user named a kind of document ("the NDA", "our
  W-9s", "capital call notices"), send Carta's exact type name from
  `${CLAUDE_PLUGIN_ROOT}/skills/carta-download-firm-document/references/document-types.md`
  (this skill's own `references/`, not the plugin's — do not search for it):
  "NDA" → `Non-Disclosure Agreement (NDA)`, "W-9" → `W8/W9`. Read it once per
  run; the filter matches a name exactly, so never send a name that is not on
  that list. When several types fit, send each. When none fits, leave it out
  and match the user's words against each row's `document_type` instead.
- When the type sent holds more than the user asked for (`W8/W9` holds W-8s
  and W-9s alike), say so with the results: "Carta files W-8s and W-9s under
  one type, so these include both."
- `fund_ids` and `issuer_ids` — for a fund, portfolio company or investor the
  user named. Look each name up once, before the search, with
  `fa__get__firm-document-filter-options` and `name` set to the words that
  name it ("Fund II", not "Great Basin Fund II, L.P."). It returns `funds`
  (`{name, fund_id}`) and `issuers` (`{name, issuer_id}`, the portfolio
  companies). When the user said "fund", only `funds` count; when they said
  "company", only `issuers` count. A 403 from the lookup takes the `None`
  path below, keeping rows whose `partner_name` or `fund_name` contains the
  name; the list's own answer decides access.
  - One match, when the user said "fund" or "company" → send its `fund_id`
    in `fund_ids`, or its `issuer_id` in `issuer_ids`.
  - Several, or any match when the user said neither "fund" nor "company"
    (a match is then only a guess) → ask with the `AskUserQuestion` tool,
    "Which of these did you mean?" One option per match (up to 4, or up to 3
    when the investor option is added, then free text), plus "An investor
    named <name>" when the user said neither, which takes the `None` path.
    Multi-select allowed. Never pick one on your own.
  - None → the name is an investor. Carta can't filter by investor here, so
    with a type sent, keep the rows whose `partner_name` contains the name
    ("Meridian side letter" → type `Side Letter`, no `search`; Meridian is no
    fund or company, so keep rows whose `partner_name` contains "Meridian").
    After a lookup 403, keep the rows whose `partner_name` or `fund_name`
    contains the name. With no type, put the name in `search` instead.
- `signed_from` / `signed_to` — inclusive `YYYY-MM-DD` dates, when the user
  ties a date to signing ("signed in March 2026", "executed last quarter").
  Say with the results: "Documents with no signed date in Carta are left out
  of a signed-date search."
- `uploaded_from` / `uploaded_to` — inclusive `YYYY-MM-DD` dates, only when
  the user ties a date to uploading or adding ("uploaded this year", "added
  in March") or asks for a recent window ("from last month"). That is the
  upload date, the Date column on the Documents page. A year, quarter or
  period that names what the document covers stays in `search` as title
  words ("the 2024 K-1" → type `Tax - Schedule K-1`, search `2024`): a 2024
  K-1 is uploaded in 2025.
- `executed` — `"yes"` when the user asks for executed or fully signed
  documents, `"no"` when they ask for unsigned ones.
- `search` — the words left over that would appear in the title: not the
  type's own words, a name looked up above, a date sent as a filter above
  or "executed" ("the executed Series B SPA" → type `Stock Purchase
  Agreement (SPA)`, executed `yes`, search `Series B`). Never put the type's own words in `search`: a
  W-9 titled "scan_0042.pdf" has no "W-9" in its title. Leave `search` out
  when nothing is left.
- `page_size` — always 50, the most Carta returns at once.

No row fits and `has_next` is true → say so and offer the next page (the
every-match step below pages on its own instead).

Results come newest first. Each row is `{id, title, document_type, fund_name,
partner_name, date, signed_date}`: `date` is the upload date and
`signed_date` is null when Carta has none. The response also carries
`total_count` (every match across pages, or null when Carta didn't count
them), `has_next` and `next`. A row is **matched locally** when 2a kept it
by its `partner_name` or `fund_name`, or, with no type sent, by its
`document_type`; `total_count` counts before that, so it is the number of
matches only when nothing was matched locally.

### Every match

When the user asks for every document that matches ("all NDAs from last
month", "every side letter for Fund II"), this step replaces 2b: the matches
are the choice, so there is no pick question.

1. Keep the rows that fit the request: every row 2a returns, except that rows
   matched locally (2a) must match. Call 2a again with `after` set to the
   previous `next` until `has_next` is false, the kept rows reach the run's
   cap, or 10 calls are done.
2. Keep at most the run's cap of rows, newest first. That number is the
   batch: the table, the confirm and the links minted all use it.
3. The batch is cut short when step 2 dropped a matching row, or paging
   stopped on the cap or step 1's call limit while `has_next` was still true.
4. No rows kept and not cut short → as `None, with filters` in 2b. No rows
   kept and cut short → say none of the documents checked so far match, and
   offer to look further. Otherwise show every kept row in the table below;
   if cut short, add under it: "More documents may match. Ask me for the next
   ones after these." When nothing was matched locally and `total_count` is
   known, say instead "Carta has <total_count> matching documents; these are
   the newest <N>. Ask me for the next ones after these." With a `carta_id`,
   end that sentence instead with ", or browse them on the firm's Documents
   page with this search's filters:" followed by the filtered page link
   (below), and name what the user still narrows by there: whichever of type,
   investor, company, date or executed this search used that the link does
   not carry. The next ones: call 2a again with the same `after` as this
   batch's last call, and skip the rows already in this batch. Never present
   a cut-short batch as every match.
5. Confirm the batch before any link is minted. Save mode: 3b's confirm.
   Link mode: `AskUserQuestion` — "Get links for these <N> documents?" —
   **Get links** ← recommended → 3c; **Cancel** → stop, no link is minted.

**Filtered page link** — the firm's Documents page with the filters 2a sent
(type, fund id, title words):
`{base_url}/investors/firm/<carta_id>/portfolio/documents/?documentTypes=<type_name>&fundIds=<fund_id>&searchString=<title_text>`.
Repeat `documentTypes` (and `fundIds`) once per value, URL-encode each value
(`W8/W9` → `W8%2FW9`), and leave out a parameter the search did not send. No
`carta_id` → leave the link out.

### 2b — pick

| Results | Do |
|---|---|
| Exactly one | Gate 3 |
| Several | Show the table below, then `AskUserQuestion` — "Which document do you want?" One option per row shown (up to 4, then free text); multi-select allowed. Ask only which document, never how to deliver it |
| None, with filters | Say nothing matched, name the filters sent, and offer to search again with fewer of them (without the type, the dates, `executed` or some title words). Never pick a near match on your own |
| None, no filters | The firm's Documents page is empty for this user. Say so and stop |

In 2b, show at most 5 rows, then "+ N more" when `has_next` is true or
more rows came back. N is `total_count` minus the rows shown when nothing was
matched locally and `total_count` is known; otherwise it is the rows that came
back but aren't shown, followed by "so far" when `has_next` is true. Never
show `id`s.

| # | Title | Type | Fund | Signed | Uploaded |
|---|---|---|---|---|---|
| 1 | <title> | <document_type> | <fund_name or —> | <signed_date or —> | <date> |

Show more only when asked: call 2a again with `after` set to the previous
response's `next`. Never page through the whole list unasked, except in the
every-match step above.

## Gate 3 — get the file

### 3a — save or link

Use the mode Gate 0 set. Never re-decide it here. In link mode the link is the
download, even when the user asked to download or save the file: never offer to
save it, never ask where to put it, and never say why it is a link, where else
the file could go or where this session runs.

### 3b — confirm (save mode only)

Call the `AskUserQuestion` tool — "Download <title> to your Downloads folder?"
(for several: "Download these <N> documents to your Downloads folder?"). Use
these labels, in this order:

- **Download** ← recommended → 3c, then 3d
- **Just give me the link** → 3c, then report as in link mode
- **Cancel** → stop. No link is minted.

In link mode, go straight to 3c: a link writes nothing. A batch from the
every-match step is confirmed there first.

### 3c — mint the link

For each chosen document, up to the run's cap:

```
call_tool({"name": "fa__get__firm-document-download-url", "arguments": {"firm_uuid": "<firm_uuid>", "document_id": "<document_id>"}})
```

Returns `{url, filename, content_type, expires_in_seconds}`.

**Link mode report** — in link mode, reply with exactly this, one link line per
document, and add nothing before or after it except the next-step menu at the
end of 3d:

> Click to download:
>
> - [<filename>](<url>)
>
> The link works for 15 minutes and opens without signing in to Carta, so don't
> forward it. Ask me for a fresh one if it expires.

### 3d — save it (save mode)

Run this once per document, on one line, exactly as written: `allowed-tools`
matches the command text, so any other form makes the user approve every file.
`<filename>` and `<title>` are 3c's `filename` and the document's title:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-download-firm-document/scripts/save_to_downloads.py" '<url>' '<filename>' '<title>'
```

Single-quote every value; a value containing `'` is written `'\''`. The
script checks that `url` is Carta's document storage, saves under a safe name without overwriting
an existing file (adding ` (1)`, ` (2)`, …), and prints one JSON line:

- `{"status": 200, "path": …, "bytes": …}` → report:
  > Saved **<filename>** to `<path>` (<bytes as KB or MB>).
- `{"status": 403}` → the link most likely expired. Mint **one** fresh link
  (3c) and run the script once more. That is the only retry: at most two runs
  per document.
- `{"error": "refused", …}`, any other status, a second failure, or
  `{"error": "connection"}` → say the file
  couldn't be saved, then give the link in the link-mode report format, so the
  user can still download it. Do not change the command and try again.

Never open, `Read` or summarize the saved file, and never fetch `url` any other
way (no WebFetch, no browser).

Then offer:

```
1 - Download another document  ← recommended
2 - Open the firm's Documents page
3 - Done
```

Offer these after the last report of the run, not after each document.

> **Checkpoint**: Call `mcp__<SERVER>__skill_checkpoint(skill_name="carta-investors:carta-download-firm-document", checkpoint_label="skill_finished")` once, with this menu. A file saved, a link given, and a failed save that gave the link instead all count: the user has the document.

Link option 2 to the filtered page link (Gate 2, every match) with no
filters; leave option 2 out when there is no `carta_id`.

---

## If something goes wrong

> **Checkpoint on every stop before this run has recorded `skill_finished`**, whether or not this table lists it: call `mcp__<SERVER>__skill_checkpoint(skill_name="carta-investors:carta-download-firm-document", checkpoint_label="skill_failed", notes="<one-line reason>")` instead of `skill_finished`. That includes a cancel at a confirm, no matching document, no access and a disabled command. `skill_finished` means a document or its link reached the user; a stop that delivered neither is a failure, and counting it as finished makes failed runs look like fast successful ones. Rows that recover and continue (a fresh link, a search again, a save that falls back to the link) do not checkpoint.

| Situation | Response |
|---|---|
| A Carta command is missing or says it isn't available | "Downloading firm documents isn't enabled for your account yet." Stop. No other route |
| 403 from the list or the link | "You need firm administrator access, or view access to every fund at <firm_name>, to open its Documents page. Ask your firm's Carta administrator." Stop |
| 404 from the list or the fund and company lookup | The firm wasn't found. Back to Gate 1; never switch firms on your own |
| 404 from the link, document not found | Search again (Gate 2) — the document may have been removed |
| The link response says the document can't be downloaded through Carta MCP | "This document can't be downloaded from here; open it from the firm's Documents page in Carta." Do not retry |
| Link expired | Mint one fresh link for that document when the user asks |
| User cancels at the download confirm, or at the every-match batch confirm | Stop. No link is minted, nothing is saved |
| The script refuses the link | Nothing was saved; say the file couldn't be saved, then give the link |
| A save fails twice, or can't connect | Say the file couldn't be saved, then give the link; do not vary the command |
| More documents wanted than the run's cap | Do as many as the cap allows, then offer the rest in another round. In the every-match step, say more may match, as step 4 says |
| User asks to upload a file | That is `carta-upload-firm-document` |
| User asks to delete, rename or replace a document | Not supported here; they can do it from the Documents page in Carta |
| User asks you to read or summarize the file | Not something this skill does; the file is in their Downloads folder (save mode) or behind the link (link mode) |
