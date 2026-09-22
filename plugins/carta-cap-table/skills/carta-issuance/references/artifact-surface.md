# The artifact surface

Selected by [SKILL.md § Pick the surface](../SKILL.md#pick-the-surface) when no panel tool
is present and the **`Artifact`** tool is. This is the whole path.

**Budget: three tool calls, one turn, to a form on screen.** If you are about to make a
fourth before the user sees anything, something below has been skipped.

The page does the work: it resolves the connector, fetches its own reference data, collects
the terms, saves and validates the draft set, shows the review, and issues on confirmation.
None of that reaches your context — not the roster, not the field manifest, not the HTML.
**You resolve the company, run one script, and publish.**

---

## 1. Preflight

- **The connected Carta must be the intended Carta** — the environment rule in
  [SKILL.md § 1](../SKILL.md#1-preflight) applies here identically. Hard stop and ask.
- **Resolve the company:** `list_accounts(search="<name>")`, never an unfiltered
  `list_accounts()` — its truncated page may never reach the name. Ask only on zero or
  several matches. It returns `id: "corporation_pk:<n>"`; the builder takes only `<n>` and
  rejects the prefixed form. Keep the exact legal name — the page's title uses it.
- **A file in the prompt goes through [the import sub-skill](../issuance-import/SKILL.md)
  first,** before the build. Its `rows` become the seed's `rows`.
- Resolve `security_type` per [SKILL.md](../SKILL.md#resolve-security_type).

Nothing else. **Do not fetch reference data, the roster, plans, valuations, share classes
or the field manifest** — the page fetches what it needs, and anything you fetch is a round
trip plus context the page will fetch again anyway.

## 2. Build the page

One `Bash` call. The seed is optional and small: it is only what the *prompt* supplied, so
the page can prefill it. Write it only when you have something to put in it.

**Set `SKILL` to the absolute `skills/carta-issuance/` path
[SKILL.md](../SKILL.md#where-everything-else-lives) already resolved for you — paste it.**
`${CLAUDE_PLUGIN_ROOT}` is empty inside Bash: a command carrying it fails on a path
starting `/skills/`, and nothing else in the command is wrong when it does.

```bash
SKILL=<paste the resolved absolute path>
WORK=<your scratchpad dir>
mkdir -p "$WORK"
cat > "$WORK/_seed.json" <<'JSON'
{"stakeholders": ["Tagg Palmer"], "quantity": "100"}
JSON
uv run "$SKILL/issuance-artifact/scripts/build_artifact.py" \
  --corporation-id 40 \
  --company-name "IMIM" \
  --security-type option_grant \
  --seed "$WORK/_seed.json" \
  --out "$WORK/issuance-40-option_grant.html"
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
- **`--out` is a stable path for this company and type**, as above: republishing the same
  file path in one conversation keeps the artifact's URL.
- The script exits non-zero and names the problem on a bad id, a missing part, or an
  unresolved placeholder. Surface that verbatim and stop — it is a build fault, not
  something a retry fixes.

**Never read the built file back.** It is ~135KB; reading it is the defect this whole path
exists to remove.

## 3. Publish it

```
Artifact({
  file_path: "<the --out path>",
  description: "Collect and review the option grants before issuing them.",
  icon: "grant",            // "certificate" | "grant" | "units", per security_type
  capabilities: {
    mcp: { servers: [{ server: "<the connector segment — see below>", tools: ["call_tool"] }] },
    db: {}
  }
})
```

**`server` is the segment of your own Carta tool name** between `mcp__` and the next `__` —
for `mcp__33b9b857-8443-4b2d-b191-2d9b6c50eb86__call_tool` it is
`33b9b857-8443-4b2d-b191-2d9b6c50eb86`. Copy it exactly, case included.

**When that segment is a connector id, the publish rejects it and names the connector:**
*"…is the id of connector "Carta (Test)" — set "server" to "Carta (Test)"."* That rejection
**is** how you learn the display name; nothing you can read beforehand carries it. So
publish once more with the name it gave you, changing nothing else. One retry, expected,
and the first attempt created nothing: **do not report it as a failure and do not conclude
the plugin is broken.** Never guess a display name no rejection has given you.

- **Omit `url`, and don't call `action: "list"` first.** The same file path in the same
  conversation already redeploys to the same URL, and reaching for an *earlier*
  conversation's artifact hands you its whole ~135KB page — which you are replacing anyway.
- `icon` goes on the first publish only. Omit it on a redeploy.
- Restate the **whole** `capabilities` object on any redeploy that passes it: a non-empty
  object replaces the stored grant, so a capability you leave out is revoked. Omitting the
  field entirely carries the stored grant forward — that is the cheaper redeploy.
- Keep `tools` at that one. It is a viewer-consented grant, and every Carta command the
  page sends goes through the `call_tool` proxy.

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

## 4. The page issues; you report

**This surface performs the irreversible write itself.** The page saves, validates, shows
the review, and asks for one confirmation in its own sheet — that click is the gate, and
the write goes out under the viewer's own connector grant. A hand-off document cannot wake
this session, so a page that stopped at a saved draft set could never issue on its own.

After the write the page seals itself — no further save or issue from it — whenever the
outcome is settled or unknowable: issued, a timeout, or accepted-and-nothing-reported. A
refused value and a duplicate stakeholder both leave it usable, because neither wrote
anything.

So there is nothing to do after § 3. **End your turn on that one line.** Do not read the
store yet, do not poll, do not narrate and do not re-publish: filling an issuance form is
minutes of human work.

Then at the start of your **next** turn, whatever the user typed, read what the page
recorded:

```
Artifact({action: "read_db", url: "<the URL the publish returned>",
          db_op: "get", collection: "issuance", doc_id: "handoff"})
```

```json
{ "status": "issued", "issued": 1, "draft_set_id": 472, "security_type": "option_grant",
  "holders": ["Tagg Palmer"], "totals": {"USD": {"quantity": 100, "value": null}},
  "issue_date": "2026-09-21" }
```

Branch on `status`, never on `summary`. `holders`, `totals` and `issue_date` are for the
closing line:

| `status` | What it means | What you do |
|---|---|---|
| *not found* | they have not finished. The normal state | Answer whatever they asked. Not an error, and never reported as one |
| `issued` | **the securities are on the cap table** | Report it and close per [issue-and-close.md § On success](issue-and-close.md#on-success). **Do not call `issue_securities`** — that would issue a second time |
| `draft` | saved, validated, not issued | Say the draft is saved and they can come back to it, and **stop**. A saved draft is not an approval to issue |
| `needs_claude` | the page tried and could not finish | Read `reason`: `duplicates` → [mutate-recovery.md § Duplicate resolution](mutate-recovery.md#duplicate-resolution); `unknown_outcome` → **read the set's state before any write**, the rows may already be issued; `nothing_issued` → [mutate-recovery.md](mutate-recovery.md) |

## When something is wrong

| What you see | What it means | What you do |
|---|---|---|
| The publish warns it could not resolve the connector | the page has no Carta access | [chat surface](chat-surface.md) |
| The user says the page is empty, or every section says it couldn't load | the viewer hasn't allowed the connector, or Carta is down for them | Tell them to allow the Carta connection when the page asks, or to reconnect Carta in Settings → Connectors. Re-publishing does not help |
| The user says they see a hard stop in the page | the account isn't set up for this issuance | Read it back to them in plain language and stop. The fix is in Carta, not here |
| The user reports validation errors they can't clear | the server refused a value | Those belong to the page, which shows them against their own fields. Only if a message is one the page can't act on — a fund-structure block, a duplicate stakeholder, a missing FMV — read [mutate-recovery.md](mutate-recovery.md) |
| The user says it issued but no document appears | the store write failed after the write landed | **Do not issue.** The page names the draft set on screen; ask for it and read its state |
| The user wants to change a term after confirming | — | Tell them to hit Back in the page's sheet and confirm again. Don't rebuild rows yourself; the draft set is the record |

## What not to do on this path

- **Don't ask who the recipients are, or for anything the form collects** — a blank field on
  the form is the question. *"100 option grants"* with nobody named is one recipient getting
  100, not a headcount and not a question.
- **Don't pre-ask for a computable value.** Exercise price, grant expiration, jurisdiction
  and the sole-option defaults are all things the page derives and shows.
- **Don't stack an `AskUserQuestion` on the open page** for anything the page collects. It is
  unrestricted for a genuine fork the page cannot present — two Carta environments, a mixed
  security type — and for recovery after a server rejection.
- **Don't build the payload yourself.** Reading
  [payload-reference.md](payload-reference.md) here means you are on the wrong path: that
  file is for the chat surface and for recovery.
