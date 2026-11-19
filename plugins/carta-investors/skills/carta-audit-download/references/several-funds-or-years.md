# Several funds or audit years

The carta-audit-download skill reads this during Step 2 when the caller wants
more than one fund or audit year. Step numbers are that skill's.

## Order of work

For several funds or years: run Step 3 for every fund and year, firm by firm as
"Several funds at once" step 4 says; then Step 3b once for the whole batch, whose areas
and document types apply to every fund and year; then Steps 4–5 once per (fund, year,
area), using the rows Step 3 kept. Never show Step 3b once per fund or year, and never
list a fund again after Step 3b. "Firm by firm" is the only serial part: within one
firm, every fund, year and area goes out together, as Step 3 and Step 4 say. If a fund
or year covers more than one area ("download all", or several picked areas), nest the
per-area loop inside it.

---

## Multiple funds — one list and export per fund, polled together

The underlying commands each take one `fund_uuid`, so there's no combined multi-fund
export: never merge documents across funds into one export call or one zip. Follow the
"Order of work" above. The exports are sent in one message per firm and polled together
in the same rounds, never one fund after another. With several firms, a poll round
visits them one at a time: switch context to a firm, poll its pending tasks in one
message, then the next firm. A permission error or zero documents on one fund is
terminal **for that fund only**: note it and continue with the rest. Rows in the final
summary run one per fund, named and ordered as the summary section says. One document
index covers the whole run.

---

## Multiple audit years — one list and export per year, polled together

`fa__list__audit-documents` filters by exactly one `audit_year` server-side, so there's
no "all years" list. If the caller wants more than one year (or a range, e.g. "2024 and
2025" or "last three years"), collect every year up front in Step 2. Follow the "Order
of work" above, passing each year's own `audit_year` to its list and export, polled
together with the other exports of the run. Zips are never merged across funds or years, matching how the investor-portal Audit
Documents page segments by audit year. A permission error or zero documents on one
year is terminal **for that year only**.
