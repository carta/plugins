# Cap Table & Firm Ownership (Investor / Firm Context)

Query investor-side cap table and firm-ownership data for portfolio companies — share classes, outstanding/authorized shares, ownership %, firm stake, and the per-stakeholder (shareholder) cap table.

## Triggers — use this file when the user asks ...

Single company:
- "Pull a cap table for **[Company]**"
- "Pull a cap table for **[Company]** using the Carta Plugin"
- "Provide a full cap table for **[Company]**"
- "Show me the cap table for **[Company]** as of **[date]**"
- "What share classes does **[Company]** have?"

Batch (multiple companies in one prompt):
- "Pull cap tables for **[A]**, **[B]**, **[C]**, and **[D]**"

Ownership questions:
- "What's our ownership in **[Company]**?"
- "What's our fully-diluted stake in **[Company]**?"

Shareholder / stakeholder questions:
- "Who are the shareholders of **[Company]**?"
- "List the stakeholders / shareholders for **[Company]**"
- "Who owns **[Company]**?" / "What does **[Stakeholder]** own in **[Company]**?"
- "Show me **[Company]**'s cap table by stakeholder" (the table keeps only each company's most recent snapshot, so a past **[date]** cannot be served — see Query D)

Portfolio event questions:
- "Show me the portfolio event history for **[Company]**"
- "What certificate activity has **[Company]** had?"
- "Has **[Company]** had any warrant exercises or share class conversions?"
- "When was the last certificate issuance/transfer for **[Company]**?"

## Tool routing (CRITICAL — investor/firm context)

When the active MCP context is a **Firm**, the agent has investor-side access only. Most portfolio companies returned by `fa:list:portfolio_companies` are exposed through the investor portal, **not** as direct cap-table-tenant members.

- **ALWAYS query the DW.** Use `SUMMARY_CAP_TABLE` for share-class detail and `FUND_CORPORATION_OWNERSHIP` for firm ownership % rollups.
- **NEVER call** `cap_table:*` or `cap_table_chart`. Those MCP commands require a direct cap-table-tenant user role and reject UUID-only corporation IDs. In firm context they will fail with permission or "invalid corporation_id" errors on nearly every portfolio company (only companies where the firm holds a direct cap-table viewer role — e.g. holdco entities — will succeed).
- **Waterfall scenarios** (`/waterfall-scenarios`) are NOT supported here — they depend on cap-table-tenant access. If asked, explain the limitation and stop; do not attempt a DW workaround.
- **Per-stakeholder / shareholder lists** come from `FUND_ADMIN.STAKEHOLDER_CAP_TABLE` (**Query D**). It is row-access controlled: a firm sees a company's stakeholder rows only when that company grants the firm **Detailed** cap table access in Carta. Zero rows for a company is the normal outcome when the firm has Summary access only — say "no detailed cap-table access for this company", not "no data", and do not fall back to `cap_table:*`.

## ⚠️ Common Mistakes in This Domain

| ❌ Wrong | ✅ Correct | Note |
|---|---|---|
| `OUTSTANDING_QUANTITY` | `OUTSTANDING_SHARES` | correct column in `SUMMARY_CAP_TABLE` and `STAKEHOLDER_CAP_TABLE` |
| `OWNERSHIP_PERCENTAGE` | `PERCENTAGE` | column in `FUND_CORPORATION_OWNERSHIP` is `PERCENTAGE`, not `OWNERSHIP_PERCENTAGE` |
| `FULLY_DILUTED_OWNERSHIP * 1` as a percent | `FULLY_DILUTED_OWNERSHIP * 100` | ownership columns in `STAKEHOLDER_CAP_TABLE` are fractions (1.0 = 100%) |
| `SUM(STAKEHOLDER_FULLY_DILUTED_SHARES)` across a stakeholder's rows | `MAX(...)` or one row per stakeholder | the `STAKEHOLDER_*` totals are repeated on every row of that stakeholder |

## Picking the right query

| User intent                                            | Use this query   | Primary table                              |
|--------------------------------------------------------|------------------|--------------------------------------------|
| Share-class breakdown, outstanding/authorized shares   | **Query A**      | `FUND_ADMIN.SUMMARY_CAP_TABLE`             |
| Firm ownership % / fully-diluted stake                 | **Query B**      | `FUND_ADMIN.FUND_CORPORATION_OWNERSHIP`    |
| Portfolio event history (certificate issuance/transfer, conversions, warrant exercises) | **Query C** | `FUND_ADMIN.NEWSFEED` |
| Shareholder / stakeholder list, what a holder owns, per-holder breakdown | **Query D** | `FUND_ADMIN.STAKEHOLDER_CAP_TABLE` |
| Batch — same intent across multiple companies          | A, B, C, or D with `IN` | (same as above)                     |
| Both — "give me the full picture for [Company]"        | A then B         | Both                                       |

## Input resolution (run before either query)

Step 0 (`fa:list:portfolio_companies`) has already run per SKILL.md — its result contains `corporation_id` and `corporation_name` for every accessible portco. **Match the user's company name(s) against that result first.**

If the user supplied a name/UUID/integer ID that doesn't appear in the Step 0 result, or there's no clean match, resolve via the canonical corporation table:

```sql
SELECT DISTINCT CORPORATION_ID, CORPORATION_UUID, CORPORATION_NAME
FROM FUND_ADMIN.CORPORATION_BASIC_INFO_V2
WHERE LOWER(CORPORATION_NAME) LIKE '%<user-supplied name>%'
   OR CORPORATION_UUID = '<user-supplied uuid>'
   OR CORPORATION_ID = <user-supplied integer id>
LIMIT 10
```

- If multiple matches, use `AskUserQuestion` to confirm before continuing.
- If zero matches, tell the user the company doesn't appear in their portfolio and stop.
- **Use the `CORPORATION_UUID` column when substituting into `<CORPORATION_UUIDS>` below — NOT the `CORPORATION_ID` integer column.** Both Query A and Query B match against the UUID-format `CORPORATION_ID` field in `SUMMARY_CAP_TABLE` / `FUND_CORPORATION_OWNERSHIP`. Substituting integer IDs yields silent zero-row results.

If only an entity link ID is available:

```sql
SELECT CORPORATION_ID
FROM FUND_ADMIN.CORPORATION_ENTITY_LINKS_V2
WHERE ENTITY_LINK_ID = '<ENTITY_LINK_ID>'
LIMIT 1
```
`CORPORATION_ENTITY_LINKS_V2.CORPORATION_ID` is **UUID-format** (TEXT) — safe to pass directly to `<CORPORATION_UUIDS>` in Query A or Query B without additional resolution. The column is nullable: if `CORPORATION_ID` is null, the entity is not a Carta-tracked corporation and has no cap table — stop and inform the user.

**Firm UUID:** call `list_contexts` — each entry has a `firm_id` field. Use it as `<FIRM_UUID>` in Query B.

## Query A — Cap Table by Share Class (SUMMARY_CAP_TABLE)

Parameters to substitute:
- `<CORPORATION_UUIDS>` — one or more corporation IDs as a comma-separated list of quoted UUIDs (e.g. `'aaa-...', 'bbb-...'`).
- `<AS_OF_DATE>` — the cap-table snapshot cutoff in `YYYY-MM-DD` format. **Default to `CURRENT_DATE`** for "latest snapshot" prompts. When the user specifies "as of [date]" (e.g. "as of Q1 2025", "as of 2024-12-31"), substitute that date here; the query will return the most recent snapshot on or before it. The same date is also applied to `FINANCING_HISTORY` so post-cutoff rounds are excluded.
  - ⚠️ **`as_of_date` is a TIMESTAMP — select and join the snapshot at the DATE level.** The `latest_dates` CTE uses `MAX(DATE(as_of_date))` and the share CTEs join on `DATE(sct.as_of_date) = ld.max_as_of_date`. Keep both date-level. Do **not** revert to `MAX(as_of_date)` + an exact `sct.as_of_date = ld.max_as_of_date` equi-join: a single daily load can write rows with sub-second timestamp jitter (e.g. common classes at `...949`, the rest at `...950`), and an exact-timestamp join silently drops the jittered rows — which is what produced cap tables missing Class A/B Common and inflated every ownership %. Likewise keep `DATE(as_of_date) <= '<AS_OF_DATE>'` in the filter so a same-day snapshot isn't excluded by midnight coercion.

```sql
WITH latest_dates AS (
    -- Snapshot selection MUST be date-level, not timestamp-level. `as_of_date` is a TIMESTAMP,
    -- and two failure modes follow from treating it as exact:
    --   1. Boundary: comparing `as_of_date <= '<date>'` coerces the literal to midnight
    --      (00:00:00), so a same-day snapshot timestamped later in the day is excluded and the
    --      query falls back to a STALE prior snapshot. Fixed by `DATE(as_of_date) <= '<date>'`.
    --   2. Intra-snapshot jitter: a single daily load can write rows with sub-second timestamp
    --      jitter — e.g. Class A/B Common land at ...12.949 while every other class lands at
    --      ...12.950. Picking MAX(as_of_date) (a single full timestamp) and equi-joining
    --      `sct.as_of_date = ld.max_as_of_date` then SILENTLY DROPS the .949 rows (the common
    --      classes), undercounting the fully-diluted denominator and inflating EVERY
    --      ownership_pct. (This is the bug that produced cap tables missing common stock.)
    -- Both are fixed by collapsing to the calendar date: take MAX(DATE(as_of_date)) here and
    -- join on DATE(as_of_date) below, so all rows of one logical daily snapshot are included
    -- regardless of jitter. Assumes one logical snapshot per corp per calendar day (true for
    -- this daily-load table); if a corp ever has two genuine same-day loads, the date join would
    -- union both — re-introduce a timestamp tiebreak then.
    SELECT CORPORATION_ID, MAX(DATE(as_of_date)) AS max_as_of_date
    FROM FUND_ADMIN.SUMMARY_CAP_TABLE
    WHERE CORPORATION_ID IN (<CORPORATION_UUIDS>)
      AND DATE(as_of_date) <= '<AS_OF_DATE>'
    GROUP BY CORPORATION_ID
),
shares_agg AS (
    SELECT
        sct.CORPORATION_ID,
        sct.SECURITY_CLASS_NAME,
        MIN(sct.security_class_type_detailed) AS security_class_type_detailed,
        SUM(sct.AUTHORIZED_SHARES)                      AS authorized_shares,
        SUM(sct.FULLY_DILUTED_QUANTITY)                 AS total_shares,
        SUM(sct.OUTSTANDING_SHARES)                     AS outstanding_shares
    FROM FUND_ADMIN.SUMMARY_CAP_TABLE sct
    INNER JOIN latest_dates ld
        ON sct.CORPORATION_ID    = ld.CORPORATION_ID
       AND DATE(sct.as_of_date)  = ld.max_as_of_date   -- date-level join: include all rows of the day's snapshot (see latest_dates)
    WHERE sct.security_class_type <> 'note_block'
    GROUP BY sct.CORPORATION_ID, sct.SECURITY_CLASS_NAME
),
total_shares_sum AS (
    SELECT
        sct.CORPORATION_ID,
        SUM(sct.FULLY_DILUTED_QUANTITY) AS grand_total_shares
    FROM FUND_ADMIN.SUMMARY_CAP_TABLE sct
    INNER JOIN latest_dates ld
        ON sct.CORPORATION_ID    = ld.CORPORATION_ID
       AND DATE(sct.as_of_date)  = ld.max_as_of_date   -- MUST match shares_agg's join exactly, or numerator/denominator diverge
    WHERE sct.security_class_type <> 'note_block'
    GROUP BY sct.CORPORATION_ID
),
round_prices AS (
    SELECT
        CORPORATION_ID,
        SHARECLASS_NAME,
        CLOSING_DATE         AS latest_closing_date,
        ORIGINAL_ISSUE_PRICE AS round_price
    FROM FUND_ADMIN.FINANCING_HISTORY
    WHERE CORPORATION_ID IN (<CORPORATION_UUIDS>)
      AND CLOSING_DATE <= '<AS_OF_DATE>'
    -- Tiebreaker on ORIGINAL_ISSUE_PRICE: if two rounds share the same CLOSING_DATE for a share class,
    -- pick the higher issue price deterministically rather than letting Snowflake choose.
    QUALIFY ROW_NUMBER() OVER (
        PARTITION BY CORPORATION_ID, SHARECLASS_NAME
        ORDER BY CLOSING_DATE DESC, ORIGINAL_ISSUE_PRICE DESC
    ) = 1
)
SELECT
    s.CORPORATION_ID,
    s.SECURITY_CLASS_NAME                                                    AS share_class,
    COALESCE(s.authorized_shares, 0)                                         AS authorized_shares,
    COALESCE(s.total_shares, 0)                                              AS total_shares,
    ROUND(s.total_shares / NULLIF(ts.grand_total_shares, 0) * 100, 2)       AS ownership_pct,
    r.round_price,
    CASE
        WHEN r.round_price IS NULL THEN NULL
        ELSE COALESCE(s.outstanding_shares, 0) * r.round_price
    END                                                                    AS liquidation_preference,
    r.latest_closing_date
FROM shares_agg s
JOIN  total_shares_sum ts ON s.CORPORATION_ID = ts.CORPORATION_ID
-- Note: SUMMARY_CAP_TABLE calls this column SECURITY_CLASS_NAME; FINANCING_HISTORY calls it SHARECLASS_NAME — different column names, same logical share class.
LEFT JOIN round_prices r  ON s.SECURITY_CLASS_NAME = r.SHARECLASS_NAME
                          AND s.CORPORATION_ID     = r.CORPORATION_ID
ORDER BY
    s.CORPORATION_ID,
    CASE
        WHEN LOWER(s.SECURITY_CLASS_NAME) LIKE '%common%'          THEN 1
        WHEN s.security_class_type_detailed = 'Option plan'         THEN 2
        WHEN s.security_class_type_detailed = 'Preferred'           THEN 3
        WHEN LOWER(s.SECURITY_CLASS_NAME) LIKE '%warrant%'         THEN 4
        ELSE 5  -- novel / unknown share types (e.g. convertible notes, RSU-only plans) sort after warrants, not interleaved with preferred
    END,
    CASE
        WHEN s.security_class_type_detailed = 'Preferred'
            THEN COALESCE(r.latest_closing_date, '1900-01-01')
        ELSE NULL
    END,
    s.SECURITY_CLASS_NAME
LIMIT 500
```

**Empty results** — if 0 rows return for a given `CORPORATION_ID`, that company has no cap table coverage in `SUMMARY_CAP_TABLE`. Surface this per-company in the response rather than failing silently for the whole batch.

**Batch truncation** — `LIMIT 500` can silently truncate the tail of a large batch (results are ordered by `CORPORATION_ID`, so the last sort-order corps get dropped first). If the result set returns exactly 500 rows, treat the batch as potentially truncated: split the original `<CORPORATION_UUIDS>` list in half and re-run the query for each half. **Cap the recursion at 2 levels of splitting** (up to 4 sub-batches). If any sub-batch still returns 500 rows after that, stop splitting and tell the user the batch is too large to fully cover in one pass — they should narrow the company list and re-ask.

- **Single-company queries** — do not trigger a split. A 500-row result for one corporation means that company genuinely has 500 share-class rows, not truncation.
- **Verification rule** — if the sum of the two halves' row counts equals the original 500, the original result was already complete; discard the split and use the original.

## Query B — Firm Ownership Snapshot (FUND_CORPORATION_OWNERSHIP)

For "what's our ownership in [Company]" / "fully-diluted stake" / "firm stake" questions. Returns one row per (corporation, fund) at the most recent `AS_OF_DATE` on or before `<AS_OF_DATE>`. Exposes `PERCENTAGE` (the fund's % stake), `OWNERSHIP_QUANTITY` (number of shares held), `FULLY_DILUTED` (the corporation's total fully-diluted share count at that date — the denominator backing the %), and `AS_OF_DATE`.

Parameters to substitute:
- `<FIRM_UUID>` — from `list_contexts`.
- `<CORPORATION_UUIDS>` — comma-separated quoted UUIDs.
- `<AS_OF_DATE>` — the snapshot cutoff in `YYYY-MM-DD` format. **Use the same value as in Query A** so the two queries align temporally for the combined "give me the full picture" path. Default to `CURRENT_DATE` for "latest snapshot" prompts; substitute the user's requested date when they say "as of [date]".

```sql
WITH ranked AS (
    SELECT  CORPORATION_ID,
            FIRM_ID,
            FUND_ID,
            TRY_TO_DECIMAL(TO_VARCHAR(PERCENTAGE), 38, 10) * 100 AS ownership_pct_calc,
            FULLY_DILUTED,
            OWNERSHIP_QUANTITY,
            AS_OF_DATE,
            ROW_NUMBER() OVER (
              PARTITION BY CORPORATION_ID, FIRM_ID, FUND_ID
              ORDER BY AS_OF_DATE DESC
            ) AS rn
    FROM FUND_ADMIN.FUND_CORPORATION_OWNERSHIP
    WHERE FIRM_ID = '<FIRM_UUID>'
      AND CORPORATION_ID IN (<CORPORATION_UUIDS>)
      -- DATE() cast for the same reason as Query A: guard against AS_OF_DATE carrying a time
      -- component, which would make a bare `<= '<date>'` (coerced to midnight) skip the
      -- same-day snapshot and fall back to a stale, lower ownership %. Harmless if the column
      -- is already a pure DATE.
      AND DATE(AS_OF_DATE) <= '<AS_OF_DATE>'
)
SELECT
    r.CORPORATION_ID,
    r.FUND_ID,
    f.FUND_NAME,
    r.AS_OF_DATE,
    ROUND(r.ownership_pct_calc, 2) AS firm_ownership_pct,
    r.OWNERSHIP_QUANTITY,
    r.FULLY_DILUTED                AS total_fd_shares
FROM ranked r
LEFT JOIN FUND_ADMIN.FUNDS f ON f.FUND_UUID = r.FUND_ID
WHERE r.rn = 1
ORDER BY r.CORPORATION_ID, f.FUND_NAME
LIMIT 500
```

Notes:
- `PERCENTAGE` in source is fraction-valued (e.g. `0.0432` = 4.32%), and its type has been both TEXT and `NUMBER(38,20)`. `TRY_TO_DECIMAL` rejects a numeric argument, so the query casts through `TO_VARCHAR` first; that works for either type — non-numeric strings (e.g. `"N/A"`) become `NULL` and propagate to `firm_ownership_pct` as `NULL`. Render `—` for these rows in the presentation; do **not** treat them as `0%` ownership.
- One row per (corporation, fund). If the firm holds the same corp through multiple funds, each fund gets its own row — do not sum percentages across funds.
- `FULLY_DILUTED` is the **corporation's total fully-diluted share count** at the snapshot date (the denominator backing `PERCENTAGE`). It is NOT a boolean. Aliased as `total_fd_shares` in the SELECT to avoid confusion.
- `FUND_NAME` is resolved via `LEFT JOIN FUND_ADMIN.FUNDS` (one row per fund — no aggregation needed).

**Batch truncation** — `LIMIT 500` can silently truncate a large batch (one row per `(corporation, fund)` — firms with many funds × many portcos may exceed 500). If the result returns exactly 500 rows, treat the batch as potentially truncated: split `<CORPORATION_UUIDS>` in half and re-run for each half. **Cap the recursion at 2 levels of splitting** (up to 4 sub-batches). If any sub-batch still returns 500 rows after that, stop splitting and tell the user the batch is too large to fully cover in one pass — they should narrow the company list and re-ask.

- **Single-company queries** — do not trigger a split. A 500-row result for one corporation means the firm holds that company through 500 funds (extremely unlikely) and is genuine, not truncation.
- **Verification rule** — if the sum of the two halves' row counts equals the original 500, the original result was already complete; discard the split.

## Query C — Portfolio Event History (NEWSFEED)

For "portfolio event history" / "certificate activity" / "warrant exercises" / "share class conversions" questions. `NEWSFEED` covers Carta-administered companies across every firm on the platform (~850K rows total) — it is only small and cheap to query at the per-company scope (a handful to a few dozen events each). **Always filter by `CORPORATION_ID` — never query this table unscoped.**

Parameters to substitute:
- `<CORPORATION_UUIDS>` — one or more corporation IDs as a comma-separated list of quoted UUIDs (same resolution as Query A/B).

```sql
SELECT
    CORPORATION_ID,
    CORPORATION_NAME,
    EVENT_TYPE,
    EVENT_DATE,
    SECURITY_LABEL,
    SECURITY_KIND,
    FUND_NAME,
    FIRM_NAME,
    DESCRIPTION
FROM FUND_ADMIN.NEWSFEED
WHERE CORPORATION_ID IN (<CORPORATION_UUIDS>)
ORDER BY EVENT_DATE DESC
LIMIT 500
```

**Event type breakdown variant** — when the user asks "what kinds of events" or "how many of each" rather than a row-by-row history:

```sql
SELECT
    CORPORATION_ID,
    EVENT_TYPE,
    COUNT(DISTINCT EVENT_UUID) AS event_count,
    MIN(EVENT_DATE) AS earliest_event_date,
    MAX(EVENT_DATE) AS latest_event_date
FROM FUND_ADMIN.NEWSFEED
WHERE CORPORATION_ID IN (<CORPORATION_UUIDS>)
GROUP BY CORPORATION_ID, EVENT_TYPE
ORDER BY event_count DESC
LIMIT 50
```

**Batch truncation** — same rule as Query A/B: if the row-by-row query returns exactly 500 rows, treat it as potentially truncated and split `<CORPORATION_UUIDS>` in half, capping recursion at 2 levels. The event-type breakdown variant is aggregated and rarely hits the 50-row limit; if it does, the company has an unusually diverse event history — split the batch the same way.

## Query D — Cap Table by Stakeholder (STAKEHOLDER_CAP_TABLE)

Parameters to substitute:
- `<CORPORATION_UUIDS>` — one or more corporation IDs as a comma-separated list of quoted UUIDs (same resolution as Query A).
- `<AS_OF_DATE>` — snapshot cutoff in `YYYY-MM-DD`. **Default to `CURRENT_DATE`.** `as_of_date` here is a **DATE**, so a plain date comparison is correct — no timestamp-jitter handling is needed, unlike `SUMMARY_CAP_TABLE`. **Only each company's most recent snapshot is retained** (the refresh replaces the previous one), so the table is a current-state view, not a history: a `<AS_OF_DATE>` earlier than that snapshot returns no rows. Use `SUMMARY_CAP_TABLE` for share-class history.

Grain: one row per stakeholder × security class (share class, option plan, warrant block, or convertible-note block) × `as_of_date`. The `STAKEHOLDER_*` columns are the holder's totals across all their rows in that company and are **repeated on every row** — never `SUM` them.

**Stakeholder summary** (default — "who are the shareholders", "who owns [Company]"):

```sql
WITH latest_dates AS (
    SELECT CORPORATION_ID, MAX(AS_OF_DATE) AS max_as_of_date
    FROM FUND_ADMIN.STAKEHOLDER_CAP_TABLE
    WHERE CORPORATION_ID IN (<CORPORATION_UUIDS>)
      AND AS_OF_DATE <= '<AS_OF_DATE>'
    GROUP BY CORPORATION_ID
)
SELECT
    s.CORPORATION_ID,
    s.LEGAL_NAME                                                  AS company_name,
    s.AS_OF_DATE,
    s.STAKEHOLDER_NAME,
    s.STAKEHOLDER_GROUP_NAME,
    MAX(s.STAKEHOLDER_OUTSTANDING_SHARES)                         AS outstanding_shares,
    MAX(s.STAKEHOLDER_FULLY_DILUTED_SHARES)                       AS fully_diluted_shares,
    ROUND(MAX(s.STAKEHOLDER_FULLY_DILUTED_OWNERSHIP) * 100, 2)    AS fully_diluted_ownership_pct,
    COUNT(*)                                                      AS holdings
FROM FUND_ADMIN.STAKEHOLDER_CAP_TABLE s
INNER JOIN latest_dates ld
    ON s.CORPORATION_ID = ld.CORPORATION_ID
   AND s.AS_OF_DATE     = ld.max_as_of_date
GROUP BY s.CORPORATION_ID, s.LEGAL_NAME, s.AS_OF_DATE, s.STAKEHOLDER_ID, s.STAKEHOLDER_NAME, s.STAKEHOLDER_GROUP_NAME
ORDER BY s.CORPORATION_ID, fully_diluted_shares DESC NULLS LAST, s.STAKEHOLDER_NAME
LIMIT 500
```

**Holding detail** (one row per stakeholder × security class — "what does [Stakeholder] own", "break down [Company] by holder and class"). Add `AND s.STAKEHOLDER_NAME ILIKE '%<name>%'` to narrow to one holder.

```sql
WITH latest_dates AS (
    SELECT CORPORATION_ID, MAX(AS_OF_DATE) AS max_as_of_date
    FROM FUND_ADMIN.STAKEHOLDER_CAP_TABLE
    WHERE CORPORATION_ID IN (<CORPORATION_UUIDS>)
      AND AS_OF_DATE <= '<AS_OF_DATE>'
    GROUP BY CORPORATION_ID
)
SELECT
    s.CORPORATION_ID,
    s.AS_OF_DATE,
    s.STAKEHOLDER_NAME,
    s.SECURITY_CLASS_NAME,
    s.SECURITY_CLASS_TYPE,
    s.OUTSTANDING_SHARES,
    s.OUTSTANDING_WARRANTS,
    s.OUTSTANDING_EQUITY_AWARD_DERIVATIVES,
    s.FULLY_DILUTED_QUANTITY,
    ROUND(s.FULLY_DILUTED_OWNERSHIP * 100, 4)                     AS fully_diluted_ownership_pct,
    s.CASH_RAISED,
    s.PRINCIPAL,
    s.OUTSTANDING_DEBT,
    s.CURRENCY_CODE
FROM FUND_ADMIN.STAKEHOLDER_CAP_TABLE s
INNER JOIN latest_dates ld
    ON s.CORPORATION_ID = ld.CORPORATION_ID
   AND s.AS_OF_DATE     = ld.max_as_of_date
ORDER BY s.CORPORATION_ID, s.STAKEHOLDER_NAME, s.SECURITY_CLASS_TYPE, s.SECURITY_CLASS_NAME
LIMIT 500
```

**Empty results** — 0 rows for a `CORPORATION_ID` almost always means the company has not granted this firm Detailed cap table access (the row access policy returns nothing, not an error). Say so per company: "_No detailed cap-table access for this company._" If Query A returns rows for the same company, the firm has Summary access only — offer the share-class view instead.

**Empty results with an `<AS_OF_DATE>` filter** — before saying "no access", re-run the `latest_dates` CTE without the date predicate and compare its `max_as_of_date` with `<AS_OF_DATE>`. If it is on or before `<AS_OF_DATE>`, that snapshot **is** the as-of answer (an exact-date match misses it): answer from it and state its date. If it is after `<AS_OF_DATE>`, say "_Detailed holders are available as of YYYY-MM-DD only; no snapshot exists on or before <AS_OF_DATE>._" and offer that snapshot or the share-class history from `SUMMARY_CAP_TABLE`. Only an empty result **without** the date filter means no Detailed access.

**Batch truncation** — same rule as Query A: exactly 500 rows means possibly truncated; split `<CORPORATION_UUIDS>` in half, cap at 2 levels. Large companies (thousands of option holders) can legitimately exceed 500 rows in the detail variant — use the stakeholder summary first, then narrow by `STAKEHOLDER_NAME`.

**Reconciling with Query A** — summing `FULLY_DILUTED_QUANTITY` over all stakeholders does **not** reach the company's fully-diluted total: the unissued option pool is not a stakeholder and has no row here. Use `SUMMARY_CAP_TABLE` for company totals.

## Table reference

### SUMMARY_CAP_TABLE
Each row is a share class snapshot per corporation at a given date.

| Column | Description |
|--------|-------------|
| `CORPORATION_ID` | Portfolio company identifier (UUID) |
| `as_of_date` | Cap table snapshot timestamp. **TIMESTAMP, not DATE** (carries a time component, e.g. `2026-06-03 16:13:19`). Rows of one daily snapshot can have sub-second jitter (e.g. common classes at `...949`, others at `...950`), so always select/join at the DATE level (`MAX(DATE(as_of_date))`, `DATE(as_of_date) = ...`) — an exact-timestamp equi-join drops the jittered rows. Also filter with `DATE(as_of_date) <= '<date>'`, never a bare `<= '<date>'`, or the same-day snapshot is excluded. |
| `SECURITY_CLASS_NAME` | Share class label (e.g. "Series A Preferred") |
| `security_class_type` | Broad type; filter out `note_block` rows |
| `security_class_type_detailed` | Granular type: `Preferred`, `Option plan`, etc. |
| `AUTHORIZED_SHARES` | Shares authorized in the class |
| `FULLY_DILUTED_QUANTITY` | Fully diluted share count — the basis for `total_shares` and the `ownership_pct` denominator. Populated for real share classes (incl. common). If common shares or another class go **missing** from a result, the cause is almost always `as_of_date` snapshot selection (stale-fallback or timestamp-jitter drop — see the row above), **not** a null `FULLY_DILUTED_QUANTITY`. Do **not** "fix" it by `COALESCE`-ing in `OUTSTANDING_SHARES`; that masks the real bug and double-counts. |
| `OUTSTANDING_SHARES` | Issued and outstanding shares |
| `OUTSTANDING_WARRANTS` | Outstanding warrants |
| `OUTSTANDING_EQUITY_AWARD_DERIVATIVES` | Outstanding options/RSUs |

Supporting tables used by Query A:
- `FINANCING_HISTORY` — round price and date per share class (`SHARECLASS_NAME`, `ORIGINAL_ISSUE_PRICE`, `CLOSING_DATE`, `RAISED_DATE`)

### STAKEHOLDER_CAP_TABLE
One row per stakeholder × security class × `AS_OF_DATE` for a corporation. Source for Query D. Row-access controlled: rows exist for a firm only where the company grants it Detailed cap table access. Refreshed once a day per corporation from Carta's cap table.

| Column | Description |
|--------|-------------|
| `CORPORATION_ID` | Portfolio company identifier (UUID) |
| `LEGAL_NAME` | Company legal name; `PRO_FORMA_OF_LEGAL_NAME` / `PRO_FORMA_OF_CORPORATION_ID` are set when the snapshot is a pro forma of another entity |
| `AS_OF_DATE` | Snapshot date. **DATE, not TIMESTAMP** — one snapshot per corporation per day; plain date comparisons are safe |
| `STAKEHOLDER_ID`, `STAKEHOLDER_NAME` | The holder (individual or entity) |
| `STAKEHOLDER_GROUP_ID`, `STAKEHOLDER_GROUP_NAME` | Group that consolidates related holders (typically the investing firm/organization) |
| `SECURITY_CLASS_ID`, `SECURITY_CLASS_NAME`, `SECURITY_CLASS_TYPE` | The holding's class; type is one of `share_class`, `option_plan`, `warrant_block`, `note_block`. Ids are prefixed `SC-` / `OP-` / `WC-` / `NB-` |
| `AS_CONVERTED_SHARECLASS_ID`, `AS_CONVERTED_SHARECLASS_NAME`, `AS_CONVERTED_SHARCLASS_STOCK_TYPE` | The share class an option plan / warrant converts into (note the historical misspelling of the stock-type column) |
| `OUTSTANDING_SHARES` | Issued and outstanding shares; `0` on rows that are not a share class |
| `OUTSTANDING_WARRANTS` | Outstanding warrants; `0` on rows that are not a warrant block |
| `OUTSTANDING_EQUITY_AWARD_DERIVATIVES` | Outstanding options/RSUs; `0` on rows that are not an option plan |
| `OUTSTANDING_COMMITTED_RSAS` | RSAs approved but not yet purchased (option plans) |
| `FULLY_DILUTED_QUANTITY` | Fully diluted count for this holding; `NULL` for note blocks |
| `OUTSTANDING_OWNERSHIP`, `FULLY_DILUTED_OWNERSHIP` | This holding's share of the company's outstanding / fully diluted total, as a **fraction** (1.0 = 100%) |
| `CONVERSION_RATIO` | Share class or warrant conversion ratio; `NULL` for option plans and notes |
| `CASH_RAISED`, `PRINCIPAL`, `INTEREST`, `OUTSTANDING_DEBT` | Money in `CURRENCY_CODE` (the company's default currency); principal/interest/debt only on note blocks |
| `CASH_RAISED_BY_CURRENCY`, `PRINCIPAL_BY_CURRENCY`, `INTEREST_BY_CURRENCY`, `OUTSTANDING_DEBT_BY_CURRENCY` | Same amounts in every currency, as an OBJECT keyed by ISO code; `NULL` when there is no money on the holding |
| `STAKEHOLDER_OUTSTANDING_SHARES`, `STAKEHOLDER_FULLY_DILUTED_SHARES`, `STAKEHOLDER_OUTSTANDING_OWNERSHIP`, `STAKEHOLDER_FULLY_DILUTED_OWNERSHIP` | The holder's totals across all their rows in the company, **repeated on every row** — take one value per stakeholder, never `SUM` |

### FUND_CORPORATION_OWNERSHIP
One row per (corporation, firm, fund, as_of_date). Source for Query B.

| Column | Description |
|--------|-------------|
| `CORPORATION_ID` | Portfolio company identifier (UUID) |
| `FIRM_ID` | Firm identifier (UUID) — match against `list_contexts.firm_id` |
| `FUND_ID` | Fund identifier (UUID) |
| `AS_OF_DATE` | Date of the ownership snapshot |
| `PERCENTAGE` | Fund's ownership fraction in the corp, TEXT or NUMBER (cast with `TRY_TO_DECIMAL(TO_VARCHAR(PERCENTAGE), 38, 10)`; multiply by 100 for %) |
| `FULLY_DILUTED` | Corporation's total fully-diluted share count at the snapshot date (NUMBER, NOT a boolean — this is the denominator backing `PERCENTAGE`) |
| `OWNERSHIP_QUANTITY` | Number of shares the fund holds |

### FINANCING_HISTORY
One row per financing round per company. Used by Query A (joined on `CORPORATION_ID`) for round price/date, **and** directly when the user asks about financing rounds ("show financing rounds for [Company]", "how much has [Company] raised", "latest post-money for [Company]").

> **Filter by company name with `INVESTMENT_NAME`** — e.g. `WHERE LOWER(INVESTMENT_NAME) LIKE '%stripe%'`. There is **no** `COMPANY_NAME`, `ISSUER_NAME`, `CORPORATION_NAME`, or `FIRM_ID` column on this table. To filter by company UUID use `CORPORATION_ID`. To scope by fund, join to `FUNDS` — there is no `FUND_NAME` or fund column here.
>
> ⚠️ **Wrong column names (common errors):**
> - `PRICE_PER_SHARE` does not exist → use `ORIGINAL_ISSUE_PRICE`
> - `AMOUNT_RAISED` does not exist → use `ESTIMATED_CASH_RAISED` or `CALCULATED_CASH_RAISED`
> - `SHARACLASS_NAME` (typo) / `SHARE_CLASS_NAME` → use `SHARECLASS_NAME` (one word, no underscore between SHARE and CLASS)

| Column | Description |
|--------|-------------|
| `INVESTMENT_NAME` | Company (investee) name — **the column to filter by company** |
| `CORPORATION_ID` | Company identifier (UUID) — join key to `SUMMARY_CAP_TABLE` / `CORPORATION_BASIC_INFO.CORPORATION_UUID` |
| `SHARECLASS_NAME` | Share class for the round (NB: `SUMMARY_CAP_TABLE` calls the same concept `SECURITY_CLASS_NAME`) |
| `ROUND` | Round label (e.g. "Series A") |
| `RAISED_DATE` / `CLOSING_DATE` | Round raised / closing dates |
| `ESTIMATED_CASH_RAISED` / `CALCULATED_CASH_RAISED` | Cash raised in the round (no `AMOUNT_RAISED` column — use these) |
| `ORIGINAL_ISSUE_PRICE` | Issue price per share for the round (no `PRICE_PER_SHARE` column) |
| `SHARES_ISSUED` / `FULLY_DILUTED_SHARES` | Share counts |
| `POST_MONEY_VALUATION` / `PRE_MONEY_VALUATION` | Round valuations |

### NEWSFEED
One row per portfolio event per corporation. Source for Query C.

> **`EVENT_TYPE` has a narrower live taxonomy than you might expect.** Only 5 values actually occur in the data: `Certificate issuance`, `Certificate transfer`, `Convertible conversion`, `Share class conversion`, `Warrant exercise`. Don't filter/group on other values (e.g. "new priced round", "valuation finalized") — they don't appear in this table.
>
> **`DESCRIPTION` is frequently empty.** Don't rely on it being populated — use `EVENT_TYPE`, `SECURITY_LABEL`, and `SECURITY_KIND` for the structured facts of the event instead.

| Column | Description |
|--------|-------------|
| `CORPORATION_ID` | Portfolio company identifier (UUID) — always filter by this; the table is ~850K rows unscoped |
| `CORPORATION_NAME` | Company legal name as recorded on the event |
| `EVENT_TYPE` | Event category — see the narrower live taxonomy above |
| `EVENT_DATE` | Date/time the event occurred — use to order event history chronologically |
| `SECURITY_LABEL` | Label of the security involved (e.g. `PS-03`, `CS-380`) |
| `SECURITY_KIND` | Kind of security involved (e.g. `CERTIFICATE`) |
| `FUND_NAME` / `FIRM_NAME` | Fund and firm associated with the event |
| `DESCRIPTION` | Free-text notes — frequently empty, do not rely on it |
| `EVENT_UUID` | Unique event identifier — use for `COUNT(DISTINCT ...)` in the event-type breakdown query |

### CORPORATION_BASIC_INFO
Canonical company-name/identifier lookup. Join target for `FUND_CORPORATION_OWNERSHIP` (`FCO.CORPORATION_ID = CBI.CORPORATION_UUID`).

> **The company-name column is `CORPORATION_NAME`; the UUID column is `CORPORATION_UUID`.** There is **no** `COMPANY_NAME`, `COMPANY_UUID`, `LEGAL_NAME`, `NAME`, or `ISSUER_NAME` column — those are the most common wrong guesses. Both `CORPORATION_BASIC_INFO` and `CORPORATION_BASIC_INFO_V2` expose the same name/UUID columns.
>
> **Location columns are `CITY`, `STATE`, `COUNTRY` — not `HEADQUARTERS_CITY` / `HEADQUARTERS_STATE` / `HEADQUARTERS_COUNTRY`.** Those compound forms do not exist and will throw `SQL compilation error: invalid identifier`.

| Column | Description |
|--------|-------------|
| `CORPORATION_NAME` | Company name — **filter by this** (`LOWER(CORPORATION_NAME) LIKE '%...%'`) |
| `CORPORATION_UUID` | Company UUID — join key from `FUND_CORPORATION_OWNERSHIP.CORPORATION_ID` |
| `CORPORATION_ID` | Integer company id (do not pass to UUID-keyed tables) |
| `CITY` / `STATE` / `COUNTRY` | Location fields (ISO-3 country code) — `HEADQUARTERS_*` variants do not exist |

> ⚠️ **FUND_CORPORATION_OWNERSHIP JOIN pattern** — `FCO.CORPORATION_ID` is **TEXT (UUID)**, while `CORPORATION_BASIC_INFO_V2.CORPORATION_ID` is **INTEGER**. Joining on `c.corporation_id = o.corporation_id` causes a Snowflake type-cast error (`Numeric value 'uuid-string' is not recognized`). Always join on the UUID column:
> ```sql
> JOIN FUND_ADMIN.CORPORATION_BASIC_INFO_V2 c
>   ON c.CORPORATION_UUID = o.CORPORATION_ID   -- both TEXT/UUID
> ```
> Never use `c.CORPORATION_ID` (INTEGER) as the join key when joining from `FUND_CORPORATION_OWNERSHIP`.

## Common Aliases

`CORPORATION_NAME`, `LEGAL_NAME`, `company_name`

## Presentation

### Single company
1. **Header line** — "Cap table for **[Company Name]** as of [latest snapshot date]"
2. **Table columns** (max 6): Share Class | Authorized Shares | Total Shares | Class Ownership % | Round Price | Closing Date. The `liquidation_preference` column is present in the result set but **must not appear as a table column** — render it only as a prose summary line below the table, and call it a **face-value estimate** (it is `outstanding_shares × round_price`; it does NOT account for participation multiples, seniority stacks, or anti-dilution adjustments, so do not use it for waterfall modeling).
3. **Currency** — `$X.XX` for round price; `$X,XXX` for liquidation preference (`outstanding_shares × round_price` per share class; surface as a face-value summary line below the table, not as an inline column).
4. **Liquidation preference reliability** — `round_price` is `NULL` when no matching row exists in `FINANCING_HISTORY` for that share class. This is expected behavior, not a bug: `FINANCING_HISTORY` only covers priced financing rounds, so non-priced classes (option/RSU plans, warrants, common stock, ESOP) will always have `NULL` round price. With the SELECT's `CASE WHEN r.round_price IS NULL THEN NULL` guard, `liquidation_preference` is also `NULL` for those rows. Render `—` for both columns in those cases. For preferred classes where the round price is still `NULL`, note in prose that the financing-round price could not be resolved (uncommon but possible for older / pre-Carta rounds with missing `FINANCING_HISTORY` coverage).
5. **Percentages** — `X.XX%`. The `ownership_pct` column from Query A is the share class's % of total fully-diluted shares — NOT the firm's stake. Label it "Class Ownership %" to avoid confusion.
6. **Firm-level stake** — to show "what % does the firm own", run Query B and surface its result in a separate summary line (e.g. "Firm ownership: 4.32% as of 2026-03-31"), not as a per-row column in the share-class table.
7. **Row order** — common first, then option plans, then preferred (oldest to newest round), then warrants
8. **Missing round price** — show `—` rather than `$0` to avoid implying a zero-dollar round

### Batch (multiple companies in one prompt)
- Render one section per company with a `### [Company Name]` header followed by its table. Do not interleave rows from different companies.
- For companies that returned zero rows from Query A, show a single line under the header: "_No cap table data in Carta for this company._" Continue to the next company; do not abort the entire response.

### Portfolio events (Query C)
1. **Header line** — "Portfolio events for **[Company Name]**"
2. **Table columns** (max 5): Event Date | Event Type | Security | Fund | Firm. Omit `DESCRIPTION` from the table (it's usually empty) — if present for a row, mention it in a footnote rather than a column.
3. **Row order** — most recent event first (`EVENT_DATE DESC`), matching the query's default order.
4. **Event-type breakdown variant** — when the user asks "what kinds" or "how many", render a simple summary table instead: Event Type | Count | Earliest | Latest.
5. **Empty results** — if 0 rows return for a company, show "_No portfolio events recorded for this company._" rather than failing silently.
6. **Batch** — same per-company section pattern as cap table batch responses: one `### [Company Name]` header per company, no interleaving.

### Stakeholder list (Query D)
1. **Header line** — "Stakeholders of **[Company Name]** as of [snapshot date]"
2. **Table columns** (max 6): Stakeholder | Group | Outstanding Shares | Fully Diluted Shares | FD Ownership % | Holdings. Use the stakeholder-summary variant by default; switch to the holding-detail variant only when the user asks about a specific holder or wants the class-level breakdown.
3. **Percentages** — `X.XX%`, from `FULLY_DILUTED_OWNERSHIP * 100` (the source is a fraction). Label it "FD Ownership %" — it is the holder's share of the company, not the firm's stake (that is Query B).
4. **Row order** — largest fully diluted holding first, as the query returns.
5. **Empty results** — show "_No detailed cap-table access for this company._" per company. Never say "no data" or "no shareholders": zero rows means the company has not granted the firm Detailed cap table access. If Query A has rows for the company, offer the share-class view. If the question had an as-of date, first drop the date filter and compare the snapshot date with the requested one: on or before it, answer from that snapshot and state its date; after it, say "_Detailed holders are available as of YYYY-MM-DD only_" instead of "no access".
6. **Totals** — do not add a total row; the unissued option pool has no stakeholder row, so stakeholder rows do not sum to the company's fully diluted total. Point to Query A for company totals.
7. **Money** — `CASH_RAISED` / `PRINCIPAL` / `OUTSTANDING_DEBT` are in `CURRENCY_CODE`; format with that code (e.g. `€1,200,000`), not `$` by default.
8. **Batch** — same per-company section pattern as Query A: one `### [Company Name]` header per company, no interleaving.

### Ownership-only response (Query B without Query A)
- Render one table per company, with columns: Fund Name | As Of | Ownership % | Shares Held.
- Each row corresponds to one fund within the firm holding that company. If the firm holds the company through multiple funds, list each fund as its own row so the user can see fund-specific ownership.
- Do not sum the ownership % across funds. `total_fd_shares` is the corporation's total fully-diluted share count (the denominator) — it is the same for every fund in a given (corp, snapshot) and should not be rendered as a per-row column; mention it once in a footnote if the user asks for the denominator.
- If `FUND_NAME` is null for a row (no matching row in `FUNDS`), fall back to displaying `FUND_ID`.
- **NULL `firm_ownership_pct`** — render `—`, not `0.00%`. A NULL means the source `PERCENTAGE` was non-numeric (e.g. `"N/A"`) for that snapshot; treat it as data-unavailable, not zero ownership.
