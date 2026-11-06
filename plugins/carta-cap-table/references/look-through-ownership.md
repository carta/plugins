# Total, indirect or look-through ownership

One cap table shows a holding entity (a trust, Stichting, SPV, holdco or fund) as one line, so
total ownership never comes from one read. Never say Carta can't show indirect ownership before
you have tried step 3.

1. Read the company's holders:
   `read_tool({"name": "cap_table__list__ownership", "arguments": {"company": <company_name_or_id>, "group_by": "stakeholder", "size": 100}})`.
   Ownership is a fraction (1 is 100%): read `fully_diluted_ownership` and
   `outstanding_ownership` from each row. While the response has a `next`, send it as `after`
   and read the next page: a holder on a later page still needs its direct ownership counted.
2. Pick the entity holders: the ones the user named, and the rows whose name is an entity
   (Inc., Corp., LLC, Ltd, B.V., GmbH, LP, Trust, Stichting, Holdings, Fund, Capital,
   Ventures, Partners). Take at most the 10
   largest unless the user asks for more.
3. For each entity, read its own holders with the same call and `company` set to the
   entity's name as the row shows it. Send these reads in parallel, and page each one through
   `next` as in step 1. When the read fails with a company error
   whose `did_you_mean` has the entity's exact name, read that id once. Any other error (no
   exact match, `ambiguous`, access refused) means the entity's holders are not visible in
   Carta to this user: do not ask the user, and do not try other spellings, names or commands.
4. Each holder's indirect ownership is the entity's ownership of the company times the
   holder's ownership of the entity. Stop at one entity level unless the user asks for more.
5. Answer with one row per holder, in a table with exactly these column names: Holder |
   Direct % | Indirect % | Through | Total %. Keep all five columns even when no entity's
   holders are visible: Indirect % is then 0% and Total % equals Direct %. A holder with both
   direct and indirect holdings gets one row, with the entities it holds through in Through.
   Name the basis (fully diluted or outstanding) in the line above the table, never in a
   column name. When the user gives a threshold, show one table per basis and mark the holders
   at or above it.
6. Keep each entity whose holders are not visible as its own row, with "holders not visible
   in Carta" in Through, and offer to add holders the user provides, labelled as the user's
   figures.

Under the table, always say: Direct % is Carta data; Indirect % and Total % are Claude's
analysis, not Carta data. Give the as-of date of each cap table you read. This calculation does not need the
AI computation question in carta-cap-table's or carta-reporting's Gates: asking for total or
indirect ownership is asking for it.
