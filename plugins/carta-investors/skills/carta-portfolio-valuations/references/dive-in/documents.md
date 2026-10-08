# Portfolio Valuation — Supporting Documents

List, download, and (for now) point the user at uploading the
**supporting documents** on a candidate — e.g. the Excel workbook used
to derive the company value. This is a distinct feature from Commentary
(a text field on the valuation) and from tearsheet/SOI export
(firm-level reports, not candidate attachments).

> **There is no upload command yet.** List and download are reads and
> never need confirmation. Upload is not implemented — see Step 1.

## Prerequisites

You need a selected candidate, already in context from the orchestrator:
`ownerId`, `project_id`, `candidate_id`, and `targetId` (for the Step 1
link). If missing, ask the user to pick a valuation row from Step 3
(the dashboard / versions list) first.

## Step 1: User asks to upload a document

There is no command for this. Do not attempt to read the file yourself,
base64-encode it, or otherwise improvise a workaround — just give the
user a real, clickable link to the valuation and tell them where to
click:

1. Build the link per [`references/deep-link.md`](../deep-link.md),
   Pattern B, with `tab` = `value-company` (documents are managed from
   Commentary in the header on that landing view — there is no
   dedicated documents tab).
2. Tell the user to click **Add** or **Edit** under Commentary in the
   header to upload the file there.

Example: *"You can upload that from the valuation page — click Add or
Edit under Commentary in the header: {link}"*

## Step 2: List documents

```
read_tool({"name": "portfolio_valuations__get__documents", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})
```

Returns metadata only per document: `id`, `filename`, `contentType`,
`size`, `uploadedBy`, `createdAt`. **There is no download link in this
response by design** — the `id` here is what Step 3 needs.

Present as a simple list (filename + size), not a table with raw IDs.

## Step 3: Download a document (two calls, not one)

Downloading is **two calls**: list first (Step 2) to find the
`document_id`, then this command to get a fetchable link for that one
document:

```
read_tool({"name": "portfolio_valuations__get__document_download_url", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>, "document_id": <document_id>}})
```

Returns `{url, filename, contentType}`. `url` is a signed link that needs
**no Carta login** to fetch, and **expires in 5 minutes** — fetch it
yourself in the same turn if you need the file's content; never save it,
cache it across turns, or hand it to the user as a link to click, since it
will most likely have expired by the time they act on it. If the user
needs to click something themselves, build the deep link per Step 1
instead of pasting this URL into chat.

If the user asks to "download a document" without naming one, list first
(Step 2) and ask which one — don't guess an id.

## User-Facing Output Rules

Do not surface raw command names, API field names, HTTP status codes, or
numeric project/candidate/document IDs in chat. Speak in business terms
("the DCF workbook attached to Acme's Q2 valuation").

## Goal-checklist note

Documents are **not** a checklist item on the End Goal — like Commentary,
they're an adjacent capability available at any time once a candidate
exists.

Entry point: the orchestrator's Step 2.5b routing table sends
"upload/attach a document", "list documents", and "download a document"
requests here.
