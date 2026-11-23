# Closing contacts: fields, states and paging

Applies to every answer about closings, with or without the Closings view.

## Fields

| Field | Meaning |
|---|---|
| `public_id` | The contact's id; what the invite command takes |
| `partner_name` | Investor name |
| `status` | The state as a label, e.g. "Prospect", "Pending investor signature", "Countersigned". States: `prospect`, `invited`, `data_room`, `in_progress`, `signatures_required`, `submitted`, `counter_signed`, `kyc_required`, `archived`, `deleted` |
| `contact_email` | The investor's contact email |
| `commitment_amount` | The commitment Carta shows the GP: GP-set (authoritative) for a fixed commitment. For a variable commitment (`variable_commitment_enabled` true) it is the GP's expected amount when the fund has open commitments on, otherwise the figure the LP typed |
| `contact_chosen_commitment_amount` | LP-entered amount (only with `detailed: true`). `null` or `"0.00"` means the LP has not entered one: variable-commitment funds report `"0.00"` for every invited investor |
| `prospect_contacts` | Collaborators: `name`, `email`, `is_signatory`, `is_filler`, `is_primary`, `is_secondary` |
| `origin` | `carta_closings` for a closing contact; `carta_partners` for an existing partner from an earlier close, who is always countersigned and has no LP-entered amount |
| `has_completed_documents_offline` | True for contacts who signed outside Carta |
| `invited_to_data_room` | Whether the contact was invited to the data room. Show it as "Access granted" or "Not invited", the wording of the Closings contact status dialog. |
| `_links.web_url` | Link to this investor in the Closings overview. Absent when the server attaches none |

**Existing partners are not closing contacts.** Count, summarise and total only rows whose `origin` is `carta_closings` (a row with no `origin` counts as one). Never fold `carta_partners` rows into the closing counts or the commitment total.

**A variance is flagged only when the LP-entered amount is non-zero and differs from the GP commitment.** Never flag a `null` or `"0.00"` amount: it means "not entered".

## State groups

Counts and summaries use these groups, in this order. A state in none of them is "other".

Turn `status` into its state key first, ignoring case. fund-admin's labels are not always the state's name:

| `status` label | State |
|---|---|
| Prospect | `prospect` |
| Invited | `invited` |
| In progress | `in_progress` |
| Pending investor signature | `signatures_required` |
| Submitted | `submitted` |
| Countersigned | `counter_signed` |
| KYC Required | `kyc_required` |
| Archived | `archived` |
| Deleted | `deleted` |

A label in none of these rows: lower-case it and join its words with `_`. If that names a state in the list above, use it; otherwise the contact is "other".

| Group | Label | States | In summaries |
|---|---|---|---|
| `ready` | Ready to countersign | `submitted` | ready to countersign |
| `signing` | Signing in progress | `invited`, `data_room`, `in_progress`, `signatures_required` | signing in progress |
| `kyc` | Awaiting KYC | `kyc_required` | awaiting KYC |
| `prospect` | Prospects | `prospect` | prospects (prospect when there is one) |
| `countersigned` | Countersigned | `counter_signed` | countersigned |
| `archived` | Archived | `archived`, `deleted` | archived |

Reminders reach the `signing` group and no other: the other groups are not waiting on the investor.

## Paging

Use `size: 10`. While the response has `has_next`, call again with `after` set to its `next` value and the same filters and `size`. Never pass `all: true`: rows carry collaborators and documents, and a reply past carta-mcp's inline limit comes back as a document link (`document_returned: true`) instead of the rows. If a reply is a document link anyway, start again from the first page with half the `size`. Every page lands in the conversation, so stop after 200 contacts, counted across restarts, and say the answer covers the first part of a larger list; suggest a `state` or `search` filter for the rest.
