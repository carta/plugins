---
name: carta-form-adv
version: 2.0.0
description: >
  Pulls Form ADV Part 1A filing data from Carta fund administration and builds an
  interactive HTML filing guide plus an Excel filing reference. Covers Items 5.D, 5.F
  and 5.H, Schedule D §7.B.(1) per fund, beneficial owner breakdown, asset class
  composition and capital activity, counts each LP once and flags the fields to enter
  by hand in IARD. Trigger on any of:
  "Form ADV", "Schedule D", "regulatory AUM", "Form PF", "annual filing",
  "annual amendment", "SEC filing", "total AUM", "AUM for filing", "AUM for the SEC",
  "regulatory assets", "AUM across all funds", "filing season", "RAUM",
  "how much AUM to report", "pull our Form ADV data", /carta-form-adv.
  Requires a Carta Fund Administration subscription.
  NOT FOR: 409A valuations, cap table ownership, LP reporting, fund financials,
  performance benchmarks, SPA coverage (use carta-spa-audit), general fund metrics
  or NAV lookups (use carta-explore-data).
model: sonnet
allowed-tools:
  - mcp__carta__welcome
  - mcp__carta__call_tool
  - mcp__carta__read_tool
  - mcp__carta__list_contexts
  - mcp__carta__set_context
  - mcp__claude_ai_Carta__welcome
  - mcp__claude_ai_Carta__call_tool
  - mcp__claude_ai_Carta__read_tool
  - mcp__claude_ai_Carta__list_contexts
  - mcp__claude_ai_Carta__set_context
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__welcome
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__call_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__read_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__list_contexts
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__set_context
  - Bash(uv run ${CLAUDE_PLUGIN_ROOT}/skills/carta-form-adv/scripts/generate_form_adv_artifact.py *)
  - Bash(uv run ${CLAUDE_PLUGIN_ROOT}/skills/carta-form-adv/scripts/form_adv_excel_generator.py *)
  - Bash(uv run python -c "import tempfile; print(tempfile.gettempdir())")
  - Write(~/.cache/carta-form-adv/**)
  - Read
  - AskUserQuestion
---

<!-- carta:plugin-version -->
<carta-plugin>carta-investors:7.43.4</carta-plugin>

> **If this plugin's files can't be found:** a path that still shows an unreplaced `${…}` variable, or a "not found" when you read or run one of this skill's files, means the skill loaded before this session's computer link was ready. Invoke this skill once more with the Skill tool and use the paths that copy gives. If they're still unreplaced, tell the user Carta's plugin files aren't available in this session yet (link your computer, then ask again) and stop. Don't search the disk for them.

[PATTERN carta-writing-style v0.0.2]
[PATTERN etiquette v0.0.6]
[PATTERN text v0.0.8]
[PATTERN tables v0.0.12]
[PATTERN carta-watermark v0.0.10]
[PATTERN base v0.1.0]

# Form ADV Part 1A — Filing Data

Pulls Form ADV Part 1A data from Carta and generates **two artifacts**:

- **Interactive HTML filing guide** (Items 5.D/F/H, Schedule D §7.B.(1) per fund, IARD checklist)
- **Excel filing reference** (same data, with a Manual Fields sheet for IARD entry)

The artifacts ARE the deliverable. **Do not render Form ADV data as markdown tables in the chat window.** Chat output is limited to a brief status acknowledgment, applicable caveats, the compliance reminder, and a follow-up question.

---

## When to Use

- "Pull our Form ADV data"
- "What's our regulatory AUM for our annual filing?"
- "Show me Schedule D §7.B.(1) data"
- "What do I need for Form PF Section 1?"
- "Give me the asset class composition of our portfolio"
- "What's our annual subscription and distribution activity?"

---

## Workflow — Execute ALL Five Steps

Send no message before Step 1 passes, other than its connection-error or No Fund Admin message. You MUST complete every step on every invocation. Step 4 is not optional — the artifacts are the deliverable, not a supplementary export.

### Step 1 — Connect and check Fund Admin access [Hard gate]

Call `welcome` to establish the session and resolve `<SERVER>`. Its response includes `is_fund_admin_user`, whether the signed-in user has an active Carta Fund Administration subscription.

| `welcome` result | Action |
|---|---|
| Error, or the Carta connector isn't available | Tell the user: "I wasn't able to connect to your Carta account. Make sure the Carta MCP server is connected in Settings → Connectors, then try again." Then stop. |
| `is_fund_admin_user: false` | Surface the message below and stop. |
| `is_fund_admin_user: true` | Continue to Step 2. |
| Field absent | Continue to Step 2 and let the data warehouse query surface any access error. |

> Form ADV regulatory filing data requires a Carta Fund Administration subscription. I can't find one on your account. If your firm uses Carta Fund Admin, reconnect Carta in **Settings → Connectors**; otherwise reach out to your Carta account manager to get Fund Admin set up.

### Step 2 — Resolve context

- **Default `reporting_date` to the most recent completed calendar year-end** — `(current year − 1)-12-31` based on today's date. Send this message, with the proposed date filled in, and proceed unless the user gives a different one:

  > "I'll pull your Form ADV Part 1A data from Carta and build an interactive filing guide and Excel reference. I'll use **{YYYY}-12-31** as the reporting date — tell me if you want a different one. Items requiring manual IARD entry (auditor info, employee counts, fund IDs) will be flagged in both artifacts."

- Accept any natural-language override ("December 2023", "end of 2022", "Dec 31, 2024") and resolve to YYYY-12-31. Do not silently use a hardcoded year.
- If this is the first query, call `list_contexts` then `set_context` to establish the firm context.
- See **Fund Scope Disambiguation** below if the user names a specific fund or fund count.

### Step 3 — Run the queries (silently)

Read `${CLAUDE_PLUGIN_ROOT}/skills/carta-form-adv/references/queries.md` for the SQL. Execute all three queries in order via `read_tool({"name": "dwh__execute__query", "arguments": {"sql": "..."}})`:

1. **Query 1** — per-fund AUM, fund detail, capital activity, point-in-time portfolio composition.
2. **Query 2** — per-fund investor demographics (point-in-time membership and NAV from `PARTNER_MONTHLY_NAV_CALCULATIONS`, mutually-exclusive entity-type buckets).
3. **Query 3** — firm-level **distinct** LP aggregates (Items 5.D, 5.H). This block is **required**: the artifact generators read distinct LP counts from `firm_aggregates` instead of summing per-fund counts (which double-counts any LP in multiple funds).

**Do not echo raw rows or render markdown tables** of the results.

### Step 4 — Generate the artifacts (MANDATORY)

Read `${CLAUDE_PLUGIN_ROOT}/skills/carta-form-adv/references/filing-guide.md` and execute its four sub-steps in order, every time:

1. Build `~/.cache/carta-form-adv/form_adv_data.json` with the actual query result values (no placeholders).
2. Run `generate_form_adv_artifact.py` → HTML artifact.
3. Run `form_adv_excel_generator.py` → Excel filing reference.
4. Surface the HTML file path so the user can open it in a browser.

If any sub-step fails, see **Error Handling** — do not silently skip.

### Step 5 — Acknowledge in chat (no data tables)

Send a brief plain-text message. Substitute the resolved values:

> Pulled your Form ADV Part 1A data for **{reporting_date}** across **{N} funds**. Two artifacts generated:
>
> - **Interactive filing guide** — saved to `<resolved-tmpdir>/FormADV_<FirmName>_<Year>.html`; open in a browser
> - **Excel filing reference** — `<resolved-tmpdir>/FormADV_<FirmName>_<Year>.xlsx`
>
> Blue = Carta-filled. Orange = manual IARD entry. The Manual Fields sheet (Excel) and IARD Checklist tab (HTML) list every field needing manual entry.

After the status, surface only caveats that **apply to this specific filing** (e.g., "NAV for [fund] is not calculated for [date] — those fields show `—`"). Do not enumerate every possible caveat — full caveat list is in the artifact's Legend sheet.

Then close with the Escalation Contract reminder and Response Closing.

---

## Out of scope

| Topic | Suggestion |
|---|---|
| 409A valuations | A separate cap table valuation product. Suggest the user reach out to their Carta account manager or use the 409A valuation process directly. |
| Cap table, option grants, share classes | Not handled here. Suggest the cap table tools in Carta. |
| SPA coverage, missing or unexecuted SPAs | `carta-investors:carta-spa-audit` |
| Schedule of investments, fund holdings | `/carta-soi` |
| LP quarterly reports, AGM decks | `carta-investors:carta-agm-deck-builder` |
| Tear sheets | `carta-investors:carta-explore-data` for a custom report; `carta-investors:carta-fund-forecasting` for funds in Fund Forecasting |
| Fund financials, NAV, trial balance | Consolidating financials skills |
| Performance benchmarks, IRR, TVPI, peer percentile | `/carta-fund-performance` |
| Co-investor analysis | `carta-co-investors` |
| Wants Carta's Fund Admin team to *do* something | `carta-fund-admin-requests` |

---

## Fund Scope Disambiguation

1. **User names a specific fund, no match found** → use `AskUserQuestion` to present up to 4 candidate fund names. Do not expand scope until the user picks one.
2. **User states a fund count that doesn't match query results** → surface the discrepancy and wait for confirmation: *"I found [N] funds, not [user's count]. Confirm which are in scope before I run the filing."*
3. **No fund named** → include all funds in the firm context.

---

## Error Handling

| Symptom | Likely cause | Tell the user |
|---|---|---|
| Query returns no rows | `reporting_date` precedes any fund data, or firm context not set | "No data found for that date. Confirm the reporting date and firm context, then try again." |
| `set_context` fails | MCP not connected or user lacks access | "I wasn't able to find your firm. Make sure the Carta MCP server is connected." |
| Permission denied (403) | User lacks data warehouse access | "Your account doesn't have data warehouse access for this query. Contact your Carta admin." |
| All NAV fields null for a fund | Monthly NAV calculation hasn't run for that period | "NAV not calculated for [fund] as of [date] — performance and Net AUM will be blank. Ask your fund admin to run the NAV before filing." |
| `reporting_currency` is null for a fund | Fund admin hasn't set the currency in Carta | "Reporting currency is not set for [fund name] in Carta — the artifacts label its amounts with `$`, but the currency is unconfirmed. Ask your fund admin to set the fund currency before filing." |
| Fund count mismatch | Excluded entity type (e.g., GP entity) | "I found [N] Fund/SPV entities. If you expected [M], some funds may be a different entity type — check with your Carta admin." |
| HTML artifact script fails | Missing `uv`, malformed JSON, or unwritable output path | "I couldn't generate the interactive filing guide. Try again, or open an issue if it persists. The Excel file may still be available — check the path below." |
| Excel generator fails | Missing `uv`/`openpyxl`, malformed JSON, or unwritable path | "I couldn't generate the Excel filing reference. The HTML guide may still be available. Try again or contact support." |

---

## Escalation Contract

This skill produces figures used directly in SEC filings. Always surface this reminder when the user indicates they are preparing to file:

> **Filing deadline check:** If any values differ from your fund administrator's records, or you're within 5 business days of your filing deadline, verify with your compliance team before submitting to the SEC. Carta data reflects fund administration records as of the reporting date — discrepancies should be resolved against the fund's audited financial statements.

---

## Voice Guidelines

- Refer to "your Form ADV data" or "your filing guide" — never "query results" or "database output".
- Data gaps: "I wasn't able to retrieve that for [fund name]" — not technical details.
- Proactively explain FMV ≠ NAV and Regulatory AUM ≠ NAV if the user asks about discrepancies.
- Always remind that manual IARD fields must be entered by the user before submitting.
- Apply the Carta watermark per [PATTERN carta-watermark v0.0.10] on all natural-language replies.

---

## Response Closing

End every response with the data-provenance footer, immediately followed by the follow-up question:

*Data as of {reporting_date} · Balance sheet uses effective_date (accounting date) · Verify legal names, fiscal year ends, and IARD fund IDs before filing*

> "Would you like to compare to your prior year's filing, pull additional Form PF fields, or walk through the IARD manual entry checklist?"
