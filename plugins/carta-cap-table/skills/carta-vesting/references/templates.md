# Schedules, acceleration terms and performance conditions

The company keeps its vesting schedules (Carta calls them vesting templates), acceleration terms
and performance conditions as lists that securities use. These changes follow the preview,
approval and apply steps 4 to 7 in [§ Change](../SKILL.md#change). Their previews return no
`thread_id`: a rework is a new preview. Read the current item first, and get each id from the
reads in [§ Actions](../SKILL.md#actions). Every preview takes `company`.

| The user wants to | `name` | Inputs (required in bold) |
|---|---|---|
| Create a vesting schedule | `cap_table__compute__create_vesting_template_preview` | **`name`**, **`description`**, `tranches`, `milestones` |
| Edit a vesting schedule | `cap_table__compute__update_vesting_template_preview` | **`vesting_template_id`**, `name`, `description`, `tranches`, `milestones` |
| Archive a vesting schedule | `cap_table__compute__archive_vesting_template_preview` | **`vesting_template_id`** |
| Create acceleration terms | `cap_table__compute__create_acceleration_template_preview` | **`name`** (unique), **`text`** |
| Edit acceleration terms | `cap_table__compute__update_acceleration_template_preview` | **`acceleration_template_id`**, `name`, `text` |
| Delete acceleration terms | `cap_table__compute__delete_acceleration_template_preview` | **`acceleration_template_id`** |
| Create a performance condition | `cap_table__compute__create_performance_condition_preview` | **`name`**, **`description`**, **`type`**, `min_payout_multiplier`, `max_payout_multiplier`, `vests_post_term`, `is_single_trigger` |
| Edit a performance condition | `cap_table__compute__update_performance_condition_preview` | **`performance_condition_id`**, and the fields that change |
| Delete a performance condition | `cap_table__compute__delete_performance_condition_preview` | **`performance_condition_id`** |

## Vesting schedule

- `tranches` is a list in order. Each tranche is one vest event at its end:
  `{length, length_unit, percentage}`. `length` is a whole number, `length_unit` is `days`,
  `months` or `years`, and `percentage` is a percent as a string (`"25"` is 25%). A tranche can
  also take `vesting_occurs`, the day of the month that it vests: `same` (the start day),
  `first`, `last` or `minusone` (the start day minus one). A tranche can also take
  `performance_condition_ids` (ids from `cap_table__list__performance_conditions`). Send
  `performance_condition_logic` (`ALL` or `ANY`) only with 2 or more ids.
- `milestones` is a list of `{name, percentage}` for vesting that waits on events, each with the
  same optional condition fields.
- The percentages add up to exactly 100. Write the tranches from the user's words. When the
  words do not say the cadence, the cliff or the length, ask. When the percents do not divide
  evenly, use 4 decimals and put the rest on the last tranche. Show the tranches in the
  preview. Example, "4 years monthly with a 1-year cliff": one tranche
  `{length: 1, length_unit: "years", percentage: "25"}`, then 36 tranches
  `{length: 1, length_unit: "months"}`, 35 at `"2.0833"` and the last at `"2.0845"`. One tranche
  of 36 months at 75% is wrong: all 75% vests at month 48.
- An edit replaces the whole list of `tranches` or `milestones` that you send. Send the full new
  list. Carta refuses an edit of a standard schedule.
- Securities that use a schedule keep their vesting when it is edited or archived.

## Acceleration terms

`text` is the legal text of the terms, in the user's words. Carta never computes acceleration from
it. Carta refuses to delete terms that a security uses.

## Performance condition

- `type` is `performance_non_market`, `market` or `event_non_market`.
- Payouts are multipliers as strings: `"1"` is 100%. `max_payout_multiplier` is at least `"1"`.
  An `event_non_market` payout is always 0 to 1.
- Carta refuses to edit a condition that was evaluated. On a condition that securities use, only
  `vests_post_term` and `is_single_trigger` change. Carta refuses to delete a condition in use.
- To record that a condition was met or missed, use the performance condition step in
  [§ Change](../SKILL.md#change), not an edit.
