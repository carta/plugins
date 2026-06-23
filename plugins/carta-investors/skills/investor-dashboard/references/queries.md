# Fund Admin data sourcing — commands & SQL

All data is **Fund Admin** via the connected Carta MCP. **Never** use `fund_forecasting:*`.
Read commands run through the MCP gateway: `call_tool({"name": "<domain>__<verb>__<noun>", "arguments": {...}})`.
DWH queries: `call_tool({"name": "dwh__execute__query", "arguments": {"sql": "...", "schema": "FUND_ADMIN"}})`.

Rules: **SELECT-only**, always a `LIMIT`, never `INFORMATION_SCHEMA`. Dedup latest snapshot with
`QUALIFY ROW_NUMBER() OVER (PARTITION BY fund_uuid ORDER BY month_end_date DESC, last_refreshed_at DESC)=1`.
Show **names, not UUIDs**. Resolve fund currency from the data — never assume USD.

## 0. Firm + fund resolution (friendly name → fund_uuid)
```
call_tool fa__list__firm            {"search": "<firm words>"}     # if firm ambiguous
set_context                          {"firm_id": "<firm_uuid>"}
call_tool fa__list__entities         {"search": "<fund name words>", "entity_types": "fund"}
```
Pick the matching entity → `fund_uuid` (+ fund name, currency if present). Disambiguate with AskUserQuestion.
Also accept a pasted fund URL / UUID (resolve directly via entities).

## 1. Fund metrics / dry powder  → `AGGREGATE_FUND_METRICS`
```sql
SELECT fund_name, fund_size, dry_powder, perc_capital_remaining,
       total_cost_of_investments, total_opx, total_mgmt_fees
FROM FUND_ADMIN.AGGREGATE_FUND_METRICS
WHERE fund_uuid = '<fund_uuid>'
QUALIFY ROW_NUMBER() OVER (PARTITION BY fund_uuid ORDER BY month_end_date DESC, last_refreshed_at DESC)=1
LIMIT 1
```
→ `capital.dryPowder`, `capital.fundSize`, `capital.totalMgmtFees`.

## 2. NAV / committed / called / distributions (+ series) → `MONTHLY_NAV_CALCULATIONS`
```sql
-- latest snapshot for headline capital
SELECT fund_name, cumulative_commitment_amount, cumulative_lp_contributions,
       cumulative_total_distributions, month_end_date
FROM FUND_ADMIN.MONTHLY_NAV_CALCULATIONS
WHERE fund_uuid = '<fund_uuid>' AND is_firm_rollup = FALSE
QUALIFY ROW_NUMBER() OVER (PARTITION BY fund_uuid ORDER BY month_end_date DESC)=1
LIMIT 1
```
→ `capital.committedCapital`, `capital.contributedCapital`, `capital.cumulativeDistributions`.
(Phase 2: drop the QUALIFY and `ORDER BY month_end_date` for the NAV/TVPI/DPI time series chart.)

## 3. Per-deal baseline (scenario rows) → `AGGREGATE_INVESTMENTS`
```sql
SELECT issuer_name, asset_class_type, investment_date,
       SUM(total_cost) AS total_cost,
       SUM(remaining_value) AS remaining_value,
       SUM(total_proceeds) AS total_proceeds,
       MAX(is_active_investment) AS is_active
FROM FUND_ADMIN.AGGREGATE_INVESTMENTS
WHERE fund_uuid = '<fund_uuid>'
GROUP BY issuer_name, asset_class_type, investment_date
ORDER BY remaining_value DESC NULLS LAST
LIMIT 200
```
→ one `deals[]` row per company: `id` (slug of issuer_name), `name`, `invested`=total_cost,
`fmv`=remaining_value, `realized`=total_proceeds, `status` (Active/Realized from is_active),
`moic`=(remaining_value+total_proceeds)/total_cost. Aggregate multiple asset rows per issuer.

## 4. Per-company fund ownership % → `FUND_CORPORATION_OWNERSHIP`
```sql
SELECT CORPORATION_ID, ownership_pct_calc AS ownership_pct
FROM FUND_ADMIN.FUND_CORPORATION_OWNERSHIP
WHERE FUND_ID = '<fund_uuid>'
QUALIFY ROW_NUMBER() OVER (PARTITION BY CORPORATION_ID, FUND_ID ORDER BY AS_OF_DATE DESC)=1
LIMIT 200
```
→ `deals[].ownershipPct` (as a fraction). Join to deals by company (resolve corp via
`CORPORATION_BASIC_INFO_V2` if needed). If ownership is unavailable, leave the deal's exit assumption
to drive proceeds directly and note it.

## 5. Dated LP cash flows (for IRR) → `JOURNAL_ENTRIES`
```sql
SELECT effective_date, event_type, SUM(amount) AS amount
FROM FUND_ADMIN.JOURNAL_ENTRIES
WHERE fund_uuid = '<fund_uuid>'
  AND event_type IN ('CAPITAL_CALL','CONTRIBUTION','DISTRIBUTION')
GROUP BY effective_date, event_type
ORDER BY effective_date
LIMIT 500
```
→ `cashflows[]`: contributions as **negative**, distributions as **positive** (LP-net). If this can't be
retrieved, omit `cashflows` and the engine flags IRR as approximate.

## 6. Fund terms (carry / hurdle / GP commit) → CLI fund-properties (not on MCP)
Not exposed by the `fa:*` MCP commands. If the Carta CLI is available:
```
carta fa get fund-properties --fund-uuid <fund_uuid>
```
Map `fund_allocations.fund_property.gp_carry_percentage` → `terms.carryPct`,
`hurdle_type` → `terms.hurdlePct` (numeric where derivable),
`fund_capital.fund_property.gp_capital_contribution_percentage` → `terms.gpCommitPct`,
`fund_distributions.fund_property.distributions_calculation_type` → `terms.distributionType`.
Record provenance in `model.termsSource` (`"fund-properties"` vs omitted). If unavailable, use defaults
(carry 0.20, hurdle 0.08, gpCommit 0.02) and leave `termsSource` empty so the UI shows "default / edited".

## 7. Partners / LPs (Phase 2) → `PARTNER_DATA`
```sql
SELECT partner_name, TOTAL_CAPITAL_COMMITMENT_AMOUNT_CURRENT AS commitment,
       TOTAL_CAP_CONTRIBUTION AS contributed
FROM FUND_ADMIN.PARTNER_DATA
WHERE fund_uuid = '<fund_uuid>'
ORDER BY commitment DESC LIMIT 200
```

## 8. Company financials / KPIs (Phase 3) → `COMPANY_FINANCIALS`
```sql
SELECT period_end, frequency, name, float_value, unit_type, report_type, instance_type
FROM FUND_ADMIN.COMPANY_FINANCIALS
WHERE LOWER(legal_name) ILIKE '%<company>%' AND is_latest = TRUE
ORDER BY period_end DESC, report_type, name LIMIT 100
```

## 9. Tearsheets (Phase 3, on-demand)
`fa__list__tearsheet_templates` → `template_uuid`; `fa__list__portfolio_companies` →
`entity_link_id`,`fund_uuid`; `fa__mutate__start_tearsheet_download` {template_uuid, fund_breakdowns:
[{fund_uuid, entity_link_ids:[...]}]}; poll `fa__get__tearsheet_download_status` → download URL.
