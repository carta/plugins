# Changing a commitment

Applies to Steps 7, 10 and 11 of SKILL.md: Step 10 reads "The amount" for a new prospect's commitment, and Step 11 reads "Choosing the investor".

## What can change

Fund-admin lets the GP change a commitment only while the contact is `prospect`, `invited` or `in_progress`. From `data_room`, `signatures_required`, `submitted`, `kyc_required` and `counter_signed` the command refuses. Tell the user the GP must send the contact back to the investor in Carta first (only before the GP has countersigned); after countersignature a commitment adjustment is made in Carta. This skill does neither.

The command writes one amount and never the one the LP typed:

| Contact | Field written | `{label}` in the confirmation |
|---|---|---|
| Fixed commitment (`variable_commitment_enabled` is not true) | `commitment_amount` | commitment |
| Variable commitment (`variable_commitment_enabled` is true) | The GP's private expected amount; the LP's own amount stays as it is | expected commitment (the amount {investor} entered is unchanged) |

`current_amount` is always the row's `commitment_amount` (see `closing-contacts.md`).

A variable commitment is changed only on a fund that shows the GP an expected amount; the command checks. Anywhere else the command refuses with a `contact_id` error: tell the user to change that investor's amount in Carta, and do not retry. Say which amount changed from the result's `field`.

## The amount

Pass `new_amount` as a plain number with at most two decimals, in the fund's own currency. `currency` is the fund's ISO code from the fund record read in Step 2.

| User wrote | `new_amount` |
|---|---|
| `250k`, `250 thousand` | `250000` |
| `$1.5M`, `1.5 million` | `1500000` |
| `1,250,000` | `1250000` |

- A symbol or code the user wrote that is not the fund's currency (`€` on a GBP fund): ask which they mean. Never convert, and never assume.
- A bare `$` fits only a fund whose currency is a dollar currency; with any other currency, ask.
- A fund with no currency on its record: do not make the change; say the fund has no currency on record.
- Zero, a negative, or more than two decimals: ask for a different amount.
- A figure that could be read two ways (`1.250`, `250 m`): ask.

## Choosing the investor

Match the user's name to `partner_name` in the rows already read. One match: use it. Several: `AskUserQuestion`, one option per investor, showing the current commitment to tell them apart. None: say so and offer the nearest names; never guess. The command takes `investor_name`, `current_amount` (the row's `commitment_amount`) and `contact_id` (its `public_id`) from that same row, and refuses if any has changed since the read.
