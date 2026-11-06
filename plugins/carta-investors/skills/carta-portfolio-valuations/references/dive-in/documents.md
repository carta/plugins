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
`ownerId`, `project_id`, `candidate_id`, and `targetId` (for opening its
page in the dashboard MCP App in Step 1). If missing, ask the user to pick
a valuation row from Step 3
(the dashboard / versions list) first.

## Step 1: User asks to upload a document

There is no command for this. Do not attempt to read the file yourself,
base64-encode it, or otherwise improvise a workaround — just show the
user where to click:

1. Tell the user to click **Add** or **Edit** under Commentary in the
   header of the valuation's page in Carta's valuations dashboard.
2. Offer to take them there, and open it only on a yes
   (SKILL.md **Page navigation → After an action, offer instead of moving**).

Example: *"You can upload that from the valuation's page in Carta's
valuations dashboard — click Add or Edit under Commentary in the header."*

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
**no Carta login** and **expires in 5 minutes** — fetch it yourself in the
same turn if you need the file's content. Never save it, cache it across
turns, or hand it to the user; if they need to click something, point
them at the valuation's page in Carta's valuations dashboard (Step 1) instead.

If the user asks to "download a document" without naming one, list first
(Step 2) and ask which one — don't guess an id.
