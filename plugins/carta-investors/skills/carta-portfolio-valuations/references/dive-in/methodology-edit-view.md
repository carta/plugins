# Enter valuation method inputs and weights by hand

An MCP App view that shows the valuation's **Select and weigh valuation methods** table, as on
the Value company tab in Carta: each method's company value, DLOM and discounted value when DLOM
is set up, its weighting and weighted value, and the weighted company value. In the view the user
selects methods, enters a value by hand for any method (GPC, Post-money, Custom value and the
rest), sets each method's weighting, and saves.

## When to open it

Open it whenever the user says they want to enter something themselves for any valuation method,
or for the weighting of each method — for example:

- "let me enter the inputs for the methods myself"
- "I want to type in the GPC / post-money / custom value myself"
- "I'll put in the weights", "I want to set the weighting manually"
- "let me weigh the methods", "show me the methods table so I can edit it"

This overrides `references/dive-in/set-approaches.md` Step 1 for these requests: don't ask for the
approach, a method's value or the split in chat. A request that already gives the answer — the
split ("GPC 60% / M&A 40%") or the value ("set the company value to 50M") — is not a request to
enter it by hand, so it stays with `set-approaches.md`.

## Offer it instead of sending the user to Carta

When a method still needs a value this skill can't collect in chat (M&A, Post-Money, Backsolve's
value, …), never tell the user to go to Carta for it. Ask instead, and wait for the reply:

> "Want me to open the methods table so you can enter the **{method}** value for
> **{company name}**?"

On yes, open it (below). On no, leave it: the method stays enabled with no value, and the user can
ask again later.

## Open it

```
view_remote({"name": "portfolio_valuations:view:methodology_edit",
             "params": {"valuation_id": <valuation_id>}})
```

`valuation_id` is the valuation's **integer** id — the `valuationId` on the `list:projects`
candidate. It is the only parameter. The view fetches the configuration, the currency and the
approaches itself, so don't call `get:approaches` or `get:configuration` first, and don't pass
`ownerId`, `project_id` or `candidate_id`.

## After it opens

**The view saves the change itself.** Stop after opening it and wait. Don't call
`mutate:approaches`, `mutate:custom_value` or any other method's write as well — that writes
twice — and don't ask for any value or weight in chat while it is open. Don't describe the table back to the user; they can see it.

When the user says they saved, re-read `get:approaches`, show what changed per SKILL.md
**Writes — save, then show what was saved**, refresh the page (**Page navigation → Refresh the
page after a change**) and re-render the Step 2.5c checklist.

## When the view cannot be used

- **A terminal client** cannot render the view. `view_remote` then returns a line of text saying
  the table is showing — that is the fallback working, not a failure. Say you'll collect the
  methods and weights in the conversation instead and follow `set-approaches.md` from Step 1.
- **`view_remote` errors, or the view isn't available to this user** (it is rolled out behind a
  feature flag). Don't retry and don't mention the view or the error. Follow `set-approaches.md`
  from Step 1 as if the view didn't exist.

Either way, a Post-Money value can still be collected in chat (`set-approaches.md` Step 4,
Post-Money). For a method with no chat path, say plainly it can't be entered here right now — don't
point the user at Carta for it.
