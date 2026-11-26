# What happens to each security on termination

Read this before presenting the Step 3 review table. It covers what the server does to each
security type, which fields to show the user, which deadline is editable, and the one place
where the user must make a choice the preview cannot make for them.

The preview's rows and their fields are in [SKILL.md Step 3](../SKILL.md#step-3--review-the-securities).

## The universal rule

Two things happen to every holding with a vesting schedule:

- **Vesting stops** at the termination date. Nothing vests after it.
- **Unvested quantity is cancelled or forfeited.** It goes back to the plan / the company.
- **Vested quantity survives, but usually on a clock.** The clock is the thing users miss, so
  it leads every line you present.

Quantities are computed **as of the termination date**, not today. Moving the date moves the
vested/unvested split — worth saying out loud when a user is choosing between two dates.

---

## Option grants, RSUs, SARs, CBUs

All four are grant rows: their `deadline` is a last day to exercise, or to settle.

| Field to show | Why |
|---|---|
| Label (`ES-104`) and type (ISO / NSO / INTL / RSU / SAR / CBU) | ISO vs NSO changes the tax story the holder faces |
| `vested_quantity` | What they keep |
| `unvested_quantity` | **What is cancelled** |
| `deadline` (RSUs/CBUs: last day to settle) | **The deadline** |
| `expiration_date` | The grant's own expiry. Carta caps the deadline at it on some companies and not others, so a `deadline` **after** the expiry is possible — which is why the window closes on whichever date comes first. |
| `acceptance_status` | Whose signature is missing — see [an unaccepted grant](#an-unaccepted-grant) |

**Treatment.** Unvested is cancelled. Vested stays exercisable until the
**post-termination exercise period (PTEP)** deadline the server computes from the plan's rules
and the **termination reason** — this is why the reason is substantive and not metadata.

**The window closes on the earlier of the last day to exercise and the expiration date**, and
that earlier date is the one to give the holder. Usually it is the deadline. When the
expiration date comes first, say so plainly — *"ES-190 expires 25 May 2027, before its
29 May 2027 exercise deadline, so 25 May is the real last day"* — rather than quoting a
deadline the holder cannot reach.

**Editable:** the deadline, per grant. Must be on or after the termination date. An override
goes in the preview's `deadlines` and is checked when you preview again (SKILL.md Step 3).

**Already-lapsed grants are omitted from the preview** — if a grant's window had already closed
as of the termination date, it won't appear. Don't report it as unaffected; it simply had
nothing left.

**ISO note.** Extending an ISO's exercise window past the statutory period can change its tax
character. Flag that it may have tax consequences and point to the holder's own advisor —
never characterise the outcome.

### An unaccepted grant

A grant can still be waiting for a signature when its holder leaves. The preview says which
one is missing: *awaiting officer signature* is the company's own to sign, *awaiting holders
signature* is the holder's.

**The termination treats it exactly as an accepted grant** — same cancellation of unvested,
same PTEP deadline, no extra check and no refusal. What the signature changes is what comes
after: the grant is usable only once it is accepted, and the acceptance window closes on the
same date the exercise window does, the earlier of the last day to exercise and the grant's
expiry. So an unaccepted grant gives the holder one deadline for both signing and exercising.

That is why it is a decision and not a note: a missing officer signature is something the
company can do today, before it starts a clock on someone who has left.

## Certificates

Issued shares. Vesting (if any) stops; the editable field is the **last day to repurchase**,
required and on or after the termination date.

Show: label, share class / equity plan, quantity, price per share with its currency symbol,
and the vested/unvested split. For post-termination performance vesting the preview breaks out
a time-vested-with-post-termination quantity — surface it rather than folding it in.

## RSAs and PIUs

Unvested shares on an RSA (restricted stock award) or a PIU (LLC profits interest unit) are
either **repurchased** or **forfeited**. The two differ materially for the holder, but only one
of them is a question for the user.

### Repurchase does not move anything

This is the part that misleads. Terminating on the repurchase path writes three things — a
termination date, a **last day to repurchase**, and a stop on vesting — and changes no
quantity. The holder keeps every share. The repurchase itself is a separate action someone
takes before that deadline, and it may never happen.

**Forfeiture is the only disposition in a termination that removes shares.** Say so in those
terms, and never tell a user that a repurchase has paid anyone back.

### RSA — ask the user

The company's choice, which the user makes, and the Carta page asks for it too. Ask in the
holder's terms:

> *"Jamie's restricted stock award (RSA-12) has 2,000 unvested shares. Does Acme repurchase
> them, or are they forfeited? Repurchase keeps the shares and gives Acme until a set date to
> buy them back at the original price; forfeiture returns them now, at no cost."*

Repurchase is the default. To forfeit, name the RSA in the preview's `forfeit`.

### PIU — derive it, never ask

The Carta page does not offer this choice: it reads the disposition from the preview and shows
it locked. Match that rule exactly — read it, don't ask:

Read it from the **first** preview of the run, the one that sent no `forfeit`:

- That preview gives the PIU a `deadline` → **repurchase**.
- That preview gives it `deadline: null` → **forfeit**: name the PIU in `forfeit` and preview
  again.

After that first call `deadline` and `forfeited` echo what you sent, so they no longer say what
Carta decided. Read the signal once, early.

Carta returns no repurchase date for a PIU today, so in practice every PIU forfeits. Follow the
rule rather than that outcome — it is the rule the page applies, and it stays right when Carta
starts returning a date. Sending repurchase for a PIU with no date fails anyway, because
repurchase needs one.

State what will happen without offering a choice: *"Jamie's profits interest units (PIU-4) —
500 unvested units will be forfeited."*

**An invested-capital PIU may still be owed a repurchase.** When the preview gives a PIU no
last day to repurchase, terminating forfeits it — an invested-capital one included — and any
buy-back is a separate action in Carta. When the user expects money to change hands for a PIU,
say the termination will not do it and point them at the repurchase in Carta.

### Consequences for the rest of the flow

- **Repurchase needs a last day to repurchase**, on or after the termination date. Override the
  computed one through the preview's `deadlines`.
- **Forfeiture rejects a future termination date.** Repurchase and plain grants do accept one.
  What the user can change depends on which security it is:
  - **A forfeited RSA** — either value can move. Offer both: an earlier date, or repurchase
    instead of forfeiture.
  - **A forfeited PIU** — **only the date can move.** The disposition came from the preview,
    not the user, so there is nothing to switch it to. Repurchase is not an escape: leaving the
    PIU out of `forfeit` repurchases one Carta gave no window to. Ask for a date on or before
    today.
- **An RSA whose shares were never purchased cannot be forfeited.** Carta refuses it and names
  the security.

The underlying values are `rsa_type` (`CASH` = repurchase, `SERVICE` = forfeit) and `piu_type`
(`WITH_CAPITAL_INVESTMENT` = repurchase, `WITHOUT_CAPITAL_INVESTMENT` = forfeit), which is why
they read backwards. Don't put those identifiers in front of the user.

## Not part of this flow

**Warrants, convertible notes and SAFEs** are outside stakeholder termination entirely. They
are not previewed, not changed, and not cancelled. An admin closing someone's file should
still know what remains, so SKILL.md Step 3 reads each type for the holder and the review
reports what came back:

> *"Their warrant (W-3) isn't affected by a termination and stays outstanding."*

## Presenting the table

One table per stakeholder, grouped by type, with a plain-language line above it naming the two
headline numbers (what's cancelled, what's on a clock). Exact quantities with units, and dates
as `D Mon YYYY` (*14 Mar 2026*). Take the word for a quantity from the security in front of you,
as SKILL.md's Voice section has it.

Every deadline the server computed gets a one-line note on where it came from — *"90 days after
their last day, per the 2021 Plan"* — so a value the user didn't type never looks like one they
did.
