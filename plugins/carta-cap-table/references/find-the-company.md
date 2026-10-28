# Find the company

Carta finds the company on the server. Do not call `list_accounts` before the first read, and
do not ask which company before it.

## Reads

- **The user named no company:** omit `corporation_id`. Carta uses the user's only company.
- **The user named a company:** pass the name as `corporation_id`, as the user said it. A
  unique part of the name is enough.
- **The user gave a numeric id:** pass it. Never search for it: a search matches names, not
  ids.
- **Later calls:** a cap table read (`cap_table__*`) returns `meta.company`: reuse its `id`
  and say its `name`. Other domains return no `meta`: send the same value again.
- **Later prompts:** a company named or numbered in the current prompt replaces the earlier
  one. A prompt with no company keeps the company already resolved in this conversation.

## Company errors

A company error is an error whose `field` is `corporation_id` (or `company`), or a
`Missing required params` error that names `corporation_id`. A `not_found` on another param
(a grant, a stakeholder, a report) is not: fix that param.

- **`ambiguous`, or `not_found` with companies in `did_you_mean`:** ask with
  `AskUserQuestion`, with up to 4 `label` values from `did_you_mean` as options (the user can
  type another name). Call again with the `id` of the pick, or with the typed name. Say the
  company by that `label`: `meta.company.name` is empty when you send an id. If the user
  dismisses the question, stop: make no further read, and ask them to name the company when
  they're ready.
- **`not_found` with an empty `did_you_mean`:** call `list_accounts(search="<name>")` once.
  If it finds nothing, ask the user for the company name as Carta shows it.
- **`Missing required params` on `corporation_id`, or `invalid_argument` that the command
  requires `company`:** Carta found no single company for the user. Ask the user to name it.

## Writes

A write takes only the exact company name and never the default company. A write skill
resolves the company with `list_accounts(search="<name>")`, or uses the `id` from an
earlier read in the same flow once the user confirms that company's name.
