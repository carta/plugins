---
name: carta-portfolio-analytics-routing
version: 2.0.0
description: >
  Routes to Schedule of Investments, Co-Investor Lookup, or Performance
  Benchmarks. Trigger on any of:
  "SOI", "schedule of investments", "fund holdings", "what is the fund invested in", "portfolio breakdown",
  "co-investor", "coinvestor", "who co-invested", "who else invested", "co-investors by stage",
  "performance benchmark", "peer comparison", "fund percentile", "IRR vs peers", "TVPI benchmark", "how does my fund stack up",
  /carta-portfolio-analytics-routing.
  NOT FOR: portfolio valuations/marks, LP documents, K-1, SPA audit, Form ADV, cap table, 409A,
  comparable company selection, loan dashboard.
model: sonnet
allowed-tools:
  # The only source for a connector's name
  - list_connectors
  - mcp__*carta*__welcome
  - mcp__*Carta*__welcome
  - mcp__carta__call_tool
  - mcp__carta__search_tools
  - mcp__carta__set_context
  - mcp__carta__list_contexts
  - mcp__Claude_Preview__preview_start
  - mcp__Claude_Preview__preview_list
  - mcp__Claude_Preview__preview_eval
  - Artifact
  - Bash(uv run /sessions/*)
  - Bash(uv run ${CLAUDE_PLUGIN_ROOT}/*)
  - Bash(pwd)
  - Bash(carta workspace cache *)
  - Bash(jq *)
  - Bash(test -f *)
  - Bash(test -d *)
  - Bash(find *)
  - Bash(date *)
  - Bash(mkdir -p *)
  - Bash(rm -f *)
  - Bash(open *)
  - Write
  - Read
  - AskUserQuestion
  - ToolSearch
---

<!-- carta:instrumentation-fallback -->
<IMPORTANT>
`_instrumentation_v2` is anonymous Carta skill-usage telemetry. ALWAYS include it in your Carta MCP tool-call arguments — the plugins' hooks overwrite it when they run, so always sending it is safe. Shape:
`_instrumentation_v2: {"skills": ["<plugin>:<skill>", ...], "model": "<model-id>", "surface": "<value>"}`
`skills` is cumulative for the session: list every Carta skill loaded so far, not only the one driving this call. Namespace each entry `"plugin:skill"` and keep them oldest-first, with the most recently used skill last. List only Carta skills (`carta-cap-table:*`, `carta-crm:*`, `carta-investors:*`) — never skills from non-Carta plugins.
`surface` is the Claude surface you are running in: `"chat"` (claude.ai or the Claude app, i.e. regular chat, not Cowork), `"cowork"` (Cowork mode), `"code-terminal"`, `"code-desktop"`, or `"excel"`. Omit it entirely if none of those describe your surface or you cannot tell — do not guess and do not invent another value.
</IMPORTANT>

# carta-portfolio-analytics-routing — Portfolio Analytics Router (mirror)

Routes to Schedule of Investments, Co-Investor Lookup, or Performance
Benchmarks — each executed inline from a content mirror of its own specialist
skill. See **specialists are unchanged** in Architecture Notes below. The
fourth Portfolio Analytics capability (Loan Dashboard) is internal-stage today
and will be wired into this router as it reaches general availability for
external users.

> **Scope note:** This router covers the Portfolio Analytics skills available
> to external customers today. Loan Dashboard exists as an internal-stage skill
> but is not yet GA for external users — see **Future routes** below.

---

## Route Map

| Intent | Skill |
|---|---|
| View fund holdings — Schedule of Investments (SOI) | `references/soi.md` |
| Who co-invested alongside us in portfolio companies | `references/co-investors.md` |
| Benchmark a fund's performance against peer cohorts | `references/benchmarks.md` |

---

## Customer Intent Framework

Use this as the semantic layer when Step 1 signal phrases don't produce an exact match.

| What the customer is trying to do | Typical phrasing | Route |
|---|---|---|
| **View fund holdings / portfolio breakdown** | "show me the SOI", "what companies is the fund invested in", "portfolio breakdown for our flagship fund", "what does Fund III hold right now" | `soi` |
| **Find who else invested alongside us** | "show me my co-investors", "who co-invested with us in Acme", "who else participated in the Series B for TechCorp", "co-invest analysis by stage" | `co-investors` |
| **Benchmark fund performance against peers** | "run performance benchmarks for Fund I", "how does our fund compare to peers", "how does Fund II stack up against vintage 2019 peers", "are we top-quartile for our vintage" | `benchmarks` |

---

## Step 1 — Parse Intent [Deterministic]

Respond immediately without extended reasoning.

**STOP rows — handle before routing:**

| Message signals | Action |
|---|---|
| "run my valuations", "do my marks", "quarterly marks", "fair value", "batch valuations", "close my quarter", "update the EV", "autopilot valuation", "goal seek", "waterfall", "exit scenario" | **Stop.** Portfolio valuations are handled separately. Tell the user: "Portfolio marks and valuations are handled by a different skill set — try `/carta-valuations-routing` or say 'run my valuations'." |
| "K-1", "capital call notice", "distribution notice", "LP documents", "LP quarterly report", "AGM deck", "tear sheet" | **Stop.** LP reporting is handled separately. Tell the user: "LP documents and reporting live in a separate skill set — try `/carta-lp-reporting-routing` or say 'show me my LP documents'." |
| "comparable companies", "comp set", "GPC comps", "select comps", "find comps", "add comparables", "update the comp set", "trading comps", "browse comps", "add ticker", "industry comparables" | **Stop.** Comparable company selection is handled by the Portfolio Valuations skill set. Tell the user: "Comparable company selection lives in the Portfolio Valuations skill — try `/carta-valuations-routing` or say 'update my comp set'." |
| "SPA audit", "SPA coverage", "missing SPAs", "Form ADV", "regulatory AUM" | **Stop.** SPA audit and Form ADV are handled separately. Tell the user: "SPA audit and Form ADV live in a separate skill set — try `/carta-compliance-routing`." |
| "fund of funds", "FoF", "fund-of-funds" | **Stop.** Fund of Funds is an upcoming capability and not yet available. Tell the user: "Fund of Funds is on the roadmap but isn't available yet — check back soon or contact your Carta account manager for the latest on availability." |

**Route rows — classify and proceed to Step 2.5:**

| Message signals | Route |
|---|---|
| "SOI", "schedule of investments", "fund holdings", "what is the fund invested in", "what companies is the fund in", "portfolio breakdown", "portfolio companies", "fund portfolio view", "investments by stage", "portfolio list", "what has [fund] invested in", "show me the portfolio" | `soi` → proceed to Step 2.5 |
| "co-investor", "coinvestor", "co-invest", "who co-invested", "who else invested", "co-investors by stage", "co-investors by round", "co-invest analysis", "who are our co-investors", "co-investors on Aumni", "which funds invest alongside us" | `co-investors` → proceed to Step 2.5 |
| "performance benchmark", "fund benchmark", "peer comparison", "percentile ranking", "IRR vs peers", "TVPI benchmark", "net IRR benchmark", "how does our fund compare", "how does Fund [X] stack up", "fund performance vs cohort", "vintage year benchmark", "benchmark cohort", "peer benchmark" | `benchmarks` → proceed to Step 2.5 |

If exactly one route matches: proceed to Step 2.5.
If zero or multiple routes match: proceed to Step 2.

---

## Step 2 — Clarify Intent [Interactive]

Fire only if Step 1 returned no clear match.

**If the user said anything at all:** reason over it before asking. Present the menu only if you've genuinely worked through every signal and still can't determine intent.

| Ambiguous phrase | Signal that tips the balance |
|---|---|
| "fund performance" alone | "vs peers" / "benchmark" / "cohort" / "percentile" → `benchmarks`; "company-level performance" / "individual portco" → may not be portfolio analytics — ask |
| "portfolio" alone | "what's in the portfolio" / "portfolio breakdown" / "holdings" → `soi`; "portfolio dashboard" → ask — could mean SOI or (not-yet-active) loan portfolio |
| "loans" / "loan portfolio" | Not yet GA externally — see **Future routes** below; do not route |
| "analytics" alone (bare noun) | Ask — too broad to route without more context |

**If you need to ask**, present once:

> Which Portfolio Analytics capability can I help with?
> 1. **Schedule of Investments (SOI)** — fund holdings and portfolio breakdown
> 2. **Co-investor lookup** — who else invested in our portfolio companies
> 3. **Performance benchmarks** — fund IRR/TVPI vs peer cohorts
> 4. **Something else** — Describe what you need and I'll point you in the right direction

| User picks | Action |
|---|---|
| Option 1 — SOI | Proceed to Step 2.5 |
| Option 2 — Co-investor lookup | Proceed to Step 2.5 |
| Option 3 — Performance benchmarks | Proceed to Step 2.5 |
| Option 4 — Something else | Respond: "I specialize in fund holdings (SOI), co-investor lookups, and performance benchmarks. Tell me what you're trying to do and I'll point you to the right Carta workflow." Then stop. |

### Out-of-scope

| Topic | Suggestion |
|---|---|
| Portfolio valuations, quarterly marks, EV updates | `/carta-valuations-routing` |
| Comparable company selection, comp sets | `/carta-valuations-routing` |
| SPA audit, Form ADV, regulatory AUM | `/carta-compliance-routing` |
| LP documents, K-1, LP reporting, AGM decks, tear sheets | `/carta-lp-reporting-routing` |
| Cap table ownership, equity management, 409A | Carta cap table tools |
| Fund of Funds | Not yet available — see STOP rows |

---

## Step 2.5 — Fund Admin access preflight [Active proxy gate]

If the Carta MCP server is not connected (`noMcp` environment), skip this step and proceed to Step 3.

Otherwise:

1. Call `welcome` to establish session identity (skip if already called this session).
2. Run **exactly one** proxy probe: `call_tool({"name": "fa__list__entities", "arguments": {}})`. You get exactly one attempt at this probe — do not retry it, do not vary the call, and do not substitute a different tool to route around a failure.

Branch on the result:

| Result | Action |
|---|---|
| Returns a list (even empty) | Fund Admin data is reachable — proceed to Step 3 |
| Errors with a permission/entitlement signal (403, "not entitled", "no access", firm not found) | Surface the access message below and **stop** — do not proceed to Step 3 |
| Errors for any other reason (timeout, connection drop, malformed response) | Proceed to Step 3 anyway — let the matched route's mirrored logic surface the specific error. Do not false-block on a transient failure. |

**If access is not confirmed**, surface this message and stop:

> This workflow requires Fund Admin access, which your firm doesn't appear to have enabled. Reach out to your Carta account manager or [contact Carta Support](https://support.carta.com) to request access.

**Important — this is a proxy, not a real entitlement check.** See Architecture Notes §"Fund Admin access preflight" for the full rationale — there is no Carta MCP command today that exposes real SKU/entitlement data (SOI's own Step 3 `discover` call is for MCP UUID-form tool disambiguation only, not an entitlement gate), so this substitutes a cheap reachability probe. It cannot distinguish specific FA sub-products, so false negatives/positives are possible.

---

## Step 3 — Route [Deterministic]

**Mechanical rule — no exceptions:** the very first content block of your very
first turn after a route match, before any tool call (including `list_contexts`,
`welcome`, or any firm-lookup call the matched route's own Step 1 would
otherwise make first) and before any internal reasoning about what the user
still needs to provide, must be plain text output containing exactly:

> Routing to [Display Name].

Do not combine this turn with a tool call. Do not decide the announcement is
unnecessary because you can already tell the matched route will need to ask a
clarifying question (e.g. "which firm?"). That clarifying question — and every
other step of the matched route's own workflow, including its own "Announce"
step if it has one — happens in the **next** turn, after this one, never
instead of it or merged into the same turn as a tool call.

Then read and execute the matched route's instructions inline:

| Route | Display Name | Read |
|---|---|---|
| `soi` | Schedule of Investments | `${CLAUDE_PLUGIN_ROOT}/skills/carta-portfolio-analytics-routing/references/soi.md` |
| `co-investors` | Co-Investor Lookup | `${CLAUDE_PLUGIN_ROOT}/skills/carta-portfolio-analytics-routing/references/co-investors.md` |
| `benchmarks` | Performance Benchmarks | `${CLAUDE_PLUGIN_ROOT}/skills/carta-portfolio-analytics-routing/references/benchmarks.md` |

Follow the matched file's instructions exactly, starting from its own Step 1/Workflow entry point with the user's original message as context. Every reference file resolves its own internal script and data paths independently (see Architecture Notes) — do not rewrite them.

Do not summarize what the target skill will do beyond the announcement itself. Do not add any other output before the routing announcement.

---

## If Something Goes Wrong

| Situation | Response |
|---|---|
| User asks about portfolio valuations or marks | Out of scope — see STOP rows, redirect to `/carta-valuations-routing` |
| User asks about comparable company selection or comp sets | Out of scope — see STOP rows, redirect to `/carta-valuations-routing` |
| User asks about LP documents, K-1s, or LP reporting | Out of scope — see STOP rows, redirect to `/carta-lp-reporting-routing` |
| User asks about SPA audit, Form ADV, or regulatory filings | Out of scope — see STOP rows, redirect to `/carta-compliance-routing` |
| User asks about cap table, equity grants, or 409A | Out of scope — redirect to the cap table skills |
| User asks about Fund of Funds | Not yet available — tell the user it is upcoming and to contact their account manager |
| User asks about a loan dashboard, loan portfolio, or draw balances | Not yet GA externally — see **Future routes** below |

---

## Architecture Notes

### Orchestrator pattern

This skill is the sole external-facing entry point for the Portfolio Analytics
theme. It classifies intent, resolves ambiguity via `AskUserQuestion`, and
executes each matched route's logic inline via `Read references/<route>.md`.
No separate registered skill is dispatched — the routing skill owns the entire
user-facing surface for its three active routes. Loan Dashboard will be wired
in as it reaches GA for external users.

### Scope decision (as of v2.0.0)

SOI, Co-Investor Lookup, and Performance Benchmarks are confirmed GA for
external users — all three carry `publish: true` on their backing skills. Loan
Dashboard (`carta-investors:carta-loan-dashboard`) has a `version` field but no
`publish` field — internal-stage today — and is documented below as a
**future route**, not an active one.

### Structural patterns

This router follows the same 6 patterns established in carta-valuations-routing
and carta-compliance-routing (the reference routing skills), extended to
**three** active mirrored routes instead of one:

| Pattern | Applied here |
|---|---|
| Step 1 `[Deterministic]` + "Respond immediately" | No over-reasoning on signal classification; STOP rows short-circuit valuations/LP-reporting/comps/compliance/FoF before route classification |
| Step 2 `AskUserQuestion` | SOI (1) / Co-investors (2) / Benchmarks (3) / Something else (4) — three active routes, same shape as the single-route pattern in valuations-routing and compliance-routing, just with more options |
| Customer Intent Framework | All three active routes; loans documented separately below |
| Explicit skip logic | Match → Step 2.5; no match → Step 2 |
| Step 2.5 (active proxy gate) | `welcome` + one `fa__list__entities` probe — not a real entitlement check (see below), but no longer purely passive |
| Step 3 `[Deterministic]` + `Read references/<route>.md` | Inline execution per matched route, no Skill() dispatch |

### Fund Admin access preflight — proxy, not a real SKU check

Step 2.5 was upgraded from a passive `welcome`-only check to an active proxy
gate — same change, same rationale, as `carta-compliance-routing` and
`carta-lp-reporting-routing`. Research into `carta/carta-web`'s
`eshares/iam/models.py` confirmed there is no single "FA" SKU — Fund Admin
access is a family of ~23 `ProductCode` values fed by fund-admin's own
`products_fundproductaccess` table via an internal gRPC call, cached in
carta-web's `EntityProductAccess` model. That model is **not exposed through
the Carta MCP gateway** — there is no `search_tools`-style command this router can
call the way `carta-valuations-routing` calls
`search_tools({"query": "waterfall modeling"})`. (SOI's own tool-discovery in Step 3
is unrelated — it disambiguates the MCP's UUID-form tool prefix, not an
entitlement check.)

Absent a real entitlement command, Step 2.5 substitutes a cheap proxy: one
`fa__list__entities` call. This only proves `FUND_ADMIN.*` data is reachable —
it cannot tell which FA sub-products are actually enabled, so it can produce
false negatives (transient failure on an entitled firm) or false positives
(base FA present, but the specific feature a route needs isn't). The
one-attempt cap follows the sub-agent safety pattern in the marketplace root
`CLAUDE.md` — capped rather than left to retry loop.

**Replace this the moment a real entitlement check exists** — file a request
for an MCP command surfacing `EntityProductAccess` for the current firm
context; that's Carta MCP team work, not something fixable from the skill side.

### Specialists are unchanged — these are mirrors, not migrations

`references/soi.md`, `references/co-investors.md`, and `references/benchmarks.md`
are **content mirrors** of `carta-investors:carta-soi`,
`carta-investors:carta-co-investors`, and `carta-investors:carta-performance-benchmarks`'s
own `SKILL.md` bodies. Two of the three are verbatim copies; `soi.md` is not:

- **`soi.md` is not re-mirrorable by copy-paste.** When re-mirroring, rewrite
  both of its Step 4b paths — the `find` pattern and the `${CLAUDE_PLUGIN_ROOT}`
  fallback — to this router's own `references/soi/` copy. `carta-soi`'s body
  points them at `skills/carta-soi/`, which the publish pipeline strips.
  `render-artifact.py` and `artifact.html` need no rewrite — the script probes
  both template offsets — so those two files stay byte-identical across both
  locations and re-mirror with `cp`. Keep them that way.
- `carta-co-investors` resolves its scripts and canonical-investors data via a
  `$SKILL_DIR` shell probe that searches for a directory literally named
  `carta-co-investors` (via `$CLAUDE_PLUGIN_ROOT/skills/carta-co-investors` or
  the Cowork bind-mount equivalent) — this resolves correctly regardless of
  which file the mirrored text lives in.
- `carta-performance-benchmarks` is entirely self-contained SQL/logic with no
  sub-references or scripts at all.

`carta-investors:carta-soi` and `carta-investors:carta-co-investors` were not
modified: both are still `publish: true`, still have their original
trigger-phrase-rich descriptions, and are still directly invocable by the
skill picker exactly as before. `carta-investors:carta-performance-benchmarks`
had only its `description` softened (see "Picker de-tune" below) — same
precedent `carta-compliance-routing` used for `carta-form-adv` (PR #11162) and
`carta-lp-reporting-routing` used for `carta-download-tearsheet` (PR #11953).
These mirrors exist purely as additional, router-owned execution paths so the
router can run each workflow inline without touching any standalone skill's
tools or its existing test coverage in
`tests/carta-investors/skill-triggers.test.yaml`.

**Maintenance cost — read before editing any of the three specialists:**
because these are mirrors, not a shared source, any change to
`carta-soi/SKILL.md`, `carta-co-investors/SKILL.md`, or
`carta-performance-benchmarks/SKILL.md` must be manually re-applied to the
matching `carta-portfolio-analytics-routing/references/<route>.md` or the two
will drift. There is no tooling that keeps them in sync. `carta-co-investors`
in particular is an 800-line skill — re-mirroring it by hand on every change is
real, ongoing cost; this was an explicit tradeoff (mirror-for-consistency over
direct-dispatch-to-avoid-drift) made when this router was built.

**Picker de-tune — `carta-performance-benchmarks`:** its trigger-phrase-rich
description was stripped down to a one-line redirect ("For performance
benchmark requests, use carta-portfolio-analytics-routing instead"), following
the same pattern documented under "How to promote a future route to active" §
Mirror + de-tune below. It keeps `publish: true` and all its tools — this only
changes picker precedence for ambiguous natural-language prompts and remains
fully invocable directly by name. Added `version: 1.0.0` — the skill had no
prior `version:` field, matching the WARN default the frontmatter validator
recommends rather than fabricating a bump from a nonexistent prior release.

**Known limitation — `carta-soi` and `carta-co-investors` only:** because
these two specialists still have trigger-phrase-rich descriptions and remain
standalone public skills, specific prompts ("show me the SOI") can still win
the skill picker directly and bypass this router — the mirror does not fix
that. This is a known, accepted limitation. See the `failing: true` trigger
tests in `carta-portfolio-analytics-routing.test.yaml` and
`carta-portfolio-analytics-routing-triggers.test.yaml` for the two remaining
un-de-tuned routes; the former benchmarks picker test is now a hard assertion,
matching PR #11953's approach for tear sheets. Routing *logic* (STOP rows,
disambiguation, inline execution) is fully verified by the inject-mode tests in
`carta-portfolio-analytics-routing.test.yaml`, which force the router to run
regardless of picker behavior.

### References layout

```
carta-portfolio-analytics-routing/
├── SKILL.md                 ← this file (sole registered skill)
└── references/
    ├── soi.md                ← mirror of carta-soi/SKILL.md — ACTIVE
    ├── soi/                  ← copies of carta-soi's script + template (see below)
    │   ├── artifact.html
    │   └── scripts/render-artifact.py
    ├── co-investors.md       ← mirror of carta-co-investors/SKILL.md — ACTIVE
    ├── co-investors/         ← copies of carta-co-investors' scripts + data files
    ├── benchmarks.md         ← mirror of carta-performance-benchmarks/SKILL.md — ACTIVE
    ├── loan-dashboard.md     ← mirror of carta-loan-dashboard/SKILL.md — NOT YET WIRED (future route)
    └── loan-dashboard/
        └── artifact_template.html   ← copy of carta-loan-dashboard/references/artifact_template.html, used only by the Step 7e fallback path (see below)
```

`soi/` and `co-investors/` hold real copies of their source skills' scripts and
assets: the publish pipeline strips the whole directory of any `publish: false`
skill, so a published route must not reference `skills/carta-soi/` or
`skills/carta-co-investors/`. Both mirrored bodies point at these copies;
`benchmarks.md` needs none (self-contained SQL). `loan-dashboard.md` is different
again: its primary render path
(`$SKILL_DIR/references/artifact_template.html`, Step 7c) also resolves
correctly with no rewrite, since `$SKILL_DIR` is probed by literal name
(`carta-loan-dashboard`) same as the others — but its **fallback** path (Step
7e) calls `read_skill(file_path="references/artifact_template.html")`, a tool
that resolves relative to whichever skill is *currently executing*. Mirrored
verbatim, that call would resolve to this router's own `references/`, not
`carta-loan-dashboard`'s — so the fallback needed a real asset copy into
`references/loan-dashboard/` and a rewritten path. Check every source skill's
tool calls individually; `Read`/absolute-path/`$SKILL_DIR`-probe calls behave
differently from `read_skill`'s implicit-relative resolution, and a skill can
mix both (as this one does).

None of the routes below are dispatched from Step 3 and none have Step 1 route
rows — promoting them is wiring work only, per "How to promote a future route
to active" below, not a re-mirroring job.

### Route dispatched

| Route | Reference file | Status |
|---|---|---|
| `soi` | `references/soi.md` | GA — external users, executed inline (mirror of `carta-investors:carta-soi`) |
| `co-investors` | `references/co-investors.md` | GA — external users, executed inline (mirror of `carta-investors:carta-co-investors`) |
| `benchmarks` | `references/benchmarks.md` | GA — external users, executed inline (mirror of `carta-investors:carta-performance-benchmarks`) |
| `loan-dashboard` | `references/loan-dashboard.md` | Mirror built, **not wired** — internal-stage, awaiting GA |

### How to promote a future route to active

1. Confirm the underlying skill is GA for external users.
2. Decide dispatch mechanism:
   - **Mirror** (this router's pattern for all three active routes) — copy the backing skill's `SKILL.md` body verbatim into `references/<route>.md`. Check first whether the source skill has any `Read ${CLAUDE_PLUGIN_ROOT}/skills/<source>/...` calls or relative `references/` links that assume they're being read from the *source* skill's own directory — if so, rewrite those paths into a `references/<route>/` sub-directory (as `carta-compliance-routing` did for `form-adv`); if the source skill resolves its own paths dynamically or via literal skill-anchored strings (as all three routes here do), no rewrite is needed. Does **not** require touching the backing skill's frontmatter or `publish` flag, so its existing test coverage stays intact. Cost: the mirror can drift from the source if the backing skill changes later — there's no auto-sync, re-mirror by hand on every meaningful change.
   - **Direct dispatch** (simplest) — Step 3 just names the skill (`carta-investors:carta-<skill>`) with no `references/` copy at all. No duplication, no drift risk, but still inherits picker-competition risk if the skill's own description is trigger-phrase-rich.
   - **Mirror + de-tune** (carta-valuations-routing's pattern for `waterfall`) — mirror as above, *and* set the backing skill to `publish: false` plus soften its description. Eliminates picker competition, but changes the skill's public availability and can break existing tests that assert direct-picker behavior. Get explicit sign-off before doing this to any currently-public skill.
3. Add its signal phrases to the Step 1 Route rows table and the Customer Intent Framework.
4. Add it as an option in Step 2's `AskUserQuestion` (existing active routes keep their numbers; new route gets the next number; "Something else" moves to last).
5. Add a `Read ${CLAUDE_PLUGIN_ROOT}/skills/carta-portfolio-analytics-routing/references/<route>.md` row to the Step 3 table (mirror/mirror+de-tune) or the bare skill name (direct dispatch).
6. MINOR bump the version and add verdict tests — both inject-mode (routing logic) and plugin-mode (picker behavior, expect `failing: true` if the backing skill still wins the picker on its own).

---

## Future routes — not yet active

### Loan Dashboard

- **Status:** Internal stage — has a `version` field (`1.0.0`) but no `publish` field. Not GA for external users.
- **Mirror status:** Already built at `references/loan-dashboard.md` — one call rewritten (the Step 7e `read_skill` fallback, see References layout above) plus a real copy of `artifact_template.html` into `references/loan-dashboard/`. Every Bash pattern it needs (`carta workspace cache`, `uv run`, `test -d`/`-f`, `find`, `mkdir -p`) and `Artifact` are already in this router's `allowed-tools` (added for `carta-soi`'s own artifact calls). Only `read_skill` is missing — add it at promotion time.
- **Signals:** "loan dashboard", "loan portfolio", "show my loans", "loan overview", "draw balance", "drawn balance", "undrawn", "credit facility", "outstanding loans", "loan commitments", "borrower portfolio", "loan KPIs", "loan exposure"
- **CTA until GA:** "The loan portfolio dashboard is coming to external users soon. Reach out to your Carta account manager or contact Carta Support to request early access."
- **Skill when live:** `carta-investors:carta-loan-dashboard`
- **Dispatch mechanism to use:** Mirror already built — promote via `Read references/loan-dashboard.md` once the tool grants above are added.
- **Disambiguation to carry forward:** "loan portfolio" / "loans I've made" / "draw balance" → Loan Dashboard (once live); "my LP portfolio" / "LP investments" → out of scope, suggest `/carta-lp-reporting-routing` (do not confuse loan portfolio with LP portfolio — these are different products, "loan" vs "LP").
