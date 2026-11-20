# Fund terms & LPAs — Mode B text fallback (Steps B0–B3)

carta-lpa-audit's SKILL.md sends you here only when Mode B runs. Everything this file names that it does not contain (Step 1, Step 2, Mode A and its steps, Step B4, the Drill-down, the Amounts and Null values rules, Caveats and the note at the top about files that can't be found) is in SKILL.md, wherever this file says it sits. `<plugin_root>` is the plugin root that SKILL.md names: write it out in full in every command below, since the shell does not set `CLAUDE_PLUGIN_ROOT` and `allowed-tools` matches the command text.

### Step B0: Resolve workspace and check cache

Before fetching anything, resolve a stable, cross-platform working directory, `<WORKSPACE>`, where the audit cache lives. Run each command below as its own Bash call, exactly as written: each matches an `allowed-tools` entry, and a shell variable does not survive from one Bash call to the next, so write the resolved path into later commands literally.

1. `test -d "$HOME/mnt/outputs"` — succeeds in the Cowork sandbox, where `mnt/outputs/` under the session root is the folder the host can read too. `<WORKSPACE>` is that folder (expand `$HOME` with `pwd` if needed) plus `/carta-lpa-audit`.
2. Otherwise `command -v carta` — succeeds on a Claude Code laptop. Run `carta workspace cache carta-lpa-audit`; it prints a quoted path, which is `<WORKSPACE>` without the quotes.
3. Otherwise `<WORKSPACE>` is `<CWD>/carta-lpa-audit`, with `<CWD>` from `pwd`.

Then create it:

```bash
mkdir -p "<WORKSPACE>"
```

Do not hardcode `/tmp` — it breaks on Windows and is invisible to the Cowork host on macOS 26.5+.

**Cache check:**

```bash
date +%s && date -r "<WORKSPACE>/carta-lpa-audit-data.json" +%s
```

The cache is fresh when the two printed numbers differ by less than 3600. If the second command fails, there is no cache.

If the cache is fresh AND the cached `firmId` matches `<firm_id>`:
1. `Read` `<WORKSPACE>/carta-lpa-audit-data.json`.
2. Run `date -r "<WORKSPACE>/carta-lpa-audit-data.json" +%H:%M` and tell the user: `Using cached LPA data from <that time>. Preparing results…`
3. Skip B1, go to B2.

**Fall through to Step B1 (live fetch)** when the cache is absent, stale, or belongs to a different firm.

### Step B1: Fetch LPA data

**Fire three queries in parallel — issue all three `read_tool` calls in the SAME assistant turn.** Each is a single high-limit fetch — never paginate. Capture each `saved to …` path and check it from bash, as Response resolution below says.

> **CRITICAL — fetch ONCE per query; never re-issue with a different `offset`.** Re-typing the SQL for "page 2" reliably corrupts a token silently.

> **CRITICAL — always include the `FIRM_ID` WHERE clause below.** Without it Query T returns every firm's LPA rows, Query O every firm's operating-agreement rows and Query L every firm's side-letter rows, which is the tenant boundary. So an unscoped query is a data-exposure incident, not just a bug.

**Firm-scoping — how it works.** Every query scopes on `FIRM_ID = '<firm_id>'` and nothing else. `FIRM_ID` is constant across every row of an extraction, so a flat `WHERE` returns whole extractions — no sub-select is needed to pull the sibling rows in.

> **Do not add a second scoping leg.** Extractions still stamped with the `'fund_admin'` placeholder instead of a firm UUID (about one in ten — see Caveats) belong to no firm and are invisible to every one of them. That is a deliberate trade for real tenant scoping, and reaching them means matching extracted fund *names* against the firm's fund list in SQL — which scopes on text lifted out of a document rather than on the firm key, so it hands a firm any unattributed extraction whose fund name happens to resemble one of theirs, including another firm's.

**Query T — LPA extraction rows (ndjson):** every row for the LPAs belonging to this firm. `DOCUMENT_CURRENCY_CODE` is a per-extraction `COALESCE` over `RAW_JSON:...:currency_code` siblings (a small share populated). The pruned `RAW_JSON` also carries the free-form `currency` string, which `process.py` trusts only when it is exactly a three-letter ISO code. Both the bare and `extraction.`-prefixed shapes are tried since one extractor version wraps the whole payload a level deeper; see Caveats. `RAW_JSON` comes back pruned to the paths `process.py` reads (`OBJECT_CONSTRUCT` over `COALESCE(RAW_JSON:extraction, RAW_JSON)`, each leaf reduced to its envelope's `value`, each array to the fields read) and windowed to the extraction's first row (`ROW_NUMBER() OVER (PARTITION BY EXTRACTION_ID ORDER BY RECORD_INDEX) = 1`, `NULL` on every other row) — `process.py` reads it (envelope-aware) as the only source for the fund/GP/LP/terms fields; see "RAW_JSON as the source" below and Caveats for why both the pruning and the windowing are load-bearing.

```
read_tool({"name": "dwh__execute__query", "arguments": {
  "format": "ndjson",
  "limit": 50000,
  "response_mode": "inline",
  "sql": "SELECT DOCUMENT_ID, EXTRACTION_ID, RECORD_TYPE, KIND, RECORD_INDEX, IFF(ROW_NUMBER() OVER (PARTITION BY EXTRACTION_ID ORDER BY RECORD_INDEX) = 1 AND RJ IS NOT NULL, OBJECT_CONSTRUCT('currency', COALESCE(RJ:currency:value, RJ:currency), 'fund_info', OBJECT_CONSTRUCT('fund_name', COALESCE(RJ:fund_info:fund_name:value, RJ:fund_info:fund_name), 'state_of_formation', COALESCE(RJ:fund_info:state_of_formation:value, RJ:fund_info:state_of_formation), 'lpa_date', COALESCE(RJ:fund_info:lpa_date:value, RJ:fund_info:lpa_date), 'master_series', COALESCE(RJ:fund_info:master_series:value, RJ:fund_info:master_series), 'fund_purpose', COALESCE(RJ:fund_info:fund_purpose:value, RJ:fund_info:fund_purpose), 'registered_agent_name', COALESCE(RJ:fund_info:registered_agent_name:value, RJ:fund_info:registered_agent_name), 'principal_office_address', COALESCE(RJ:fund_info:principal_office_address:value, RJ:fund_info:principal_office_address)), 'document_metadata', OBJECT_CONSTRUCT('governing_law', COALESCE(RJ:document_metadata:governing_law:value, RJ:document_metadata:governing_law), 'document_variant', COALESCE(RJ:document_metadata:document_variant:value, RJ:document_metadata:document_variant), 'amendment_number', COALESCE(RJ:document_metadata:amendment_number:value, RJ:document_metadata:amendment_number)), 'parties', OBJECT_CONSTRUCT('general_partner', OBJECT_CONSTRUCT('name', COALESCE(RJ:parties:general_partner:name:value, RJ:parties:general_partner:name), 'entity_type', COALESCE(RJ:parties:general_partner:entity_type:value, RJ:parties:general_partner:entity_type), 'state_of_formation', COALESCE(RJ:parties:general_partner:state_of_formation:value, RJ:parties:general_partner:state_of_formation), 'commitment_amount', COALESCE(RJ:parties:general_partner:commitment_amount:value, RJ:parties:general_partner:commitment_amount), 'commitment_percentage', COALESCE(RJ:parties:general_partner:commitment_percentage:value, RJ:parties:general_partner:commitment_percentage), 'commitment_formula', COALESCE(RJ:parties:general_partner:commitment_formula:value, RJ:parties:general_partner:commitment_formula), 'address', COALESCE(RJ:parties:general_partner:address:value, RJ:parties:general_partner:address), 'members', TRANSFORM(RJ:parties:general_partner:members, x VARIANT -> OBJECT_CONSTRUCT('name', COALESCE(x:name:value, x:name)))), 'initial_limited_partner', COALESCE(RJ:parties:initial_limited_partner:value, RJ:parties:initial_limited_partner), 'limited_partners', TRANSFORM(RJ:parties:limited_partners, x VARIANT -> OBJECT_CONSTRUCT('name', COALESCE(x:name:value, x:name), 'entity_type', COALESCE(x:entity_type:value, x:entity_type), 'commitment_amount', COALESCE(x:commitment_amount:value, x:commitment_amount), 'percentage_interest', COALESCE(x:percentage_interest:value, x:percentage_interest), 'address', COALESCE(x:address:value, x:address)))), 'carried_interest', OBJECT_CONSTRUCT('carried_interest_rate', COALESCE(RJ:carried_interest:carried_interest_rate:value, RJ:carried_interest:carried_interest_rate), 'preferred_return_rate', COALESCE(RJ:carried_interest:preferred_return_rate:value, RJ:carried_interest:preferred_return_rate), 'preferred_return_multiple', COALESCE(RJ:carried_interest:preferred_return_multiple:value, RJ:carried_interest:preferred_return_multiple), 'distribution_waterfall_type', COALESCE(RJ:carried_interest:distribution_waterfall_type:value, RJ:carried_interest:distribution_waterfall_type), 'waterfall_tiers', TRANSFORM(RJ:carried_interest:waterfall_tiers, x VARIANT -> OBJECT_CONSTRUCT('kind', COALESCE(x:kind:value, x:kind), 'percentage_to_gp', COALESCE(x:percentage_to_gp:value, x:percentage_to_gp)))), 'management_fee', OBJECT_CONSTRUCT('pays_management_fee', COALESCE(RJ:management_fee:pays_management_fee:value, RJ:management_fee:pays_management_fee), 'management_fee_rate_investment_period', COALESCE(RJ:management_fee:management_fee_rate_investment_period:value, RJ:management_fee:management_fee_rate_investment_period), 'management_fee_rate_post_investment', COALESCE(RJ:management_fee:management_fee_rate_post_investment:value, RJ:management_fee:management_fee_rate_post_investment), 'management_fee_basis_investment_period', COALESCE(RJ:management_fee:management_fee_basis_investment_period:value, RJ:management_fee:management_fee_basis_investment_period), 'management_fee_basis_post_investment', COALESCE(RJ:management_fee:management_fee_basis_post_investment:value, RJ:management_fee:management_fee_basis_post_investment)), 'fund_terms', OBJECT_CONSTRUCT('fund_term_years', COALESCE(RJ:fund_terms:fund_term_years:value, RJ:fund_terms:fund_term_years), 'investment_period_years', COALESCE(RJ:fund_terms:investment_period_years:value, RJ:fund_terms:investment_period_years), 'initial_closing_date', COALESCE(RJ:fund_terms:initial_closing_date:value, RJ:fund_terms:initial_closing_date)), 'capital_provisions', OBJECT_CONSTRUCT('capital_call_notice_days', COALESCE(RJ:capital_provisions:capital_call_notice_days:value, RJ:capital_provisions:capital_call_notice_days))), NULL) AS RAW_JSON, BOUNDING_BOXES, CREATED_AT, COALESCE(NULLIF(RAW_JSON:fund_size:gp_commitment_amount:currency_code::VARCHAR, 'null'), NULLIF(RAW_JSON:extraction:fund_size:gp_commitment_amount:currency_code::VARCHAR, 'null'), NULLIF(RAW_JSON:fund_size:target_fund_size:currency_code::VARCHAR, 'null'), NULLIF(RAW_JSON:extraction:fund_size:target_fund_size:currency_code::VARCHAR, 'null'), NULLIF(RAW_JSON:fund_size:minimum_lp_commitment:currency_code::VARCHAR, 'null'), NULLIF(RAW_JSON:extraction:fund_size:minimum_lp_commitment:currency_code::VARCHAR, 'null'), NULLIF(RAW_JSON:parties:limited_partners[0]:commitment_amount:currency_code::VARCHAR, 'null'), NULLIF(RAW_JSON:extraction:parties:limited_partners[0]:commitment_amount:currency_code::VARCHAR, 'null')) AS DOCUMENT_CURRENCY_CODE FROM (SELECT DOCUMENT_ID, EXTRACTION_ID, RECORD_TYPE, KIND, RECORD_INDEX, RAW_JSON, BOUNDING_BOXES, CREATED_AT, COALESCE(RAW_JSON:extraction, RAW_JSON) AS RJ FROM FUND_ADMIN.DOCUMENT_AI_RECORD WHERE DOCUMENT_TYPE = 'limited_partnership_agreement' AND FIRM_ID = '<firm_id>') ORDER BY DOCUMENT_ID, EXTRACTION_ID, RECORD_INDEX"
}})
```

**Query O — operating agreement rows (ndjson):** the same projection as Query T under `DOCUMENT_TYPE = 'operating_agreement'`. An LLC vehicle's governing document runs through the LPA extractor and writes the same record types, so `process.py` assembles both together. It is its own query, not an `IN` list, so each response stays under the connector's size cap.

```
call_tool({"name": "dwh__execute__query", "arguments": {
  "format": "ndjson",
  "limit": 50000,
  "response_mode": "inline",
  "sql": "SELECT DOCUMENT_ID, EXTRACTION_ID, RECORD_TYPE, KIND, RECORD_INDEX, IFF(ROW_NUMBER() OVER (PARTITION BY EXTRACTION_ID ORDER BY RECORD_INDEX) = 1 AND RJ IS NOT NULL, OBJECT_CONSTRUCT('currency', COALESCE(RJ:currency:value, RJ:currency), 'fund_info', OBJECT_CONSTRUCT('fund_name', COALESCE(RJ:fund_info:fund_name:value, RJ:fund_info:fund_name), 'state_of_formation', COALESCE(RJ:fund_info:state_of_formation:value, RJ:fund_info:state_of_formation), 'lpa_date', COALESCE(RJ:fund_info:lpa_date:value, RJ:fund_info:lpa_date), 'master_series', COALESCE(RJ:fund_info:master_series:value, RJ:fund_info:master_series), 'fund_purpose', COALESCE(RJ:fund_info:fund_purpose:value, RJ:fund_info:fund_purpose), 'registered_agent_name', COALESCE(RJ:fund_info:registered_agent_name:value, RJ:fund_info:registered_agent_name), 'principal_office_address', COALESCE(RJ:fund_info:principal_office_address:value, RJ:fund_info:principal_office_address)), 'document_metadata', OBJECT_CONSTRUCT('governing_law', COALESCE(RJ:document_metadata:governing_law:value, RJ:document_metadata:governing_law), 'document_variant', COALESCE(RJ:document_metadata:document_variant:value, RJ:document_metadata:document_variant), 'amendment_number', COALESCE(RJ:document_metadata:amendment_number:value, RJ:document_metadata:amendment_number)), 'parties', OBJECT_CONSTRUCT('general_partner', OBJECT_CONSTRUCT('name', COALESCE(RJ:parties:general_partner:name:value, RJ:parties:general_partner:name), 'entity_type', COALESCE(RJ:parties:general_partner:entity_type:value, RJ:parties:general_partner:entity_type), 'state_of_formation', COALESCE(RJ:parties:general_partner:state_of_formation:value, RJ:parties:general_partner:state_of_formation), 'commitment_amount', COALESCE(RJ:parties:general_partner:commitment_amount:value, RJ:parties:general_partner:commitment_amount), 'commitment_percentage', COALESCE(RJ:parties:general_partner:commitment_percentage:value, RJ:parties:general_partner:commitment_percentage), 'commitment_formula', COALESCE(RJ:parties:general_partner:commitment_formula:value, RJ:parties:general_partner:commitment_formula), 'address', COALESCE(RJ:parties:general_partner:address:value, RJ:parties:general_partner:address), 'members', TRANSFORM(RJ:parties:general_partner:members, x VARIANT -> OBJECT_CONSTRUCT('name', COALESCE(x:name:value, x:name)))), 'initial_limited_partner', COALESCE(RJ:parties:initial_limited_partner:value, RJ:parties:initial_limited_partner), 'limited_partners', TRANSFORM(RJ:parties:limited_partners, x VARIANT -> OBJECT_CONSTRUCT('name', COALESCE(x:name:value, x:name), 'entity_type', COALESCE(x:entity_type:value, x:entity_type), 'commitment_amount', COALESCE(x:commitment_amount:value, x:commitment_amount), 'percentage_interest', COALESCE(x:percentage_interest:value, x:percentage_interest), 'address', COALESCE(x:address:value, x:address)))), 'carried_interest', OBJECT_CONSTRUCT('carried_interest_rate', COALESCE(RJ:carried_interest:carried_interest_rate:value, RJ:carried_interest:carried_interest_rate), 'preferred_return_rate', COALESCE(RJ:carried_interest:preferred_return_rate:value, RJ:carried_interest:preferred_return_rate), 'preferred_return_multiple', COALESCE(RJ:carried_interest:preferred_return_multiple:value, RJ:carried_interest:preferred_return_multiple), 'distribution_waterfall_type', COALESCE(RJ:carried_interest:distribution_waterfall_type:value, RJ:carried_interest:distribution_waterfall_type), 'waterfall_tiers', TRANSFORM(RJ:carried_interest:waterfall_tiers, x VARIANT -> OBJECT_CONSTRUCT('kind', COALESCE(x:kind:value, x:kind), 'percentage_to_gp', COALESCE(x:percentage_to_gp:value, x:percentage_to_gp)))), 'management_fee', OBJECT_CONSTRUCT('pays_management_fee', COALESCE(RJ:management_fee:pays_management_fee:value, RJ:management_fee:pays_management_fee), 'management_fee_rate_investment_period', COALESCE(RJ:management_fee:management_fee_rate_investment_period:value, RJ:management_fee:management_fee_rate_investment_period), 'management_fee_rate_post_investment', COALESCE(RJ:management_fee:management_fee_rate_post_investment:value, RJ:management_fee:management_fee_rate_post_investment), 'management_fee_basis_investment_period', COALESCE(RJ:management_fee:management_fee_basis_investment_period:value, RJ:management_fee:management_fee_basis_investment_period), 'management_fee_basis_post_investment', COALESCE(RJ:management_fee:management_fee_basis_post_investment:value, RJ:management_fee:management_fee_basis_post_investment)), 'fund_terms', OBJECT_CONSTRUCT('fund_term_years', COALESCE(RJ:fund_terms:fund_term_years:value, RJ:fund_terms:fund_term_years), 'investment_period_years', COALESCE(RJ:fund_terms:investment_period_years:value, RJ:fund_terms:investment_period_years), 'initial_closing_date', COALESCE(RJ:fund_terms:initial_closing_date:value, RJ:fund_terms:initial_closing_date)), 'capital_provisions', OBJECT_CONSTRUCT('capital_call_notice_days', COALESCE(RJ:capital_provisions:capital_call_notice_days:value, RJ:capital_provisions:capital_call_notice_days))), NULL) AS RAW_JSON, BOUNDING_BOXES, CREATED_AT, COALESCE(NULLIF(RAW_JSON:fund_size:gp_commitment_amount:currency_code::VARCHAR, 'null'), NULLIF(RAW_JSON:extraction:fund_size:gp_commitment_amount:currency_code::VARCHAR, 'null'), NULLIF(RAW_JSON:fund_size:target_fund_size:currency_code::VARCHAR, 'null'), NULLIF(RAW_JSON:extraction:fund_size:target_fund_size:currency_code::VARCHAR, 'null'), NULLIF(RAW_JSON:fund_size:minimum_lp_commitment:currency_code::VARCHAR, 'null'), NULLIF(RAW_JSON:extraction:fund_size:minimum_lp_commitment:currency_code::VARCHAR, 'null'), NULLIF(RAW_JSON:parties:limited_partners[0]:commitment_amount:currency_code::VARCHAR, 'null'), NULLIF(RAW_JSON:extraction:parties:limited_partners[0]:commitment_amount:currency_code::VARCHAR, 'null')) AS DOCUMENT_CURRENCY_CODE FROM (SELECT DOCUMENT_ID, EXTRACTION_ID, RECORD_TYPE, KIND, RECORD_INDEX, RAW_JSON, BOUNDING_BOXES, CREATED_AT, COALESCE(RAW_JSON:extraction, RAW_JSON) AS RJ FROM FUND_ADMIN.DOCUMENT_AI_RECORD WHERE DOCUMENT_TYPE = 'operating_agreement' AND FIRM_ID = '<firm_id>') ORDER BY DOCUMENT_ID, EXTRACTION_ID, RECORD_INDEX"
}})
```

**Query L — side letter extraction rows (ndjson):** every row for the side letters belonging to this firm. Both roles come back on the same filter — the firm's fund appears as the `fund` entity when it granted the terms and as a `limited_partner` entity when it received them; `process.py` (Step B1.5 below) checks both fields and tags the match with `role`. `DOCUMENT_CURRENCY_CODE` here is the side letter's own `capital_commitment` currency, independent of Query T's.

```
read_tool({"name": "dwh__execute__query", "arguments": {
  "format": "ndjson",
  "limit": 50000,
  "response_mode": "inline",
  "sql": "SELECT DOCUMENT_ID, EXTRACTION_ID, RECORD_TYPE, KIND, RECORD_INDEX, OBJECT_CONSTRUCT('capital_commitment', ATTRIBUTES:capital_commitment, 'economic_provisions', ATTRIBUTES:economic_provisions) AS ATTRIBUTES, IFF(ROW_NUMBER() OVER (PARTITION BY EXTRACTION_ID ORDER BY RECORD_INDEX) = 1 AND RJ IS NOT NULL, OBJECT_CONSTRUCT('issuer_name', COALESCE(RJ:issuer_name:value, RJ:issuer_name), 'executed_by_issuer', COALESCE(RJ:executed_by_issuer:value, RJ:executed_by_issuer), 'has_draft_markings', COALESCE(RJ:has_draft_markings:value, RJ:has_draft_markings), 'has_unfilled_placeholders', COALESCE(RJ:has_unfilled_placeholders:value, RJ:has_unfilled_placeholders), 'side_letters', TRANSFORM(RJ:side_letters, x VARIANT -> OBJECT_CONSTRUCT('investor', COALESCE(x:investor:value, x:investor), 'issue_date', COALESCE(x:issue_date:value, x:issue_date), 'executed_by_investor', COALESCE(x:executed_by_investor:value, x:executed_by_investor), 'complex_management_fee', OBJECT_CONSTRUCT('summary', COALESCE(x:complex_management_fee:summary:value, x:complex_management_fee:summary)), 'complex_carry', OBJECT_CONSTRUCT('summary', COALESCE(x:complex_carry:summary:value, x:complex_carry:summary)), 'mfn_provision', OBJECT_CONSTRUCT('summary', COALESCE(x:mfn_provision:summary:value, x:mfn_provision:summary)), 'excuse_right', OBJECT_CONSTRUCT('summary', COALESCE(x:excuse_right:summary:value, x:excuse_right:summary)), 'transfer_restriction_modification', OBJECT_CONSTRUCT('summary', COALESCE(x:transfer_restriction_modification:summary:value, x:transfer_restriction_modification:summary))))), NULL) AS RAW_JSON, BOUNDING_BOXES, CREATED_AT, COALESCE(NULLIF(RAW_JSON:side_letters[0]:capital_commitment:currency_code::VARCHAR, 'null'), NULLIF(RAW_JSON:extraction:side_letters[0]:capital_commitment:currency_code::VARCHAR, 'null')) AS DOCUMENT_CURRENCY_CODE FROM (SELECT DOCUMENT_ID, EXTRACTION_ID, RECORD_TYPE, KIND, RECORD_INDEX, ATTRIBUTES, RAW_JSON, BOUNDING_BOXES, CREATED_AT, COALESCE(RAW_JSON:extraction, RAW_JSON) AS RJ FROM FUND_ADMIN.DOCUMENT_AI_RECORD WHERE DOCUMENT_TYPE = 'side_letter' AND FIRM_ID = '<firm_id>') ORDER BY DOCUMENT_ID, EXTRACTION_ID, RECORD_INDEX"
}})
```

Substitute `<firm_id>` with the UUID from Step 1 in all three — it is the only placeholder any query takes.

> **`response_mode: "inline"` is load-bearing on both ndjson fetches — do not remove it.** The server infers the delivery shape from `clientInfo.name`, and that name cannot distinguish the Claude Code CLI (which accepts a binary blob) from other runtimes that share the same name but reject the blob with `-32602 invalid_union`. `inline` forces the always-safe plain-string path for every client.

> **`DOCUMENT_TYPE` is load-bearing too.** `DOCUMENT_AI_RECORD` holds every document type, and `RECORD_TYPE` values (`fund`, `limited_partner`, `investor`) are generic labels an SPA and a subscription agreement also use. Dropping the `DOCUMENT_TYPE` filter silently pulls other document types into the audit.

**Every query groups an agreement's rows by `EXTRACTION_ID`, and keeps `DOCUMENT_ID` to link to the source document.** One uploaded document can hold several extractions: Document AI splits a packet into segments, so one file can carry two LPAs, or two side letters, each its own extraction. Grouping on `DOCUMENT_ID` would merge them into one fund with the other agreement's LPs. A re-extraction does not duplicate an agreement, because the view serves only each segment's current extraction.

> **Do not group on `DOCUMENT_ID`.** It crosses agreements whenever a document holds more than one. A test fails if a query windows or orders rows without `EXTRACTION_ID`.

> **Inline vs. offloaded response — handle both; neither branch is dead code.** The median firm returns 7–9 rows / 1–2 KB, which arrives inline in the tool result body (no `saved to` path). When it does, write the raw ndjson text to a temp file under `<WORKSPACE>` (e.g. `<WORKSPACE>/query_t.ndjson`, `query_o.ndjson`, `query_l.ndjson`) so the assembly step below can read it via CLI arg the same way it reads a resolved blob. The distribution has a long tail, though — p90 is ~113–151 rows and the largest firm returns 1,344 rows / 340 KB — so **6 firms today exceed the ~100kb inline cap** and get offloaded to a `tool-results/*.txt` path. Use their saved path once bash can read it (`test -r`). Never assume one path exclusively.

**Response resolution (unified for inline + offloaded).** For each query, determine which path applies:

- **Inline** — the tool result contains the ndjson text directly (no `saved to <path>` marker). Write it to `<WORKSPACE>/query_t.ndjson` (or `query_o.ndjson`, `query_l.ndjson`) using the Write tool. That file is the query's path.
- **Offloaded** — the tool result surfaces a `saved to <path>` line. Check it with its own Bash call, `test -r "<saved path>"`. Bash is what reads the file (`process.py`, below), and the Read tool can open paths bash can't. If the check succeeds, the saved path is the query's path. If it fails, treat the query as not loaded: do not search the disk for the file. In the Cowork sandbox bash can't read the saved path, so a large offloaded result there ends in the reload message below.

Call the three results `<QUERY_T_PATH>`, `<QUERY_O_PATH>` and `<QUERY_L_PATH>`.

If neither the inline write nor the saved path yields a file bash can read, re-run that one query once. Do **not** narrate paths or sandbox mechanics to the user. If it still fails:

> "I couldn't load your LPA data just now. Try running the report again in a moment. If it keeps happening, [contact Carta Support](https://support.carta.com/kb/guide/en/how-to-get-support-with-carta-help-T8DEfuxhi9/Steps/3724508)."

Tell the user: `LPA data loaded. Assembling report…`

**RAW_JSON as the source.** `process.py` (and artifact.html's JS port) reads most fund/GP/LP/terms and side-letter fields from `RAW_JSON`: unwrap a citation envelope (`{value, text, ..., citations[]}`) to its `value`, trying the bare path then the `extraction`-prefixed path, and treat a JSON-null `value` as null. **There is no `ATTRIBUTES` fallback.** document-ai builds `ATTRIBUTES` from the same extraction output, so a field `RAW_JSON` leaves null is null in `ATTRIBUTES` too — verified on production data: across every field below, zero LPA, operating-agreement, or side-letter rows carry an `ATTRIBUTES` value that `RAW_JSON` lacks. Every document a firm-scoped query returns has `RAW_JSON`; the only extractions without one (Jul 6–10 2026) carry the `'fund_admin'` placeholder `FIRM_ID`, which the `FIRM_ID = '<firm_id>'` filter never matches. The rows' `RECORD_TYPE` and `KIND` still decide *which* records exist (an LP row, a `limited_partnership` event row) — just not their field values. The two exceptions are `lpCapitalCommitment` and `economicProvisions`, which have no `RAW_JSON` read path and stay on `ATTRIBUTES`. Query L returns only those two `ATTRIBUTES` keys; Query T and Query O return no `ATTRIBUTES`, because nothing reads it there.

| Field group | `RAW_JSON` path root | Correlated by |
|---|---|---|
| `fund.*` | `fund_info` (`governingLaw` is `document_metadata.governing_law`) | one per extraction |
| `generalPartner.*` | `parties.general_partner` | one per extraction |
| `limitedPartners[].*` | `parties.limited_partners[]` | positional — the Nth `limited_partner` row by `RECORD_INDEX` is the Nth array entry (validated: counts always match). Not by `name`: ~6% of LP rows have no extracted name |
| `terms.*` | `carried_interest` / `management_fee` / `fund_terms` / `capital_provisions` | one per extraction, only when an ATTRIBUTES `limited_partnership` event row exists |
| side letter `issueDate` / `executedByInvestor` / `lpName` / `lpCapitalCommitment` | `side_letters[]` | positional — same index as the ATTRIBUTES event row within its extraction (validated: array size always matches event-row count) |
| side letter `executedByIssuer` / `hasDraftMarkings` / `hasUnfilledPlaceholders` / `fundName` (issuer) | extraction root (`executed_by_issuer`, `has_draft_markings`, `has_unfilled_placeholders`, `issuer_name`) | one per extraction |
| `complexManagementFee` / `complexCarry` / `mfnProvision` / `excuseRight` / `transferRestrictionModification` | `side_letters[].complex_management_fee` / `.complex_carry` / `.mfn_provision` / `.excuse_right` / `.transfer_restriction_modification` (`.summary`) | positional; no `ATTRIBUTES` counterpart. Each renders as a labelled line on the side letter (see Caveats) |

`economic_provisions` is **not** migrated — `RAW_JSON`'s closest analog (`side_letters[].complex_carry`) is a materially different shape (a waterfall-tier structure, not `{provision_type, rate_paid}`), and reshaping one into the other would be new derivation logic, not plumbing. A letter's tiered or IRR-based fee and carry terms are shown from the `summary` sentence of `complex_management_fee` and `complex_carry` instead, never as a rate.

### Step B1.5: Assemble JSON

The firm's fund names (from Step 1's `fa__list__entities` call) are passed in as a JSON array so `process.py` can match them against the extracted LPA fund entity names — the exact same deterministic algorithm Mode A's JS transform ports and validates against, not an approximation.

The script is `<plugin_root>/skills/carta-lpa-audit/scripts/process.py`; do not search for it. Run it on one line, exactly as written below, for the same allowlist reason as Mode A's Step A2c:

```bash
uv run "<plugin_root>/skills/carta-lpa-audit/scripts/process.py" --lpa-rows "<QUERY_T_PATH>" --operating-agreement-rows "<QUERY_O_PATH>" --side-letter-rows "<QUERY_L_PATH>" --firm-id "<firm_id>" --firm-name "<firm_name>" --firm-carta-id <org_pk> --firm-fund-names-file "<CWD>/<firm-slug>-funds.json" --out "<WORKSPACE>/carta-lpa-audit-data.json"
```

If the script file does not exist, follow the note at the top of this skill on plugin files that can't be found.

`<CWD>/<firm-slug>-funds.json` is the same file Mode A's Step 2a writes: every entity from Step 1 as `{"name", "carta_id", "entity_type", "currency"}`. Write it first if Mode A didn't run. It is passed as a file so an apostrophe in a fund name can't break the shell quoting. With `entity_type`, the entities Step 2a describes as never carrying an LPA land in `notAudited` instead of `funds`, by the same rule the page uses.

Output (`carta-lpa-audit-data.json`) lands in `<WORKSPACE>` and doubles as the Mode B cache. This is the exact schema Step B2, the Drill-down section, and Step B4 read from.

- **Exit 0** — proceed.
- **Non-zero exit** — show the script's stderr output to the user and stop.

Tell the user: `LPA data loaded. Building your coverage report…`

### Step B2: Present results

> **Checkpoint**: Call `mcp__<SERVER>__skill_checkpoint(skill_name="carta-investors:carta-lpa-audit", checkpoint_label="data_fetched")` once the LPA data is in hand, whether Step B1 fetched it or Step B0 read it from the cache.

**BLUF lead:** One sentence with the coverage split before the fund sections.

> "**<extracted>** of **<total_funds>** funds have full data · **<vehicle_agreement>** vehicle agreements that state no fee or carry of their own · **<partial>** with partial data · **<parent_agreement>** governed by a parent agreement · **<missing>** missing an LPA · **<name_mismatch>** with a name mismatch · **<no_documents>** with no documents extracted · **<total_side_letters>** side letters granted."

Leave out the vehicle-agreement, parent-agreement, name-mismatch and no-documents clauses when their counts (`coverage.vehicleAgreement`, `coverage.parentAgreement`, `coverage.nameMismatch`, `coverage.noDocuments`) are 0. Never fold either into "missing": a fund whose LPA exists under another name is not a fund without an LPA.

Then present **one section per fund**, sorted by status (full data → vehicle agreement → partial data → governed by parent → name mismatch → missing → no documents) then fund name. Each section is a mini tear-sheet, with the depth of detail scaled to what's extracted.

**Formatting rules:**
- Dates: `Mmm D, yyyy`. Percentages: `X.XX%`. Multiples: `X.XXx` (a hurdle stated as a multiple of capital, `1.60x`). Amounts: `$X,XXX` / `($X,XXX)`-style, using the extraction's `RAW_JSON`-derived currency, else the fund's Carta currency, where known, and rendering the number bare when the currency is unknown (never an assumed `$`) — see the Amounts rule above and Caveats. Null: `—`, except a fee, carry, hurdle, fund term or investment period on a fund whose terms were extracted, which is `Not found` (see Null values above).
- Fund term / investment period: `<N> years`, rounded to one decimal (`10.4 years`). Capital call notice: `<N> days`.
- **Management fee:** `0` means the LPA states no fee is charged — render `No fee (per LPA)`, never `0%` or `None`. When `lpa.mgmtFeeSetOutsideAgreement` is true, the LPA charges a fee but sets its rate in another document: render `Charged; rate set outside the LPA`. Any other missing rate is `Not found` (see Null values above).
- **Fee basis:** In the tear-sheet table use `lpa.terms.mgmtFeeBasisShort` for the investment-period fee and `lpa.terms.mgmtFeeBasisPostInvestmentShort` for the post-investment fee (each the verbatim sentence cut to 60 characters, often commitment then invested capital). Show the full `mgmtFeeBasisInvestmentPeriod` and `mgmtFeeBasisPostInvestment` only in the Drill-down.
- **LP count:** When the fund's roster is empty and it is not `inheritedFromMaster` (an inherited series shows `lpa.limitedPartnerCount`, see below), write `Investors could not be found on the agreement.` instead of `0 LPs`, the same words the page's panel uses.
- **Operating agreements:** An operating agreement keeps the carry it states, as an LLC fund's own governing document. When `lpa.notFundLpa` is true (its stated carry is above 50%, a member profit split rather than fund carry), label the document `Operating agreement, not a fund LPA`; `process.py` has already withheld carry, hurdle and waterfall, so do not infer carry from the document.
- **Document links.** Every `documentId` (on a fund, a parent agreement, an unmatched or received document, a side letter) is the fund-admin document's own id. Link it as `[<label>](<base_url>/investors/firm/<org_pk>/portfolio/documents/<document_id>)`, the document library link below with the id appended.
- **Term checks.** Each entry in `lpa.termFlags` (`{field, reason}`) marks a value outside a sane range — more likely a misread than a real term. Keep the value and append `⚠ Check the LPA — <reason>` to that row, e.g. `| Hurdle | 300.00% ⚠ Check the LPA — above 30%, may be a multiple |`. Never drop or correct the value: an unusual term can be real.

---

#### ✅ Full data

For each fund with full data (`lpaStatus: "EXTRACTED"`):

> **<Fund name>** — [LPA](<document link for documentId>) dated <lpa_date> · <state_of_formation><if lpaMatch == "close": · *Similar name — matched to the LPA for "<lpa.fund.name>"; confirm it's this fund's.*>
>
> | Field | Value |
> |-------|------|
> | Management fee (investment) | <rate>% of <basis> |
> | Management fee (post-investment) | <rate>% of <post-investment basis> |
> | Carry | <rate>%<if carryTierRates: " (tiered)"> |
> | Carry tiers | <carryTierRates joined with " → ", each as <rate>%; omit the row when carryTierRates is null> |
> | Hurdle | <rate>%, <multiple>x, or both as "<rate>% · <multiple>x" |
> | Waterfall | <structure> |
> | Fund term | <N> years |
> | Investment period | <N> years |
> | Capital call notice | <N> days |
>
> **<gp_name>** (<entity_type>) · <lp_count> LPs · <side_letter_count> side letters

If the user wants LP or side letter detail on a specific fund, run the drill-down (below).

---

#### ▫ Vehicle agreements

For each fund with `lpaStatus: "VEHICLE_AGREEMENT"` (a vehicle whose agreement carries no fee, carry, hurdle or waterfall; the rule is in Caveats → *Partial LPAs*). Never call it partial or missing. For each:

> **<Fund name>** — [Vehicle agreement](<document link for documentId>) · Vehicle agreement on file. It states no fee or carry of its own, which is usual for a vehicle that distributes pro rata or takes its economics from the main fund's agreement.<if not lpa.termsExtracted: [Upload the full agreement](<document library link>).> Every vehicle gets this same line.
>
> <a `| Field | Value |` table of only the non-null `lpa.terms` (a `0` fee is `No fee (per LPA)`, capital call notice, fund term); omit the table when every term is null>

---

#### ⚠ Partial data

LPA fund entity was detected but the agreement states none of the terms the table shows (fee, carry, hurdle, fund term, investment period): the terms event row is missing, every term in it is empty, or it states only terms the table does not show, such as a waterfall type or a post-investment fee. For each:

> **<Fund name>** — On file, but the documents state no headline fee, carry, hurdle or fund-term figures
>
> **<gp_name>** (<entity_type>) · <lp_count> LPs · <side_letter_count> side letters

---

#### ◐ Governed by a parent agreement

A series of one LLC whose own agreement is not on file, while the parent LLC's agreement is. Terms sit in each series' own schedule, so none are shown for the series, and it is not counted as missing or as a name mismatch. For each (`parentAgreements` names the parent's agreement):

> **<Fund name>** — Governed by the **[<parentAgreements[0].name>](<document link for parentAgreements[0].documentId>)** agreement. Series-specific terms are not on file.<if side_letter_count > 0: **<N>** side letter<s> on file.>

---

#### ⚠ Name mismatch

For each fund with `lpaStatus: "NAME_MISMATCH"` (an LPA tied between it and a sibling, or an unmatched document could be its: one sharing a word that names this fund rather than the firm or its fund family, its name with one run of words written as initials ("AV" for "Acme Ventures"), either way round, or its fund number when that is 2 or more; a GP or manager entity never counts). `possibleLpaNames` holds those documents' fund names:

> **<Fund name>** — No document carries this name. Its LPA may be filed as **<possibleLpaNames[0]>**<if more than one: (+<N> more)> — check which fund it covers.<if side_letter_count > 0: **<N>** side letter<s> on file even without the LPA.>

Right after the fund sections, list `unmatchedDocuments` (fund name linked to its document · GP name · date) under **Documents that didn't match any fund**, with this line: "A renamed fund is the usual cause. Link by asking your Carta team: send them each document and the fund it belongs to, and they will attach it."

#### ❌ Missing LPAs

For each fund with `lpaStatus: "MISSING"` (the firm has documents, none of them this fund's):

> **<Fund name>** — No LPA on file<if side_letter_count > 0: **<N>** side letter<s> on file even without the LPA.>

#### ➖ No documents

For each fund with `lpaStatus: "NO_DOCUMENTS"` (nothing extracted for the firm at all): list the funds in one line, not one section each:

> *No LPA or operating agreement has been extracted for this firm — <N> funds: <names joined with ", ">.* <if side_letter_count > 0 for any: side letters are on file for <names>.>

---

---

#### Not audited

When `notAudited` is non-empty, one line, not one section per entity:

> *Not audited — <N> entities that are not fund vehicles, by reason (`notAudited[].reason`: entity type, wire instructions, custodial account, trust, duplicate, combined entry, the firm itself): <reason>: <names joined with ", ">; …*

---

#### Received from other managers

When `receivedDocuments` is non-empty, one collapsed line, not a section per document: these are LPAs of other managers' funds whose investor roster names one of the firm's entities, so they are not errors and are not counted in coverage. Other managers' agreements whose roster names none of the firm's entities are not in the data at all: nothing ties them to the firm, so never mention them.

> *<N> agreements received from other managers (not part of this firm's coverage).*

#### Side letters

State the split once: `sideLetterCounts.granted` letters granted by the firm's funds, `received` received as an investor, `unmatched` that name none of the firm's funds (`unmatchedSideLetters`), out of `extracted` rows. `company` letters are a portfolio company's funding round (the issuer is an Inc., Corp., PBC, PLC or Ltd., or a company form used abroad such as AB, AG, GmbH, S.A., B.V. or N.V., whose name has no fund or vehicle word, such as Fund, Capital, Partners, Feeder or Blocker), including one that names a firm fund as its investor; they are on no fund and left out of `unmatchedSideLetters` — mention their count in one clause, never list them. A letter with a named issuer where neither party could be the firm (neither shares a distinctive word with the firm's or its entities' names, nor is one of those names written with initials, "AV Global I SPV" for "Acme Ventures Global I SPV") is another manager's fund and its own investors: it is not in the data at all, `extracted` included, so never mention it. The raw row count is higher than what lands on a fund because duplicate uploads fold together.

#### Inherited series

A fund with `inheritedFromMaster` set shares the agreement of that master fund. Show its terms line, add "inherited from <master>", and do not repeat the LP roster (`lpa.limitedPartnerCount` gives its size).

**After all sections,** say how to add documents:

> To add a missing or full LPA, drop it into this chat and I'll add it to your firm's Documents page, or [view or upload LPA documents in Carta](<base_url>/investors/firm/<org_pk>/portfolio/documents/).

**Side letter note.** Always append once at the end:

> *"Side letter economic provisions are extracted and compared against the fund's own LPA where relevant."*

### Step B3: Offer next steps

```python
AskUserQuestion(
    questions=[{
        "question": "What would you like to do next?",
        "header": "Next step",
        "multiSelect": False,
        "options": [
            {"label": "Drill into a fund", "description": "See the full tear-sheet (terms, LP roster, side letters with LP names + execution status) for a specific fund."},
            {"label": "Show only gaps", "description": "List only funds without an LPA, with partial LPA extractions, or governed by a parent agreement."},
            {"label": "Compare a term across funds", "description": "e.g. compare management fee or carry across every extracted LPA in a single side-by-side table."},
            {"label": "Ask a question about provisions", "description": "Free-text query across every fund's LPA terms and side letter provisions — e.g. 'do any provisions prevent me from investing in defense tech?' or 'which LPs got reduced carry?'"},
            {"label": "Done — no further action", "description": "Return to chat."},
        ],
    }]
)
```

If the user picks "Drill into a fund," continue with the **Drill-down** section below. If they pick "Show only gaps," re-render Step B2 with only the Partial, Governed by a parent agreement, Name mismatch, Missing and No documents sections. If they pick "Compare a term," ask which term (mgmt fee, carry, hurdle, waterfall, term), then render a one-column table with fund name + that term for every extracted fund, applying Step B2's year rounding and term-check suffix to each value. If they pick "Ask a question about provisions," continue with Step B4.

> **Checkpoint**: Call `mcp__<SERVER>__skill_checkpoint(skill_name="carta-investors:carta-lpa-audit", checkpoint_label="skill_finished")` after showing the next-step question.
