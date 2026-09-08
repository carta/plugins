---
name: financials-upload
description: Upload a portfolio company's financial document (or pasted figures) to Carta for extraction. Deterministic entry into the carta-financials skill's upload route.
argument-hint: "<file path>[, <file path>...]  [corporation-id=<corporation_id>]  [org-id=<org_pk>]"
---

# /carta-investors:financials-upload

Invoke `Skill(carta-investors:carta-financials)` with the arguments `upload $ARGUMENTS`.

The first word, `upload`, is the route. Everything after it is what the skill's `file-path`,
`corporation-id` and `org-id` arguments accept: one or more absolute paths (all for the
same portfolio company), and optionally the corporation and the firm's organization pk. If
`$ARGUMENTS` is empty, pass `upload` alone and let the skill ask for the path.

The skill's upload reference owns the flow from here. This route needs the Bash tool for
its helper scripts; without Bash the skill says so and stops.
