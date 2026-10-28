---
name: carta-upload-firm-document
description: >-
  Upload one or more files from your computer to your firm's Documents page in Carta. Carta classifies each document after it lands. Confirms the firm and files once before anything is written. TRIGGER: "upload this document", "upload these documents", "upload this document to {firm}", "upload this to Carta", "add this PDF to our firm documents", "put this NDA on our documents page", "save this side letter to Carta", "file this engagement letter in Carta", "upload a document to my firm". NOT FOR: downloading a document already on the firm's Documents page (use carta-download-firm-document); finding documents shared with LPs (use carta-gp-lp-documents or carta-lp-documents); sending a file to your Fund Admin team as part of a request (use carta-fund-admin-requests); passports, driver's licenses or other identity documents, which go through KYC, not the Documents page.
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
  - Bash(uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-upload-firm-document/scripts/send_to_storage.py" *)
  - Read
  - AskUserQuestion
---

<!-- carta:plugin-version -->
<carta-plugin>carta-investors:7.5.6</carta-plugin>

> **If this plugin's files can't be found:** a path that still shows an unreplaced `${…}` variable, or a "not found" when you read or run one of this skill's files, means the skill loaded before this session's computer link was ready. Invoke this skill once more with the Skill tool and use the paths that copy gives. If they're still unreplaced, tell the user Carta's plugin files aren't available in this session yet (link your computer, then ask again) and stop. Don't search the disk for them.

<!-- Part of the official Carta AI Agent Plugin -->

# Upload a document to your firm's Documents page

Puts one or more local files on a firm's Documents page in Carta. Once a file
lands, everyone at the firm with firm administrator or full view access can see
it, so the firm and the files are confirmed together, once, before anything is
written. Then every file uploads without asking again.

Carta classifies each document after upload. This skill never picks, suggests,
asks for or sends a document type, even when the user names one ("upload this
NDA"): that wording only identifies the file.

## Commands

Names are verbatim. Call each through `call_tool` on whichever Carta MCP server
this session has. Every Carta call carries
`"_instrumentation_v2": {"skills": ["carta-investors:carta-upload-firm-document"]}`;
if one is rejected for missing it, send it again with it, without telling the user.

| Step | Call |
|---|---|
| Find the firm | `list_contexts(firm_uuid="<firm_uuid>")`, `list_contexts(firm_id="<carta_id>")`, `list_contexts(firm_name="<firm_name>")`, or `list_contexts()` when nothing is named — Gate 2 |
| 1. Get an upload URL | `call_tool({"name": "fa__create__document-upload-url", "arguments": {"filename": "<file_name>"}})` |
| 2. Send the file | `send_to_storage.py` to the returned `url` — Step 4b |
| 3. Save the document | `call_tool({"name": "fa__create__document", "arguments": {"key": "<s3_key>", "title": "<title>"}})` |
| 4. Put it on the firm's page | `call_tool({"name": "fa__create__firm-document", "arguments": {"firm_uuid": "<firm_uuid>", "document_ids": ["<document_id>"]}})` |

Steps 1–4 run in that order for each file, one file at a time, and only after
Gate 3. A document saved in step 3 but never attached in step 4 exists in Carta
but appears nowhere, so step 4 is never skipped.

---

## Gate 0 — session and access

1. Call `welcome`, then `get_current_user`. Keep `base_url` for links and
   `is_staff` for Gate 2.

   Do **not** stop on `fund_admin_access` or any other profile flag. Those come
   from best-effort account enrichment, not from the permission check. Whether
   this user may upload to this firm is decided by `fa__create__firm-document`
   in step 4, and only its answer is reported as "no access".

2. This skill sends files from Bash. If you have no Bash tool in this
   session (for example, claude.ai chat), say so and stop:

   > I can't reach files on your computer from here. Upload it from your firm's
   > Documents page in Carta, or run this from Claude Code or Cowork.

## Gate 1 — the files

Take every file the user gave or attached in this request: one run uploads them
all.

1. No path given → ask for one. In Cowork, a file the user attached to the
   conversation has a local path; use it. Inside Bash that path is under
   `/sessions/<session_id>/mnt/uploads/`, not the host's `uploads/` folder, so
   use the `/sessions/…` path for `ls` here and the send in 4b.
2. Check them all in one call:

   ```bash
   ls -l "<file_path_1>" "<file_path_2>"
   ```

   Missing, unreadable or a directory → say which, and ask for the right path
   for those files only. Keep the files that passed.
3. A passport, driver's license, national ID or similar identity document →
   drop it from the run and say why in one line: those go through KYC, not the
   Documents page. Carry on with the other files; stop only when none are left.
   Judge from the file name and what the user said; do not open the file to
   check.

Do not read the files' contents. The user chose them; this skill only moves them.

## Gate 2 — the firm

Resolve the firm once for the whole run. A wrong firm puts the documents in
front of another firm's users.

Read `${CLAUDE_PLUGIN_ROOT}/references/gate-resolve-firm.md` (the plugin's own
`references/`, not this skill's — do not search for it) and follow it, with:

- `<firm_question>`: "Which firm should these documents go to?"
- `<access_step>`: `fa__create__firm-document` (step 4)
- `<no_uuid_stop>`: suggest uploading from the firm's Documents page in Carta

It yields `<firm_uuid>` for step 4, plus `<firm_name>` and, when known,
`<carta_id>` for Gate 3. A firm the user gave only as a UUID is shown in Gate 3
by that UUID.

"Upload this document" mid-session means the firm this conversation is about.
Never take the firm from the file names or the files' contents without asking;
a file name can only suggest one. When asking, the firm to suggest is the row
whose name matches every file's name by the name rule (for example
`Great_Basin_Capital_Partners_NDA.pdf` → "Great Basin Capital Partners"); the
user still picks it.

## Gate 3 — confirm [hard gate]

One confirmation covers every file. Show the firm once, linked to
`{base_url}/investors/firm/<carta_id>/portfolio/documents` when `carta_id` is
present; otherwise show the name unlinked. Never show UUIDs, except when the
firm has no known name and the user gave the UUID themselves.

**Firm:** <firm_name>

| # | File | Size |
|---|---|---|
| 1 | `<file_name_1>` | <size_1> |
| 2 | `<file_name_2>` | <size_2> |

List every file, however many there are: this is what the user approves.

Then say who will see them, verbatim except for the firm name:

> Once uploaded, anyone at **<firm_name>** with firm administrator or full view
> access in Carta can see these documents, as can your Carta team.

Then call the `AskUserQuestion` **tool**, with the firm in the question —
"Upload <N> documents to <firm_name>?", or "Upload `<file_name>` to
<firm_name>?" for one file — so the firm is confirmed on its own, not only as a
heading. A markdown list of options is not a gate — it does not block the
upload. Use these three option labels verbatim, in this order:

- **Upload all** ← recommended (**Upload** when there is one file)
- **Change the firm** → back to Gate 2, then show this summary again
- **Cancel** → stop. Say in one line that nothing was uploaded, and ask
  nothing more.

Nothing in Gate 4 runs until the user picks **Upload all** (or **Upload**).
That one answer covers every file in the table: do not ask again between files.

## Gate 4 — upload, file by file

Run 4a–4d for the first file in the Gate 3 table, then the next, in table
order. Each file gets its own upload URL: never reuse a `url`, `fields` or `key`
from another file. Keep each file's result (`Uploaded`, `Failed at <step>`, or
`Not sent`) for Gate 5.

Ask the user nothing between files: the Gate 3 answer covers the whole run,
and every failure is reported once, in Gate 5. A file that fails after its
retries is skipped: record where it stopped and go straight on to the next
file. Four failures stop the whole run instead, because each one
would fail every remaining file too: a refused `url` in 4b, a connection error
in 4b, a Carta command that is missing or not enabled, and a `403` from 4d. The
files not reached yet are `Not sent`.

### 4a — upload URL

```
call_tool({"name": "fa__create__document-upload-url", "arguments": {"filename": "<file_name>"}})
```

Returns `{url, fields, key}`. `fields` is an object of form fields the upload
must carry unchanged; `key` is the `<s3_key>` for 4c. Call 4a for a file only
when you are about to send it, and once: never fetch URLs ahead for later files,
and never fetch a second one except after a `403` in 4b.

### 4b — send the file

A file goes only to the URL 4a returned for it, never to one taken from
anywhere else. Run this on one line, exactly as written: `allowed-tools`
matches the command text, so any other form makes the user approve every file.
`<fields_json>` is 4a's `fields` object as JSON, unchanged:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-upload-firm-document/scripts/send_to_storage.py" '<url>' '<fields_json>' '<file_path>'
```

Single-quote every value; a value containing `'` is written `'\''`. The
script checks that `url` is Carta's document storage and that the file exists,
sends the fields and then the file, and prints one JSON line:

- `{"status": 204}` or any other `2xx` → sent. Go to 4c.
- `{"status": 403}` → the URL most likely expired. Get **one** fresh URL with
  4a and send once more. That is the only retry: at most two sends per file.
- Any other status, or a second failure → this file is `Failed at sending` with
  the status code; go on to the next file. Only a `403` gets a fresh URL. Do
  not change the command and try again, and do not fall back to another upload
  route.
- `{"error": "refused", "reason": …}` → nothing was sent. A `reason` starting
  with `url` stops the run and is reported; any other refusal (the file or
  `fields`) makes this file `Failed at sending`; go on to the next file.
- `{"error": "connection"}` → in Cowork this usually means the sandbox can't
  reach the storage service. Stop the run and tell the user to upload from the
  Documents page in Carta.

### 4c — save the document

```
call_tool({"name": "fa__create__document", "arguments": {"key": "<s3_key>", "title": "<file_name>"}})
```

Keep `id` from the result: it is `<document_id>` for 4d.

A `5xx`, a timeout, or a result with no `id` → call 4c **once more** with the
same `<s3_key>`. The file is already in storage, so this re-sends nothing. If the
second call also returns no `id`, this file is `Failed at saving`; go on to the
next file. Never repeat 4a or 4b for it.

### 4d — put it on the firm's page

```
call_tool({"name": "fa__create__firm-document", "arguments": {"firm_uuid": "<firm_uuid>", "document_ids": ["<document_id>"]}})
```

If this fails, retry **4d only, once**, with the same `<document_id>`. Never
repeat 4a–4c: the document is already saved, and a second upload makes a
duplicate. If the retry also fails, this file is `Failed at adding to the
page`; keep its `<document_id>` and go on to the next file. A `403` stops the
run instead (see the error table below).

## Gate 5 — report

Report once, after the last file. Link the firm name as in Gate 3; unlinked when
there is no `carta_id`.

> Uploaded **<uploaded_count> of <N>** documents to
> [<firm_name>](<documents_page_url>).

| # | File | Result |
|---|---|---|
| 1 | `<file_name_1>` | Uploaded |
| 2 | `<file_name_2>` | Failed at saving |

When anything was uploaded, add:

> Carta has started classifying them and extracting their details. The
> documents are on the Documents page now, and their type and details appear
> there once extraction finishes.

With one file, a sentence replaces the table: "Uploaded **<file_name>** to
[<firm_name>](<documents_page_url>)."

Then offer, when the run reached every file and some failed:

```
1 - Retry the files that didn't upload  ← recommended
2 - Open the firm's Documents page
3 - Done
```

A retry covers only those files and needs no new confirmation: the user already
approved them. A file `Failed at adding to the page` retries 4d only, with its
kept `<document_id>`; every other file starts again at 4a.

When one of the four run-stopping failures in Gate 4 ended the run, report it
as the error table below says and never offer a retry: it would repeat the same
failure, and after a `403` it would save documents that appear on no page.
Offer only:

```
1 - Open the firm's Documents page  ← recommended
2 - Done
```

When every file uploaded:

```
1 - Open the firm's Documents page  ← recommended
2 - Done
```

Leave out the Documents page option when there is no link.

---

## If something goes wrong

| Situation | Response |
|---|---|
| No Bash tool | Gate 0 message; stop |
| You wrote the confirm options as markdown | Stop and call `AskUserQuestion`. Text does not block the upload |
| Identity document | Drop it from the run; it belongs in KYC. Upload the rest |
| Some paths missing | Ask for those paths only; keep the files that passed |
| Staff in local/test/demo name a firm | Match it against the firm list `list_contexts` returns (Gate 2) before asking for a UUID |
| Named firm not in the firm list | Not a refusal — ask for the firm's UUID (Gate 2). Never upload to a different firm |
| No firm named and the user has several | Ask (Gate 2). The active firm is the recommended option, never a silent default |
| No firm named and the list has more than 4 firms | Ask which firm in plain text, then match the answer (Gate 2) |
| Staff firm search finds nothing | Say so and ask again; do not guess another firm |
| A Carta command is missing or says it isn't available | "Uploading documents isn't enabled for your account yet." Stop the run. No retry, no other route |
| `fa__create__firm-document` returns 403 / permission denied | "You need firm administrator or full view access at <firm_name> to add documents. Ask your firm's Carta administrator." Stop the run: the other files would fail the same way. This file is saved in Carta but not on the page; say so. Do not retry |
| The script refuses `url` | Stop the run; nothing was sent |
| The script refuses the file or `fields` | Mark it `Failed at sending`; go on |
| A send fails twice for a file | Mark it `Failed at sending` with the status code; go on to the next file. Do not vary the command |
| `fa__create__document` returns 5xx or no `id` | Retry once with the same key; if that fails too, mark the file `Failed at saving` and go on |
| 4d fails twice for a file | Mark it `Failed at adding to the page`; go on. In Gate 5 say: "The file was uploaded but couldn't be added to <firm_name>'s Documents page." A retry runs 4d only |
| Some files failed, others uploaded | Gate 5 shows each file's result and offers to retry only the ones that didn't upload |
| User asks to delete or replace a document | Not supported here; they can do it from the Documents page in Carta |

Every call in Gate 4 writes to Carta. Never loop on one, and never reach for a
different tool to get around a failure — record what failed, and stop the run
where the table says to.
