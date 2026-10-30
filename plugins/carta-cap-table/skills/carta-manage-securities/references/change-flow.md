# Edit fields and the Change page

Read this for the **Edit fields** action ([SKILL.md § Actions](../SKILL.md#actions)). Approval,
apply and the closing are in [SKILL.md § Flow](../SKILL.md#flow).

## The Change page

Carta keeps an edit as a **thread** of previews: each preview is the next **revision**. When the
Change page is on for the user, the bootstrap carries `companion` with `available: true`, and each
preview result leads with `companion_url` and `how_to_reply`, sometimes after `next_step`. The
page shows the latest revision, read-only. Every change happens in chat; the page follows.

- Show each preview as in [SKILL.md § Flow](../SKILL.md#flow) step 5. Never build the page's
  address.
- When the user asks to see the page, open it as `next_step` would.
- Once the page is open, it follows each new revision by itself: **do not navigate again on the
  same thread**.
- If the tab lands on a `login.` address, ask the user to sign in to Carta in that panel once.

## Open the page first

Every edit's first bootstrap sends `look_first: true`, whatever the user said, so the page is up
before the first preview. With the Change page on, the result leads with `next_step`,
`companion_url` and `how_to_reply`, and carries `thread_id`. Follow `next_step`, post the link,
then:

- **The user named the field and the value:** go on to the preview with that `thread_id`. The
  open page turns into the diff.
- **They did not** ("show me first", "something is wrong", only a person or securities): say in
  one line what the page shows, then ask what to change.

Send that `thread_id` with the first preview.

## Fields and values

Offer only the fields in `sections.form` with `eligible: true`. Send each one under its `name`.
[field-contract.md](field-contract.md) says how to read each field.

- **`current`:** the value now. It is `value`, or `by_security` when the securities differ.
- **Values:** use what the user said, and never guess one.

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
- Never ask in free text, and never guess a field.

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
