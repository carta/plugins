# Portfolio Valuation — Tutorial: a probability-weighted valuation

A guided walkthrough of PWERM, for someone who has not built one before. Every figure below is
made up — **Nova Dynamics** is a fictional company and nothing here reads or writes real data.

Run it as a conversation, not a document. Show one section, then stop and wait for the user to
say **"next"** before the following one. If they ask a question mid-way, answer it and offer to
carry on from where you were.

At the end, offer to do it for real on one of their own companies.

---

## Section 1: What PWERM is for

Most valuations answer one question: what is this company worth? A probability-weighted
valuation answers a harder one — **what is it worth when more than one future is plausible?**

Say Nova Dynamics is mid-way through an FDA approval. Approved, it is worth a great deal.
Rejected, it is worth its cash and its patents. A single number hides that; a PWERM shows it:

| Outcome | How likely | What it's worth |
|---|---:|---:|
| Downside — approval denied | 30% | $20M |
| Base — approval, slow uptake | 50% | $55M |
| Upside — approval, fast uptake | 20% | $120M |
| **Blended value** | **100%** | **$57.5M** |

Each outcome is a **scenario** with a weight. Carta values each one separately, then blends them
by weight into the company value the valuation reports.

> Say **"next"** to build one.

---

## Section 2: Agree the outcomes first

The flow asks for the outcomes and their weights together, in one question — a weight means
nothing without the outcome it belongs to.

> *"What outcomes would you like to weight, and how likely is each? For example:
> Downside 30%, Base 50%, Upside 20%."*

Two rules hold here, and both exist because the alternative is a silent mistake:

- **At least two scenarios.** One outcome at 100% is an ordinary valuation, and the flow will
  say so and offer that instead.
- **The weights must total 100%.** If they don't, you get the sum back and a question — never a
  quiet adjustment:

  > *"Those come to 90%. Is there a fourth outcome at 10%, or should one of these be higher?"*

  Someone who says 30/30/30 may have meant to add a fourth scenario, not to be scaled up.

> Say **"next"** to create it.

---

## Section 3: One confirmation, then the candidate exists

With the outcomes agreed, the whole thing is created in a single call — the valuation, its three
scenarios and their weights together. You confirm once, at the point the numbers are settled,
not three times on the way.

```
Created "Nova Dynamics — FDA outcomes" with three weighted scenarios:

  Downside   30%     no value yet
  Base       50%     no value yet
  Upside     20%     no value yet

Each scenario needs a company value before the blend can be shown.
Shall I start with the downside?
```

Nothing is weighted into a number yet. The scenarios exist; they are empty.

> Say **"next"** to value them.

---

## Section 4: Value each scenario, one at a time

A scenario is valued exactly as an ordinary valuation is — GPC multiples, a backsolve, a
post-money, an M&A comparison, or a value you type in. The difference is that the method applies
to **that scenario**, not to the company as a whole.

> *"Set the downside's company value to 20M."*
> *"Use GPC for the base case."*
> *"Run a backsolve on the upside."*

After each one, allocation runs for that scenario so the value reaches the holdings:

```
Downside: company value $20M, allocation complete.
Base:     company value $55M, allocation complete.
Upside:   still needs a company value.
```

**One thing worth knowing.** The methods table — the grid you may be used to opening to type
values in by hand — can only reach a standard valuation, not a single weighted scenario. On a
PWERM the flow will decline to open it and take the values in conversation instead. That is
deliberate: the table would save to a scenario that carries no weight, and the number would
quietly never reach the blend.

> Say **"next"** to see where it stands.

---

## Section 5: Readiness, and the blend

At any point you can ask what is left:

> *"Where is this valuation up to?"*

The answer comes from the valuation itself, not a checklist — so it stays right as the product
changes:

```
Upside still needs a company value.
Everything else is valued and allocated.
```

Once nothing is outstanding, the blend appears:

| Scenario | Weight | Company value |
|---|---:|---:|
| Downside | 30% | $20,000,000 |
| Base | 50% | $55,000,000 |
| Upside | 20% | $120,000,000 |
| **Blended** | **100%** | **$57,500,000** |

> Say **"next"** for changing one.

---

## Section 6: Changing it later

A draft PWERM stays editable, and re-weighting is the common request:

> *"Make the downside 44%."*

Because the weights must still total 100%, the flow works out what else has to move and shows
you the whole set before writing anything:

| Scenario | Now | After |
|---|---:|---:|
| Downside | 30% | **44%** |
| Base | 50% | **40%** |
| Upside | 20% | **16%** |
| **Total** | **100%** | **100%** |

> *"Taking Downside to 44% leaves 56% across Base and Upside, so I've kept their current 5:2
> ratio. Good to save?"*

The blended value moves with them — $50.0M at these weights, against $57.5M at the originals.

Adding an outcome works the same way, and a new scenario arrives needing a value of its own.
Re-weighting changes no scenario's own value, so nothing needs re-valuing.

> Say **"next"** to finish.

---

## Section 7: Finalizing

Finalizing is the one step that always stops and asks, separately from everything above, because
it cannot be undone:

> *"Finalizing Nova Dynamics — FDA outcomes locks it as FINAL. This can't be undone.
> Company value: $57,500,000. Shall I go ahead?"*

An earlier "finalize it" is the request, not the answer — the flow still waits for a yes at the
point of writing.

After that the valuation is read-only. Its scenarios and weights can't be changed, and only
Carta staff can reopen it, so re-weight before you finalize rather than after.

---

## Wrap-up

| What you want | What to say |
|---|---|
| Build one | "Set up a probability-weighted valuation for {company} — Downside 30%, Base 50%, Upside 20%" |
| Value a scenario | "Set the downside's company value to 20M" / "Use GPC for the base case" |
| See where it stands | "Where is this valuation up to?" |
| Re-weight | "Make the downside 44%" |
| Add an outcome | "Add a stretch case at 10%" |
| See the result | "Show me the blend" |

Then offer the real thing: *"Want to set one up on one of your own companies?"*

**On yes, start the skill properly.** Nothing above touched Carta, so there is no firm, no
company and no access check yet. Go to **Gate 1**, then **Step 1** to settle the firm, then ask
which company and take it in as the Routing table's single-company row does: **Step 2.5**
resolves its project, and Step 2.5b's PWERM row opens `references/dive-in/pwerm.md`.

Don't jump from a company's name straight into `pwerm.md`. Its prerequisites expect `ownerId`
and `project_id` already in hand, and only Step 2.5 produces the second — skip it and the flow
either asks the user for ids nobody has, or takes the no-project-yet create path for a company
that already has one.
