-- Portfolio ownership: one row per fund x portfolio company, as of one date.
--
-- The single source for this skill's numbers: the live page and the chat answers run this text
-- verbatim, so the two can never disagree. Before running, replace the fund-list parameter
-- with comma-separated, single-quoted fund/SPV UUIDs and the as-of parameter with a
-- YYYY-MM-DD date (today for the current position), then append LIMIT/OFFSET to page.
--
-- Shares held come from the company's cap table (FUND_CORPORATION_OWNERSHIP). Company
-- totals come from SUMMARY_CAP_TABLE so every fund of one company divides by the same
-- denominator, which is what lets fund rows add up to the company row. Companies a fund
-- holds with no cap table on Carta come from the fund's books (AGGREGATE_INVESTMENTS_HISTORY)
-- and carry NULL ownership.
WITH positions AS (
    -- Equity positions each fund holds at the as-of date, from fund admin.
    SELECT DISTINCT FIRM_ID, FUND_UUID, ENTITY_LINK_ID, GENERAL_LEDGER_ISSUER_ID, ISSUER_NAME
    FROM FUND_ADMIN.AGGREGATE_INVESTMENTS_HISTORY
    WHERE FUND_UUID IN (<FUND_UUIDS>)
      AND EFFECTIVE_DATE <= '<AS_OF_DATE>'
      AND (NEXT_EFFECTIVE_DATE IS NULL OR NEXT_EFFECTIVE_DATE > '<AS_OF_DATE>')
      AND ASSET_CLASS_TYPE IN ('PREFERRED_EQUITY', 'COMMON_EQUITY')
      AND COALESCE(IS_INVESTMENT_IN_FUND, FALSE) = FALSE
      AND (COALESCE(COUNT_REMAINING_SHARES, 0) <> 0 OR COALESCE(REMAINING_VALUE, 0) <> 0)
),
links AS (
    -- The view repeats per AS_OF_DATE, so DISTINCT; a NULL CORPORATION_ID means no cap table on Carta.
    SELECT DISTINCT FIRM_ID, ENTITY_LINK_ID, CORPORATION_ID
    FROM FUND_ADMIN.CORPORATION_ENTITY_LINKS_V2
    WHERE CORPORATION_ID IS NOT NULL
),
held AS (
    SELECT p.FUND_UUID, l.CORPORATION_ID, MIN(p.ISSUER_NAME) AS ISSUER_NAME,
           MIN(p.GENERAL_LEDGER_ISSUER_ID) AS ISSUER_ID
    FROM positions p
    LEFT JOIN links l ON l.FIRM_ID = p.FIRM_ID AND l.ENTITY_LINK_ID = p.ENTITY_LINK_ID
    GROUP BY p.FUND_UUID, l.CORPORATION_ID, IFF(l.CORPORATION_ID IS NULL, p.GENERAL_LEDGER_ISSUER_ID, NULL)
),
ownership AS (
    -- Latest real (not pro forma) snapshot per fund x company on or before the as-of date.
    -- DATE() so a same-day snapshot stamped after midnight still counts.
    SELECT FUND_ID, CORPORATION_ID, LEGAL_NAME, OWNERSHIP_QUANTITY,
           FULLY_DILUTED, DATE(AS_OF_DATE) AS OWNERSHIP_AS_OF
    FROM FUND_ADMIN.FUND_CORPORATION_OWNERSHIP
    WHERE FUND_ID IN (<FUND_UUIDS>)
      AND COALESCE(IS_PRO_FORMA, FALSE) = FALSE
      AND DATE(AS_OF_DATE) <= '<AS_OF_DATE>'
    QUALIFY ROW_NUMBER() OVER (PARTITION BY FUND_ID, CORPORATION_ID ORDER BY AS_OF_DATE DESC) = 1
),
rows_ AS (
    SELECT COALESCE(o.FUND_ID, h.FUND_UUID) AS FUND_UUID,
           COALESCE(o.CORPORATION_ID, h.CORPORATION_ID) AS CORPORATION_ID,
           h.ISSUER_ID, h.ISSUER_NAME, o.LEGAL_NAME,
           -- 0 means the cap table links no position to the fund, not a 0% stake.
           NULLIF(o.OWNERSHIP_QUANTITY, 0) AS SHARES_HELD,
           o.FULLY_DILUTED AS FCO_FULLY_DILUTED,
           o.OWNERSHIP_AS_OF
    FROM ownership o
    FULL OUTER JOIN held h ON h.FUND_UUID = o.FUND_ID AND h.CORPORATION_ID = o.CORPORATION_ID
    -- A zero-share cap-table row with no position on the books is an exited or placeholder link.
    WHERE NOT (h.FUND_UUID IS NULL AND COALESCE(o.OWNERSHIP_QUANTITY, 0) = 0)
),
cap_dates AS (
    -- Snapshot picked by calendar date: one load writes rows with sub-second jitter, and the
    -- latest row per company alone would drop share classes and inflate every percentage.
    SELECT CORPORATION_ID, MAX(DATE(AS_OF_DATE)) AS CAP_TABLE_AS_OF
    FROM FUND_ADMIN.SUMMARY_CAP_TABLE
    WHERE CORPORATION_ID IN (SELECT CORPORATION_ID FROM rows_ WHERE CORPORATION_ID IS NOT NULL)
      AND DATE(AS_OF_DATE) <= '<AS_OF_DATE>'
    GROUP BY CORPORATION_ID
),
cap_totals AS (
    SELECT s.CORPORATION_ID, d.CAP_TABLE_AS_OF,
           SUM(s.OUTSTANDING_SHARES) AS OUTSTANDING_SHARES,
           SUM(IFF(s.SECURITY_CLASS_TYPE = 'note_block', 0, s.FULLY_DILUTED_QUANTITY)) AS FULLY_DILUTED_SHARES
    FROM FUND_ADMIN.SUMMARY_CAP_TABLE s
    JOIN cap_dates d ON d.CORPORATION_ID = s.CORPORATION_ID AND DATE(s.AS_OF_DATE) = d.CAP_TABLE_AS_OF
    GROUP BY s.CORPORATION_ID, d.CAP_TABLE_AS_OF
),
names AS (
    -- The authoritative company name; the cap table's LEGAL_NAME goes stale after a rename.
    SELECT CORPORATION_UUID, CORPORATION_NAME
    FROM FUND_ADMIN.CORPORATION_BASIC_INFO_V2
    WHERE CORPORATION_UUID IS NOT NULL
    QUALIFY ROW_NUMBER() OVER (PARTITION BY CORPORATION_UUID ORDER BY _LOADED_AT DESC) = 1
),
company_fd AS (
    -- One fully diluted total per company, decided once so every fund of a company divides by
    -- the same number. The cap table wins; with none on or before the as-of date, the
    -- freshest ownership snapshot's total stands in.
    SELECT r.CORPORATION_ID,
           COALESCE(NULLIF(MAX(c.FULLY_DILUTED_SHARES), 0),
                    MAX_BY(r.FCO_FULLY_DILUTED, r.OWNERSHIP_AS_OF)) AS FD_TOTAL
    FROM rows_ r
    LEFT JOIN cap_totals c ON c.CORPORATION_ID = r.CORPORATION_ID
    WHERE r.CORPORATION_ID IS NOT NULL
    GROUP BY r.CORPORATION_ID
),
final AS (
    SELECT r.FUND_UUID,
           COALESCE(r.CORPORATION_ID, 'issuer:' || r.ISSUER_ID) AS COMPANY_KEY,
           r.CORPORATION_ID,
           COALESCE(n.CORPORATION_NAME, r.LEGAL_NAME, r.ISSUER_NAME) AS COMPANY_NAME,
           r.SHARES_HELD,
           NULLIF(c.OUTSTANDING_SHARES, 0) AS OUTSTANDING_SHARES,
           f.FD_TOTAL AS FULLY_DILUTED_SHARES,
           r.OWNERSHIP_AS_OF,
           c.CAP_TABLE_AS_OF,
           r.CORPORATION_ID IS NOT NULL AND (r.SHARES_HELD IS NOT NULL OR c.CORPORATION_ID IS NOT NULL) AS HAS_CAP_TABLE
    FROM rows_ r
    LEFT JOIN cap_totals c ON c.CORPORATION_ID = r.CORPORATION_ID
    LEFT JOIN company_fd f ON f.CORPORATION_ID = r.CORPORATION_ID
    LEFT JOIN names n ON n.CORPORATION_UUID = r.CORPORATION_ID
)
SELECT FUND_UUID              AS fund_uuid,
       COMPANY_KEY            AS company_key,
       CORPORATION_ID         AS corporation_id,
       COMPANY_NAME           AS company_name,
       SHARES_HELD            AS shares_held,
       OUTSTANDING_SHARES     AS outstanding_shares,
       FULLY_DILUTED_SHARES   AS fully_diluted_shares,
       -- Fractions (0.0432 = 4.32%). Above 1 is a data fault, so it shows as blank, not >100%.
       IFF(SHARES_HELD / OUTSTANDING_SHARES <= 1, SHARES_HELD / OUTSTANDING_SHARES, NULL) AS outstanding_ownership,
       IFF(SHARES_HELD / FULLY_DILUTED_SHARES <= 1, SHARES_HELD / FULLY_DILUTED_SHARES, NULL) AS fully_diluted_ownership,
       OWNERSHIP_AS_OF        AS ownership_as_of,
       CAP_TABLE_AS_OF        AS cap_table_as_of,
       HAS_CAP_TABLE          AS has_cap_table
FROM final
ORDER BY company_name, company_key, fund_uuid
