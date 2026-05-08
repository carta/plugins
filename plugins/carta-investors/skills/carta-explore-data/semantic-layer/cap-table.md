# Cap Table Summary

Query cap table data for a portfolio corporation — share classes, authorized/outstanding shares, ownership percentages, and firm stake.

> **Prerequisite:** A corporation ID is required. If only a company name is known, resolve it from `ALLOCATIONS` before running. If only an entity link ID is available, resolve it via `CORPORATION_ENTITY_LINKS_V2` first (see input resolution notes in the query section below).

## Table: SUMMARY_CAP_TABLE

Each row is a share class snapshot per corporation at a given date. Always filter to the latest `as_of_date` using a `latest_dates` CTE.

| Column | Description |
|--------|-------------|
| `CORPORATION_ID` | Portfolio company identifier |
| `as_of_date` | Date of the cap table snapshot |
| `SECURITY_CLASS_NAME` | Share class label (e.g. "Series A Preferred") |
| `security_class_type` | Broad type; filter out `note_block` rows |
| `security_class_type_detailed` | Granular type: `Preferred`, `Option plan`, etc. |
| `AUTHORIZED_SHARES` | Shares authorized in the class |
| `FULLY_DILUTED_QUANTITY` | Fully diluted share count |
| `OUTSTANDING_SHARES` | Issued and outstanding shares |
| `OUTSTANDING_WARRANTS` | Outstanding warrants |
| `OUTSTANDING_EQUITY_AWARD_DERIVATIVES` | Outstanding options/RSUs |

Supporting tables joined in the main query:
- `STAKEHOLDER_CAP_TABLE` — share counts per stakeholder; used to compute firm stake (filter by `STAKEHOLDER_NAME` or `STAKEHOLDER_GROUP_NAME`)
- `FINANCING_HISTORY` — round price and closing date per share class (`SHARECLASS_NAME`, `ORIGINAL_ISSUE_PRICE`, `CLOSING_DATE`); use `ISSUER_NAME` to filter by company name

## Common Aliases

`CORPORATION_NAME`, `LEGAL_NAME`, `company_name`

## Query — Cap Table Summary by Corporation

> **Input resolution — run these first if needed:**
>
> *Corporation ID from company name:*
> ```sql
> SELECT DISTINCT corporation_id, company_name
> FROM FUND_ADMIN.ALLOCATIONS
> WHERE LOWER(company_name) LIKE '%<user-supplied name>%'
> LIMIT 10
> ```
> If multiple matches, use `AskUserQuestion` to confirm which one before continuing.
>
> *Corporation ID from entity link ID:*
> ```sql
> SELECT CORPORATION_ID
> FROM FUND_ADMIN.CORPORATION_ENTITY_LINKS_V2
> WHERE ENTITY_LINK_ID = '<ENTITY_LINK_ID>'
> LIMIT 1
> ```
> If `CORPORATION_ID` is null, the company has no cap table in Carta — stop and inform the user.
>
> *Firm name:* call `list_contexts` — each entry has a `firm_name` field. Substitute it as `<FIRM_NAME>` below to compute the firm's ownership stake.

Replace `<CORPORATION_ID>` with the target corporation and `<FIRM_NAME>` with the firm name from context.

```sql
WITH latest_dates AS (
    SELECT CORPORATION_ID, MAX(as_of_date) AS max_as_of_date
    FROM FUND_ADMIN.SUMMARY_CAP_TABLE
    GROUP BY CORPORATION_ID
),
shares_agg AS (
    SELECT
        sct.CORPORATION_ID,
        sct.SECURITY_CLASS_NAME,
        MIN(sct.security_class_type_detailed) AS security_class_type_detailed,
        SUM(sct.AUTHORIZED_SHARES)                      AS authorized_shares,
        SUM(sct.FULLY_DILUTED_QUANTITY)                 AS total_shares,
        SUM(sct.OUTSTANDING_SHARES)                     AS outstanding_shares,
        SUM(sct.OUTSTANDING_WARRANTS)                   AS outstanding_warrants,
        SUM(sct.OUTSTANDING_EQUITY_AWARD_DERIVATIVES)   AS outstanding_options
    FROM FUND_ADMIN.SUMMARY_CAP_TABLE sct
    INNER JOIN latest_dates ld
        ON sct.CORPORATION_ID = ld.CORPORATION_ID
       AND sct.as_of_date     = ld.max_as_of_date
    WHERE sct.CORPORATION_ID      = '<CORPORATION_ID>'
      AND sct.security_class_type <> 'note_block'
    GROUP BY sct.CORPORATION_ID, sct.SECURITY_CLASS_NAME
),
total_shares_sum AS (
    SELECT
        sct.CORPORATION_ID,
        SUM(sct.FULLY_DILUTED_QUANTITY) AS grand_total_shares
    FROM FUND_ADMIN.SUMMARY_CAP_TABLE sct
    INNER JOIN latest_dates ld
        ON sct.CORPORATION_ID = ld.CORPORATION_ID
       AND sct.as_of_date     = ld.max_as_of_date
    WHERE sct.CORPORATION_ID = '<CORPORATION_ID>'
      AND sct.security_class_type <> 'note_block'
    GROUP BY sct.CORPORATION_ID
),
round_prices AS (
    SELECT
        CORPORATION_ID,
        SHARECLASS_NAME,
        MAX(CLOSING_DATE)         AS latest_closing_date,
        MAX(ORIGINAL_ISSUE_PRICE) AS round_price
    FROM FUND_ADMIN.FINANCING_HISTORY
    WHERE CORPORATION_ID = '<CORPORATION_ID>'
    GROUP BY CORPORATION_ID, SHARECLASS_NAME
)

SELECT
    s.SECURITY_CLASS_NAME                                                     AS share_class,
    COALESCE(s.authorized_shares, 0)                                          AS authorized_shares,
    s.total_shares,
    ROUND(s.total_shares / NULLIF(ts.grand_total_shares, 0) * 100, 2)        AS ownership_pct,
    r.round_price,
    COALESCE(s.total_shares, 0) * COALESCE(r.round_price, 0)                AS liquidation_preference,
    r.latest_closing_date
FROM shares_agg s
JOIN  total_shares_sum ts ON s.CORPORATION_ID = ts.CORPORATION_ID
LEFT JOIN round_prices r  ON s.SECURITY_CLASS_NAME = r.SHARECLASS_NAME
                          AND s.CORPORATION_ID     = r.CORPORATION_ID
ORDER BY
    CASE
        WHEN LOWER(s.SECURITY_CLASS_NAME) LIKE '%common%'          THEN 1
        WHEN s.security_class_type_detailed = 'Option plan'         THEN 2
        WHEN s.security_class_type_detailed = 'Preferred'           THEN 3
        WHEN LOWER(s.SECURITY_CLASS_NAME) LIKE '%warrant%'         THEN 4
        ELSE 3
    END,
    CASE
        WHEN s.security_class_type_detailed = 'Preferred'
            THEN COALESCE(r.latest_closing_date, '1900-01-01')
        ELSE NULL
    END,
    s.SECURITY_CLASS_NAME
LIMIT 200
```

## Presentation

1. **Header line** — "Cap table for **[Company Name]** as of [latest snapshot date]"
2. **Table columns** (max 6): Share Class | Total Shares | Ownership % | Firm Shares | Firm Ownership % | Round Price
3. **Currency** — `$X.XX` for round price; `$X,XXX` for liquidation preference (show in a separate summary line, not inline)
4. **Percentages** — `X.XX%`
5. **Row order** — common first, then option plans, then preferred (oldest to newest round), then warrants
6. **Missing round price** — show `—` rather than `$0` to avoid implying a zero-dollar round
