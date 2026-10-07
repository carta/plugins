# Portfolio Valuation — Deep Link Construction

Single source of truth for constructing deep links into Carta from
portfolio valuation skill flows. All other reference files in this
skill point to this file rather than duplicating the URL tables.

> **For agent use only.** This reference defines URL construction
> rules; it is loaded by the orchestrator's context, not invoked by
> the user.

## Step 1: Resolve the app base URL

Read `environment` from `get_current_user` and map it (call it first if its
result isn't already in context — the Carta MCP bootstrap normally has it):

| `environment` | App base URL |
|---|---|
| `production` | `https://app.carta.com` |
| `preprod` | `https://app.preprod.carta.rocks` |
| `sandbox` | `https://app.sandbox.carta.team` |
| `demo` | `https://app.demo.carta.team` |
| `test` | `https://app.test.carta.rocks` |
| `local` | ambiguous — see below |

These are the `web_base_url` values `carta config list-envs` reports per
environment; re-derive from there if a new environment appears.

`local` is the one row you cannot resolve from the name alone. A local MCP
fronting the shared TEST backend serves `https://app.test.carta.rocks`, while a
fully local stack serves `http://localhost:8000` — the environment name is
identical either way. Ask the user which one they are on rather than picking.

**Never use `get_current_user`'s `base_url` field as `{BASE_URL}`.** It is the
API host, not the app host: on `test` it returns `https://test.carta.rocks`,
which resolves to the Kong API gateway and has no web app behind it. A link
built from it does not 404 — the browser aborts the connection before any page
loads, so don't go hunting for a Carta error page when one of these is wrong.
The app host always carries the `app.` prefix — and on production the
environment name drops out entirely (`app.carta.com`, not `app.production.…`),
so the prefix cannot be derived by string-munging `base_url` either. Use the
table.

Treat a row's name as a prefix, so `preproduction` still resolves to the
`preprod` row. If `environment` matches no row, ask the user which environment
they are in rather than guessing a host.

Throughout this file, the resolved base URL is referred to as
`{BASE_URL}`.

## Step 2: Pick the right URL pattern

Carta's portfolio valuation pages use **two distinct URL patterns**.
Use the one that matches the tab you're linking to. Both branch on the
valuation target's kind.

### First: resolve the target kind

A c-corp and an LLC sit under different portfolio routes, so resolve
`targetKind` and `targetId` **together** — they are a pair, and an LLC
has no `corporationId` at all:

1. the `target` object (`kind` and `id`) on the resolved project from
   `list:projects`, captured by the orchestrator's Step 2.5a; or
2. the matched company's `isLlc` / `llcIssuerId` from
   `list:portfolio_dashboard` — `isLlc: true` means `LLC_ISSUER` with
   `llcIssuerId` as the `targetId`; otherwise `CORPORATION` with
   `corporationId`.

Never default to `CORPORATION` when the signal is absent: pairing that
kind with an LLC issuer id builds a URL that 404s. If neither source is
in context, use the firm's portfolio landing page (see **When a pattern
can't be built** at the end of this file) rather than guessing a kind.

`LLC_ENTITY` never reaches this file — SKILL.md Step 2.5a stops that
deprecated target kind upstream.

### Pattern A — landing / overview (uses `project_id`)

For the project-level landing page (versions list, valuation
ledger). The portfolio segment differs per target kind:

`CORPORATION`:

```
{BASE_URL}/investors/firm/{ownerId}/portfolio/investment/{targetId}/valuations/portfolio-valuations/projects/{project_id}/versions
```

`LLC_ISSUER` — `/portfolio/llc/`, not `/portfolio/investment/`:

```
{BASE_URL}/investors/firm/{ownerId}/portfolio/llc/{targetId}/valuations/portfolio-valuations/projects/{project_id}/versions
```

### Pattern B — specific tabs within a candidate (uses `valuation_id`)

For tabs scoped to a specific valuation candidate, use the
`valuation_id` (NOT the candidate_id or project_id). The
`valuation_id` is the `valuationDetails.id` field returned by
`create:project`, `create:project_from_copy`, and
`get:valuation`. Capture it on candidate selection so you can
construct these URLs without re-fetching.

Base template, `CORPORATION`:

```
{BASE_URL}/investors/firm/{ownerId}/portfolio/investments/view/investment/{targetId}/portfolio-valuations/valuation/{valuation_id}/{tab}
```

Base template, `LLC_ISSUER`:

```
{BASE_URL}/investors/firm/{ownerId}/portfolio/llc/{targetId}/portfolio-valuations/valuation/{valuation_id}/{tab}
```

The LLC form is not a one-segment swap of the c-corp form — it drops
`investments/view/investment` entirely, and it has **no `/valuations/`
segment** before `portfolio-valuations` (Pattern A does have one). Build
it from the template above rather than editing the c-corp URL.

Replace `{tab}` with the value from the table below. The `{tab}` values
are identical for both kinds — only the prefix differs.

## Step 3: Tab paths

| Reference file using this | `{tab}` value | Notes |
|---|---|---|
| `cap-table-review.md` | `cap-table` | |
| `financials-review.md` | `financials` | |
| `set-approaches.md` | `value-company` | Approaches / methodology landing |
| `comps.md` | `comparables` | Comp set selection |
| `gpc-analysis.md` | `value-company/gpc/conclusion` | GPC multiples + conclusion |
| `allocation.md` | `value-holdings` | Allocation results |
| `backsolve.md` | `value-company/backsolve` | Backsolve approach landing (setup, share class, timeline/debt/etc.) |
| `backsolve.md` (Step 4 results) | `value-company/backsolve/results` | Full Backsolve results — share class breakdown, breakpoints |

## Step 4: References that don't have a dedicated tab

| Reference file | Recommended URL |
|---|---|
| `audit-notes.md` | Pattern A (landing) — no audit-notes tab in Carta |
| `ship.md` | Pattern A (landing) — no finalize tab in Carta |
| `add-candidate.md` | Pattern A (landing) — versions list shows the new candidate |
| `create-val.md` | Pattern A (landing) — versions list shows the new candidate |

## Step 5: Render the link

Render every Carta link as a markdown hyperlink with a short, descriptive
label — `[Label](URL)` — so the user clicks the label instead of copying a
long URL. Never print the bare URL, and never put the link inside a fenced
code block: a code block shows the text but does not render it as a link.
This applies in every `env_mode` (`artifact`, `preview-server` and `inline`),
so this file does not branch on `env_mode`.

The default label is **View in Carta**. Use a more specific label when
context warrants — e.g. **Edit financials in Carta** for the financials
review fallback. If a URL ever contains a space or a closing parenthesis,
percent-encode it so the link does not break.

Example for the cap table tab on Meetly's Q2 2026 valuation — a
`CORPORATION` (`ownerId=1`, `targetId=7`, `valuation_id=1323`):

[View in Carta](https://app.test.carta.rocks/investors/firm/1/portfolio/investments/view/investment/7/portfolio-valuations/valuation/1323/cap-table)

Same tab for an `LLC_ISSUER` (`ownerId=1`,
`targetId=c3d27e81-1098-4735-a4cf-7b52d4506361`, `valuation_id=1408`):

[View in Carta](https://app.test.carta.rocks/investors/firm/1/portfolio/llc/c3d27e81-1098-4735-a4cf-7b52d4506361/portfolio-valuations/valuation/1408/cap-table)

## When `valuation_id` is missing

If `valuation_id` isn't in context, fetch it via
`portfolio_valuations:get:valuation` and use the top-level `id`
field. (Equivalently, it's the `valuationDetails.id` field in
`create:project`, `create:project_from_copy`, and the candidate
nested in `list:projects` — all four expose the same value.)

Capture `valuation_id` once on candidate selection and keep it in
context so subsequent deep links don't re-fetch.

If the fetch fails or returns null, fall back to **Pattern A**
(landing) using just `project_id` — better to land the user on
the project than to skip the deep link.

## Cap table access request page

Firm-level, not candidate-scoped — takes only `{ownerId}` (the resolved
`org_pk`), no `targetId`, `project_id`, or `valuation_id`. Use this
whenever the user asks how to request cap table access, or asks for
"the request access link" — whether or not the dashboard's "No cap
table access" group is currently in view. This is the same URL the
dashboard's "Request access" button opens (`build_artifact.py`'s
`_request_access_url()` / `templates/dashboard.html`'s `renderPrepCard`
build it identically for the interactive surfaces); this section exists
so the plain-chat path can construct the identical URL on request.

```
{BASE_URL}/investors/firm/{ownerId}/information-access/?has_active_holdings=true&inactive=false&ordering=captable_access&page=1&page_size=50
```

Render it per **Step 5** above:

[Request cap table access](https://app.test.carta.rocks/investors/firm/1/information-access/?has_active_holdings=true&inactive=false&ordering=captable_access&page=1&page_size=50)

## Firm investments dashboard

The firm's investment list. Used for companies with no cap table on Carta —
they have no per-company valuation page, so this is where the dashboard's
"Open Carta" button sends the user to build a pro-forma cap table.

```
{BASE_URL}/investors/firm/{ownerId}/portfolio/investments/?date={YYYY-MM-DD}&group=ungrouped
```

`date` is today's date. The dashboard's button stamps it at click time
(`datedInvestmentsHref()` in `templates/dashboard.html`) rather than baking
it into the payload, because a preview panel can sit open past midnight;
`build_artifact.py`'s `_investments_url()` therefore emits the bare path.
When constructing this URL in plain chat, use today's date directly.

Render it per **Step 5** above:

[Open investments](https://app.test.carta.rocks/investors/firm/1/portfolio/investments/?date=2026-09-10&group=ungrouped)

## Investment overview (fix a failed valuation)

For a company where valuation creation **failed** (e.g. a bulk-run error)
— there is no `project_id` or `valuation_id` to link to, since nothing
was created. Send the user to the investment/holdings overview page
instead, so they can fix the underlying issue (e.g. a missing OIP or
conversion ratio) and retry. Resolve `targetKind`/`targetId` per **Step
2's "resolve the target kind"** above — same pairing rule applies here.

`CORPORATION`:

```
{BASE_URL}/investors/firm/{ownerId}/portfolio/investment/{targetId}/overview
```

`LLC_ISSUER`:

```
{BASE_URL}/investors/firm/{ownerId}/portfolio/llc/{targetId}/holdings
```

Note the LLC form is not a one-segment swap of the c-corp form — it's a
different last segment (`holdings`, not `overview`) as well as the
`/llc/` portfolio segment.

Render it per **Step 5** above:

[Fix in Carta](https://app.test.carta.rocks/investors/firm/1/portfolio/investment/7/overview)

Same tab for an `LLC_ISSUER` (`ownerId=1`,
`targetId=c3d27e81-1098-4735-a4cf-7b52d4506361`):

[Fix in Carta](https://app.test.carta.rocks/investors/firm/1/portfolio/llc/c3d27e81-1098-4735-a4cf-7b52d4506361/holdings)

## When a pattern can't be built

Never invent a path segment to fill a gap. If `project_id` is missing too
(routine for an LLC holding with no valuation yet), or the target kind
can't be resolved so you don't know which portfolio segment to emit, use
the firm's portfolio landing page:

```
{BASE_URL}/investors/firm/{ownerId}/portfolio
```

Render it per **Step 5** above, labeled **Open your portfolio**. Say plainly why the specific link isn't available. Don't present the
landing page as though it were the page the user asked for.
