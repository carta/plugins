# 409A-only fallback

Use this only when `cap_table__get__valuations` answers `Unknown tool` or a server error. Never use it after a 403 or `role_required`: the user's role can't see the valuations, and this read is no different.

```
read_tool({"name": "cap_table__get__409a_valuations", "arguments": {"corporation_id": corporation_id}})
```

It returns `{count, current_409a, history}` with US 409A data only, so:

- Say the answer covers 409A valuations only; an EMI, CSOP or share-price valuation can exist
  and not show here.
- The response has **no currency field**. Show its prices without a currency code or symbol
  rather than assuming one.
- Check `current_409a.is_expired` before calling it current.
- Dates are `MM/DD/YYYY`. Sort on parsed dates: a string sort is month-major and ranks
  `12/01/2023` above `04/25/2025`.

Then go on with Step 3 of the skill (expiration) and its Presentation rules, except the currency rule: show these prices with no currency code.
