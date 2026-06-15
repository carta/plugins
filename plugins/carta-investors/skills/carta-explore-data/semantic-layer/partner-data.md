# Partner & LP Data

Query limited-partner and general-partner data: commitments, contributions, management fees, capital-account balances, and per-LP NAV over time.

> For **fund-level** NAV/TVPI/DPI (one row per fund), use `MONTHLY_NAV_CALCULATIONS` (see `nav.md`).
> This file is the **per-partner** breakdown — use it whenever the question is about individual LPs/GPs.

## Common Aliases

`LP`, `LPs`, `limited partners`, `general partners`, `investors in the fund`, `capital accounts`, `partner rollforward`, `commitments`, `units per LP`

## Picking the right table

| User intent | Table |
|---|---|
| Current commitments, contributions, fees, NAV balance per LP ("list LPs in [Fund] with commitments") | `PARTNER_DATA` |
| Capital-account statement / rollforward / NAV over time per LP ("LP X's capital account as of 12/31", "partner rollforward") | `PARTNER_MONTHLY_NAV_CALCULATIONS` |
| How many LPs / GPs does a fund have | either (count distinct `partner_id` / `partner_name`) |

## Table: PARTNER_DATA

One row per partner per fund — current/snapshot totals.

> **Column names that trip up the agent (do not use these):** there is no `PARTNER_TYPE` (use `PARTNER_ENTITY_TYPE` or `PARTNER_CLASS_NAME`), no bare `COMMITMENT` or `COMMITMENT_AMOUNT` (use `TOTAL_CAPITAL_COMMITMENT_AMOUNT_CURRENT`), and no `FUND_ID` (the fund column here is `FUND_UUID`).

| Column | Description |
|--------|-------------|
| `PARTNER_NAME` | LP/GP name — filter by this |
| `PARTNER_CLASS_NAME` | Partner class label |
| `PARTNER_ENTITY_TYPE` | Entity type of the partner |
| `TOTAL_CAPITAL_COMMITMENT_AMOUNT_CURRENT` | Current committed capital |
| `TOTAL_CAPITAL_COMMITMENT_AMOUNT_MAX` | Maximum/original commitment |
| `TOTAL_CAP_CONTRIBUTION` | Capital contributed (drawn) to date |
| `TOTAL_MGMT_FEES` | Management fees charged to the partner |
| `TOTAL_NET_ASSET_BALANCE` | Partner's net asset (capital-account) balance |
| `IS_LIMITED_PARTNER` / `IS_GENERAL_PARTNER` | Partner role flags |
| `IS_ACTIVE` | `TRUE` for active partners |
| `EARLIEST_COMMITMENT_DATE` | Date of first commitment |
| `FUND_NAME` / `FUND_UUID` | Fund the partner belongs to (fund column is `FUND_UUID`, not `FUND_ID`) |

### Query 1 — LP commitment & contribution summary for a fund

```sql
SELECT
    PARTNER_NAME,
    PARTNER_CLASS_NAME,
    TOTAL_CAPITAL_COMMITMENT_AMOUNT_CURRENT AS commitment,
    TOTAL_CAP_CONTRIBUTION                  AS contributed_to_date,
    TOTAL_MGMT_FEES                         AS mgmt_fees,
    TOTAL_NET_ASSET_BALANCE                 AS capital_account_balance
FROM FUND_ADMIN.PARTNER_DATA
WHERE LOWER(FUND_NAME) LIKE '%{fund_name}%'
  AND IS_LIMITED_PARTNER = TRUE
  AND IS_ACTIVE = TRUE
ORDER BY commitment DESC NULLS LAST
LIMIT 200
```

## Table: PARTNER_MONTHLY_NAV_CALCULATIONS

The per-partner companion to `MONTHLY_NAV_CALCULATIONS`: one row per partner per fund per month-end. Source for capital-account statements and rollforwards.

| Column | Description |
|--------|-------------|
| `FUND_NAME` / `FUND_ID` | Fund (here the fund column is `FUND_ID`, UUID-format) |
| `PARTNER_NAME` / `PARTNER_ID` | Partner (`PARTNER_ID` is an integer) |
| `MONTH_END_DATE` | Snapshot month-end |
| `BEGINNING_TOTAL_NAV` / `ENDING_TOTAL_NAV` | Capital-account NAV at start/end of month (`ENDING_TOTAL_NAV` = the capital-account balance) |
| `TOTAL_CONTRIBUTIONS` / `TOTAL_DISTRIBUTIONS` | Period activity that month |
| `CUMULATIVE_TOTAL_CONTRIBUTIONS` | Contributions to date |
| `TOTAL_VALUE` | Total value |
| `TOTAL_TVPI` / `TOTAL_DPI` / `TOTAL_RVPI` | Partner-level multiples |
| `IS_LIMITED_PARTNER` / `IS_GENERAL_PARTNER` / `IS_ACTIVE` | Role / status flags |

> Join to `PARTNER_DATA` on `PARTNER_MONTHLY_NAV_CALCULATIONS.FUND_ID = PARTNER_DATA.FUND_UUID AND .PARTNER_ID = .PARTNER_ID`. For "latest capital account per LP", use `QUALIFY ROW_NUMBER() OVER (PARTITION BY fund_name, partner_name ORDER BY month_end_date DESC) = 1`. For a point-in-time balance, filter `month_end_date <= '<as_of_date>'`.

### Query 2 — Latest capital-account balance per LP

```sql
SELECT
    FUND_NAME,
    PARTNER_NAME,
    MONTH_END_DATE,
    ENDING_TOTAL_NAV AS capital_account_balance,
    CUMULATIVE_TOTAL_CONTRIBUTIONS
FROM FUND_ADMIN.PARTNER_MONTHLY_NAV_CALCULATIONS
WHERE LOWER(FUND_NAME) LIKE '%{fund_name}%'
  AND IS_LIMITED_PARTNER = TRUE
QUALIFY ROW_NUMBER() OVER (
    PARTITION BY FUND_NAME, PARTNER_NAME
    ORDER BY MONTH_END_DATE DESC
) = 1
ORDER BY capital_account_balance DESC NULLS LAST
LIMIT 200
```

### Query 3 — Capital-account rollforward for one LP

```sql
SELECT
    MONTH_END_DATE,
    BEGINNING_TOTAL_NAV,
    TOTAL_CONTRIBUTIONS,
    TOTAL_DISTRIBUTIONS,
    ENDING_TOTAL_NAV
FROM FUND_ADMIN.PARTNER_MONTHLY_NAV_CALCULATIONS
WHERE FUND_ID = '<fund_uuid>'
  AND PARTNER_ID = <partner_id>
  AND MONTH_END_DATE <= '<as_of_date>'
ORDER BY MONTH_END_DATE
LIMIT 200
```

## Presentation

1. **Lead with a summary** — "[Fund] has N limited partners with $X committed and $Y contributed to date" (use the fund's own currency).
2. **Currency** — read it from the fund/partner data; never hardcode `$`/USD. Format as `<symbol>X,XXX`. Never sum amounts across funds in different currencies.
3. **Format as tables** — one row per LP; multiples as `X.XXx`; percentages as `X.XX%`.
4. **Capital account = `ENDING_TOTAL_NAV`** — label it "capital account balance", not "NAV", in LP-facing summaries.
5. **Use Carta voice** — "your LPs", "your partners", not "query results".
