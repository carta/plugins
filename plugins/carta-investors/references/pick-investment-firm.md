# Pick the investment firm

For a skill whose Carta commands take the firm's `organization_pk`.

**Pick the firm first, every invocation, before any call.** The choice is dropped when a
conversation is compacted or resumed, so never assume the firm carried over. Requests and
reminders email companies on the firm's behalf, so never use a firm only because it was used
last: either the user names it, it is their only firm, or they confirm it. Always call
`list_accounts` with `detail` set to "full" (the summary detail can return blank names) and keep
only the accounts whose type is `investment_firm`. A firm's id there reads
`organization_pk:<n>`; the number is the `organization_pk` every call takes. Look the firm up in
the first of these that applies:

1. **The user named a firm in this request.** Call `list_accounts` with `search` set to that
   name. If exactly one `investment_firm` account matches, use it. Otherwise go to 3.
2. **No firm named.** Call `list_contexts`. If it shows an active investment firm, ask with
   `AskUserQuestion`: "Work with **{firm}**?", options "Yes, continue" and "Pick a different
   firm". On yes, call `list_accounts` with `search` set to that firm's name and use the one
   `investment_firm` account whose name matches. On "Pick a different firm", if no firm is
   active, or if the name matches no account or several, go to 3. `list_contexts` lists only
   firms with Carta's data warehouse product, so it is a shortcut to the open firm, never the
   list to pick from.
3. **Pick from the full list.** Call `list_accounts` with no `search`:
   - Exactly one `investment_firm` account: use it without asking.
   - No `investment_firm` account: tell the user their Carta login isn't a member of an
     investment firm, so there is no portfolio to show, and stop.
   - Otherwise ask with `AskUserQuestion`, listing the firms by name (no ids), before any call.

Name the firm in every answer, confirmation and result, so the user can see which firm acts.

Keep the firm name and its `organization_pk`.
