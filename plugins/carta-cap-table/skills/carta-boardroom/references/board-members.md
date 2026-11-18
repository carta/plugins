# Board members

The directors and observers on the company's board, current and past. The Hard rules, Calls,
Flow steps 4 to 6, Error Handling and Closing of the skill apply.

| The user wants to | `name` | Member status |
|---|---|---|
| See the board members | `cap_table__list__board_members` | any |
| Add a director or an observer | `cap_table__compute__add_board_member_preview` | — |
| End a term, or move its end date | `cap_table__compute__update_board_member_preview` | current, past |
| Delete the member record | `cap_table__compute__remove_board_member_preview` | current, past |
| Send the invitation email again | `cap_table__compute__resend_board_member_invite_preview` | current |

Only company admins and editors can do these, on a company with the Board product. Do not ask
for the user's role: Carta checks it. No command clears an end date or changes a member's role.
To change the role, end the term and add the person again.

## Read

Call `cap_table__list__board_members`. Send `search` (a name or an email) when the user names a
person. Send `status` (`current`, `past`) only when the user names one. For more rows, send
`next` as `after`. Show `| Member | Role | Status | Start | End |`.

- `member_id` is the `id` of a row. When 2 or more rows fit, ask which one in one
  `AskUserQuestion`. When no row fits, say so.
- When the row's status is not in the action's row above, say which statuses allow it and stop.
- A read of the list ends with the table. Ask nothing more.

## Inputs

Use the user's words. Ask only for what is missing, in one `AskUserQuestion`.

- **Add:** `email`, `first_name`, `last_name` and `board_role` (`director` or `observer`).
  Send `start_date` only when the user gives one, and `end_date` only for a term with an end.
  The start date is today or before: for a later date, say Carta does not accept it, and ask for
  another date.
- **End a term:** `member_id` and `end_date`. A date before today makes the person a past
  member: their board access ends. A past member's end date can only move to another day before
  today.
- **Remove:** for a `current` row, ask one `AskUserQuestion` with options **"End the term"**
  (first: it keeps the history) and **"Delete the record"**. On "End the term", preview the end of
  the term with the user's date, or else the day before `meta.as_of`: a term that ends today stays
  current until tomorrow. For a `past` row, ask no question and preview the delete. Send the
  delete preview with `member_id` only on "Delete the record" or for a `past` row.
- **Send the invitation again:** `member_id` of a `current` row.

Then preview, ask for approval and apply as Flow steps 4 to 6 of the skill say. Post the
`meta.web_url` of a board member result as `[Open in Carta](<web_url>)`.
