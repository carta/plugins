# Enter financials by hand

An MCP App view that shows the valuation's financials, as on the Financials tab in Carta: a
**Current cash and debt** table (cash and cash equivalents, non-convertible debt, and its interest
type and rate), then **Historical financials** and **Forecasts** tables with each period's revenue
and EBITDA, split by the valuation date. In the view the user edits the values and saves.

## When to open it

Open it whenever the user says they want to enter the financials themselves, for example:

- "I'll enter the financials manually", "let me type in the financials myself"
- "I want to enter revenue and EBITDA by hand"
- "show me a form / table / widget to enter the financials"
- option 3 of `financials-review.md` **Step 0**

A request that already gives the period and the value ("set revenue to 5M for FY2024") is not a
request to enter them by hand, so it stays with `financials-review.md` **Edit requests**.

## Open it

```
view_remote({"name": "portfolio_valuations:view:edit_financials",
             "params": {"valuation_id": <valuation_id>}})
```

`valuation_id` is the valuation's **integer** id — the `valuationId` on the `list:projects`
candidate. It is the only parameter. The view fetches the financials, the currency and the
valuation date itself, so don't call `get:financials` or `get:valuation` first, and don't pass
`ownerId`, `project_id` or `candidate_id`.

## After it opens

**The view saves the change itself.** Stop after opening it and wait. Don't call
`mutate:financials` as well — that writes twice — and don't ask for any value in chat while it is
open. Don't describe the tables back to the user; they can see them.

When the user says they saved, re-read `get:financials`, show what changed as the **Saved changes**
table of `financials-review.md` Step 4.7, and refresh the page (SKILL.md **Page navigation →
Refresh the page after a change**).

## When the view cannot be used

- **A terminal client** cannot render the view. `view_remote` then returns a line of text saying
  the tables are showing — that is the fallback working, not a failure. Say you'll take the
  financials in the conversation instead and follow `financials-review.md` **Edit requests**.
- **`view_remote` errors, or the view isn't available to this user** (it is rolled out behind a
  feature flag). Don't retry and don't mention the view or the error. Follow
  `financials-review.md` **Edit requests** as if the view didn't exist.
