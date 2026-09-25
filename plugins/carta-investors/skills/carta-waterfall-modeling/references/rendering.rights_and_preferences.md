# Rendering — rights & preferences (`rights_and_preferences` shape)

Column/row spec for `cap_table:get:rights_and_preferences` — the per-share-class rights &
preferences *configuration* used in the waterfall. Rendered **on request only**, as a companion
beside the corp cap table (see `references/cap-table.corp.md` §Rights & preferences for the fetch +
wiring). Number formatting is `SKILL.md` §Formatting rules.

## Response shape

```
{ count, by_type,
  classes: [ { id, name, prefix, stock_type, seniority,
               multiplier, original_issue_price, participating_preferred, preference_cap,
               conversion_ratio, conversion_price,
               dividend_type, dividend_coupon, dividend_accrual,
               interest_compounding_period, day_count_convention,
               votes_per_share, total_quantity, authorized_shares, is_deferred } ] }
```

One entry per share class, in returned (cap-table) order. `count` / `by_type` are metadata — not rendered.

## Print — two tables (chat)

One share class per row, in returned order. Values are under each class's entry.

**Table 1 — Economics**

| Column        | Source (`classes[].…`)   | Note                                          |
| ------------- | ------------------------ | --------------------------------------------- |
| Share class   | `name`                   | row label                                     |
| Seniority     | `seniority`              | payout rank; corp-only (LLC lacks it)         |
| Multiplier    | `multiplier`             | e.g. `1.5×`; `—` if none                       |
| OIP           | `original_issue_price`   | original issue price                          |
| Participating | `participating_preferred`| Yes / No                                      |
| Cap           | `preference_cap`         | `—` if none                                    |
| Conv. ratio   | `conversion_ratio`       | conversion *price* is on-demand               |

**Table 2 — Dividends / preferred return**

| Column        | Source (`classes[].…`)         |
| ------------- | ------------------------------ |
| Share class   | `name`                         |
| Dividend      | `dividend_type`                |
| Cumulative    | derived from `dividend_type` (a cumulative type → Yes, any other type → No); `—` when `dividend_type` is null |
| Rate          | `dividend_coupon`              |
| Accrual       | `dividend_accrual`             |
| Compounding   | `interest_compounding_period`  |

Formatting: money / prices / rates / percentages per `SKILL.md` §Formatting rules; null or unset →
`—`. Never fabricate a missing value.

## Answering on-demand questions (the command returns more than it prints)

Each share class carries fields beyond the printed columns. On a direct ask for a specific class,
read the key off the already-fetched response (no re-fetch):

| Ask (natural language) | Key |
|---|---|
| conversion price | `conversion_price` |
| votes per share | `votes_per_share` |
| day-count convention | `day_count_convention` |
| compounding period | `interest_compounding_period` |
| dividend rate / coupon | `dividend_coupon` |
| authorized units | `authorized_shares` |
| total quantity issued | `total_quantity` |
| is it deferred | `is_deferred` |

Format per `SKILL.md` §Formatting rules; null-dropped — never fabricate.
