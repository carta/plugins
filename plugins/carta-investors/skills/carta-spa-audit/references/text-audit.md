## Mode B — Audit (text)

Render the four-bucket audit as Markdown tables. Single fetch, single render.

### Step B0: Resolve workspace and check cache

Before fetching anything, resolve a stable, cross-platform working directory, `<WORKSPACE>`, where the audit cache lives. **Both the Claude process AND the preview-panel host must be able to read this path** — on Cowork demo VMs running macOS 26.5+ the host can no longer see `~/.cache/...` or `/tmp/...`. Run each command below as its own Bash call, exactly as written: each matches an `allowed-tools` entry, and a shell variable does not survive from one Bash call to the next, so write the resolved path into later commands literally.

1. `test -d "$HOME/mnt/outputs"` — succeeds in the Cowork sandbox, where `mnt/outputs/` under the session root is the folder the host can read too. `<WORKSPACE>` is that folder (expand `$HOME` with `pwd` if needed) plus `/carta-spa-audit`.
2. Otherwise `command -v carta` — succeeds on a Claude Code laptop. Run `carta workspace cache carta-spa-audit`; it prints a quoted path, which is `<WORKSPACE>` without the quotes.
3. Otherwise `<WORKSPACE>` is `<CWD>/carta-spa-audit`, with `<CWD>` from `pwd`.

Then create it:

```bash
mkdir -p "<WORKSPACE>"
```

Do not hardcode `/tmp` — it breaks on Windows and is invisible to the Cowork host on macOS 26.5+.

**Cache check:**

```bash
date +%s && date -r "<WORKSPACE>/carta-spa-audit-data.json" +%s
```

The cache is fresh when the two printed numbers differ by less than 3600 (60 minutes). If the second command fails, there is no cache.

If the cache is fresh:
1. `Read` `<WORKSPACE>/carta-spa-audit-data.json`.
2. Confirm `data.meta.firmId == <firm_id>` (cache is per-firm; a stale cache from another firm must be ignored).
3. Run `date -r "<WORKSPACE>/carta-spa-audit-data.json" +%H:%M` and tell the user: `Using cached SPA data from <that time>. Preparing results…`
4. Skip Step B1 and proceed directly to Step B2.

**Fall through to Step B1 (live fetch) when:**
- The cache file does not exist
- The cache file is older than 60 minutes
- The cached `firmId` does not match
- The user explicitly asks to refresh (e.g. "rerun", "fresh data")

Drill-down queries always run live — per-company SPA documents are too noisy to cache and the user expects current data when they ask for it.

### Step B1: Fetch audit data

Run the main audit query and the two coverage queries in parallel.

### Main audit query

Reads the unified SPA source (see SKILL.md, *SPA data source*), groups by issuer name to deduplicate multi-upload cases, then fuzzy-matches investment names to SPA issuer names at Jaro-Winkler ≥ 90 to catch variants like "AcmeCorp, Inc." vs. "AcmeCorp Inc." or "AcmeCo International Inc. (fka. OldName, Inc.)" vs. "AcmeCo International Inc."

**Important — regex escaping:** Snowflake processes backslashes in string literals (`\s` → `s`), so patterns that need a literal backslash for the regex engine must use `\\` in the SQL string. The patterns below use `[(]`, `[)]`, and `[ ]` (space) instead of `\(`, `\)`, and `\s` to avoid this entirely.

> **`fuzzy_matched` needs a total ordering — do not drop a trailing ORDER BY key.** Once `norm_investments` emits an alias candidate alongside the primary name, one investment can score 100 against two different SPAs, and `has_executed_spa DESC` alone does not separate them. With a tie, `ROW_NUMBER()` picks whichever row the plan happens to emit first, so the SPA named against a company changes between runs of the *same* audit. The rank ends `..., s.has_executed_spa DESC, i.is_alias, s.spa_name`: the executed flag keeps its precedence so bucket assignment is untouched, `is_alias` prefers a match on the company's own name over its former name, and `spa_name` makes the order total.

> **`NULLS LAST` on that same rank is load-bearing — do not drop it.** `fuzzy_matched` ranks candidates through a `LEFT JOIN`, and Snowflake sorts NULLs **first** on a `DESC` ordering. Without `NULLS LAST`, a company whose primary name finds no SPA but whose alias scores 100 has its NULL row win `rn = 1`, carries a NULL `spa_name` into `labeled`, and gets bucketed "1. Missing SPA" — silently discarding exactly the matches the alias candidates exist to recover. At one firm that was the difference between 66 and 133 companies in Executed SPA. Like the total ordering above, it only became load-bearing once `norm_investments` emitted more than one row per investment. The co-investors skill carries the same clause; keep the two in step. `carta-portfolio-rights/references/portfolio-rights.sql` copies this query's name normalisation and alias expressions; change them there too.

> **A bare parenthetical is an alias only when it could be a name.** `alias_raw` takes the text after `fka`/`dba`/`formerly` when the investment name has one, and otherwise any parenthetical — but investment names carry many that are not names: `(1 CASE)`, `(Series A)`, `(Cayman)`, `(US)`, `(Holding)`, `(Israeli company)`. The `IFF(REGEXP_LIKE(...), NULL, ...)` around the bare fallback drops those — two characters or fewer, a leading digit, a series, a "held …" or "investment …" phrase, "… company", or a structural word (holding, group, feeder, onshore/offshore, and the jurisdictions Cayman, BVI, Delaware, Pty) — before they reach the fuzzy match, where a generic word scores ≥ 90 against another company's SPA (`(Holding)` against `SP Holding LTD`). Query O, `carta-portfolio-rights/references/portfolio-rights.sql` and the `carta-co-investors` page carry the same expression; `test_former_name_expression_matches_the_mode_b_audit` fails when one drifts. The name strip, legal-suffix list and alias legs around it are copied the same way: `carta-co-investors` (`references/artifact.html` `SPA_CTE` and the Mode B queries in its SKILL.md), `carta-portfolio-rights/references/portfolio-rights.sql` and this skill's Query A and artifact. Change one and change all; `test_company_name_matching_fragments_are_in_every_copy` and `test_company_name_matching_fragments_are_in_every_name_matching_copy` fail when one drifts; `tests/carta-investors/spa_audit_parity.py` ports the suffix step to Python, and `test_parity_script_suffix_step_is_the_sql_suffix_step` pins it.

> **CRITICAL — fetch ONCE; never re-issue this query with a different `offset`.** A single fetch with `limit: 1000` covers any real portfolio — the query returns one row per company the firm holds, SAFEs and fund positions included, and active multi-fund firms reach 500. Do **not** re-run this query for "later pages." Reason: when the model re-types this ~1,500-char SQL for a second call it reliably corrupts a token — the embedded firm UUID drifts (e.g. `…8af6…` → `…8ad6…`), or a JOIN key changes (`d.DOCUMENT_ID` → `s.DOCUMENT_ID`), silently dropping rows or failing the call. One fetch means the SQL is authored exactly once and this whole class of error cannot happen.
>
> **If the row count ever exceeds 1000** (flag it as a data anomaly rather than paginating): raise `limit` in the same single call. Never add `offset` pages.

Replace `<firm_id>` with the firm id from Step 1.

```
read_tool({"name": "dwh__execute__query", "arguments": {
  "sql": "WITH spa_issuers AS (SELECT ISSUER_NAME, EXECUTED_BY_ISSUER FROM (SELECT CASE WHEN TYPEOF(RAW_JSON:company:name) = 'OBJECT' AND RAW_JSON:company:name:value::STRING IS NOT NULL THEN RAW_JSON:company:name:value::STRING WHEN TYPEOF(RAW_JSON:company:name) = 'VARCHAR' THEN RAW_JSON:company:name::STRING ELSE ATTRIBUTES:name::STRING END AS ISSUER_NAME, CASE WHEN TYPEOF(RAW_JSON:company:executed_by_issuer) = 'OBJECT' AND TRY_TO_BOOLEAN(RAW_JSON:company:executed_by_issuer:value::VARCHAR) IS NOT NULL THEN TRY_TO_BOOLEAN(RAW_JSON:company:executed_by_issuer:value::VARCHAR) WHEN TYPEOF(RAW_JSON:company:executed_by_issuer) = 'BOOLEAN' THEN TRY_TO_BOOLEAN(RAW_JSON:company:executed_by_issuer::VARCHAR) ELSE ATTRIBUTES:executed_by_issuer::BOOLEAN END AS EXECUTED_BY_ISSUER FROM FUND_ADMIN.DOCUMENT_AI_RECORD WHERE FIRM_ID = '<firm_id>' AND DOCUMENT_TYPE = 'stock_purchase_agreement' AND RECORD_TYPE = 'company') WHERE ISSUER_NAME IS NOT NULL), norm_spa AS (SELECT ISSUER_NAME AS spa_name, TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(UPPER(ISSUER_NAME), ' *[(][^)]*[)].*$', '')), ' +(D[.]?/?B[.]?/?A[.]?|F[.]?/?K[.]?/?A[.]?|N[.]?/?K[.]?/?A[.]?|A[.]?K[.]?A[.]?|FORMERLY( +KNOWN +AS)?) +.*$', '')), '([ ,]+(INCORPORATED|INC|LLC|LTD|LIMITED|CORPORATION|CORP|L[.]P[.]|LLP|LP|PBC|PLC|CO[.]?|HOLDINGS? +COMPANY|HOLDINGS?|TECHNOLOGIES|TECHNOLOGY|TECH)[.]?)+ *$', '')), '[,.]', '')) AS name_norm, MAX(CASE WHEN EXECUTED_BY_ISSUER = TRUE THEN 1 ELSE 0 END) AS has_executed_spa FROM spa_issuers GROUP BY ISSUER_NAME), norm_investments_base AS (SELECT ISSUER_NAME, MAX(CASE WHEN ASSET_CLASS_TYPE = 'PREFERRED_EQUITY' THEN 1 ELSE 0 END) AS has_preferred, MAX(CASE WHEN ASSET_CLASS_TYPE = 'COMMON_EQUITY' THEN 1 ELSE 0 END) AS has_common, MIN(INVESTMENT_DATE) AS first_invested, SUM(CASE WHEN IS_FOREIGN_CURRENCY_INVESTMENT THEN BASE_CURRENCY_TOTAL_COST ELSE TOTAL_COST END) AS total_cost_basis, COUNT(DISTINCT CURRENCY_CODE) AS currency_count, MAX(CURRENCY_CODE) AS currency_code, TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(UPPER(ISSUER_NAME), ' *[(][^)]*[)].*$', '')), ' +(D[.]?/?B[.]?/?A[.]?|F[.]?/?K[.]?/?A[.]?|N[.]?/?K[.]?/?A[.]?|A[.]?K[.]?A[.]?|FORMERLY( +KNOWN +AS)?) +.*$', '')), '([ ,]+(INCORPORATED|INC|LLC|LTD|LIMITED|CORPORATION|CORP|L[.]P[.]|LLP|LP|PBC|PLC|CO[.]?|HOLDINGS? +COMPANY|HOLDINGS?|TECHNOLOGIES|TECHNOLOGY|TECH)[.]?)+ *$', '')), '[,.]', '')) AS name_norm, COALESCE(REGEXP_SUBSTR(ISSUER_NAME, '[(] *(D[.]?/?B[.]?/?A[.]?|F[.]?/?K[.]?/?A[.]?|N[.]?/?K[.]?/?A[.]?|A[.]?K[.]?A[.]?|FORMERLY( +KNOWN +AS)?)[ :]+([^)]+)[)]', 1, 1, 'ie', 3), IFF(REGEXP_LIKE(UPPER(TRIM(REGEXP_SUBSTR(ISSUER_NAME, '[(]([^)]+)[)]', 1, 1, 'e', 1))), '(.{0,2}|[0-9].*|SERIES.*|.*COMPANY|HELD .*|INVESTMENT .*|HOLDINGS?|GROUP|CAYMAN|BVI|PTY|DELAWARE|OFFSHORE|ONSHORE|FEEDER)'), NULL, REGEXP_SUBSTR(ISSUER_NAME, '[(]([^)]+)[)]', 1, 1, 'e', 1)), REGEXP_SUBSTR(ISSUER_NAME, '[ ,]+(D[.]?/?B[.]?/?A[.]?|F[.]?/?K[.]?/?A[.]?|N[.]?/?K[.]?/?A[.]?|A[.]?K[.]?A[.]?|FORMERLY( +KNOWN +AS)?)[ :]+([^(]+)', 1, 1, 'ie', 3)) AS alias_raw FROM FUND_ADMIN.AGGREGATE_INVESTMENTS WHERE FIRM_ID = '<firm_id>' GROUP BY ISSUER_NAME), norm_investments AS (SELECT ISSUER_NAME, has_preferred, has_common, first_invested, total_cost_basis, currency_count, currency_code, name_norm, 0 AS is_alias FROM norm_investments_base UNION ALL SELECT ISSUER_NAME, has_preferred, has_common, first_invested, total_cost_basis, currency_count, currency_code, TRIM(REGEXP_REPLACE(TRIM(REGEXP_REPLACE(UPPER(alias_raw), '([ ,]+(INCORPORATED|INC|LLC|LTD|LIMITED|CORPORATION|CORP|L[.]P[.]|LLP|LP|PBC|PLC|CO[.]?|HOLDINGS? +COMPANY|HOLDINGS?|TECHNOLOGIES|TECHNOLOGY|TECH)[.]?)+ *$', '')), '[,.]', '')) AS name_norm, 1 AS is_alias FROM norm_investments_base WHERE alias_raw IS NOT NULL AND TRIM(alias_raw) <> ''), fuzzy_matched AS (SELECT i.ISSUER_NAME, i.has_preferred, i.has_common, i.first_invested, i.total_cost_basis, i.currency_count, i.currency_code, s.spa_name, s.has_executed_spa, ROW_NUMBER() OVER (PARTITION BY i.ISSUER_NAME ORDER BY JAROWINKLER_SIMILARITY(i.name_norm, s.name_norm) DESC NULLS LAST, s.has_executed_spa DESC, i.is_alias, s.spa_name) AS rn FROM norm_investments i LEFT JOIN norm_spa s ON JAROWINKLER_SIMILARITY(i.name_norm, s.name_norm) >= 90), best AS (SELECT * FROM fuzzy_matched WHERE rn = 1), labeled AS (SELECT CASE WHEN has_preferred = 0 AND has_common = 0 THEN '4. No SPA needed' WHEN spa_name IS NULL THEN '1. Missing SPA' WHEN has_executed_spa = 0 THEN '2. SPA not executed' ELSE '3. Executed SPA' END AS spa_bucket, ISSUER_NAME AS company, spa_name, first_invested, total_cost_basis, currency_count, currency_code FROM best) SELECT spa_bucket, company, spa_name, first_invested, total_cost_basis, currency_count, currency_code FROM labeled ORDER BY spa_bucket, total_cost_basis DESC NULLS LAST, company",
  "limit": 1000
}})
```

### Coverage queries (run in parallel with the main query)

```
read_tool({"name": "dwh__execute__query", "arguments": {
  "sql": "SELECT COUNT(DISTINCT ISSUER_NAME) AS spa_companies FROM (SELECT CASE WHEN TYPEOF(RAW_JSON:company:name) = 'OBJECT' AND RAW_JSON:company:name:value::STRING IS NOT NULL THEN RAW_JSON:company:name:value::STRING WHEN TYPEOF(RAW_JSON:company:name) = 'VARCHAR' THEN RAW_JSON:company:name::STRING ELSE ATTRIBUTES:name::STRING END AS ISSUER_NAME FROM FUND_ADMIN.DOCUMENT_AI_RECORD WHERE FIRM_ID = '<firm_id>' AND DOCUMENT_TYPE = 'stock_purchase_agreement' AND RECORD_TYPE = 'company') WHERE ISSUER_NAME IS NOT NULL"
}})

read_tool({"name": "dwh__execute__query", "arguments": {
  "sql": "SELECT COUNT(DISTINCT ISSUER_NAME) AS total_companies FROM FUND_ADMIN.AGGREGATE_INVESTMENTS WHERE FIRM_ID = '<firm_id>'"
}})
```

If any query fails with a table-not-found error, call `read_tool({"name": "dwh__list__tables", "arguments": {}})` to confirm available table names, then retry.

**Bucket definitions:**
- **1. Missing SPA** — holds equity (preferred or common) but no SPA document found in Carta
- **2. SPA not executed** — SPA uploaded but `EXECUTED_BY_ISSUER = FALSE` on all documents for that issuer
- **3. Executed SPA** — at least one SPA with `EXECUTED_BY_ISSUER = TRUE`
- **4. No SPA needed** — no preferred or common equity (SAFE-only, convertible debt, fund investment, warrants, tokens, etc.)

Tell the user: `SPA data loaded. Building your coverage report…`

### Step B1.5: Write cache

After both queries return, assemble a cache payload and write it to `<WORKSPACE>/carta-spa-audit-data.json` so a re-invocation within 60 minutes can skip the live fetch (Step B0).

Cache schema:

```json
{
  "meta": {
    "firmId": "<firm_id>",
    "firmName": "<firm_name>",
    "firmCartaId": <org_pk>,
    "generatedAt": "<UTC ISO 8601 timestamp>"
  },
  "coverage": {
    "totalCompanies": <Y>,
    "spaCompanies": <X>
  },
  "buckets": {
    "missing":     [{"company": "...", "firstInvested": "YYYY-MM-DD", "costBasis": <number>, "currency": "<currency_code, or null when currency_count is not 1>"}, ...],
    "unexecuted":  [...],
    "executed":    [...],
    "notNeeded":   [...]
  }
}
```

Use `Write` to write the JSON. Group the main audit query's rows by `spa_bucket` into the four bucket arrays. Store `currency` as the row's `currency_code` when `currency_count` is 1, otherwise null. Drill-down data is NOT cached (always fetched live in Step B2 follow-ups).

---

### Step B2: Present results

> **Checkpoint**: Call `mcp__<SERVER>__skill_checkpoint(skill_name="carta-investors:carta-spa-audit", checkpoint_label="data_fetched")` once the audit data is in hand, whether Step B1 fetched it or Step B0 read it from the cache.

**BLUF lead:** One sentence with the coverage fraction and bucket breakdown before the tables.

> "**X** of your **Y** priced-equity portfolio companies have an SPA on file. Of those equity investments: **A** are missing an SPA entirely, **B** have executed SPAs on file, and **C** have an SPA uploaded but not yet executed. **Z** additional investment(s) don't need an SPA (SAFEs, convertible notes, fund/LP positions, tokens, warrants)."

> **Y is priced-equity only.** Count investments in the Executed / Unexecuted / Missing buckets — exclude "No SPA needed" from the denominator. That bucket surfaces in its own sub-table as an FYI. This keeps the co-investor skill and the SPA-audit skill reporting the same coverage % for the same firm.

Then present **four separate sub-tables** — one per bucket, in priority order, each with its own heading. Do not combine into one flat table.

**Formatting rules (all tables):**
- Cost basis: `X,XXX,XXX <currency_code>` with commas, no cents (e.g. `30,534,806 USD`, `28,080,000,000 IDR`). Write `Multiple currencies` when `currency_count` > 1, and append `*` with the footnote `* currency not recorded` when the code is null. Never prefix `$`, and never add or compare amounts in different currencies
- Dates: `Mmm yyyy` (e.g. "Dec 2017") — month-level is intentional for first invested
- `#` column for row references — does not count toward the 6-column limit
- Never show raw UUIDs
- Sort each sub-table by `total_cost_basis DESC` when rendering — filter rows by their `spa_bucket` value and sort within that bucket, regardless of the order rows arrived from the query. Sort the companies in the currency most companies share first, then the rest grouped by currency code, each group by cost basis — never rank an amount against one in another currency
- Within actionable buckets, insert a `— Exited / written-off positions —` divider row between the last entry with cost basis above 0 and the first with 0
- **Fuzzy-match footnote:** if any company was matched to its SPA via Jaro-Winkler similarity (not an exact name match), append `*` to that company name and add a footnote below the table: `* matched via name similarity`

---

#### ❌ Missing SPA — A companies

Show all rows individually — each represents a gap to remediate.

| # | Company | First invested | Cost basis |
|---|---------|---------------|----------:|
| 1 | Acme Holdings, Inc. | Nov 2017 | 30,534,806 USD |

---

#### ⚠ SPA not executed — C companies

SPA is on file but needs the issuer's signature.

| # | Company | First invested | Cost basis |
|---|---------|---------------|----------:|
| 1 | PortCo Beta, Inc. | Dec 2017 | 52,405,204 USD |

---

#### ✅ Executed SPA — B companies

| # | Company | First invested | Cost basis |
|---|---------|---------------|----------:|
| 1 | Greenfield Tech, Inc. | Aug 2021 | 24,515,309 USD |

---

#### — No SPA needed — W companies

| # | Company | First invested | Cost basis |
|---|---------|---------------|----------:|
| 1 | Example Co., Inc. | Jul 2023 | 1,500,000 USD |

---

**After all four sections,** add the document library link and flag the two highest-priority gaps:

> [View all SPA documents in Carta](<base_url>/investors/firm/<org_pk>/portfolio/documents/)

• Largest cost-basis position in bucket 1 (missing SPA) — biggest blind spot, no document on file
• Largest cost-basis position in bucket 2 (unexecuted SPA) — most urgent to chase for signature

Pick each largest position only among companies in the currency most companies share.

---

### Step B3: Offer next steps

```python
AskUserQuestion(
    questions=[{
        "question": "What would you like to do next?",
        "header": "Next step",
        "multiSelect": False,
        "options": [
            {"label": "Drill into a company", "description": "See all SPA documents on file for a specific portfolio company."},
            {"label": "Show only gaps", "description": "List companies with missing or unexecuted SPAs only, sorted by cost basis."},
            {"label": "Run co-investor analysis", "description": "Hand off to the carta-co-investors skill — it uses the same SPA data to surface who else invested alongside you in your portfolio companies."},
            {"label": "Done — no further action", "description": "Return to chat."},
        ],
    }]
)
```

If the user picks "Drill into a company," continue with the drill-down in `<plugin_root>/skills/carta-spa-audit/references/drill-down.md` (read it by that exact path; do not search for it). If they pick "Show only gaps," re-render Step B2 with only buckets 1 and 2. If they pick "Run co-investor analysis," hand off to `carta-co-investors` (do not re-fetch — the SPA data is already cached at `<WORKSPACE>`).

> **Checkpoint**: Call `mcp__<SERVER>__skill_checkpoint(skill_name="carta-investors:carta-spa-audit", checkpoint_label="skill_finished")` after showing the next-step question.

**Suggested next step after presenting the audit.** Always append, in plain text after Step B2 and before the AskUserQuestion: *"To close any coverage gap, drop missing or signed SPAs into this chat and I'll add them to your firm's Documents page, or [upload them in Carta](\<base_url>/investors/firm/\<org_pk>/portfolio/documents/). Uploaded SPAs unlock co-investor analysis and more downstream skills."*
