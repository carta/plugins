# Rendering — corp vesting schedule (`grant_vesting` / `certificate_vesting` shape)

Column/row spec for a single security's per-tranche vesting schedule on a corp cap table —
`cap_table:get:grant_vesting` (options) and `cap_table:get:certificate_vesting`
(certificates / RSAs / PIUs). Both share this layout. Rendered **on request only**, in chat, after a
holder drill (see `references/cap-table.corp.md` §Vesting schedule for the fetch + dispatch). Number
formatting is `SKILL.md` §Formatting rules.

## Response shape (both commands)

```
{ total_shares, vested_shares, unvested_shares,
  has_performance_condition, cliff_summary, vesting_start_date,
  exercise_price,            // grant_vesting (options) — strike; null on certificates
  base_value,                // grant_vesting (CBU / phantom) — strike analog; null otherwise
  threshold_value, threshold_value_type,   // certificate_vesting (PIU hurdle); null otherwise
  // invested-capital / preferred-return (certificate_vesting only; null otherwise):
  unreturned_invested_capital, initial_invested_capital, returned_invested_capital,
  unpaid_preferred_return, paid_preferred_return, preferred_return_accrued_all_time,
  dividend_accrual_start_date,
  preferred_return_history: [ { date, event_type, principal_amount, yield_amount, event_id } ],
  vesting_events: [ { date, amount, cumulative, has_vested, vesting_type,
                      performance_condition_title, payout_percentage, evaluation_date, target_amount } ] }
```

`vesting_events` are chronological. Corp events vest atomically (an event is fully vested or not) —
there is no service-window split.

## Caption (one line above the table)

`{security label} — total {total_shares}: vested {vested_shares} / unvested {unvested_shares}`

`{security label}` is the drilled security's `label` (from the holder drill `securities[].label`).
**Append the security's economics when present**, each clause ` · `-separated; omit any clause whose
field is null:

- **strike** — `· strike {exercise_price}` (options); for CBU / phantom use `· strike {base_value}`
- **threshold** — `· threshold {threshold_value}` (PIU)
- **invested capital** — `· unreturned capital {unreturned_invested_capital}`
- **preferred return** — `· pref accrued {unpaid_preferred_return} / paid {paid_preferred_return}`

## Print — one row per event (chat)

| Column | Source |
| --- | --- |
| Tranche | index (1..n) |
| State | `has_vested` → Vested / Unvested |
| Nominal | `amount` (the event's units) |
| Vested | `amount` if `has_vested`, else `0` |
| Unvested | `amount` if not `has_vested`, else `0` |
| Vest date | `date` — point-in-time (no service window on corp) |
| Performance | `performance_condition_title` + `payout_percentage` (e.g. `IPO — 50%`), else `—` |

The **Performance** column shows only when grant-level `has_performance_condition` is true; otherwise
omit the column. **Never synthesize a time-vs-performance split.** Format quantities / percentages /
dates per `SKILL.md` §Formatting rules; null → `—`.

## Answering on-demand questions (the schedule carries more than it prints)

On a direct ask, read the key off the already-fetched response (no re-fetch):

| Ask (natural language) | Key |
|---|---|
| strike / exercise price | `exercise_price` |
| base value (CBU / phantom) | `base_value` |
| distribution threshold / hurdle | `threshold_value`, `threshold_value_type` |
| cliff | `cliff_summary` |
| vesting start / commencement date | `vesting_start_date` |
| time vs performance for an event | `vesting_type` |
| payout percentage / target / evaluation date (a performance event) | `payout_percentage`, `target_amount`, `evaluation_date` |
| cumulative vested to an event | `cumulative` |
| initial / returned invested capital | `initial_invested_capital`, `returned_invested_capital` |
| preferred return accrued all-time | `preferred_return_accrued_all_time` |
| preferred-return history / ledger events | `preferred_return_history[]` (`date`, `event_type`, `principal_amount`, `yield_amount`) |
| accrual start date | `dividend_accrual_start_date` |

Format per `SKILL.md` §Formatting rules; null-dropped — never fabricate.
