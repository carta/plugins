# The artifact surface

Selected by [SKILL.md § Pick the surface](../SKILL.md#pick-the-surface) when no panel tool
is present and the **`Artifact`** tool is. This is the whole path — you need nothing else
until the mutate.

**Budget: three tool calls, one turn, to a form on screen.** If you are about to make a
fourth before the user sees anything, something below has been skipped.

The page does the work. It resolves the Carta connector itself, fetches its own reference
data, collects the terms, saves the draft set, validates it, renders the server's errors
against their own fields, and shows the review. None of that reaches your context — not the
roster, not the field manifest, not the HTML. **You resolve the company, run one script, and
publish.**

---

## 1. Preflight

- **The connected Carta must be the intended Carta.** `corporation_id` is not unique across
  environments, so aiming at the wrong one issues real securities onto the wrong company.
  When the request implies an environment that differs from the connected one — a host, a
  Carta link, "sandbox", "demo", "production" — **hard stop and ask.**
- **Resolve the company:** `list_accounts(search="<name>")`, never an unfiltered
  `list_accounts()` — its truncated page may never reach the name. Ask only on zero or
  several matches. `list_accounts` returns `id: "corporation_pk:<n>"`; the builder takes
  only `<n>`, and rejects the prefixed form so the mistake fails here instead of inside a
  published page. Keep the exact legal name it returns — the page's title uses it.
- **A file in the prompt goes through [the import sub-skill](../issuance-import/SKILL.md)
  first,** before the build. Its `rows` become the seed's `rows`.
- Resolve `security_type` per [SKILL.md](../SKILL.md#resolve-security_type).

Nothing else. **Do not fetch reference data, the roster, plans, valuations, share classes
or the field manifest** — the page fetches what it needs, and anything you fetch is a round
trip plus context the page will fetch again anyway.

## 2. Build the page

One `Bash` call. `$WORK` is your scratchpad directory.

The seed is optional and small: it is only what the *prompt* supplied, so the page can
prefill it. Write it only when you have something to put in it.

```bash
WORK=<your scratchpad dir>
mkdir -p "$WORK"
cat > "$WORK/_seed.json" <<'JSON'
{"stakeholders": ["Tagg Palmer"], "quantity": "100"}
JSON
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-issuance/issuance-artifact/scripts/build_artifact.py" \
  --corporation-id 40 \
  --company-name "IMIM" \
  --security-type option_grant \
  --seed "$WORK/_seed.json" \
  --out "$WORK/issuance.html"
```

- `--seed` takes a **path**, never an inline blob. Omit the flag entirely when the prompt
  named nobody and no terms; the page then opens with one blank recipient row, which is
  correct.
- Seed keys: `stakeholders` (names verbatim, as the user said them), `quantity`,
  `issue_date`, and `rows` when the import sub-skill produced them. Nothing else. An
  unknown key fails the build rather than opening a form that quietly ignores it.
- **Resuming a saved draft set** adds two more: `draft_set_id`, and a `draft_pk` on each
  row. Call `cap_table:get:load_drafts` first ([resume-flow.md](resume-flow.md)) and seed
  what it returns. Both are load-bearing — without the set id the page mints a *second*
  draft set of the same rows, and without each row's `draft_pk` the row inserts instead of
  updating ([hard rule 3](../SKILL.md#hard-rules)). `draft_pk`s with no `draft_set_id` is
  incoherent and fails the build.
- **`--out` is a stable path for this company and type.** Within one conversation,
  republishing the same file path updates the same artifact and keeps its URL, which is what
  you want for an error re-render. Use `$WORK/issuance-<corporation_id>-<security_type>.html`.
- The script exits non-zero and names the problem on a bad id, a missing part, or an
  unresolved placeholder. Surface that verbatim and stop — it is a build fault, not
  something a retry fixes.

**Never read the built file back.** It is ~90KB; reading it is the defect this whole path
exists to remove.

## 3. Publish it

```
Artifact({
  file_path: "<the --out path>",
  description: "Collect and review the option grants before issuing them.",
  icon: "grant",            // "certificate" | "grant" | "units", per security_type
  capabilities: {
    mcp: { servers: [{ server: "<the connector segment — see below>", tools: ["call_tool", "welcome"] }] },
    db: {}
  }
})
```

**`server` is the segment of your own Carta tool name** between `mcp__` and the next `__` —
for `mcp__33b9b857-8443-4b2d-b191-2d9b6c50eb86__call_tool` it is
`33b9b857-8443-4b2d-b191-2d9b6c50eb86`. Copy it exactly, case included. The publish resolves
it to the display name viewers match on and tells you what it resolved to; **the page reads
that name at runtime for itself**, so you never have to pass a display name anywhere and
never have to guess one.

- **Omit `url`, and don't call `action: "list"` first.** Same file path in the same
  conversation already redeploys to the same URL. Reaching for an artifact from an *earlier*
  conversation makes the tool hand you the whole live page to build on — ~90KB into your
  context for no benefit, since you are replacing the page wholesale anyway.
- `icon` goes on the first publish only. Omit it on a redeploy.
- Restate the **whole** `capabilities` object on any redeploy that passes it: a non-empty
  object replaces the stored grant, so a capability you leave out is revoked. Omitting the
  field entirely carries the stored grant forward — that is the cheaper redeploy.
- Keep `tools` at those two. It is a viewer-consented grant, and everything the page needs
  goes through `call_tool`.

**Read the publish result's warnings.** One matters: if it reports that it could not resolve
the connector name, the grant is not wired and every card in the page will come up empty.
That is the one condition that sends this run to
[the chat surface](chat-surface.md) instead. Any other warning is informational.

Then say **one short line** and give the URL as a link. Something like:

> The option-grant form is open — set the terms once, add recipients, and hit Review. It'll
> flag anything Carta needs before you can issue.

Echo nothing else — no ids, no field names, no summary of what you prefilled
([hard rule 8](../SKILL.md#hard-rules)). The first open asks the viewer to allow the Carta
connection; until they do, the page shows its own no-connection state and says what to do.

## 4. Wait for the hand-off

The page stops at a **saved and validated** draft set. It never issues — you do, so the
host's confirmation prompt still fires ([hard rule 2](../SKILL.md#hard-rules)).

On Confirm it writes one document, which you read:

```
Artifact({action: "read_db", url: "<the URL the publish returned>",
          db_op: "get", collection: "issuance", doc_id: "handoff"})
```

```json
{ "status": "ready",          // "draft" when they used Save as draft instead
  "draft_set_id": 472, "corporation_id": 40, "security_type": "option_grant",
  "recipients": 1, "totals": {"USD": 100}, "summary": "…", "confirmed_at": "…" }
```

**How to wait.** Read it once, right after you publish — a fast filler may already be done.
If it is not there, **end your turn** with the line from § 3. Do not poll in a loop, do not
narrate, and do not re-publish. Filling an issuance form is minutes of human work, and a
polling loop spends the session watching an empty document.

Then read it again at the start of your next turn, whatever the user says. If they said
"done" or "go ahead", that is the signal. If they ask something else, answer them and read
it anyway — a `status: "ready"` document is the user's approval regardless of what they
typed next.

**Not found** means they have not confirmed yet. That is the normal state, not an error, and
never something to report as a failure.

**`status: "draft"`** means they saved without issuing. Say the draft is saved and that they
can come back to it, and **stop** — a saved draft is not an approval to issue.

## 5. Issue

With `status: "ready"`, go to [SKILL.md § Issue](../SKILL.md#issue) and use that
`draft_set_id`. No `drafts` key, no re-validation.

## When something is wrong

| What you see | What it means | What you do |
|---|---|---|
| The publish warns it could not resolve the connector | the page has no Carta access | [chat surface](chat-surface.md) |
| The user says the panel is empty, or every section says it couldn't load | the viewer hasn't allowed the connector, or Carta is down for them | Tell them to allow the Carta connection when the page asks, or to reconnect Carta in Settings → Connectors. Re-publishing does not help |
| The user says they see a hard stop in the page | the account isn't set up for this issuance | Read it back to them in plain language and stop. The fix is in Carta, not here |
| The user reports validation errors they can't clear | the server refused a value | Those belong to the page, which shows them against their own fields. Only if a message is one the page can't act on — a fund-structure block, a duplicate stakeholder, a missing FMV — read [mutate-recovery.md](mutate-recovery.md) |
| The hand-off document never appears and the user insists they confirmed | the store write failed | The page shows the draft set number on screen for exactly this case. Ask them for it, then issue with it |
| The user wants to change a term after confirming | — | Tell them to hit Back to edit in the page and confirm again. Don't rebuild rows yourself; the draft set is the record |

## What not to do on this path

- **Don't read the built HTML**, in whole or in part, ever.
- **Don't fetch reference data.** Not the roster, not the field manifest, not plans,
  valuations or share classes. The page owns all of it.
- **Don't ask who the recipients are, or for anything the form collects** — a blank field on
  the form is the question. *"100 option grants"* with nobody named is one recipient getting
  100, not a headcount and not a question.
- **Don't pre-ask for a computable value.** Exercise price, grant expiration, jurisdiction
  and the sole-option defaults are all things the page derives and shows.
- **Don't stack an `AskUserQuestion` on the open page** for anything the page collects. It is
  unrestricted for a genuine fork the page cannot present — two Carta environments, a mixed
  security type — and for recovery after a server rejection.
- **Don't build the payload yourself.** If you find yourself reading
  [payload-reference.md](payload-reference.md) on this path, you are on the wrong path: that
  file is for the chat surface and for recovery.
