# Attributing spend: vendors, and accounts that pay people

Steps 4.5 and 4.6, **both opt-in** — run neither unless the operator asked for
it. Reached from [budget-ingest.md](budget-ingest.md).

> Steps referenced here that are documented elsewhere: **Step 3** → [data-fetch.md](data-fetch.md); **Step 4** → [serve-and-update.md](serve-and-update.md).

## Step 4.5 — Infer vendors for unattributed spend (opt-in)

**Strictly opt-in — changes nothing by default.** The Top Vendors chart
renders from the vendor Carta recorded unless the user asks for this.

Run only when the built snapshot's `vendorSpend.unattributed_amount` is a
meaningful share of `total_expense` (say a fifth or more) and the user opts
in. Mirrors `carta-investors:carta-manco`'s Gate 5.5 — same rules, because
they are the ones that keep a guess from reading as a fact.

**Offer it** with the figure, so the decision is informed:

> `<amount>` (`<pct>`% of expense) sits on entries with no vendor. Want me
> to read their descriptions and propose vendors?

**Say "description", not "memo".** Carta labels this field Description
everywhere a journal entry appears, and reserves Memo for other records — a
bank transaction's memo, a payment obligation's memo. A user may still ask
about "the memos"; understand them and answer in the product's word, so the
one they read back matches the column they can see in the ledger.

**Judge, don't parse.** A regex over these descriptions produces categories
and month labels as vendors — measured on real firms, it returned "Tax",
"Employee benefits - Jan 2026" and "Ramp transactions for January" as top
vendors, each of which would outrank real ones in a dollar-sorted chart.

For each unattributed entry, read `description` — the journal header's text,
so every line of one journal repeats it:

- Prefer a vendor **already in `vendorSpend.vendors`** — reconciles to a bar
  the reader can already see.
- `[Expensify] Amazon.com*5b0kg6l73` and `[Expensify] Amazon.com` are the
  same vendor. Strip the card-transaction suffix.
- **A description naming only a person is not a vendor.** `Ramp Reimbursement -
  <name>` and `<name> Expensify - Expense Report` name the employee who
  filed, not who was paid; the merchant is in Expensify or Ramp, not Carta.
  Leave these unattributed rather than putting staff on a vendor chart.
- **A description naming a category is not a vendor** — "Tax", "Employee
  benefits - Feb 2026", "Ramp transactions for January".
- Not confident → leave it. The unattributed bucket is honest; a wrong
  vendor is not.

**Confirm before writing.** Show a preview — Description | Vendor | New or
existing | Amount — then `AskUserQuestion`: apply all, apply only matches
to existing vendors, or cancel.

**Write approved mappings** to `<dashboard_dir>/vendor-config.json` and
re-run Step 4's build, which folds them in:

```json
{"mappings": [{"entry_id": "<journal entry id>", "vendor": "Amazon"}],
 "aggregate_accounts": [7112]}
```

Keyed on entry id, not description text, so a re-run applies exactly what
was approved. Never write inferred vendors back to Carta — this is report-only.

**The decision lands on the entry, so it reaches every vendor surface** —
the chart, the row breakout, the census that decides whether a vendor
breakout is worth offering, and the drawer's filter. Approving a vendor in
one view and seeing the same spend as "Not specified" in the next is the
report contradicting itself with nothing on the page to explain it.

It stays separable everywhere it lands: the chart shades inferred amounts
and names the total, and an entry in the drawer says `inferred` beside the
name. A reader can always tell which part was judged rather than recorded.


## Step 4.6 — Accounts that pay people rather than suppliers (opt-in)

**An individual is not automatically a problem.** A consultant invoicing
for professional fees is a supplier, is booked as a plain `Vendor`, and
stays named on the chart like any other. That is what the firm's own books
say they are, and grouping them away would hide a real supplier
relationship.

Two other cases are not that, and they are handled differently.

### Reimbursements — Carta marks these itself

`VENDOR_TYPE` on a journal entry line reads either `Vendor` or
**`Reimbursement Individual`**. The second names who was *repaid*, not who
was *paid*: the hotel, the restaurant, the carrier are nowhere in Carta.
Listing that person beside real suppliers reads as spend with an employee,
which is not what happened.

The build groups them under **"Employee reimbursements"** — one line
carrying the full amount, no names. Grouped, never dropped: the spend is
real and belongs in the total. The person stays on the entry as
`reimbursed_to`, so the drawer can still say whose expense it was, and a
firm that wants them named on the chart says so once by setting
`name_reimbursement_individuals: true` in `vendor-config.json`.

**Offer the breakout when it would be read.** Where reimbursements are a
material share of expense, ask whether naming the individuals is useful to
this firm — some want to see who is spending, most do not want staff names
on a report a client may see:

> `<N>` reimbursement lines totalling `<amount>` across `<K>` people are
> grouped as "Employee reimbursements". Want them broken out by person?

### Individuals Carta doesn't mark — the booking does

Firms also book reimbursements against ordinary vendor records, which
carry no `VENDOR_TYPE` flag at all. Those are caught by **how the entry was
settled**, not by what was bought: Query A2 ([data-fetch.md](data-fetch.md))
returns every entry that touches the firm's reimbursement-payable account,
and the expense lines in those entries group the same way the flagged ones
do.

This needs no confirmation, because it isn't a guess. A reimbursement
credits a liability to the person and clears when they are repaid — the
firm recorded what the payment was, and reading it back is not inference.

**Don't reach for the expense side.** An earlier version scored vendors on
what they had spent on — meals, mileage, parking — and it went wrong in
both directions on one firm's books: it missed people who only ever
expensed a phone bill, and it proposed a food-delivery company as an
employee. The payable account found every individual on that firm and no
suppliers at all.

### Partner compensation — named like anyone else

Guaranteed payments are compensation to a partner for services, expensed
by the entity. **They are reported like any other vendor spend** — a
partner paid for their work is named, on the chart and in Budget vs
Actuals both.

This is a smaller question than it looks: 97% of guaranteed-payment lines
carry no vendor at all, so they never reach a vendor chart in the first
place. Don't go looking for them.

The `aggregate_accounts` mechanism below stays available for a firm that
asks to group an account's payees under the account's own name. Offer it
when a firm raises it; don't prompt for it. Show the accounts those
entries hit, and ask:

> These accounts pay individuals: `<7112 Venture partner consulting
> fees — $23K across 2 people>`. Group each under its account name
> instead of naming them?

On yes, add the GL codes to `aggregate_accounts` in `vendor-config.json`
and re-run Step 4's build. Those entries then report as one bar carrying
the account's own name.

**Group, never drop.** Removing the spend would leave the chart's bars no
longer summing to expense, and the unattributed figure in its note wrong
— hiding a real cost to avoid naming someone. Aggregation keeps the total
honest and the person unnamed.

An individual who is genuinely a supplier — a contractor invoicing for
professional fees — stays named. That is what the firm's own books say
they are, and it is the default: grouping is for the two cases above, not
for every person who appears.

---
