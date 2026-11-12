# Transfer, buy back and exercise

Read this for the transfer, buyback, exercise and exercise request actions
([SKILL.md § Actions](../SKILL.md#actions)). Preview, approval, apply and the closing are in
[SKILL.md § Flow](../SKILL.md#flow).

Rules for all of these actions:

- One security, or one exercise request, per change. Bootstrap one security at a time: with 2 or
  more, the bootstrap marks these actions unavailable. Split as
  [SKILL.md § Several changes](../SKILL.md#several-changes) says.
- Send `security_type` only as [SKILL.md § Flow](../SKILL.md#flow) step 3 says. Send only the
  inputs below: there is no `notes`, `price_per_share` or `reason`.
- Every date is today or earlier.
- Map the user's words to the values below. When the words fit none of them, or a required
  input is missing, ask with `AskUserQuestion`. Never pick a value yourself.
- These previews open no Change page. Show the `summary` and `side_effects` as
  [SKILL.md § Flow](../SKILL.md#flow) step 5 says.
- A Carta page comes from `cap_table__get__transfer_link`, `cap_table__get__exercise_link` or
  `cap_table__get__repurchase_link`, called with `corporation_id` (the same number as
  `company`). Post its `web_url` as `[Open it in Carta](<web_url>)` with its `in_carta` step as
  returned. Its `message` is for you: never quote it.

## Transfer shares, an RSA or a PIU

Bootstrap with `security_type` `certificate`, `rsa` or `piu`. The action is
`certificate:transfer`. Send `security`, `operation_type`, `transfer_date` and `recipients`, at
most 20:

- `operation_type`: a gift is `GIFT`, a sale to another holder is `SECONDARY`, a death is `DEATH`,
  a divorce is `DIVORCE`, a donation is `DONATION`, a move to the holder's own trust or company is
  `TRANSFER_TO_AFFILIATED`, a tender offer is `TENDER_OFFER`. Any other reason is `OTHER`, with
  `transaction_notes`.
- Every recipient needs all of `stakeholder` (the name, email or id of a stakeholder on this
  company), `quantity`, `cash_paid` (`"0"` for a gift), `is_sale` and
  `did_beneficial_owner_change`. `is_sale` is `true` for `SECONDARY` and `TENDER_OFFER`, and
  `false` for `GIFT`, `DEATH`, `DIVORCE` and `DONATION`. For other reasons, and for
  `did_beneficial_owner_change`, ask when the user did not say.
- For a whole certificate, `quantity` is its current quantity in the bootstrap.
- For a certificate, RSA or PIU from an equity plan, each recipient also takes `from_plan`. When
  you do not know if it is from a plan, ask.
- A US company also needs, for each recipient, `legends`, `original_acquisition_date` and
  `transfer_agreement_file_key`. Preview first with what the user gave. When a failed check names
  one of these fields, get it, then preview again on the same `thread_id`:
  - `legends`: read `cap_table__list__legends`, show the legend names and ask which ones.
  - `original_acquisition_date`: offer the certificate's issue date as the first option.
  - `transfer_agreement_file_key`: [§ Agreements](#agreements).
- Carta issues the shares that stay with the holder on a new certificate.

To move the capital of LLC units, give the `transfer_link` page (see the rules above).

## Transfer a warrant or a convertible note

Bootstrap with `security_type` `warrant` or `convertible_note`. Send `security`, `security_type`,
`transfer_date` and `recipients`. A warrant goes whole to one recipient. A note goes to one
recipient, or is split between up to 20 whose `principal` values add up to the note's. Each
recipient needs `stakeholder` (who must have an email), `relationship` (for example `Investor`,
`Employee` or `Advisor`) and `transfer_agreement_file_key` ([§ Agreements](#agreements)). A note
can also take `form_of_note_file_key`.

## Buy back shares, an RSA or a PIU

Bootstrap with `security_type` `certificate`, `rsa` or `piu`. The action is
`certificate:repurchase`. Send `security`, `quantity`, `cost`, `repurchase_date`,
`operation_type` and `is_sale`:

- `cost` is the total price, `"0"` when the company pays nothing. From a price per share, send
  quantity × price and show the math.
- `operation_type`: a buyback because the holder left the company is `RELATIONSHIP_CHANGE`.
  Unvested shares from an early exercise, bought back when the holder leaves, are
  `EARLY_EXERCISE_TERMINATION`. A tender offer is `TENDER_OFFER`. Any other buyback is `BUYBACK`.
  A forfeiture is not a buyback: ask the user which one they mean.
- A certificate, RSA or PIU from an equity plan also takes `return_shares`: ask whether the
  shares go back to the plan pool. When you do not know if it is from a plan, ask.
- `reduce_from`: `unvested` buys back the unvested shares first (a holder who left), `vested`
  the vested shares first. Ask when the user did not say.
- `repurchase_agreement_file_key` is optional ([§ Agreements](#agreements)).

No money moves: the payment is made outside Carta. For a bank payment through Carta, give the
`repurchase_link` page (see the rules above).

## Record an option exercise

For an exercise that the holder paid in cash outside Carta. Bootstrap with `security_type`
`option_grant`. The action is `option_grant:record_exercise`, for company admins only. Send
`security`, `exercise_date`, `quantity` and `exercise_agreement_file_key`
([§ Agreements](#agreements)). For a grant with an ISO/NSO split, send `iso_quantity` and
`nso_quantity` instead of `quantity`; the preview says which one the grant needs.

A net or cashless exercise goes to the `exercise_link` page (see the rules above). This action is
for the company: a holder who exercises their own options does it in Carta.

## Exercise requests

Requests that holders make in Carta. There is no bootstrap: call
`cap_table__list__company_exercise_requests` with `company`, and `status: ["requested"]` for the
requests that wait for approval. Show the holder, the grant label, the quantity, the exercise
cost, how the holder pays and the request date. Never show the request id.

- Only the company's exercise approver approves or rejects. When `summary.is_approver` is false,
  say so and stop: *"Only your company's exercise approver can approve or reject these requests.
  Ask them to do it in Carta."*
- Offer **approve** only for a row with `can_approve: true`, and **reject** only for a row with
  `can_reject: true`. For other rows, say to do it in the Carta web app.
- **Approve:** `exercise_request` (the row's `id`) and `signature_line`. Ask the user in plain
  text, not with `AskUserQuestion`, to type their signature as it is in their Carta profile.
  Never write it yourself. Use the same signature for each request of this run. When the plan is
  applied, the payment starts at once and cannot be undone: say so before the approval.
- **Reject:** `exercise_request`, `rejection_reason` and `details`. Too few shares in the plan is
  `lack_of_shares_available`, the holder canceled is `cancellation_by_participant`, the company
  canceled is `cancellation_by_company`, too late after termination is
  `past_post_termination_window`, any other reason is `other`. Write `details` as one sentence
  from the user's words. The holder gets `details` by email: show the full text before the
  approval, and let the user change it.

## Agreements

An agreement file key comes only from an upload. Never write a key yourself, and never send a
file name or a path as a key. This upload is only for the actions in this file: a document change
on an issued security goes to Carta, as
[change-flow.md § Documents](change-flow.md#documents) says.

A key is needed for a warrant or note transfer, for a recorded exercise, and for a share, RSA or
PIU transfer when a failed check asks for it. When a key is needed, preview only after the
upload gives it. A buyback goes on with no agreement.

1. Ask for the signed agreement as a file. When a key is needed and this chat has no shell, or
   the user has no file, apply nothing. For shares, an RSA or a PIU, give the `transfer_link`
   page; for an exercise, the `exercise_link` page (see the rules above). For a warrant or a note,
   say to transfer it in the Carta web app. Then stop.
2. Call `read_tool` with `cap_table__mutate__upload_url`, `corporation_id` (the same number as
   `company`) and the file's `filename`. It returns `url`, `fields` and `key`.
3. Send the file in one shell command. Put every item of `fields` first with `--form-string`,
   then `Content-Type` with the file's real type (for example `application/pdf`), then the file:
   `curl -sS -o /dev/null -w '%{http_code}' --form-string '<field>=<value>' --form-string 'Content-Type=<file type>' -F 'file=@<path>' '<url>'`.
   Carta's storage answers `204`. With any other answer, or no network, say the upload failed and
   give the Carta page as step 1 says.
4. Send `key` as the file key in the preview. The URL lasts 3 hours.
