---
name: portco-financials-and-kpis-review
description: Open a financials extraction session for review and publish it. Deterministic entry into the carta-portco-financials-and-kpis skill's review route.
argument-hint: "organizations/<org_pk>/extraction-sessions/<session_id>  |  org-id=<org_pk> session-id=<session_id>"
---

# /carta-investors:portco-financials-and-kpis-review

Invoke `Skill(carta-investors:carta-portco-financials-and-kpis)` with the arguments `review $ARGUMENTS`.

The first word, `review`, is the route. Everything after it is the session: a reference
shaped `organizations/<org_pk>/extraction-sessions/<session_id>`, or explicit
`org-id=<org_pk> session-id=<session_id>`. If `$ARGUMENTS` is empty, pass `review` alone and
let the skill ask for the session.

The skill's review reference owns the flow from here. Never the upload flow.
