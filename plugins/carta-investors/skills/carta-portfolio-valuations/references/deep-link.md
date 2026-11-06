# Portfolio Valuation — Deep Link Construction

Single source of truth for the Carta links this skill gives. All other
reference files in this skill point to this file rather than duplicating
the URL tables.

> **For agent use only.** This reference defines URL construction
> rules; it is loaded by the orchestrator's context, not invoked by
> the user.

## Step 1: Resolve the app base URL

Resolve `{BASE_URL}` per `${CLAUDE_PLUGIN_ROOT}/references/app-host.md`.

## Step 2: No links to the valuations dashboard

The portfolio valuations dashboard (its firm, company and valuation pages,
under `/investors/firm/{ownerId}/portfolio-valuations-dashboard`) is the
dashboard MCP App (`references/dashboard-view.md`), so this skill never
links it: no **View in Carta**, **Valuations dashboard**, **Open {company}
in Carta** or `{DEEP_LINK}` / `{DASHBOARD_LINK}` link to any of those pages,
with or without the MCP App open. Never link the older valuation pages
outside the dashboard either.

Where a flow points the user at a page to finish something there, name the
page in Carta's valuations dashboard and offer to take them there (SKILL.md
**Page navigation → After an action, offer instead of moving**), without a
link. A pick of an **Edit in Carta** menu option, or a request like "open
this valuation in Carta to …", is a direct request for the page: open it
(SKILL.md **Page navigation → Which page to open**) instead of offering.

The only Carta links this skill gives are the pages below: the cap table
access request page, the firm investments dashboard and the investment
overview. Each is outside the valuations dashboard.

### The ids the MCP App takes

`open_company` and `open_valuation` (`references/dashboard-view.md` **Open
a page in it**) take these ids.

`companyId` is the company's `corporationId` for a c-corp, or its
`llcIssuerId` for an LLC — the same value as the valuation target's
`targetId`. Take it from, in order:

1. the `target.id` on the resolved project from `list:projects`, captured by
   the orchestrator's Step 2.5a; or
2. the matched company's row in `list:portfolio_dashboard` — `llcIssuerId`
   when `isLlc` is true, otherwise `corporationId`.

Never pass a `corporationId` for an LLC, or the reverse — it opens the wrong
company or none. If neither source is in context, pass the company's name.

`LLC_ENTITY` never reaches this file — SKILL.md Step 2.5a stops that
deprecated target kind upstream.

`valuation_id` is the `valuationDetails.id` field returned by
`create:project`, `create:project_from_copy`, and `get:valuation` (its
top-level `id`) — NOT the `candidate_id` or `project_id`. It is always a
whole number. Capture it on candidate selection so you don't re-fetch it.

## Step 3: Render the link

Render every Carta link as a markdown hyperlink with a short, descriptive
label — `[Label](URL)` — so the user clicks the label instead of copying a
long URL. Never print the bare URL, and never put the link inside a fenced
code block: a code block shows the text but does not render it as a link.
If a URL ever contains a space or a closing parenthesis, percent-encode it
so the link does not break.

## Cap table access request page

Firm-level, not candidate-scoped — takes only `{ownerId}` (the resolved
`org_pk`), no `companyId`, `project_id`, or `valuation_id`. Use this
whenever the user asks how to request cap table access, or asks for
"the request access link" — whether or not the dashboard's "No cap
table access" group is currently in view.

```
{BASE_URL}/investors/firm/{ownerId}/information-access/?has_active_holdings=true&inactive=false&ordering=captable_access&page=1&page_size=50
```

Render it per **Step 3** above:

[Request cap table access](https://app.test.carta.rocks/investors/firm/1/information-access/?has_active_holdings=true&inactive=false&ordering=captable_access&page=1&page_size=50)

## Firm investments dashboard

The firm's investment list. Used for companies with no cap table on Carta —
they can't be valued until they have one, so this is where to send the user
to build a pro-forma cap table.

```
{BASE_URL}/investors/firm/{ownerId}/portfolio/investments/?date={YYYY-MM-DD}&group=ungrouped
```

`date` is today's date.

Render it per **Step 3** above:

[Open investments](https://app.test.carta.rocks/investors/firm/1/portfolio/investments/?date=2026-09-10&group=ungrouped)

## Investment overview (fix a failed valuation)

For a company where valuation creation **failed** (e.g. a bulk-run error)
and the cause is in the company's holdings data (e.g. a missing OIP or
conversion ratio). The fix is made on the investment/holdings page, which
the valuations dashboard doesn't have, so this is the one company-level link
outside it. Use it only for this fix; to show the company itself, open its
page in the dashboard MCP App.

`CORPORATION` (`targetId` = `corporationId`):

```
{BASE_URL}/investors/firm/{ownerId}/portfolio/investment/{targetId}/overview
```

`LLC_ISSUER` (`targetId` = `llcIssuerId`):

```
{BASE_URL}/investors/firm/{ownerId}/portfolio/llc/{targetId}/holdings
```

Note the LLC form is not a one-segment swap of the c-corp form — it's a
different last segment (`holdings`, not `overview`) as well as the
`/llc/` portfolio segment. Resolve which id and kind per **The ids the MCP
App takes** above.

Render it per **Step 3** above:

[Fix in Carta](https://app.test.carta.rocks/investors/firm/1/portfolio/investment/7/overview)

Same page for an `LLC_ISSUER` (`ownerId=1`,
`targetId=c3d27e81-1098-4735-a4cf-7b52d4506361`):

[Fix in Carta](https://app.test.carta.rocks/investors/firm/1/portfolio/llc/c3d27e81-1098-4735-a4cf-7b52d4506361/holdings)
