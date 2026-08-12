# Reference: fetch cash balance from Carta (`fa:get:cash-balance`)

Defines the canonical fetch pattern for pulling GL-based bank/cash
balances from Carta's Fund Admin via the MCP `fa:get:cash-balance`
command. Every capability that needs a current or as-of-date cash
figure — `fetch-budget`'s Beginning cash balance row, and each
budget-scenario reference's cash-impact summary — calls this reference
rather than reading a stale workbook cell or asking the user.

## Command shape

**If `<ENTITY_ID>` is not yet set this session** (the scenario references
work off an already-open workbook and don't call `entity-picker.md`
themselves), resolve it first: `read_skill(file_path="references/entity-picker.md")`.
Skip its "Build the picker" step if the workbook's Entity name (A1 of the
budget tab) matches exactly one entity from `fa:list:entities` — lock
`<ENTITY_ID>`/`<ENTITY_UUID>` from that match instead of re-asking the
user. Only fall through to the full picker if the match is ambiguous or
the workbook has no resolvable entity name.

```
call_tool({"name": "fa__get__cash-balance", "arguments": {
  "firm_uuid":   "<FIRM_UUID>",
  "entity_ids":  [<ENTITY_ID>],
  "as_of_date":  "<YYYY-MM-DD>"
}, "_instrumentation": {"plugin": "carta-investors", "skills": ["carta-manco", "<CAPABILITY>"]}})
```

- `firm_uuid` is `<FIRM_UUID>` from Gate 0 — **not** the ManCo entity's
  UUID. This command is firm-scoped; passing the entity UUID here
  returns the wrong (or no) data.
- `entity_ids` takes the **integer** Fund PK(s), not a UUID — use
  `<ENTITY_ID>` from `entity-picker.md`'s output, never `<ENTITY_UUID>`.
  Pass a single-element list to scope to the active ManCo.
- `as_of_date` is the date to fetch balances as of. For `fetch-budget`,
  this is the budget period's start date. For a scenario's cash-impact
  summary, this is "today" (or the date the user's goal is framed
  against, e.g. "by year-end" still starts from today's balance).

## Response shape

```
{
  "entities": [
    {
      "entity_id": <int>,
      "entity_name": "Example Capital, LLC",
      "entity_type": "fund" | "management_co" | ...,
      "totals_by_currency": [
        { "currency_code": "USD", "total_balance": 1234567.89 }
      ],
      "bank_accounts": [
        {
          "account_id": "<uuid>",
          "bank_name": "Chase",
          "account_name": "Operating",
          "balance": 950000.00,
          "currency_code": "USD",
          "integration_type": "plaid" | "jpm" | "direct" | null,
          "as_of_date": "01/15/2026",
          "is_manual": true | false,
          "staleness_days": <int> | null,
          "is_stale": true | false
        }
      ]
    }
  ]
}
```

Notes from the source data:

- `is_manual = true` means the account has no live bank-feed
  integration (`integration_type` is `null`) — its balance is only as
  fresh as the last manually-entered transaction, not a live sync.
- `is_stale = true` flags an `is_manual` account whose `as_of_date` is
  more than a day behind the requested `as_of_date` (or missing
  entirely). Integrated accounts (Plaid/JPM/etc.) are never flagged
  stale here — they sync on a schedule fund-admin already trusts.
- `as_of_date` per account is a date, not a datetime — day-granularity
  only.
- `totals_by_currency` is already broken out per currency. **Never sum
  across currencies into one blended total** — if `totals_by_currency`
  has more than one entry, present each currency's total separately.

## Presentation rule — staleness caveat

Never surface `integration_type`, `is_manual`, or `is_stale` as raw
field names or booleans to the user. When any account in the response
has `is_stale = true`, add one plain-English sentence to the relevant
preview step, not a separate table:

> Heads up — [Account name] hasn't synced recently (last updated
> [as_of_date]). This balance may be out of date.

If every account for the entity is stale or the entity has zero bank
accounts, treat cash balance as **unavailable** for this fetch — do not
silently substitute $0. Follow the calling reference's own fallback
rule for what to do next (see Empty-result handling below).

## Empty-result handling

If `entities` is empty, or the matched entity has an empty
`bank_accounts` list: the entity has no bank account configured in
Carta Fund Admin, or the caller lacks GL-view permission on it. This is
not a fake-zero situation — do **not** synthesize a $0 balance.

- **`fetch-budget`:** omit the Beginning cash balance row entirely; do
  not block the rest of the budget fetch.
- **Budget-scenario references:** fall back to "read current cash from
  the workbook if there's a cash-balance cell or a Cash tab; otherwise
  ask the user" — the pre-existing behavior — and note in the preview
  that the figure is user-supplied, not Carta-sourced.

## Output to the calling reference

```
{
  source: "Carta Fund Admin (fa:get:cash-balance)",
  fetched_at: "<ISO timestamp>",
  entity_name: "Example Capital, LLC",
  entity_id: <int>,
  as_of_date: "<YYYY-MM-DD>",
  totals_by_currency: [ { currency_code, total_balance } ],
  accounts: [
    { bank_name, account_name, balance, currency_code, is_stale }
  ],
  has_stale_accounts: true | false,
  available: true | false
}
```

`available = false` means Empty-result handling applies — the caller
must not present a cash figure. Do **not** invent balances; do **not**
apply a buffer or rounding beyond standard currency formatting.
