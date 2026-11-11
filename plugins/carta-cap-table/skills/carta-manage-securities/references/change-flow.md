# Edit fields and the Change page

Read this for the **Edit fields** action ([SKILL.md § Actions](../SKILL.md#actions)). Approval,
apply and the closing are in [SKILL.md § Flow](../SKILL.md#flow).

## The Change page

Carta keeps an edit as a **thread** of previews: each preview is the next **revision**. For a type
the page serves, the bootstrap carries `companion` with `available: true`, and each preview result
leads with `companion_url` and `how_to_reply`, sometimes after `next_step`. The page shows the
latest revision, read-only. Every change happens in chat; the page follows.

- Show each preview as in [SKILL.md § Flow](../SKILL.md#flow) step 5. Never build the page's
  address.
- When the user asks to see the page, open it as `next_step` would.
- Once the page is open, it follows each new revision by itself: **do not navigate again on the
  same thread**.
- If the tab lands on a `login.` address, ask the user to sign in to Carta in that panel once.

## Open the page first

Every edit's first bootstrap sends `look_first: true`, whatever the user said, so the page is up
before the first preview. The result leads with `next_step`, `companion_url` and `how_to_reply`,
and carries `thread_id`. Follow `next_step`, post the link as
[SKILL.md § Flow](../SKILL.md#flow) step 5 says, then:

- **The user named the field and the value:** go on to the preview with that `thread_id`. The
  open page turns into the diff.
- **They did not** ("show me first", "something is wrong", only a person or securities): say in
  one line what the page shows, then ask which field to change as **No field named** in
  [§ Fields and values](#fields-and-values) says, never in free text.

Send that `thread_id` with the first preview.

## Fields and values

Offer only the fields in `sections.form` with `eligible: true`. Send each one under its `name`.
[field-contract.md](field-contract.md) says how to read each field.

- **`current`:** the value now. It is `value`, or `by_security` when the securities differ.
- **Values:** use what the user said, and never guess one.
- **A field that is not in `sections.form`**, such as a SAR's base price: make no preview. Say that
  Carta's edit form does not offer this field, so this skill cannot change it.

**No field named:**
- When you have a `show_widget` tool and you are not in Claude Code, show the eligible fields as
  chips. Replace each `<field label>` and add one `<button disabled title="<why_not.message>">`
  for each field that isn't eligible. Keep it this small: `show_widget` hangs on large HTML.

  ```html
  <div style="display:flex;flex-wrap:wrap;gap:8px;font:14px system-ui">
    <button onclick="sendPrompt('<field label>')">&lt;field label&gt;</button>
  </div>
  ```

  Then say they can also type the field.
- In Claude Code, where `sendPrompt` does nothing, or with no `show_widget`, ask one
  `AskUserQuestion` with up to 4 eligible fields.
- **Several types** ("Update ES-123 (Shares) and PIU-456"): bootstrap each type first. Then ask
  one `AskUserQuestion`, also when you have `show_widget`, with one question for each type, up to
  4 per call. Each question names that type's securities and offers up to 4 fields that its own
  bootstrap marks eligible. Do not offer only the fields that the types share: each row of
  `changes` takes its own fields. Use each answer only for the rows of that type.
- **One eligible field:** a question needs 2 options, so ask no field question for that type.
  Name its one field and ask for the value.
- Never ask in free text, and never guess a field.

## Several securities

When the securities take different values (a spreadsheet, or "ES-1 to 3/1, ES-2 to 4/1"), or are
of several types, make **one** preview with `changes` instead of `security_type`, `securities` and
`fields`.

1. **Rows.** Read the request or the spreadsheet into rows: one row per security, with its
   type, its label and its own fields and values. Take each type as
   [SKILL.md § Actions](../SKILL.md#actions) says. When rows have no type, ask one question per
   label prefix (a row with no prefix is its own question), up to 4 per `AskUserQuestion`, asking
   the next 4 only after the answers come back, and apply each answer to every row with that
   prefix. Never guess.
2. **Bootstrap each type** with that type's labels. Send `look_first: true` on the first one
   only, and send its `thread_id` with the preview. Offer each type only the fields that its own
   bootstrap marks `eligible`. When the user named no field, ask as **Several types** in
   [§ Fields and values](#fields-and-values) says.
3. **Preview.** Send `changes`: one item per row, `{security_type, security: <id>, fields}`, with
   one `reason`, `note` and `send_email` for all rows.
4. **More rows than `limits.max_securities`**, or a bootstrap `too_large` whose `message` names
   the limit: split them into parts in row order and run each part as its own change, saying
   *"Part 1 of 3"* before each. Each part has its own bootstrap, page, preview and approval.

**Single-security fields.** Carta changes a
[single-security field](field-contract.md#rules-users-trip-on) on one security per plan. A
bootstrap of 2 or more securities marks it `single_security_only`, and a bootstrap of one security
does not. When the user sends one of these fields to 2 or more securities, with one value or with a
value for each, do this before step 2:

- Make each security that gets the field its own change, with a bootstrap of that one security.
- Put the other rows in one change, as steps 2 to 4 say.
- Say the split first, as [SKILL.md § Several changes](../SKILL.md#several-changes) says: *"Carta
  changes Quantity on one security at a time, so these are 3 changes: option grant ES-1, option
  grant ES-2, and then option grants ES-3 and ES-4 together. I'll apply them one at a time,
  starting with ES-1."*

When a preview is blocked by this check, quote it and split the same way.

**Emails.** Each type and value set of the plan sends its own modification email, so a holder
with securities in two rows of different values can get 2 emails. When the email side effect
counts more emails than holders (`1 holder gets 2 modification emails`), say the count and ask one
`AskUserQuestion` before the approval: **"Send these N emails?"**, options **"Send"** and **"No
emails"**. On "No emails", preview again with `send_email: false`. Then ask for approval
([SKILL.md § Flow](../SKILL.md#flow) step 7) on the latest preview.

## Reason, note and Rule 144

**Reason.** Take it from the user's words:

| The user says | `reason` |
|---|---|
| "fix", "typo", "wrong", "mistake" | `Clerical error` |
| "agreed", "renegotiated", "amend" | `Amendment` |

When you chose the reason, say why in one clause and send that clause as `reason_why` (140
characters at most, e.g. `you said "fix"`). Leave `reason_why` out when the user picked the
reason. When the words don't say, ask one `AskUserQuestion` with "Clerical error" and "Amendment".

**Rule 144.** A certificate whose new `rule_144_date` is not the effective `issue_date` also
needs `rule_144_difference_reason`: offer that form field's `options`. Put that question in the
**same** `AskUserQuestion` call as the reason: 2 questions, 1 turn.

**Note.** When the user gave none, write one sentence from their words and show it.

**Email.** `send_email` is true by default: Carta emails each holder whose security changes. Say
so in the side effects. Send `send_email: false` only when the user asks for no email.

Different reasons are separate changes, per [SKILL.md § Several changes](../SKILL.md#several-changes).

## Documents

Edits change no documents. To attach, replace or remove a document, send the user to Carta.
