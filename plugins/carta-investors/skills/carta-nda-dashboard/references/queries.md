# NDA dashboard queries

The six datasets the dashboard needs. Every query is the **shared `WITH` block** below followed
by that dataset's `SELECT`. Run each through `read_tool` → `dwh__execute__query` with
`format: "ndjson"` and `response_mode: "inline"`. The Carta MCP scopes every table to the active
firm, so no query filters by firm id. Field paths and the rules behind each expression are in
`nda_data_model.md` (this skill's own `references/`).

Before running, make two substitutions in the shared block:

- **`<firm token>`** — the firm token (`nda_data_model.md` → Counterparty). Double any `'` in
  it (`o'neil` → `o''neil`) and drop any `%` or `_`, so it stays a valid literal that matches
  only itself.
- **The Path A line** — keep it when the pre-flight `wi_count > 0`; delete it when `wi_count = 0`.
  The join drops deleted documents, and it sits before `QUALIFY` so a deleted copy can never win
  the dedupe tiebreak.

## Shared `WITH` block

```sql
WITH nda AS (
  SELECT r.document_id,
    r.attributes:metadata:disclosing_party:name:value::string AS disc,
    r.attributes:metadata:receiving_party:name:value::string  AS recv,
    COALESCE(TRY_TO_DATE(r.attributes:metadata:effective_date:value::string),
             TRY_TO_DATE(r.attributes:metadata:executed_date:value::string)) AS start_date,
    r.attributes:term:initial_term:text::string AS term_text,
    TRY_TO_NUMBER(r.attributes:term:initial_term:value::string) AS term_num,
    r.attributes:term:initial_term:unit::string AS term_unit,
    LOWER(r.attributes:governing:governing_law:value::string) AS gl,
    COALESCE(r.attributes:transaction:non_solicitation:present:value::boolean, FALSE)     AS non_solicitation,
    COALESCE(r.attributes:transaction:contact_restrictions:present:value::boolean, FALSE) AS contact_restrictions,
    COALESCE(r.attributes:transaction:standstill:present:value::boolean, FALSE)           AS standstill,
    COALESCE(r.attributes:portfolio_company_exclusion:present:value::boolean, FALSE)      AS portfolio_company_exclusion,
    COALESCE(r.attributes:specialized:non_circumvention:value::boolean, FALSE)            AS non_circumvention,
    COALESCE(r.attributes:information_barriers:present:value::boolean, FALSE)             AS information_barriers
  FROM FUND_ADMIN.DOCUMENT_AI_RECORD r
  JOIN (SELECT DISTINCT document_id FROM FUND_ADMIN.DOCUMENT_ATTRIBUTE_CARTA_LAW_WORK_ITEM) w ON r.document_id = w.document_id  -- Path A only
  WHERE r.document_type = 'nda'
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY COALESCE(r.attributes:metadata:disclosing_party:name:value::string,'')
      ||'|'||COALESCE(r.attributes:metadata:receiving_party:name:value::string,'')
      ||'|'||COALESCE(r.attributes:metadata:effective_date:value::string,'')
      ||'|'||COALESCE(r.attributes:metadata:executed_date:value::string,'')
      ||'|'||COALESCE(r.attributes:term:initial_term:text::string,'')
      ||'|'||COALESCE(r.attributes:governing:governing_law:value::string,'')
    ORDER BY r.document_id) = 1
),
calc AS (
  SELECT nda.*,
    COALESCE(CASE
      WHEN disc ILIKE '%<firm token>%' THEN recv
      WHEN recv ILIKE '%<firm token>%' THEN disc
      ELSE COALESCE(disc, recv)
    END, 'Unknown') AS counterparty,
    CASE
      WHEN term_unit ILIKE 'year%'  THEN term_num * 12
      WHEN term_unit ILIKE 'month%' THEN term_num
      WHEN term_unit ILIKE 'day%'   THEN CEIL(term_num / 30)
    END AS term_months,
    DATEADD(month, term_months, start_date) AS expiry,
    expiry >= CURRENT_DATE AND expiry < DATEADD(month, 24, CURRENT_DATE) AS expiring_soon,
    (non_solicitation OR contact_restrictions OR non_circumvention)
      AND (expiry IS NULL OR expiry >= CURRENT_DATE) AS restriction_in_force,
    CASE
      WHEN gl ILIKE '%delaware%'                                              THEN 'Delaware (US)'
      WHEN gl ILIKE '%new york%'                                              THEN 'New York (US)'
      WHEN gl ILIKE '%california%'                                            THEN 'California (US)'
      WHEN gl ILIKE '%texas%'                                                 THEN 'Texas (US)'
      WHEN gl ILIKE '%england%' OR gl ILIKE '%wales%' OR gl ILIKE '%english%' THEN 'England & Wales'
      WHEN gl ILIKE '%luxembourg%'                                            THEN 'Luxembourg'
      WHEN gl ILIKE '%cayman%'                                                THEN 'Cayman Islands'
      WHEN gl ILIKE '%ireland%' OR gl ILIKE '%irish%'                         THEN 'Ireland'
      WHEN gl ILIKE '%german%'                                                THEN 'Germany'
      WHEN gl ILIKE '%france%' OR gl ILIKE '%french%'                         THEN 'France'
      WHEN gl ILIKE '%italian%' OR gl ILIKE '%italy%'                         THEN 'Italy'
      WHEN gl ILIKE '%netherlands%' OR gl ILIKE '%dutch%'                     THEN 'Netherlands'
      WHEN gl ILIKE '%spain%' OR gl ILIKE '%spanish%'                         THEN 'Spain'
      WHEN gl ILIKE '%switzerland%' OR gl ILIKE '%swiss%'                     THEN 'Switzerland'
      WHEN gl ILIKE '%belgian%' OR gl ILIKE '%belgium%'                       THEN 'Belgium'
      ELSE INITCAP(gl)
    END AS gov_law
  FROM nda
),
wi AS (
  SELECT document_id, MAX(deal_name) AS deal_name
  FROM FUND_ADMIN.DOCUMENT_ATTRIBUTE_CARTA_LAW_WORK_ITEM
  GROUP BY document_id
)
```

`wi` carries the Deal Name workflow field. Every dataset LEFT JOINs it, so a firm without work
items gets blank deals and the dashboard hides its Deal columns.

## kpi

True totals over the deduped set. Never derive these from the capped tab datasets.

```sql
SELECT COUNT(*) AS TOTAL_NDAS,
  SUM(IFF(start_date IS NOT NULL, 1, 0)) AS WITH_START_DATE,
  COUNT(DISTINCT counterparty) AS DISTINCT_COUNTERPARTIES,
  COUNT(DISTINCT IFF(restriction_in_force, counterparty, NULL)) AS RESTRICTED_COMPANIES,
  SUM(IFF(expiring_soon, 1, 0)) AS EXPIRING_NEXT_2_YEARS
FROM calc
```

## provisions

```sql
SELECT 'Non-solicitation' AS PROVISION, SUM(IFF(non_solicitation, 1, 0)) AS N FROM calc
UNION ALL SELECT 'Contact restrictions', SUM(IFF(contact_restrictions, 1, 0)) FROM calc
UNION ALL SELECT 'Standstill', SUM(IFF(standstill, 1, 0)) FROM calc
UNION ALL SELECT 'Portfolio-company exclusion', SUM(IFF(portfolio_company_exclusion, 1, 0)) FROM calc
UNION ALL SELECT 'Non-circumvention', SUM(IFF(non_circumvention, 1, 0)) FROM calc
UNION ALL SELECT 'Information barriers', SUM(IFF(information_barriers, 1, 0)) FROM calc
```

## jurisdictions

```sql
SELECT gov_law AS JURISDICTION, COUNT(*) AS NDA_COUNT
FROM calc
GROUP BY 1
ORDER BY 2 DESC
LIMIT 30
```

NDAs with no governing law come back as a null bucket, which `process.py` drops from the chart.

## expiring

```sql
SELECT c.counterparty AS COUNTERPARTY, wi.deal_name AS DEAL_NAME, c.start_date AS START_DATE,
  c.term_text AS TERM_TEXT, c.term_months AS TERM_MONTHS, c.expiry AS EXPIRY
FROM calc c
LEFT JOIN wi ON c.document_id = wi.document_id
WHERE c.expiring_soon
ORDER BY c.expiry
LIMIT 500
```

## restrictions

One row per counterparty with a restriction in force. The labels are the long form the
Restriction filter offers.

```sql
SELECT c.counterparty AS COUNTERPARTY,
  ARRAY_TO_STRING(ARRAY_CONSTRUCT_COMPACT(
    IFF(BOOLOR_AGG(c.non_solicitation), 'Non-solicitation', NULL),
    IFF(BOOLOR_AGG(c.contact_restrictions), 'Contact restrictions', NULL),
    IFF(BOOLOR_AGG(c.non_circumvention), 'Non-circumvention', NULL)), ', ') AS RESTRICTIONS,
  MAX(c.expiry) AS BINDING_UNTIL,
  LISTAGG(DISTINCT wi.deal_name, ', ') AS DEALS,
  COUNT(*) AS NDA_COUNT
FROM calc c
LEFT JOIN wi ON c.document_id = wi.document_id
WHERE c.restriction_in_force
GROUP BY c.counterparty
ORDER BY BINDING_UNTIL NULLS LAST, c.counterparty
LIMIT 500
```

## counterparties

`MODE` picks each counterparty's most common governing law, so every spelling of one
jurisdiction stays one filter option.

```sql
SELECT c.counterparty AS COUNTERPARTY, COUNT(*) AS NDA_COUNT, MODE(c.gov_law) AS GOV_LAW,
  LISTAGG(DISTINCT wi.deal_name, ', ') AS DEALS
FROM calc c
LEFT JOIN wi ON c.document_id = wi.document_id
GROUP BY c.counterparty
ORDER BY NDA_COUNT DESC
LIMIT 500
```
