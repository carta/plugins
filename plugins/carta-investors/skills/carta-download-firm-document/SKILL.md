---
name: carta-download-firm-document
description: >-
  Download a document from your firm's Documents page in Carta (LPA, NDA, side letter, engagement letter, capital call notice, and so on). Finds the document by title, type or fund, confirms which one when several match, then saves it to your Downloads folder once you confirm (Claude Code), or gives a short-lived download link (Cowork, claude.ai). Never reads the file. TRIGGER: "download the LPA from our documents", "get me the NDA from {firm}'s documents page", "send me a link to our engagement letter in Carta", "download a document from my firm", "find and download the side letter we uploaded", "I need the {document} from Carta's Documents page". NOT FOR: documents shared with LPs or an LP's own documents (use carta-gp-lp-documents or carta-lp-documents); uploading a file to Carta (use carta-upload-firm-document); tear sheets (use carta-download-tearsheet).
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
  - Read
  - AskUserQuestion
---

<!-- carta:plugin-version -->
<carta-plugin>carta-investors:6.117.2</carta-plugin>

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
| 1. Find the document | `call_tool({"name": "fa__list__firm-documents", "arguments": {"firm_uuid": "<firm_uuid>", "search": "<title_text>"}})` |
| 2. Get its link | `call_tool({"name": "fa__get__firm-document-download-url", "arguments": {"firm_uuid": "<firm_uuid>", "document_id": "<document_id>"}})` |
| 3. Save it | `curl` to `~/Downloads` — Gate 3d, Claude Code only |

Every link minted in step 2 is recorded in Carta's document access log, so mint
one only for a document the user chose, at most 5 per run.

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
call_tool({"name": "fa__list__firm-documents", "arguments": {"firm_uuid": "<firm_uuid>", "search": "<title_text>"}})
```

- `search` — words from the user's request that would appear in the title
  ("Meridian side letter" → `Meridian`). Leave it out when they gave none.
- A document type the user named ("the NDA", "our LPA") is not sent: the
  `document_types` filter needs Carta's exact type name, and a near-miss matches
  nothing. Match the type against each row's `document_type` instead
  ("NDA" → `Non-Disclosure Agreement (NDA)`), and keep the rows that fit.
  None fit and `has_next` is true → say so and offer the next page.
- `fund_ids` — only when the user named a fund and you already have its
  fund-admin integer id. Do not go looking for one; mention the fund in
  `search` instead.

Results come newest first. Each row is `{id, title, document_type, fund_name,
partner_name, date}`; the response also carries `has_next` and `next`.

### 2b — pick

| Results | Do |
|---|---|
| Exactly one | Gate 3 |
| Several | Show the table below, then `AskUserQuestion` — "Which document do you want?" One option per row shown (up to 4, then free text); multi-select allowed. Ask only which document, never how to deliver it |
| None, with filters | Say nothing matched, and offer to search again without the type or with fewer words. Never pick a near match on your own |
| None, no filters | The firm's Documents page is empty for this user. Say so and stop |

Show at most 5 rows, then "+ N more" when `has_next` is true or more rows came
back. Never show `id`s.

| # | Title | Type | Fund | Date |
|---|---|---|---|---|
| 1 | <title> | <document_type> | <fund_name or —> | <date> |

Show more only when asked: call 2a again with `after` set to the previous
response's `next`. Never page through the whole list unasked.

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

In link mode, go straight to 3c: a link writes nothing.

### 3c — mint the link

For each chosen document (at most 5 per run):

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

**Before saving, check `url`:** it must start with `https://` and its host must
either end in `.amazonaws.com` or be exactly `documents.carta.com`. Anything
else → do not run `curl`; say the file couldn't be saved, then give the link in
the link-mode report format.

Name the file `<safe_filename>`: `filename` with `/ \ : * ? " < > |` and
control characters removed and leading dots and spaces trimmed (empty → the
document's title, sanitized the same way). Never overwrite a file:

```bash
ls -l ~/Downloads/'<safe_filename>'
```

If it exists, add ` (1)`, ` (2)`, … before the extension and check again. Then:

```bash
curl --proto '=https' --tlsv1.2 -sS -f -o ~/Downloads/'<safe_filename>' -w '%{http_code}\n' '<url>'
```

Single-quote every value; a value containing `'` is written `'\''`.

- `200` → `ls -l ~/Downloads/'<safe_filename>'` for the size, then report:
  > Saved **<filename>** to `~/Downloads/<safe_filename>` (<size>).
- `403` → the link most likely expired. Mint **one** fresh link (3c) and run
  `curl` once more. That is the only retry: at most two `curl` runs per
  document.
- Anything else, a second failure, or a connection error → say the file
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

Link option 2 to `{base_url}/investors/firm/<carta_id>/portfolio/documents`;
leave it out when there is no `carta_id`.

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
| User cancels at the download confirm | Stop. No link is minted, nothing is saved |
| `url` from 3c is not `https://…amazonaws.com` or `https://documents.carta.com/…` | Do not save; say the file couldn't be saved, then give the link |
| `curl` fails twice, or can't connect | Say the file couldn't be saved, then give the link; do not vary the command |
| More than 5 documents wanted | Do the first 5, then offer the rest in another round |
| User asks to upload a file | That is `carta-upload-firm-document` |
| User asks to delete, rename or replace a document | Not supported here; they can do it from the Documents page in Carta |
| User asks you to read or summarize the file | Not something this skill does; the file is in their Downloads folder (save mode) or behind the link (link mode) |
