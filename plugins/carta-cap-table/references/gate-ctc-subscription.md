# Gate — Carta Total Compensation subscription

Run this before any other `compensation:*` call. It decides whether the corp has Carta Total
Compensation (CTC) and whether the caller may read it.

```
read_tool({"name": "compensation__get__subscription_status",
           "arguments": {"corporation_id": <corporation_pk>}})   # corporation_id is optional, see below
```

## Resolve the company on this call

A skill whose Step 1 points here resolves the company with this call, not with `list_accounts`.
Other skills send the `<corporation_pk>` their Step 1 resolved.

Reuse the company already resolved in this conversation unless this prompt names or numbers another. Else send the numeric id the user gave, else the company name as the user said it, else no `corporation_id` (Carta uses the user's only company). For errors, resolve the company as
`${CLAUDE_PLUGIN_ROOT}/references/find-the-company.md` *Company errors* says, on this call (read it by
that path, do not search for it). If the user dismisses the company
question, stop and send the skill's dismissal message. One case differs: on `Missing required
params` on `corporation_id` (no company), or `not_found` with an empty `did_you_mean`, do not
call `list_accounts`. Call `context_tools__get__profile`. Empty `corporations[]`: send the
"your firm" variant of *The subscription message* below and stop. Non-empty: ask for the exact
company name or numeric id.

Take `corporation_id` from the response: it is the `<corporation_pk>` of every later call. Name
the company by the `label` of the pick, else by the name the user gave.

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
