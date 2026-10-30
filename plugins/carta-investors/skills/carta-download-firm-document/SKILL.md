---
name: carta-download-firm-document
description: >-
  Download a document from your firm's Documents page in Carta (LPA, NDA, side letter, engagement letter, capital call notice, and so on). Finds the document by title, type or fund, confirms which one when several match (or, when you ask for every match such as "all NDAs from last month", gathers the matches and confirms the batch), then saves it to your Downloads folder once you confirm (Claude Code), or gives a short-lived download link (Cowork, claude.ai). Never reads the file. TRIGGER: "download the LPA from our documents", "get me the NDA from {firm}'s documents page", "send me a link to our engagement letter in Carta", "download a document from my firm", "find and download the side letter we uploaded", "I need the {document} from Carta's Documents page". NOT FOR: documents shared with LPs or an LP's own documents (use carta-gp-lp-documents or carta-lp-documents); uploading a file to Carta (use carta-upload-firm-document); tear sheets (use carta-download-tearsheet).
version: 0.1.0
model: inherit
allowed-tools:
  # Production
  - mcp__claude_ai_Carta__call_tool
  - mcp__claude_ai_Carta__welcome
  - mcp__claude_ai_Carta__get_current_user
  - mcp__claude_ai_Carta__list_contexts
  # Local / legacy fallback
  - mcp__carta__call_tool
  - mcp__carta__welcome
  - mcp__carta__get_current_user
  - mcp__carta__list_contexts
  # Cowork
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__call_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__welcome
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__get_current_user
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__list_contexts
  - Bash(ls -l *)
  - Bash(uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-download-firm-document/scripts/save_to_downloads.py" *)
  - Read
  - AskUserQuestion
---

<!-- carta:plugin-version -->
<carta-plugin>carta-investors:7.8.0</carta-plugin>

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
this session has. Both are reads. Every Carta call carries
`"_instrumentation_v2": {"skills": ["carta-investors:carta-download-firm-document"]}`;
if one is rejected for missing it, send it again with it, without telling the user.

| Step | Call |
|---|---|
| Find the firm | `list_contexts(firm_uuid="<firm_uuid>")`, `list_contexts(firm_id="<carta_id>")`, `list_contexts(firm_name="<firm_name>")`, or `list_contexts()` when nothing is named — Gate 1 |
| 1. Find the document | `call_tool({"name": "fa__list__firm-documents", "arguments": {"firm_uuid": "<firm_uuid>", "document_types": ["<type_name>"], "search": "<title_text>", "page_size": 50}})` |
| 2. Get its link | `call_tool({"name": "fa__get__firm-document-download-url", "arguments": {"firm_uuid": "<firm_uuid>", "document_id": "<document_id>"}})` |
| 3. Save it | `save_to_downloads.py` to `~/Downloads` — Gate 3d, Claude Code only |

Every link minted in step 2 is recorded in Carta's document access log, so mint
one only for a document the user chose, at most 20 per run (the run's cap).

---

## Gate 0 — session

Call `welcome`, then `get_current_user`. Keep `base_url` for links and
`is_staff` for Gate 1.

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
call_tool({"name": "fa__list__firm-documents", "arguments": {"firm_uuid": "<firm_uuid>", "document_types": ["<type_name>"], "search": "<title_text>", "page_size": 50}})
```

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
- `search` — words from the user's request that would appear in the title and
  are not the type's own words ("the executed Series B SPA" → type `Stock
  Purchase Agreement (SPA)`, search `Series B`). Never put the type's own
  words in `search`: a W-9 titled "scan_0042.pdf" has no "W-9" in its title.
  With a type sent, an investor or fund the user named is matched against
  each row's `partner_name` and `fund_name`, not sent in `search`, since
  titles often leave them out ("Meridian side letter" → type `Side Letter`,
  no `search`; keep rows whose `partner_name` or `fund_name` contains
  "Meridian"). With no type, mention them in `search`. Leave `search` out
  when nothing is left.
- `fund_ids` — only when the user named a fund and you already have its
  fund-admin integer id. Do not go looking for one.
- `page_size` — always 50, the most Carta returns at once.

No row fits and `has_next` is true → say so and offer the next page (the
every-match step below pages on its own instead).

Results come newest first. Each row is `{id, title, document_type, fund_name,
partner_name, date}`; the response also carries `has_next` and `next`.

### Every match

When the user asks for every document that matches ("all NDAs from last
month", "every side letter for Fund II"), this step replaces 2b: the matches
are the choice, so there is no pick question.

1. Keep the rows that fit the request, matched as 2a says (investor, fund,
   and type when no type was sent), and within any date range the user gave.
   Call 2a again with `after` set to the previous `next` until `has_next` is
   false, the rows are older than a date range the user gave, the kept rows
   reach the run's cap, or 10 calls are done.
2. Keep at most the run's cap of rows, newest first. That number is the
   batch: the table, the confirm and the links minted all use it.
3. The batch is cut short when step 2 dropped a matching row, or paging
   stopped on the cap or step 1's call limit while `has_next` was still true.
4. No rows kept and not cut short → as `None, with filters` in 2b. No rows
   kept and cut short → say none of the documents checked so far match, and
   offer to look further. Otherwise show every kept row in the table below;
   if cut short, add under it: "More documents may match. Ask me for the next
   ones after these." With a `carta_id`, end that sentence instead with ", or
   browse them on the firm's Documents page with this search's filters:"
   followed by the filtered page link (below), and name what the user still
   narrows by there: whichever of type, investor, fund or date this batch
   matched locally rather than sent. The next ones: call 2a again with the
   same `after` as this batch's last call, and skip the rows already in this
   batch. Never present a cut-short batch as every match.
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
| None, with filters | Say nothing matched, and offer to search again without the type or with fewer words. Never pick a near match on your own |
| None, no filters | The firm's Documents page is empty for this user. Say so and stop |

In 2b, show at most 5 rows, then "+ N more" when `has_next` is true or
more rows came back. Never show `id`s.

| # | Title | Type | Fund | Date |
|---|---|---|---|---|
| 1 | <title> | <document_type> | <fund_name or —> | <date> |

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

Link option 2 to the filtered page link (Gate 2, every match) with no
filters; leave option 2 out when there is no `carta_id`.

---

## If something goes wrong

| Situation | Response |
|---|---|
| A Carta command is missing or says it isn't available | "Downloading firm documents isn't enabled for your account yet." Stop. No other route |
| 403 from either command | "You need firm administrator access, or view access to every fund at <firm_name>, to open its Documents page. Ask your firm's Carta administrator." Stop |
| 404 from the list | The firm wasn't found. Back to Gate 1; never switch firms on your own |
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
