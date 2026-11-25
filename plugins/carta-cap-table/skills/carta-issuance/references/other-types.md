# The other six types

Convertible notes and SAFEs, RSAs, warrants, RSUs, SARs and CBUs go through the run,
[companion-surface.md](companion-surface.md), like option grants and certificates. This file adds
their columns to the run's § 2, gives the block step a note or warrant set needs before the run's
§ 5 saves it, and [§ Close](#close) gives their close. Every other step is the run's.

## Per-type values

| | `convertible_note` | `rsa` | `warrant` | `rsu` | `sar` | `cbu` |
|---|---|---|---|---|---|---|
| Account gate | one note block per set, from `note_block_terms`: the one the files or prompt name, else ask which in the chat, each block and `New terms`; with none, or `New terms`, [§ No block yet](#no-block-yet). Its `id` is `note_block_id` on the first save | stop when `option_plans` is empty: the company needs an equity plan in Carta | each row's block, from `warrant_blocks`, saved as its `prefix`: the one the files or prompt name, else an open input; with none, or new terms, [§ No block yet](#no-block-yet) | stop when `option_plans` has no live plan or `document_sets` is empty. The plan the files or prompt name, else the only live one, else ask which in the chat; its `id` is `equity_plan_id` on the first save | the RSU gate | none: the plan is optional. A dilutive row (`from_plan` true) takes the `id` of a plan in `option_plans` as `option_plan` or, with no plan, of a share class in `certificate_share_classes` as `share_class`, never both; a phantom row (`from_plan` false) takes neither. Never send `equity_plan_id` |
| `company_setup` picks | note block | plan, legend, vesting template, acceleration | warrant block, legend, vesting template | plan, vesting template, acceleration, document set | plan, vesting template, acceleration, document set | plan, share class, vesting template, acceleration |
| Summary adds | the note block, the total principal per currency | price per share and where it comes from, plan room left | each block and its share class, shares added to fully diluted | the plan and its pool room left | the plan, the base price and the pool room left | the base value or threshold, and the plan room left for dilutive rows |
| `set_label` | `Convertibles #<draft_set_id>` | `RSAs #<draft_set_id>` | `Warrants #<draft_set_id>` | `RSUs #<draft_set_id>` | `SARs #<draft_set_id>` (`UARs #<draft_set_id>` at an LLC) | `CBUs #<draft_set_id>` |
| Issue button | **Issue convertibles** | **Issue RSAs** | **Issue warrants** | **Issue RSUs** | **Issue SARs** (**Issue UARs** at an LLC) | **Issue CBUs** |
| `cap_table:list:securities` `type` | `convertible_note` | `rsa` | `warrant` | `rsu` | `sar` | `cbu` |
| Ledger path | `debt/list/<CORP_ID>/` | `options/rsa/list/<CORP_ID>/` | `warrants/list/<CORP_ID>/` | `options/list/rsus/<CORP_ID>/` | `options/list/sars/<CORP_ID>/` | `options/list/cbus/<CORP_ID>/` |
| Library `document_type` | `Convertible Note / SAFE`, `Board Consent` | `Restricted Stock Award`, `Stock Purchase Agreement`, `Board Consent`, `Equity Plan` | `Warrant`, `Board Consent` | `RSU Award Agreement`, `Board Consent`, `Equity Plan` | `Board Consent`, `Equity Plan` | `Board Consent`, `Equity Plan` |
| Never recommend | a note block, a valuation cap, a discount, an interest rate | a purchase price | a warrant block, a share class, a prefix, an exercise price | a plan, a tax filing status | a plan, a base price | a plan, a share class, a base value or threshold |

An RSA row's `status` is `committed` while the holder has not paid, with no `issue_date`; else
`issued`. After an RSA set issues, say each holder may file an 83(b) election with the IRS within
30 days of the issue date: the holder files it, not Carta.

An RSU has no price: never ask for a 409A. Each RSU row stays a draft until a board admin
approves it in a board consent: say so, and offer to draft an amended consent. When Issue or the
preview says the company gives a Rule 701 disclosure, the admin issues the set on the Drafts page,
where the disclosure runs: say so, and issue nothing from the chat.

A SAR's base price is its `exercise_price`, and its grant date is its `issue_date`: both are
required. A SAR gets no FMV check: never read or name a 409A for it, and never compare the base
price to one. The company is an LLC when `issuance_init`'s `knowns_seed.is_llc` or
`draft_set_init.isLLC`, or the `cap_table:get:draft_set_companion` read's `is_llc`, is true.
There Carta calls SARs UARs: say UARs, and use the LLC `set_label` and Issue button.

A debt note, under a block whose `note_type` is `debt` or `convertible_debt`, needs its maturity
date (column `maturityDate`, save key `maturity_date`) as well as the principal: with none given,
it is a `needs_input` cell, though `field_spec` does not list it. A SAFE has no maturity date:
never ask for one.

A CBU is a unit of value paid in cash, not a share. Each row takes a `base_value`, or a
`threshold_value` and its `threshold_value_type`, never both. A phantom CBU changes no share
count. Never ask for an exercise price, a 409A or an option pool for a CBU.

## No block yet

A note or warrant set needs its block before the run's § 5 saves it. When the type's account gate
sends you here:

1. Ask for every term the files and prompt don't give, in one chat message, and end the turn;
   with none missing, go to step 2. Never suggest a term or offer a value of your own: the terms
   are the user's.
   - Note block, `cap_table:mutate:create_note_block`: `name`; `note_type`, the one the user
     named (`safe`, `convertible_debt` or `convertible_equity`); `interest_cash`; and only the
     terms the user gives, such as `price_cap`, `discount_percent` and `interest_rate` (a debt
     note needs it). A SAFE sends `interest_cash` false and no interest terms.
   - Warrant block, `cap_table:mutate:create_warrant_block`: `name`; `share_class`, an `id` from
     `cap_table:list:share_classes` (a `read_tool` call), never a name; `prefix`; `exercise_price`; and
     `board_approval_date` when the user gives it.
2. Once every term it needs is known, one `AskUserQuestion` shows every term you will send,
   defaults included, and confirms them. Confirm the block once. That question asks only about
   the block: a row's gap, such as a warrant's expiration date, is not a block term. It is a
   `needs_input` cell that the run's § 6 asks after the save.
3. Call the command with `company` and the terms. Its `id` is the note set's `note_block_id`;
   its `prefix` is each warrant row's `prefix`. A refused term (a prefix in use, a share class
   outside the user's scope): ask it again, confirm, and call once more. Refused as not allowed:
   say a company admin must add the block in Carta, and stop.
4. Go on with the run's § 5 from step 1: its first save carries the new `note_block_id` or
   `prefix`.

## Close

[issue-and-close.md](issue-and-close.md) names its per-type text for certificates, option grants
and PIUs only. For `convertible_note`, `rsa`, `warrant`, `rsu`, `sar` and `cbu`, use this in its
place, with the nouns of the type's `set_label`:

- **The confirm** says what the preview's `side_effects` say confirming does, word for word, with
  no sentence of your own.
- **On success** leads with what the run's *What issued* (its § 8) or `issue_summary.sentence`
  says happened. The table of rows is Holder · Quantity (Principal for a convertible) · Issue
  date.
- **Issued**: *"N \<securities\> issued on \<company\> — \<issue date\>. Open \<company\>'s
  securities ledger in Carta — link text *\<company\>'s securities ledger*, href
  `\<BASE_URL\>/\<Ledger path\>` — to see them."*

`BASE_URL` is the one issue-and-close.md names, and the path is the type's *Ledger path* row
above. Never build another path.
