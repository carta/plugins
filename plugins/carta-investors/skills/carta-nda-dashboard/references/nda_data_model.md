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
| Initial term — unit (`year` / `month` / `week` / `day`) | `attributes:term:initial_term:unit::string` |
| What the initial term runs from (`Effective Date` / `Last Disclosure` / `Other`) | `attributes:term:initial_term_start:value::string` |
| Survival period — display text, number, unit | `attributes:term:survival_period:text::string`, `TRY_TO_NUMBER(…:value::string)`, `…:unit::string` |
| Initial term — display text ("2 years") | `attributes:term:initial_term:text::string` |
| Governing law | `attributes:governing:governing_law:value::string` |
| Mutual or one-way (`Mutual` / `One Sided`) | `attributes:metadata:confidentiality_direction:value::string` |

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
on either side, often as a fund, its manager or a holding company. A party is the firm's when it
holds, as whole words, either of:

1. **The firm token**, in any case: the distinctive core of the firm's name, lower-cased, with
   entity suffixes (LLC, LP, Ltd, Partners, Management, Capital, Advisors, Inc) and any
   parenthetical dropped ("Acme Capital Partners, LP" → `acme`).
2. **The firm's initials**, in capitals only: the first letters of the firm's words from its
   first word through each later word, three letters or more, leaving out LLC, LP, Ltd, Inc,
   "the", "and" and "of" ("Great Basin Capital Partners" → `GBC|GBCP`), so an affiliate such as
   "GBC HoldCo, LLC" counts as the firm. Capitals only, so "The" or "New" in a counterparty's
   name never matches. Only words that start with a letter count, so the initials hold nothing
   but A–Z, and a candidate that equals an entity or legal suffix (LLC, LLP, PLC, INC, LTD, CORP, USA,
   PLLC, LLLP, PTE, PTY, SAS, SARL, SRL, SPA, GMBH, SDN, BHD, LTDA) is left out: "Lion Lake
   Capital" has no usable initials, because LLC would match nearly every counterparty, and "Pine
   Lake Lane Capital" keeps `PLL` but not `PLLC`.

Before splitting the name into words, delete dots, `%`, `_` and backslashes ("L.P." → `lp`) and
turn other punctuation and regex characters (`,*+?^$()[]{}|`) into spaces. The party on the
firm's side is the **firm entity** the Expiring tab shows. A party with no name shows as
`Unknown`, never a blank row.

## Restrictions that bind the firm

A restriction counts as in force only when it binds the firm and has not run out:

- **Who it binds.** A one-way NDA puts its restrictions on the receiving party, so when the
  firm only discloses, the counterparty is the one restricted. Everything else binds the firm
  (`binds_firm`): a mutual NDA, an NDA with no direction captured, and one where the firm
  can't be told apart. A missed restriction is worse than an extra one.
- **How long it runs.** A non-solicit or standstill runs for its own stated period, usually far
  shorter than the NDA. `duration_start` says what the period runs from: Effective Date (the
  start date; also assumed when it was not read) or Termination Or Expiry (the NDA's expiry).
  With no readable duration the clause ends when the NDA does, whatever its start point.
  Contact restrictions and non-circumvention run for the NDA's term.
- **Which end date the page shows.** `restricted_until` is the latest end among a
  counterparty's in-force clauses, or null ("Unknown / perpetual", never lapsed) when any of
  them has none.
- **When a date is an estimate.** A date is flagged only when it rests on a start point the NDA
  did not state: a clause with a duration whose `duration_start` is Last Disclosure, Other or
  unread; a date taken from the NDA's expiry when the NDA's own term doesn't run from its
  effective date.

| Provision | Duration path | Start-point path |
|---|---|---|
| Non-solicitation | `attributes:transaction:non_solicitation:duration:value` + `:unit` | `attributes:transaction:non_solicitation:duration_start:value` |
| Standstill | `attributes:transaction:standstill:duration:value` + `:unit` | `attributes:transaction:standstill:duration_start:value` |

## Term and expiry

The term is a number plus a separate unit. Don't read the number alone — "2" is 2 *years* and
"24" is 24 *months*. `term_months` converts with the unit; expiry is start date +
`term_months`. The start date is the effective date, else the executed date: the executed date
is filled only from a dated signature, so most NDAs carry an effective date and no executed
date. The term is taken to run from that date; `initial_term_start` records when it does not
(Last Disclosure, Other), and the page then flags the expiry as an estimate. Expiry exists only
when **both** a start date and a term were captured.
Every other NDA has no start date on file or is perpetual — say so, don't drop them silently.

### Survival

Confidentiality usually outlives the NDA. `survival_period` is how long the duty runs after the
NDA ends, so an expired NDA still binds until `confidential_until = expiry + survival`
(`still_confidential`). Blank survival text means the NDA states no period: indefinite or not
captured, shown as "Not stated". Text that cannot be turned into months leaves the date null and
is shown as "See NDA". Units convert like the term's: year, month, week, day.

## Governing law

The governing law stated in each NDA, normalized into one bucket per jurisdiction: one generic
`ILIKE` pattern per jurisdiction catches every spelling, and scanning slips such as "New ork"
or "New Y ork". Unmatched values keep their own cleaned
name (`INITCAP`) — **never roll the long tail into "Other"**, which reads as missing data. Any
per-counterparty governing law uses the same buckets and picks with `MODE`, never `MAX` of the
raw text.

## Deal

`DOCUMENT_ATTRIBUTE_CARTA_LAW_WORK_ITEM` is both the Path A deletion filter (inner join on
`SELECT DISTINCT document_id`) and the source of the `DEAL_NAME` workflow field. Enrichment is
always a LEFT JOIN on one row per document. Without a deal name, the deal is the project
codename in the NDA's title (`attributes:metadata:title:value`), such as "Project Atoll".

## Purpose

`attributes:confidentiality:permitted_purpose:description:value` says what the NDA was signed
for ("evaluating a potential minority equity investment in the Disclosing Party"). With the
firm entity and the deal, it tells apart two NDAs with the same counterparty.

## Output rules

- Never show SQL, ids, table or column names, or the words "Snowflake", "DWH" or "warehouse".
- State coverage honestly: "expiry computed for X of Y NDAs; the rest have no start date".
- Call the jurisdiction view "governing law" (the law that governs the NDA), not counterparty
  location, which isn't extracted.
