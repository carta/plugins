# NDA dashboard queries

The seven datasets the dashboard needs. Every query is the **shared `WITH` block** below followed
by that dataset's `SELECT`. Run each through `read_tool` → `dwh__execute__query` with
`format: "ndjson"` and `response_mode: "inline"`. The Carta MCP scopes every table to the active
firm, so no query filters by firm id. Field paths and the rules behind each expression are in
`nda_data_model.md` (this skill's own `references/`).

Before running, make three substitutions in the shared block:

- **`<firm token>`** — the firm token (`nda_data_model.md` → Counterparty), e.g. `great basin`.
  Double any `'` in it (`o'neil` → `o''neil`).
- **`<firm initials>`** — the firm's initials, upper case and `|`-separated, e.g. `GBC|GBCP`.
  With no token or no initials, write `FALSE` in place of that `REGEXP_INSTR(...) > 0` test
  (both lines), so an empty pattern never matches every party.
- **The Path A line** — keep it when the pre-flight `wi_count > 0`; delete it when `wi_count = 0`.
  The join drops deleted documents, and it sits before `QUALIFY` so a deleted copy can never win
  the dedupe tiebreak.

## Shared `WITH` block

```sql
WITH wi AS (
  SELECT document_id, MAX(deal_name) AS deal_name
  FROM FUND_ADMIN.DOCUMENT_ATTRIBUTE_CARTA_LAW_WORK_ITEM
  GROUP BY document_id
),
nda AS (
  SELECT r.document_id,
    r.attributes:metadata:disclosing_party:name:value::string AS disc,
    r.attributes:metadata:receiving_party:name:value::string  AS recv,
    r.attributes:metadata:title:value::string AS title,
    r.attributes:metadata:confidentiality_direction:value::string AS nda_direction,
    r.attributes:confidentiality:permitted_purpose:description:value::string AS purpose,
    COALESCE(TRY_TO_DATE(r.attributes:metadata:effective_date:value::string),
             TRY_TO_DATE(r.attributes:metadata:executed_date:value::string)) AS start_date,
    r.attributes:term:initial_term:text::string AS term_text,
    TRY_TO_NUMBER(r.attributes:term:initial_term:value::string) AS term_num,
    r.attributes:term:initial_term:unit::string AS term_unit,
    r.attributes:term:initial_term_start:value::string AS term_start,
    r.attributes:term:survival_period:text::string AS survival_text,
    TRY_TO_NUMBER(r.attributes:term:survival_period:value::string) AS survival_num,
    r.attributes:term:survival_period:unit::string AS survival_unit,
    LOWER(r.attributes:governing:governing_law:value::string) AS gl,
    COALESCE(r.attributes:transaction:non_solicitation:present:value::boolean, FALSE)     AS non_solicitation,
    TRY_TO_NUMBER(r.attributes:transaction:non_solicitation:duration:value::string)       AS non_solicitation_num,
    r.attributes:transaction:non_solicitation:duration:unit::string                       AS non_solicitation_unit,
    r.attributes:transaction:non_solicitation:duration_start:value::string                AS non_solicitation_start,
    COALESCE(r.attributes:transaction:contact_restrictions:present:value::boolean, FALSE) AS contact_restrictions,
    COALESCE(r.attributes:transaction:standstill:present:value::boolean, FALSE)           AS standstill,
    TRY_TO_NUMBER(r.attributes:transaction:standstill:duration:value::string)             AS standstill_num,
    r.attributes:transaction:standstill:duration:unit::string                             AS standstill_unit,
    r.attributes:transaction:standstill:duration_start:value::string                      AS standstill_start,
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
    COALESCE(REGEXP_INSTR(disc, '(^|[^a-z0-9])(<firm token>)($|[^a-z0-9])', 1, 1, 0, 'i') > 0
      OR REGEXP_INSTR(disc, '(^|[^A-Za-z0-9])(<firm initials>)($|[^A-Za-z0-9])', 1, 1, 0, 'c') > 0, FALSE) AS disc_is_firm,
    COALESCE(REGEXP_INSTR(recv, '(^|[^a-z0-9])(<firm token>)($|[^a-z0-9])', 1, 1, 0, 'i') > 0
      OR REGEXP_INSTR(recv, '(^|[^A-Za-z0-9])(<firm initials>)($|[^A-Za-z0-9])', 1, 1, 0, 'c') > 0, FALSE) AS recv_is_firm,
    COALESCE(CASE
      WHEN disc_is_firm THEN recv
      WHEN recv_is_firm THEN disc
      ELSE COALESCE(disc, recv)
    END, 'Unknown') AS counterparty,
    CASE WHEN disc_is_firm THEN disc WHEN recv_is_firm THEN recv END AS firm_entity,
    COALESCE(wi.deal_name,
      'Project ' || INITCAP(REGEXP_SUBSTR(title, 'project[[:space:]]+([a-z]+)', 1, 1, 'ie', 1))) AS deal,
    CASE
      WHEN term_unit ILIKE 'year%'  THEN term_num * 12
      WHEN term_unit ILIKE 'month%' THEN term_num
      WHEN term_unit ILIKE 'week%'  THEN CEIL(term_num * 7 / 30)
      WHEN term_unit ILIKE 'day%'   THEN CEIL(term_num / 30)
    END AS term_months,
    DATEADD(month, term_months, start_date) AS expiry,
    CASE
      WHEN survival_unit ILIKE 'year%'  THEN survival_num * 12
      WHEN survival_unit ILIKE 'month%' THEN survival_num
      WHEN survival_unit ILIKE 'week%'  THEN CEIL(survival_num * 7 / 30)
      WHEN survival_unit ILIKE 'day%'   THEN CEIL(survival_num / 30)
    END AS survival_months,
    DATEADD(month, survival_months, expiry) AS confidential_until,
    expiry < CURRENT_DATE
      AND (confidential_until IS NULL OR confidential_until >= CURRENT_DATE) AS still_confidential,
    expiry >= CURRENT_DATE AND expiry < DATEADD(month, 24, CURRENT_DATE) AS expiring_soon,
    NOT (COALESCE(nda_direction, '') ILIKE 'one%' AND disc_is_firm AND NOT recv_is_firm) AS binds_firm,
    CASE
      WHEN non_solicitation_unit ILIKE 'year%'  THEN non_solicitation_num * 12
      WHEN non_solicitation_unit ILIKE 'month%' THEN non_solicitation_num
      WHEN non_solicitation_unit ILIKE 'week%'  THEN CEIL(non_solicitation_num * 7 / 30)
      WHEN non_solicitation_unit ILIKE 'day%'   THEN CEIL(non_solicitation_num / 30)
    END AS non_solicitation_months,
    CASE
      WHEN standstill_unit ILIKE 'year%'  THEN standstill_num * 12
      WHEN standstill_unit ILIKE 'month%' THEN standstill_num
      WHEN standstill_unit ILIKE 'week%'  THEN CEIL(standstill_num * 7 / 30)
      WHEN standstill_unit ILIKE 'day%'   THEN CEIL(standstill_num / 30)
    END AS standstill_months,
    COALESCE(DATEADD(month, non_solicitation_months,
                     IFF(non_solicitation_start = 'Termination Or Expiry', expiry, start_date)), expiry) AS non_solicitation_until,
    COALESCE(DATEADD(month, standstill_months,
                     IFF(standstill_start = 'Termination Or Expiry', expiry, start_date)), expiry) AS standstill_until,
    COALESCE(term_start <> 'Effective Date', FALSE) AS expiry_estimated,
    (non_solicitation_months IS NOT NULL
       AND NOT COALESCE(non_solicitation_start IN ('Effective Date', 'Termination Or Expiry'), FALSE))
      OR (expiry_estimated AND (non_solicitation_months IS NULL
                                OR non_solicitation_start = 'Termination Or Expiry')) AS non_solicitation_estimated,
    (standstill_months IS NOT NULL
       AND NOT COALESCE(standstill_start IN ('Effective Date', 'Termination Or Expiry'), FALSE))
      OR (expiry_estimated AND (standstill_months IS NULL
                                OR standstill_start = 'Termination Or Expiry')) AS standstill_estimated,
    non_solicitation AND binds_firm
      AND (non_solicitation_until IS NULL OR non_solicitation_until >= CURRENT_DATE) AS non_solicitation_in_force,
    contact_restrictions AND binds_firm AND (expiry IS NULL OR expiry >= CURRENT_DATE) AS contact_restrictions_in_force,
    non_circumvention AND binds_firm AND (expiry IS NULL OR expiry >= CURRENT_DATE) AS non_circumvention_in_force,
    standstill AND binds_firm
      AND (standstill_until IS NULL OR standstill_until >= CURRENT_DATE) AS standstill_in_force,
    non_solicitation_in_force OR contact_restrictions_in_force OR non_circumvention_in_force
      OR standstill_in_force AS restriction_in_force,
    (non_solicitation_in_force AND non_solicitation_estimated)
      OR (standstill_in_force AND standstill_estimated)
      OR ((contact_restrictions_in_force OR non_circumvention_in_force) AND expiry_estimated) AS restricted_estimated,
    IFF((non_solicitation_in_force AND non_solicitation_until IS NULL)
        OR ((contact_restrictions_in_force OR non_circumvention_in_force) AND expiry IS NULL)
        OR (standstill_in_force AND standstill_until IS NULL), NULL,
      GREATEST(IFF(non_solicitation_in_force, non_solicitation_until, '1900-01-01'::date),
               IFF(contact_restrictions_in_force OR non_circumvention_in_force, expiry, '1900-01-01'::date),
               IFF(standstill_in_force, standstill_until, '1900-01-01'::date))) AS restricted_until,
    CASE
      WHEN gl ILIKE '%delaware%'                                              THEN 'Delaware (US)'
      WHEN REGEXP_LIKE(gl, '.*new ?y? ?ork.*')                                THEN 'New York (US)'
      WHEN gl ILIKE '%california%'                                            THEN 'California (US)'
      WHEN gl ILIKE '%texas%'                                                 THEN 'Texas (US)'
      WHEN gl ILIKE '%massachusetts%'                                         THEN 'Massachusetts (US)'
      WHEN gl ILIKE '%australia%' OR gl ILIKE '%new south wales%'             THEN 'Australia'
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
      WHEN gl ILIKE '%sweden%' OR gl ILIKE '%swedish%'                        THEN 'Sweden'
      WHEN gl ILIKE '%hong kong%'                                             THEN 'Hong Kong'
      WHEN gl ILIKE '%singapore%'                                             THEN 'Singapore'
      WHEN gl ILIKE '%japan%'                                                 THEN 'Japan'
      WHEN gl ILIKE '%ontario%' OR gl ILIKE '%canada%'                        THEN 'Canada'
      ELSE INITCAP(gl)
    END AS gov_law
  FROM nda
  LEFT JOIN wi ON nda.document_id = wi.document_id
)
```

`wi` carries the Deal Name workflow field. `deal` falls back to the project codename in the NDA's
title ("Project Atoll — Confidentiality Agreement" → `Project Atoll`), so a firm without work
items still sees deals when its NDAs name one; with neither, the dashboard hides its Deal columns.

## kpi

True totals over the deduped set. Never derive these from the capped tab datasets.

```sql
SELECT COUNT(*) AS TOTAL_NDAS,
  SUM(IFF(start_date IS NOT NULL, 1, 0)) AS WITH_START_DATE,
  COUNT(DISTINCT counterparty) AS DISTINCT_COUNTERPARTIES,
  COUNT(DISTINCT IFF(restriction_in_force, counterparty, NULL)) AS RESTRICTED_COMPANIES,
  SUM(IFF(expiring_soon, 1, 0)) AS EXPIRING_NEXT_2_YEARS,
  SUM(IFF(still_confidential, 1, 0)) AS EXPIRED_STILL_CONFIDENTIAL
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

One row per NDA. Two NDAs with the same counterparty are told apart by the firm entity that
signed, the deal and the purpose.

```sql
SELECT counterparty AS COUNTERPARTY, firm_entity AS FIRM_ENTITY, deal AS DEAL_NAME,
  purpose AS PURPOSE, start_date AS START_DATE, term_text AS TERM_TEXT,
  term_months AS TERM_MONTHS, expiry AS EXPIRY
FROM calc
WHERE expiring_soon
ORDER BY expiry
LIMIT 500
```

## expired

NDAs whose term has ended but whose confidentiality duty still runs: the duty survives for the
stated survival period after the NDA ends. A null `CONFIDENTIAL_UNTIL` has two meanings, told apart
by `SURVIVAL_TEXT`: blank means the NDA states no survival period (indefinite or not captured);
text without a date means a period the query could not turn into months, so the NDA must be read.

```sql
SELECT counterparty AS COUNTERPARTY, firm_entity AS FIRM_ENTITY, deal AS DEAL_NAME,
  purpose AS PURPOSE, expiry AS EXPIRY, survival_text AS SURVIVAL_TEXT,
  confidential_until AS CONFIDENTIAL_UNTIL
FROM calc
WHERE still_confidential
ORDER BY confidential_until NULLS LAST, expiry
LIMIT 500
```

## restrictions

One row per counterparty with a restriction in force that binds the firm. The labels are the
long form the Restriction filter offers.

```sql
SELECT counterparty AS COUNTERPARTY,
  ARRAY_TO_STRING(ARRAY_CONSTRUCT_COMPACT(
    IFF(BOOLOR_AGG(non_solicitation_in_force), 'Non-solicitation', NULL),
    IFF(BOOLOR_AGG(contact_restrictions_in_force), 'Contact restrictions', NULL),
    IFF(BOOLOR_AGG(non_circumvention_in_force), 'Non-circumvention', NULL),
    IFF(BOOLOR_AGG(standstill_in_force), 'Standstill', NULL)), ', ') AS RESTRICTIONS,
  IFF(COUNT_IF(restricted_until IS NULL) > 0, NULL, MAX(restricted_until)) AS BINDING_UNTIL,
  BOOLOR_AGG(restricted_estimated) AS ESTIMATED,
  LISTAGG(DISTINCT deal, ', ') AS DEALS,
  COUNT(*) AS NDA_COUNT
FROM calc
WHERE restriction_in_force
GROUP BY counterparty
ORDER BY BINDING_UNTIL NULLS LAST, counterparty
LIMIT 500
```

## counterparties

`MODE` picks each counterparty's most common governing law, so every spelling of one
jurisdiction stays one filter option.

```sql
SELECT counterparty AS COUNTERPARTY, COUNT(*) AS NDA_COUNT, MODE(gov_law) AS GOV_LAW,
  LISTAGG(DISTINCT deal, ', ') AS DEALS
FROM calc
GROUP BY counterparty
ORDER BY NDA_COUNT DESC
LIMIT 500
```
