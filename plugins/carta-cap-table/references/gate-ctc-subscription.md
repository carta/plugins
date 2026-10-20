# Gate — Carta Total Compensation subscription

Run this once a `corporation_pk` is resolved and before any other `compensation:*` call. It
decides whether the corp has Carta Total Compensation (CTC) and whether the caller may read it.

```
read_tool({"name": "compensation__get__subscription_status",
           "arguments": {"corporation_id": <corporation_pk>}})
```

## Call it once per corp per conversation

When this conversation already holds a **classified outcome** (one of the four below) for this
corp — the skill was invoked again, the rolematcher just handed back, or the user asked a
follow-up — reuse it instead of calling again. Only a classified outcome counts: after a
timeout, a server error or an authentication error, call it again once the cause is fixed.

## Outcomes

| Response | Means | Do |
|---|---|---|
| `has_ctc_access: true`, `is_subscribed: true` | **PASS** | Continue with the skill. |
| `has_ctc_access: true`, `is_subscribed: false` | **FAIL — no subscription** | Send the subscription message below. STOP. |
| Error (`role_required`) whose message says the corporation `does not have an active subscription to Total Comp` | **FAIL — no subscription** | Same as the row above. Ignore the error's own `fix` ("Ask a company admin for a role…"): an admin can't grant a product the company hasn't bought. |
| `has_ctc_access: false`, or any other `role_required` error | **FAIL — no access** | Send the no-access message below. STOP. With `has_ctc_access: false`, `is_subscribed` is `null`: the corp's subscription state is withheld, so don't infer it. |

On either FAIL, make **no further compensation call** for this corp — `filter_options`, `plan`,
`benchmark`, `benchmark_versions` and the rest fail the same way or return empty data. Do not
retry and do not re-authenticate: a fresh token for the same user grants no product and no role.

## The subscription message

Send it on **FAIL — no subscription**.

- Determine whether the user has cap table access: `read_tool({"name": "context_tools__get__profile", "arguments": {}})` and check whether `corporations[]` is non-empty. Treat a **non-empty** list as "has cap table access" — the endpoint already excludes `NO_ACCESS` roles, so presence is the signal. Do **not** match on the `role` label: those strings are raw and unnormalized (`'Admin'` and `'Administrator'` both occur), so an allowlist would misclassify real admins. Do **not** test whether *this specific corp* is in the list — the list is capped server-side, so a large-portfolio admin can be a false negative.
- If `corporations[]` is **non-empty**, tell the user:
  > *"That's a Carta Total Compensation (CTC) question — CTC runs on Carta's private market salary and equity data. The data can be segmented by level, function, stage, and geography, directly in Claude. It's not active for your company yet. Reach out to your account team or [request a demo](https://carta.com/demo/total-comp/?&utm_medium=product&utm_source=carta-web&utm_campaign=ctc-plugin-inq-amer-q2-26) to unlock it.*
  >
  > *I can pull cap table data — grants, vesting, round history — in the meantime."*
- If `corporations[]` is **empty** — a Fund-Admin-only user, or the user typed a numeric corp ID they hold no cap-table role on — tell the user:
  > *"That's a Carta Total Compensation (CTC) question — CTC runs on Carta's private market salary and equity data. The data can be segmented by level, function, stage, and geography, directly in Claude. It's not active for your firm yet. Reach out to your account team or [request a demo](https://carta.com/demo/total-comp/?&utm_medium=product&utm_source=carta-web&utm_campaign=ctc-plugin-inq-amer-q2-26) to unlock it."*
- If the profile call errors or returns an unreadable response, use the **"your firm"** variant — it promises nothing you can't deliver. Do not retry it.

## The no-access message

> *"Your account doesn't have a CTC role for this corporation, contact a company admin for access"*

It says nothing about the corp's subscription, so it is right whenever the caller lacks a role.
