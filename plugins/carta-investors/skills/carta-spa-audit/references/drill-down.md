## Drill-down: SPA documents by company

Triggered when the user selects "Drill into a company" or asks to see documents for a named company.

### Step A

If the user hasn't named a company, ask: "Which company would you like to review?"

### Step B

Run this query, replacing `<company_name>` with their input:

```
read_tool({"name": "dwh__execute__query", "arguments": {
  "sql": "WITH gen_rec AS (SELECT EXTRACTION_ID, RECORD_TYPE, ATTRIBUTES, RAW_JSON, CREATED_AT FROM FUND_ADMIN.DOCUMENT_AI_RECORD WHERE FIRM_ID = '<firm_id>' AND DOCUMENT_TYPE = 'stock_purchase_agreement'), spa_docs AS (SELECT EXTRACTION_ID, ISSUER_NAME, EXECUTED_BY_ISSUER, CLOSING_DATE, CURRENCY_CODE, UPLOAD_DATE FROM (SELECT c.EXTRACTION_ID, CASE WHEN TYPEOF(c.RAW_JSON:company:name) = 'OBJECT' AND c.RAW_JSON:company:name:value::STRING IS NOT NULL THEN c.RAW_JSON:company:name:value::STRING WHEN TYPEOF(c.RAW_JSON:company:name) = 'VARCHAR' THEN c.RAW_JSON:company:name::STRING ELSE c.ATTRIBUTES:name::STRING END AS ISSUER_NAME, CASE WHEN TYPEOF(c.RAW_JSON:company:executed_by_issuer) = 'OBJECT' AND TRY_TO_BOOLEAN(c.RAW_JSON:company:executed_by_issuer:value::VARCHAR) IS NOT NULL THEN TRY_TO_BOOLEAN(c.RAW_JSON:company:executed_by_issuer:value::VARCHAR) WHEN TYPEOF(c.RAW_JSON:company:executed_by_issuer) = 'BOOLEAN' THEN TRY_TO_BOOLEAN(c.RAW_JSON:company:executed_by_issuer::VARCHAR) ELSE c.ATTRIBUTES:executed_by_issuer::BOOLEAN END AS EXECUTED_BY_ISSUER, TRY_TO_DATE(e.ATTRIBUTES:closing_dates[0]::STRING) AS CLOSING_DATE, IFF(REGEXP_LIKE(e.ATTRIBUTES:currency_code::STRING, '^[A-Z]{3}$'), e.ATTRIBUTES:currency_code::STRING, NULL) AS CURRENCY_CODE, c.CREATED_AT::DATE AS UPLOAD_DATE FROM gen_rec c LEFT JOIN gen_rec e ON e.EXTRACTION_ID = c.EXTRACTION_ID AND e.RECORD_TYPE = 'stock_purchase' WHERE c.RECORD_TYPE = 'company') WHERE ISSUER_NAME IS NOT NULL), gen_purch AS (SELECT EXTRACTION_ID, ATTRIBUTES:name::STRING AS PURCHASER_NAME, ATTRIBUTES:entity_type::STRING AS ENTITY_TYPE, ATTRIBUTES:share_class_name::STRING AS SHARE_CLASS_NAME, ATTRIBUTES:shares_purchased_by_cash::NUMBER AS SHARES_PURCHASED, ATTRIBUTES:price_per_share::NUMBER(38, 6) AS PRICE_PER_SHARE, ATTRIBUTES:total_amount_paid::NUMBER(38, 2) AS TOTAL_AMOUNT_PAID FROM gen_rec WHERE RECORD_TYPE = 'investor') SELECT DENSE_RANK() OVER (ORDER BY sd.EXTRACTION_ID) AS spa_num, sd.UPLOAD_DATE AS upload_date, sd.ISSUER_NAME, gp.PURCHASER_NAME, gp.SHARE_CLASS_NAME, gp.SHARES_PURCHASED, gp.PRICE_PER_SHARE, gp.TOTAL_AMOUNT_PAID, sd.CURRENCY_CODE, sd.CLOSING_DATE AS transaction_date, CASE WHEN sd.EXECUTED_BY_ISSUER = TRUE THEN 'Yes' ELSE 'No' END AS executed FROM spa_docs sd LEFT JOIN gen_purch gp ON gp.EXTRACTION_ID = sd.EXTRACTION_ID AND (gp.ENTITY_TYPE IS NULL OR (gp.ENTITY_TYPE NOT ILIKE '%notice%' AND gp.ENTITY_TYPE NOT ILIKE '%law firm%')) WHERE UPPER(sd.ISSUER_NAME) LIKE UPPER('%<company_name>%') ORDER BY sd.EXTRACTION_ID, gp.PURCHASER_NAME",
  "limit": 500
}})
```

> **Checkpoint**: Call `mcp__<SERVER>__skill_checkpoint(skill_name="carta-investors:carta-spa-audit", checkpoint_label="data_fetched")` after the Step B query returns.

### Step C

Present results in two sub-tables. Both use `SPA #` as the join key so the user can correlate rows.

**Document overview**

| SPA # | Issuer | Transaction date | Upload date | Executed? |
|------:|-------|:----------------:|:-----------:|:---------:|
| 1 | Acme Corp, Inc. | Jan 31, 2022 | Jan 2022 | Yes |

**Purchaser / transaction details**

| SPA # | Purchaser (fund) | Share class | Shares | Price/share | Total amount |
|------:|-----------------|------------|-------:|------------:|-------------:|
| 1 | Sample Fund IV, L.P. | Series C Preferred | 125,000 | 40.00 USD | 5,000,000 USD |

Show each price per share with the decimals the document states (`0.05071`, not `0.05`) — seed-stage prices are often fractions of a cent. Every amount carries the `CURRENCY_CODE` of its SPA — never assume USD, and never total across SPAs with different codes. When `CURRENCY_CODE` is null the document did not state a currency: render the bare number with a `*` and add the footnote `* currency not stated in the source document`.

**Field notes:**
- **Upload date** — when Carta extracted the document. For SPAs that predate the current extraction pipeline this falls back to a data-refresh date and reads as approximate.
- **Executed?** — Yes/No from document extraction; a specific execution date is not available
- **Currency** — read from the document extraction, per SPA. Null when the document itself stated no currency.

> **Checkpoint**: Call `mcp__<SERVER>__skill_checkpoint(skill_name="carta-investors:carta-spa-audit", checkpoint_label="skill_finished")` after the two sub-tables.

### Step D

```python
AskUserQuestion(
    questions=[{
        "question": "What would you like to do next?",
        "header": "Next step",
        "multiSelect": False,
        "options": [
            {"label": "Back to full audit", "description": "Return to the four-bucket portfolio summary. ← recommended"},
            {"label": "Look up another company", "description": "Search SPA documents for a different portfolio company."},
        ],
    }]
)
```
