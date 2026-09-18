# Fund-of-Funds Look-Through

This describes behavior already implemented in `artifact.html`/`render-artifact.py` — every rendered SOI artifact carries it, for every firm. It is not something Claude decides to include per invocation (see **Step 2b** in `SKILL.md`); this file exists so a future change to the feature, or a "why does the drill-down do X" question, has a place to start. Corporate/direct-investment firms are unaffected in practice: with no `FUND_INVESTMENT` positions, the expand affordances, bulk prefetch, and global search simply have nothing to show.

Everything below was built and verified against real fund-of-funds customer data, then merged into the shared template. Look-through is capped at **one level of drill-down** — it does not recurse into a second layer of fund-of-funds; the underlying fund's own look-through positions (if any) are out of scope.

## 1. Look-through drill-down query

Each `FUND_INVESTMENT` asset row (a parent LP interest in another fund) can be expanded to show what that underlying fund actually holds, scoped by `FUND_UUID` (not fund name — several entities in a firm can share a display name) and the parent's issuer name:

```sql
SELECT
    FUND_UUID                    AS fund_uuid,
    FUND_NAME                    AS fund_name,
    PARENT_ISSUER_NAME           AS parent_issuer_name,
    UNDERLYING_FUND_NAME         AS underlying_fund_name,
    UNDERLYING_ISSUER_NAME       AS underlying_issuer_name,
    ASSET_NAME                   AS asset_name,
    SOURCE                       AS source,
    OWNERSHIP_FRACTION           AS ownership_fraction,
    IS_PRORATED                  AS is_prorated,
    TOTAL_COST_BASIS             AS cost_basis,
    REMAINING_VALUE               AS fmv,
    TOTAL_UNREALIZED_GAIN_LOSS   AS unrealized_gain_loss,
    COUNT_REMAINING_SHARES       AS count_remaining_shares,
    REMAINING_VALUE_PER_SHARE    AS remaining_value_per_share,
    CURRENCY_CODE                AS currency_code
FROM FUND_ADMIN.UNDERLYING_INVESTMENTS  -- or _HISTORY for a historical as-of, see §6
WHERE FUND_UUID = '<parent_fund_uuid>'
  AND PARENT_ISSUER_NAME = '<parent_issuer_name>'
ORDER BY remaining_value DESC NULLS LAST, underlying_issuer_name
LIMIT 500
```

**`REMAINING_VALUE`/`TOTAL_COST_BASIS` here are already the firm's prorated look-through share** — not the underlying fund's full totals. `OWNERSHIP_FRACTION` is informational only (e.g. show it as "Firm's look-through share of Underlying Fund X: 4.2%" in a tooltip); do not multiply it against the value columns yourself, that would double-count the proration.

## 2. Bulk prefetch, not per-row queries

Don't fetch-on-expand per position — it doesn't scale past a handful of `FUND_INVESTMENT` rows and makes the initial load feel broken. Run **one** paginated query across every parent fund UUID and every parent position at once, right after the base SOI load, and group the results client-side by `(fund_uuid, parent_issuer_name)`:

```sql
SELECT
    FUND_UUID AS fund_uuid, FUND_NAME AS fund_name,
    PARENT_ISSUER_NAME AS parent_issuer_name,
    UNDERLYING_FUND_NAME AS underlying_fund_name, UNDERLYING_ISSUER_NAME AS underlying_issuer_name,
    ASSET_NAME AS asset_name, SOURCE AS source,
    OWNERSHIP_FRACTION AS ownership_fraction, IS_PRORATED AS is_prorated,
    TOTAL_COST_BASIS AS cost_basis, REMAINING_VALUE AS fmv, TOTAL_UNREALIZED_GAIN_LOSS AS unrealized_gain_loss,
    COUNT_REMAINING_SHARES AS count_remaining_shares, REMAINING_VALUE_PER_SHARE AS remaining_value_per_share,
    CURRENCY_CODE AS currency_code
FROM FUND_ADMIN.UNDERLYING_INVESTMENTS  -- or _HISTORY, see §6
WHERE FUND_UUID IN (<all parent fund uuids>)
ORDER BY fund_uuid, parent_issuer_name, remaining_value DESC NULLS LAST
LIMIT <page_size> OFFSET <offset>
```

Page through with the same OFFSET-accumulation pattern the base SOI query uses (payload size limits truncate large results). Cache the grouped result per `(fund_uuid, parent_issuer_name)` key; a position with no matching rows still gets a cache entry (empty array) so the UI can say "No look-through holdings available for this position" instead of re-querying forever.

## 3. Tranche merging

A parent LP interest funded across multiple dates (initial commitment + later capital calls) shows up as multiple raw `FUND_INVESTMENT` asset rows for the *same* underlying issuer. Merge them into one displayed row before rendering, or the drill-down fetch runs redundantly and the table shows confusing duplicate "Partnership Interest" lines for what is really one position:

- Sum `count_remaining_shares`, `cost_basis`, `fmv` (remaining value), `unrealized_gain_loss`
- Earliest `acquisition_date` across the merged rows
- Latest `latest_fmv_effective_date` across the merged rows
- Recompute cost-per-share / value-per-share from the summed totals (don't average the per-row ratios)
- Tag the merged row with a tranche count (e.g. a small "(3 tranches)" indicator) so the merge is visible, not silent
- Only merge `FUND_INVESTMENT` rows — direct equity asset rows for the same company pass through untouched

## 4. Default sort on underlying holdings

Sort look-through rows by **remaining value (FMV), highest to lowest** — `ORDER BY remaining_value DESC NULLS LAST` — both in the per-position drill-down (§1) and the bulk prefetch (§2). This is the default sort for the expanded underlying-holdings rows; it does not change the base SOI table's own default sort (issuer/asset name).

## 5. Global cross-fund search

The base SOI search bar filters the currently-selected fund's own companies. For fund-of-funds, add a query that searches every `UNDERLYING_INVESTMENTS`/`_HISTORY` row across **every fund UUID in the firm at once** (row access is already firm-scoped by `set_context`, so no explicit fund-UUID filter is needed), matching on the underlying company name:

```sql
SELECT
    FUND_UUID AS fund_uuid, FUND_NAME AS fund_name,
    PARENT_ISSUER_NAME AS parent_issuer_name,
    UNDERLYING_FUND_NAME AS underlying_fund_name, UNDERLYING_ISSUER_NAME AS underlying_issuer_name,
    TOTAL_COST_BASIS AS cost_basis, REMAINING_VALUE AS fmv, TOTAL_UNREALIZED_GAIN_LOSS AS unrealized_gain_loss,
    CURRENCY_CODE AS currency_code
FROM FUND_ADMIN.UNDERLYING_INVESTMENTS  -- or _HISTORY, see §6
WHERE LOWER(UNDERLYING_ISSUER_NAME) LIKE '%<escaped lowercased search term>%' ESCAPE '\\'
ORDER BY fund_name, parent_issuer_name, remaining_value DESC NULLS LAST
LIMIT <limit>
```

Escape the search term before interpolating it: prefix `\`, `%`, and `_` with a
backslash, then double every backslash so the escape survives the SQL string
literal, and keep the `ESCAPE` clause. Quote-escaping alone is not enough — an
unescaped `%` makes the pattern `'%%'`, which matches every row and returns the
firm's entire underlying-holdings catalog.

Surface this as a separate panel from the base per-fund search results ("Also held (look-through) across your funds — N matches"), not merged into the same list — a match here means "held indirectly via a different vehicle," not "held directly in the fund you're looking at."

## 6. As-of quarter selector

Branch the underlying-holdings queries (§1, §2, §5) between `UNDERLYING_INVESTMENTS` (live) and `UNDERLYING_INVESTMENTS_HISTORY` (point-in-time) based on whether a historical date is selected — same `EFFECTIVE_DATE <= :date AND (NEXT_EFFECTIVE_DATE IS NULL OR NEXT_EFFECTIVE_DATE > :date)` pattern the base SOI's own as-of branching already uses for `AGGREGATE_INVESTMENTS_HISTORY`.

There is no server-side "as of" catalog — compute the last N quarter-ends client-side (calendar quarters: 3/31, 6/30, 9/30, 12/31, most recent completed quarter first) rather than fetching them from anywhere.

The base SOI query (`AGGREGATE_INVESTMENTS`/`_HISTORY`) gained the same as-of branch as part of this work, so the "As of" selector in the header applies to every firm, not just fund-of-funds ones — it's a prerequisite for the look-through as-of behavior to make sense (switching quarters has to move both tables together), not a separate feature.

## Related data-quality notes (apply regardless of look-through)

These surfaced while building fund-of-funds support but aren't specific to it — keep them in mind any time this skill touches `AGGREGATE_INVESTMENTS_HISTORY` or a firm's fund list:

- **`AGGREGATE_INVESTMENTS_HISTORY` and `UNDERLYING_INVESTMENTS_HISTORY` are not clones of their current-state counterparts.** They're missing columns like `investment_date` and `remaining_value_per_share`. Any historical-row rendering that needs a per-share value must fall back to computing it client-side from `remaining_value / count_remaining_shares` rather than assuming the column is populated.
- **Snowflake treats `ROWS` as a reserved word.** It cannot be used as a column alias (`unexpected 'rows'`) — pick a different alias if a query needs a row-count column.
- **Duplicate fund entity records are common.** `FUND_ADMIN.FUNDS` can have multiple identically-named fund records where only one is real (administered, has a vintage/fund size, has investment rows) and the rest are dead placeholders (`IS_ADMINISTERED_BY_CARTA = False`, no vintage, no fund size, zero investment rows). Before presenting a fund list, cross-reference name collisions against vintage/fund-size/administered-status/investment-row-count and either auto-drop confirmed-dead duplicates or flag them — don't silently list every UUID under a repeated name.
- **The fund dropdown now sorts by `VINTAGE_DATE` descending (most recent first, undated funds last), not alphabetically.** This applies to every firm's fund selector, not just fund-of-funds ones — it tested better for firms with many similarly-named vehicles and was folded into the shared template alongside the look-through work.

## Maintainer note

If you ever hand-edit a published Live Artifact's `<script>` block directly (rather than re-running `render-artifact.py`), extract the script and run `node -c` on it before republishing — cheap way to catch a syntax error before it reaches a user.
