# Exercise periods

Read this to change the post-termination exercise period of option grants, RSUs, SARs or CBUs:
the time a holder has to exercise after they leave, for each kind of termination
([SKILL.md § Actions](../SKILL.md#actions)). Preview, approval, apply and the closing are in
[SKILL.md § Flow](../SKILL.md#flow).

## Inputs

Bootstrap with `security_type` `option_grant`, `rsu`, `sar` or `cbu`. The action is
`securities:change_exercise_window`, for company admins only. Send `securities` (a list of ids of
that one type), `security_type`, `exercise_windows` and `reason`. Send `effective_date`, `notes`
and `update_last_day_to_exercise` only as the rules below say.

- `exercise_windows`: one item for each termination reason that changes. A reason that you do not
  send keeps its window. The reasons are `voluntary_termination` (the holder resigns),
  `involuntary_termination` (the company ends the job, not for cause),
  `involuntary_termination_cause` (for cause), `death`, `disability` and `retirement`. Each item
  is `{"count": <n>, "period": "day" | "month" | "year"}` in the user's own unit: "90 days" is
  `{"count": 90, "period": "day"}`, "3 months" is `{"count": 3, "period": "month"}`. Never change
  the unit.
- When the user names a window but no termination reason ("make it 12 months"), ask which reasons
  in one `AskUserQuestion` with `multiSelect: true` and these options: **Voluntary**,
  **Involuntary (not for cause)**, **Death, disability and retirement**, and **For cause**. Never
  pick them yourself.
- `reason`: a fix of a wrong entry is `clerical_error`, a change that the board or a plan
  amendment approved is `amendment`. When the user did not say, ask.
- `effective_date`: the date the change takes effect, today by default. Send it only when the user
  names it.
- `notes`: send only the user's own words.
- Carta changes at most 25 grants at a time. For more grants, or for a group that the user names,
  such as "all outstanding option grants", read every page of `cap_table__list__securities` for the
  ids, say the count, and bootstrap and preview them in parts of at most 25. Each part is its own
  change ([SKILL.md § Several changes](../SKILL.md#several-changes)).

## Last day to exercise

A grant whose holder is terminated in Carta has a last day to exercise. A new window does not move
it, unless the preview sends `update_last_day_to_exercise: true`. Carta then counts the new window
from the grant's termination date. Send it for one grant at a time only.

- For one option grant, read it first with `cap_table__get__option_grant` (`corporation_id` and
  `label`). It gives `termination_date`, `termination_reason` and `ptep_expiration_date` (the last
  day to exercise now). When it has a `termination_date`, the user's change is for a holder who
  left: send the window of that reason only (`Voluntary` is `voluntary_termination`,
  `Involuntary` is `involuntary_termination`, `With cause` is `involuntary_termination_cause`,
  `Death`, `Disability` and `Retirement` are `death`, `disability` and `retirement`). When
  `termination_reason` is none of these, say that Carta records the reason as
  "<termination_reason>", that this change cannot tell which window it uses, and stop. Ask no
  question about it: the change is made in the Carta web app. When the
  user did not say whether the last day moves too, ask before the preview.
- When the grant has no `termination_date` and the user asks to move the last day to exercise,
  the holder's departure is not recorded in Carta: send the user to `carta-terminate-stakeholder`
  and stop.
- For an RSU, SAR or CBU, send `update_last_day_to_exercise` only when the user asks for more or
  less time to exercise, and ask for the termination reason and date that you need.
- When the user names the new last day, not a window ("give Jane until 06/30/2027"), send the
  window in days: the count of days from the termination date to that day. Show the math in one
  line.
- The preview's summary says where the last day to exercise moves. When it does not move to the
  day the user named, or does not move, say so before the approval. Carta can stop the last day at
  the grant's expiration date.
- For an RSU, SAR or CBU, when Carta answers that the grant is not terminated, the holder's
  departure is not recorded in Carta: send the user to `carta-terminate-stakeholder` and stop.

## Show and approve

The preview opens no Change page. Show a table with the header
`| Security | Field | Before | After |`, one row for each item in `changes` of each `grants` row:
the grant label, the termination reason in words (or "Last day to exercise"), and its `before`
and `after`. Show each email that `side_effects` names before the approval, as
[SKILL.md § Flow](../SKILL.md#flow) step 6 says. This change cannot skip them: never ask
**"Send these N emails?"** for it.

A longer window can change the tax treatment of an incentive stock option (ISO). For an option
grant, say in one line that a longer window can have tax effects and that the holder should ask
their tax advisor. Never say what the effect is.
