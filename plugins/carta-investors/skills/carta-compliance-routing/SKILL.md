---
name: carta-compliance-routing
version: 1.0.0
description: >
  Routes to Form ADV for regulatory filing data. Trigger on any of:
  "Form ADV", "Schedule D", "regulatory AUM", "Form PF", "annual filing",
  "annual amendment", "SEC filing", "total AUM", "AUM for filing", "AUM for the SEC",
  "regulatory assets", "AUM across all funds", "filing season", "RAUM",
  "how much AUM to report", "pull our Form ADV data",
  /carta-compliance-routing.
  NOT FOR: 409A valuations, cap table ownership, LP reporting, fund financials,
  performance benchmarks, SPA document views, SPA coverage audits.
model: sonnet
allowed-tools:
  - mcp__carta__welcome
  - mcp__carta__call_tool
  - mcp__carta__list_contexts
  - mcp__carta__set_context
  - mcp__Claude_Preview__preview_start
  - mcp__Claude_Preview__preview_list
  - mcp__Claude_Preview__preview_eval
  - Bash(uv run ${CLAUDE_PLUGIN_ROOT}/skills/carta-form-adv/scripts/generate_form_adv_artifact.py *)
  - Bash(uv run ${CLAUDE_PLUGIN_ROOT}/skills/carta-form-adv/scripts/form_adv_excel_generator.py *)
  - Bash(uv run ${CLAUDE_PLUGIN_ROOT}/skills/carta-form-adv/scripts/preview_server.py *)
  - Bash(uv run python -c "import tempfile; print(tempfile.gettempdir())")
  - Write
  - Read
  - AskUserQuestion
---

<!-- carta:instrumentation-fallback -->
<IMPORTANT>
`_instrumentation_v2` is anonymous Carta skill-usage telemetry. ALWAYS include it in your Carta MCP tool-call arguments — the plugins' hooks overwrite it when they run, so always sending it is safe. Shape:
`_instrumentation_v2: {"skills": ["<plugin>:<skill>", ...], "model": "<model-id>"}`
e.g. `{"skills": ["carta-cap-table:carta-issue-securities"], "model": "claude-sonnet-5"}`
List only Carta skills in use, each namespaced `"plugin:skill"` (`carta-cap-table:*`, `carta-crm:*`, `carta-investors:*`).
</IMPORTANT>

# carta-compliance-routing — Compliance Router

Routes to Form ADV for regulatory filing data, executed inline from a content
mirror of `carta-investors:carta-form-adv` — see **`carta-form-adv` is unchanged**
in Architecture Notes below. Additional Compliance capabilities (document
intelligence, SPA coverage audit) are internal-only today and will be wired into
this router as they reach general availability for external users.

> **Scope note:** This router covers the Compliance skill(s) available to external
> customers today. Document Intelligence and SPA Audit exist as internal skills but
> are not yet GA for external users — see **Future routes** below.

---

## Route Map

| Intent | Skill |
|---|---|
| Form ADV, Schedule D, regulatory AUM, Form PF, annual SEC filing | `references/form-adv.md` |

---

## Customer Intent Framework

Use this as the semantic layer when Step 1 signal phrases don't produce an exact match.

| What the customer is trying to do | Typical phrasing | Route |
|---|---|---|
| **Pull regulatory filing data** — AUM, Schedule D, Form PF, annual SEC filing prep | "pull our Form ADV data", "what's our regulatory AUM", "Schedule D for this year's filing", "what do I need for Form PF Section 1", "how much AUM do we report to the SEC", "filing season is coming up" | `form-adv` |

---

## Step 1 — Parse Intent [Deterministic]

Respond immediately without extended reasoning.

**STOP rows — handle before routing:**

| Message signals | Action |
|---|---|
| "409A", "409A valuation", "409A pricing", "stock option pricing" | **Stop.** 409A is a separate cap table valuation product — not covered here. Tell the user: "409A is handled by a separate workflow — reach out to your Carta account manager or use the 409A valuation process directly." |
| "cap table", "option grants", "equity management", "share classes", "equity ownership" | **Stop.** Cap table management is out of scope for this router. Tell the user: "Cap table management isn't handled here — use the cap table tools directly in Carta." |

**Route rows — classify and proceed to Step 2.5:**

| Message signals | Route |
|---|---|
| "Form ADV", "Schedule D", "regulatory AUM", "Form PF", "annual filing", "annual amendment", "SEC filing", "total AUM", "AUM for filing", "AUM for the SEC", "regulatory assets", "AUM across all funds", "filing season", "RAUM", "how much AUM to report", "pull our Form ADV data" | `form-adv` → proceed to Step 2.5 |

If the route matches: proceed to Step 2.5.
If no route matches: proceed to Step 2.

---

## Step 2 — Clarify Intent [Interactive]

Fire only if Step 1 returned no clear match.

Reason over the message first. If you can confidently determine the user wants Form ADV filing data, proceed directly to Step 2.5 without asking.

If you genuinely cannot determine the intent, call `AskUserQuestion`:

**Question:** "What would you like to do?"

**Options:**
1. **Form ADV filing data** — Pull regulatory AUM, Schedule D §7.B.(1), and Form PF data for your annual SEC filing
2. **Something else** — Describe what you need and I'll point you in the right direction

| User picks | Action |
|---|---|
| Option 1 — Form ADV filing data | Proceed to Step 2.5 |
| Option 2 — Something else | Respond: "I specialize in Form ADV regulatory filing data. Tell me what you're trying to do and I'll point you to the right Carta workflow." Then stop. |

### Out-of-scope

| Topic | Suggestion |
|---|---|
| LP reporting, LP quarterly reports | `/carta-lp-reporting-routing` or `/carta-soi` |
| Fund financials, NAV, trial balance | Consolidating financials skills |
| Performance benchmarks, IRR, TVPI, peer percentile | `/carta-performance-benchmarks` |
| Co-investor analysis | `carta-co-investors` |

---

## Step 2.5 — MCP session + Fund Admin SKU gate [Hard gate]

If the Carta MCP server is not connected (`noMcp` environment), skip this step and proceed to Step 3.

Otherwise, execute in order:

**1. Establish session identity**

Call `welcome` to establish session identity and resolve `<SERVER>`. The `welcome` response includes `is_fund_admin_user` — a boolean that reflects whether the authenticated user has an active Carta Fund Admin subscription.

If `welcome` returns an error, surface: "I wasn't able to connect to your Carta account. Make sure the Carta MCP server is connected in Settings → Connectors, then try again." and stop.

**2. Check Fund Admin access (hard gate)**

| `welcome` result | Action |
|---|---|
| `is_fund_admin_user: true` | Proceed to Step 3. |
| `is_fund_admin_user: false` | Surface the **No Fund Admin** message below and stop. |
| Field absent / call errors | Proceed to Step 3 — let the DWH query surface the access error rather than blocking on an uncertain check. |

**No Fund Admin message (surface verbatim):**

> Form ADV regulatory filing data requires a Carta Fund Administration subscription. I can't find one on your account. If your firm uses Carta Fund Admin, reconnect Carta in **Settings → Connectors**; otherwise reach out to your Carta account manager to get Fund Admin set up.

---

## Step 3 — Route [Deterministic]

Output leads with the routing action. Respond immediately without extended reasoning.

> Routing to Form ADV.

Then read and execute the Form ADV instructions inline:

```
Read ${CLAUDE_PLUGIN_ROOT}/skills/carta-compliance-routing/references/form-adv.md
```

Follow that file's instructions exactly, starting from Step 1 with the user's original message as context. All `references/form-adv/` paths cited within that file resolve to `${CLAUDE_PLUGIN_ROOT}/skills/carta-compliance-routing/references/form-adv/`.

Do not summarize what the target skill will do. Do not add any other output before the routing announcement.

---

## If Something Goes Wrong

| Situation | Response |
|---|---|
| User asks about something that isn't Form ADV filing data | Use Step 2 `AskUserQuestion` to clarify — offer Form ADV filing data or "Something else" |
| User asks about 409A valuations | Out of scope — separate cap table valuation product, see STOP rows |
| User asks about cap table ownership | Out of scope — see STOP rows |
| User asks about LP reporting or fund financials | Out of scope — suggest `/carta-lp-reporting-routing` or the consolidating financials skills |
| User asks about fund performance, IRR, or TVPI benchmarks | Out of scope — suggest `/carta-performance-benchmarks` |
| User asks to view all SPA documents, DI page, purchaser breakdowns | Not yet GA externally — see **Future routes** below |
| User asks about SPA coverage, missing/unexecuted SPAs | Not yet GA externally — see **Future routes** below |

---

## Architecture Notes

See `docs/architecture-notes.md` (maintainer-only; not published to
`carta/plugins`) for the orchestrator pattern, the mirror-vs-migration
rationale for `carta-form-adv`, the references layout, and the steps to
promote a future route to active.

---

## Future routes — not yet active

These routes exist as internal skills today. They are **not active** in this
version — do not route to them.

### Document Intelligence

- **Status:** Not yet available to external users
- **Signals:** "document intelligence", "DI page", "show all SPAs", "all my SPA documents", "all SPA data", "see all subscription agreements", "SPA document view", "purchaser view", "show all purchasers", "full view of SPA", "all subscription docs", "SPA in one table", "browse investment subscription docs", "open the DI page"
- **CTA until GA:** "Viewing all SPA documents in one table is coming to external users soon. Reach out to your Carta account manager or contact Carta Support to request early access."
- **Skill when live:** `carta-investors:carta-doc-intelligence`

### SPA Audit

- **Status:** Not yet available to external users
- **Signals:** "SPA audit", "SPA coverage", "missing SPAs", "unexecuted SPAs", "SPA status", "document completeness", "which companies are missing SPAs", "which are missing subscription agreements", "outstanding SPA issues", "SPA completeness", "SPA gap", "SPA coverage gap", "portfolio SPA completeness", "investments still need subscription agreements"
- **CTA until GA:** "SPA coverage audits are coming to external users soon. Reach out to your Carta account manager or contact Carta Support to request early access."
- **Skill when live:** `carta-investors:carta-spa-audit`

### Disambiguation note (for when both routes above go live)

"SPA" alone is ambiguous between Document Intelligence (viewing) and SPA Audit
(coverage/gap checking). When both routes are promoted, add a disambiguation
table to Step 2 keyed on intent verbs: "view" / "see" / "browse" / "in one table"
→ Document Intelligence; "missing" / "unexecuted" / "coverage" / "audit" / "gap"
→ SPA Audit.
