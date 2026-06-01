---
name: send-smart-document-signature
description: >
  Send a smart document for signature. Takes a document ID, confirms the document
  with the document engine (transitioning it from PREVIEW to SIGNING), which
  triggers signature request emails to all signatories. Use when the user wants to
  send a smart document for signing, confirm a smart document, or request signatures
  on a generated document.
allowed-tools:
  - Bash(carta fa send smart-document *)
  - Bash(carta fa get smart-document *)
  - Bash(carta scope *)
  - Bash(carta auth-status *)
  - AskUserQuestion
args:
  - name: document_id
    description: >
      The smart document ID (integer) to send for signature.
      If omitted, the skill asks the user for it.
    required: false
model: sonnet
---

# Send Smart Document for Signature

Send a generated smart document for signature via the Carta CLI.

## Prerequisites

The document must be in `PREVIEW` status. Documents in other states
(e.g. `SIGNING`, `SIGNED`, `FAILED`) cannot be sent.

## Workflow

### Step 1: Prerequisites

1. Run `carta auth-status` to verify the user is logged in.
   - If not logged in, tell the user to run `carta login` and retry.
2. Ensure a write scope is active: `carta scope set write`.

### Step 2: Get Document ID

If `document_id` arg is provided, use it.

Otherwise, ask the user: "What is the document ID?"

### Step 3: Verify Document Status

Fetch the document:
```bash
carta fa get smart-document <document_id>
```

Check the `status` field:
- If `PREVIEW` → proceed to Step 4.
- If `SIGNING` → tell the user "This document is already being signed."
  Show the document service URL and exit.
- If `SIGNED` → tell the user "This document has already been signed." Exit.
- If `GENERATED` → tell the user "This document has been generated but may
  need review before signing." Show the document service URL and ask if
  they want to proceed.
- If `FAILED` → tell the user "This document failed to generate. It cannot
  be sent for signature. Consider regenerating it." Exit.
- If `DELETED` → tell the user "This document has been deleted." Exit.

### Step 4: Confirm with User

Show a summary of the document:

```
**Document to send for signature**

  **Name:** Seed Britannia - Investment Management Agreement
  **Document ID:** 118
  **Status:** PREVIEW
  **Preview URL:** https://documents.carta.com/documents/<document_id>/preview

Sending this document will email signature requests to all signatories
defined in the document.
```

Ask: "Send this document for signature? [Y/n]"

If no, exit.

### Step 5: Send for Signature

```bash
carta fa send smart-document <document_id>
```

Parse the response. The document status should transition to `SIGNING`.

### Step 6: Result

Show the result:

```
Document sent for signature

  **Status:** SIGNING
  Signature requests have been emailed to the signatories.

  Track progress: carta fa get smart-document <document_id>
```

## Error Handling

- **Document not found**: "No document found with ID <id>. Check the ID
  and try again."
- **Auth failure**: Tell the user to run `carta login`.
- **Scope error**: Run `carta scope set write` and retry.
- **CLI error on send**: Show the error message. Common cause: document is
  not in PREVIEW status.
