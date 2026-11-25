# 409A-only fallback

Use this only when `cap_table__get__valuations` answers `Unknown tool` or a server error. Never use it after a 403 or `role_required`: the user's role can't see the valuations, and this read is no different.

```
read_tool({"name": "cap_table__list__valuations", "arguments": {"type": "409a", "corporation_id": corporation_id}})
```

It returns one row per 409A report in `results`, newest effective date first, so:

- Say the answer covers 409A valuations only; an EMI, CSOP or share-price valuation can exist
  and not show here.
- `price` is `{amount, currency}`. Show each price with its own currency code.
- The current 409A is the first row with `status: "active"`. When no row is active, say that
  the latest 409A expired on its `expiration_date`.
- Dates are ISO (`YYYY-MM-DD`).
- When `has_next` is true, call again with `after` set to `next` for the older rows.

Then go on with Step 3 of the skill (expiration) and its Presentation rules.
