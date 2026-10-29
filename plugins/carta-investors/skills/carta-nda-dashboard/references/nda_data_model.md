# NDA document intelligence — data model

Field paths and query rules behind `queries.md`. All data is reached **only through the Carta
MCP** (`read_tool` → `dwh__execute__query`).

## Query rules

1. **Set firm context first, every invocation.** Call `list_contexts`, then `set_context` to
   the firm the user is asking about. The MCP scopes `DOCUMENT_AI_RECORD` and the work-item
   table to the active firm, so no query filters by firm id. Firm context is silently dropped
   when a conversation is compacted or resumed, and a zero-row result from lost context looks
   exactly like a firm with no NDAs — setting context first removes that ambiguity.
2. **Tables:** `FUND_ADMIN.DOCUMENT_AI_RECORD` (filter `document_type = 'nda'`) and
   `FUND_ADMIN.DOCUMENT_ATTRIBUTE_CARTA_LAW_WORK_ITEM`.
3. **Choose the document set with the pre-flight:**
   ```sql
   SELECT COUNT(*) AS wi_count FROM FUND_ADMIN.DOCUMENT_ATTRIBUTE_CARTA_LAW_WORK_ITEM
   ```
   - `wi_count > 0` → **Path A.** The firm tracks NDAs as work items, and a document without
     a work item has been deleted. Inner-join the work items before deduping.
   - `wi_count = 0` → **Path B.** No work items; every NDA record is treated as live.

   Then dedupe to one row per agreement: the same NDA is often uploaded more than once, so
   `QUALIFY ROW_NUMBER() = 1` over the parties, effective date, executed date, term text and governing law.
4. **`LATERAL FLATTEN` is blocked** by the MCP. Use direct VARIANT paths, `CASE`, `IFF`,
   `SUM`, `REGEXP_*` and `GROUP BY` on scalar expressions. `QUALIFY` works.
5. **Aggregate in SQL** — never pull raw rows; responses are capped. Cast every VARIANT path.
6. **A zero-NDA result is not conclusive on the first try.** Extraction can lag behind what the
   Carta app already shows. If the base count returns 0, wait a few seconds and run the same
   queries once more — same queries, same context, same approach — and use only the second
   set of results.
   - Still 0: say plainly that this firm's NDA data isn't available yet and suggest checking
     the Documents view in Carta. Don't speculate about permissions or a broken query.
   - Rows on the retry: carry on, and don't mention the first attempt.

## Field paths (under the `ATTRIBUTES` VARIANT)

Each leaf is a wrapper object; read the scalar at `...:value`. **Party fields are double-wrapped**
(`party:name:value`).

| What | Path |
|---|---|
| Disclosing party name | `attributes:metadata:disclosing_party:name:value::string` |
| Receiving party name | `attributes:metadata:receiving_party:name:value::string` |
| Effective date (the date it says it takes effect) | `TRY_TO_DATE(attributes:metadata:effective_date:value::string)` |
| Executed date (signature evidence only) | `TRY_TO_DATE(attributes:metadata:executed_date:value::string)` |
| Initial term — number | `TRY_TO_NUMBER(attributes:term:initial_term:value::string)` |
| Initial term — unit (`year` / `month` / `day`) | `attributes:term:initial_term:unit::string` |
| Initial term — display text ("2 years") | `attributes:term:initial_term:text::string` |
| Governing law | `attributes:governing:governing_law:value::string` |

### Provisions

Most provisions carry a `present` flag; non-circumvention is a flat boolean. **Null means the
clause is absent, not that extraction failed**, so wrap every flag in `COALESCE(..., FALSE)`.

| Provision | Path |
|---|---|
| Non-solicitation | `attributes:transaction:non_solicitation:present:value` |
| Contact restrictions (no-contact) | `attributes:transaction:contact_restrictions:present:value` |
| Standstill | `attributes:transaction:standstill:present:value` |
| Portfolio-company exclusion | `attributes:portfolio_company_exclusion:present:value` |
| Non-circumvention | `attributes:specialized:non_circumvention:value` |
| Information barriers | `attributes:information_barriers:present:value` |

## Counterparty

An NDA names two parties; the counterparty is whichever is **not** the firm, and the firm sits
on either side. Pick by the firm token: the distinctive core of the firm's name, lower-cased,
with entity suffixes (LLC, LP, Ltd, Partners, Management, Capital, Advisors, Inc) and any
parenthetical dropped ("Acme Capital Partners, LP" → `acme`). A party with no name shows as `Unknown`, never a blank row.

## Term and expiry

The term is a number plus a separate unit. Don't read the number alone — "2" is 2 *years* and
"24" is 24 *months*. `term_months` converts with the unit; expiry is start date +
`term_months`. The start date is the effective date, else the executed date: an NDA's term runs
from its effective date, and the executed date is filled only from a dated signature, so most
NDAs carry an effective date and no executed date. Expiry exists only when **both** a start date
and a term were captured.
Every other NDA has no start date on file or is perpetual — say so, don't drop them silently.

## Governing law

The governing law stated in each NDA, normalized into one bucket per jurisdiction: one generic
`ILIKE` pattern per jurisdiction catches every spelling. Unmatched values keep their own cleaned
name (`INITCAP`) — **never roll the long tail into "Other"**, which reads as missing data. Any
per-counterparty governing law uses the same buckets and picks with `MODE`, never `MAX` of the
raw text.

## Workflow fields (Deal Name)

`DOCUMENT_ATTRIBUTE_CARTA_LAW_WORK_ITEM` is both the Path A deletion filter (inner join on
`SELECT DISTINCT document_id`) and the source of the `DEAL_NAME` workflow field. Enrichment is
always a LEFT JOIN on one row per document, so a firm without work items gets blank deals.

## Output rules

- Never show SQL, ids, table or column names, or the words "Snowflake", "DWH" or "warehouse".
- State coverage honestly: "expiry computed for X of Y NDAs; the rest have no start date".
- Call the jurisdiction view "governing law" (the law that governs the NDA), not counterparty
  location, which isn't extracted.
