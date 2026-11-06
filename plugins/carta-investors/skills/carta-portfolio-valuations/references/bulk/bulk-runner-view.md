# Bulk Run Picker View

The runner's selection screen, as an MCP App view. One view replaces the numbered table, the
row-number reply, the date question and the per-company approach questions. It shows:

- one **valuation date** for the whole run, with today and the last month, quarter and year
  ends as shortcuts;
- every company with a readable cap table, **Existing valuations** first, then **No valuation
  yet**. The user ticks a company and picks its method: Copy previous approach (existing only),
  GPC, Backsolve, Post-money, Custom Company Value or M&A. Post-money and Custom Company Value
  take a value; once one is entered the view offers an optional allocation method,
  **Waterfall** or **Common Stock Equivalent**, with a note that OPM needs more inputs than a
  bulk run collects.

A company's latest event (financing round, tender offer, share transfer) fills in its method,
and its row says which event: after a financing round, Post-money at the round's post-money
value; after a tender offer or share transfer, Backsolve. Nothing is ticked.

Read by `references/md-table-runner.md` Step 0. Never surface the view's internals (prop names,
`methodology` keys) in chat.

## Open it

```
view_remote({"name": "portfolio_valuations:view:edit_bulk_val",
             "params": {"organizationId": <org_pk>}})
```

`organizationId` is the firm's **integer** org_pk, the one `list:portfolio_dashboard` takes. It
is the only parameter. The view reads the portfolio itself, so don't pass companies, and don't
print the table or the approach signals: each company's row shows its recommendation.

## After it opens

Stop and wait. Don't describe the view back to the user, and don't ask for companies, methods,
values or the date in chat while it is open.

## What the view sends back

Clicking **Create draft valuations** sends one message as the user. The view has already
checked that a company is ticked, every ticked company has a method, every Post-money and
Custom Company Value company has a valid value, and the date is today or earlier:

```
Run bulk valuations as of 2026-09-30, all as Draft:
1. BetaHex (id 3) — Copy previous approach
2. Meetly (id 81) — GPC
3. MangoCart, Inc. (id 112) — Post-money (25,000,000), Waterfall allocation
4. Acme (id 4) — Custom Company Value (15,000,000), Common Stock Equivalent allocation
5. Holdco LLC (id 6f1c2e9a-…) — Custom Company Value (8,000,000)
```

Treat that message as the user's confirmed plan. **Skip `md-table-runner.md` Steps 1–7 and go
straight to Step 8.** Don't echo the plan or ask "yes / go" again.

Parse each line into the `create:bulk` payload:

| Label in the message | Sent as |
|---|---|
| `Copy previous approach` | `copyFromPrevious: true`, no `methodology` |
| `GPC` | `methodology: "gpc"` |
| `Backsolve` | `methodology: "backsolve"` |
| `Post-money (value)` | `methodology: "post_money"`; the value is applied in `bulk-runner.md` Step 6.3 |
| `Custom Company Value (value)` | `methodology: "other_indication_of_value"`; the value is applied in Step 6.3 |
| `M&A` | `methodology: "ma"` |

The `(id …)` after the name is the company's `targetId`: a number is a `corporationId`
(`targetKind: "CORPORATION"`), anything else an `llcIssuerId` (`targetKind: "LLC_ISSUER"`). No
dashboard lookup is needed. Every item's `valuationDate` is the single date after `as of`.
Values are whole amounts with commas.

A trailing `, Waterfall allocation` or `, Common Stock Equivalent allocation` is that company's
allocation method, `WATERFALL` or `COMMON_STOCK_EQUIVALENT`, which `bulk-runner.md` Step 6.3
checks, saves and runs after the value. No suffix means leave the allocation as created.

If the user types a change instead of using the view ("also add Zeta", "make row 2 Backsolve",
"make row 3 Waterfall"), apply it to the plan from the view's last message, keeping each row's
allocation method, and show the updated plan as the Step 7 list from `md-table-runner.md`
(which shows allocation methods), then wait for a yes. A company that isn't in the view's
message has no `(id …)`: resolve it to its `corporationId` or `llcIssuerId` from
`list:portfolio_dashboard`, fetched as SKILL.md Step 3.2 does. A message that isn't from the view never
skips that confirmation, and Step 8 runs the plan the user confirmed.

## When the view cannot be used

- **A terminal client** cannot render the view. `view_remote` then returns a line of text saying
  the picker is showing — that is the fallback working, not a failure. Use the table flow,
  `md-table-runner.md` Steps 1–7.
- **`view_remote` errors, or the view isn't available to this user** (it is rolled out behind a
  feature flag). Don't retry and don't mention the view or the error. Use the table flow as if
  the view didn't exist.
