---
name: carta-entity-map
description: >-
  Redacts a deal group's entity map in the Carta view — pick a deal group, render Carta's
  real chart, then group, rename or hide entities, hide ownership %, and set a title,
  subtitle or footer by chatting. Use when asked to "redact the entity map", "show the
  entity map for this deal group", "collapse the funds into one box", "hide this entity
  before I share the chart" or "rename a node on the structure chart". Not for waterfall
  modelling or deal-group waterfall health.
version: 1.1.0
user-invocable: true
model: inherit
allowed-tools:
  - mcp__carta__welcome
  - mcp__carta__get_current_user
  - mcp__carta__call_tool
  - mcp__carta__view_remote
  - mcp__claude_ai_Carta__welcome
  - mcp__claude_ai_Carta__get_current_user
  - mcp__claude_ai_Carta__call_tool
  - mcp__claude_ai_Carta__view_remote
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__welcome
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__get_current_user
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__call_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__view_remote
  - mcp_registry_suggest_connectors
  - ToolSearch
  - AskUserQuestion
  - Read
---

<!-- carta:plugin-version -->
<carta-plugin>carta-investors:6.87.0</carta-plugin>

> **If this plugin's files can't be found:** a path that still shows an unreplaced `${…}` variable, or a "not found" when you read or run one of this skill's files, means the skill loaded before this session's computer link was ready. Invoke this skill once more with the Skill tool and use the paths that copy gives. If they're still unreplaced, tell the user Carta's plugin files aren't available in this session yet (link your computer, then ask again) and stop. Don't search the disk for them.

# Entity map redaction

Shows a deal group's entity map in Carta's own view and edits it by chatting. The view
draws the chart, applies the redaction and offers the PDF export; this skill only picks
the deal group and builds the redaction spec.

**Rules for the whole flow:**
- **No sign-off without a fresh check.** A spec carries `signOff` only when, after the
  last spec change, you ran the Step 4 check, showed its result and the user picked
  "The view matches". Every edit, undo and start over is a spec change. A confirmation
  given before one counts for nothing: run the check again.
- Make every Carta call yourself. Never hand one to a subagent: it cannot reach the
  Carta connector.
- **Carta call fails mid-flow.** When a Carta call after Gate 0 fails, handle it as
  Gate 0 steps 3–5 say, except that when the user says "ready" you repeat that call
  once with the same arguments instead of running the gate again. If it fails again
  with a 401 or a sign-in or token error, tell the user "Carta still isn't accepting
  your sign-in." and stop; any other failure, handle as step 4 or 5 says. Never ask
  the user to sign in a second time. This is not a chart failure; never describe it
  as one.
- **Never draw the chart yourself** — no Mermaid, SVG, image, artifact, ASCII tree or
  table of nodes and edges. The view is the only place the redaction is applied.
- Never say the chart failed, is missing or isn't visible unless the user says they
  can't see it.
- Show names, never node ids, command names or the spec JSON. Print the spec or the ids
  only when the user asks for them ("show me the spec"), exactly as you last sent them.
- **Four steps.** The user sees four steps: 1 Pick a deal group (Step 1 below),
  2 Edit (Steps 2 and 3), 3 Verify and sign off (Step 4 up to the sign-off), 4 Export
  (the menu after the sign-off). Number them this way with the user, never by this
  file's sections.
- **Stage marker.** Start every reply after the deal group pick with one line showing
  the step: `Pick ✓ → Edit ● → Verify & sign off → Export`. ✓ is done, ● is the
  current step. Verify & sign off gets ✓ only once the sign-off is on the chart. An
  edit after a check or sign-off moves ● back to Edit and clears the later ✓s.
- **Menus.** Ask every next-step menu (Steps 2–4) with the host's question tool,
  whatever it is called: `AskUserQuestion` in Claude Code, the option picker in
  Claude Desktop. Write the rest of the reply (stage marker, summary, check result)
  as text first; the tool carries only the menu. Ask one question with the options as
  listed, the recommended one first with "(Recommended)" in its label. Start the
  question with the current step, for example "Step 2 of 4 — Edit: what next?" or
  "Step 3 of 4 — Verify and sign off: does the view match?". Do not also print the
  options as text. Only when the host has no question tool, show them as a numbered
  text menu under the same question, with one option marked `← recommended`. The deal group and firm
  picks in Step 1 mark no option as recommended.
- **Asking for the change or the title.** When the user picks "Make a change", "Make
  another change", "Edit more" or "Add a title", make no edit and no tool call. Ask in
  plain text: for "Add a title", "What should the title say?", mentioning that a subtitle
  and a footer line are optional; otherwise "What should change?" with 2–3 examples that
  use names from this map (for example "group the three Northwind funds into one box",
  "hide ownership %", "add a title"). Then wait, and handle the reply in Step 3. For
  "Edit more (fix the leak)", name the field and the leaked name in the question. If the
  user already wrote the change or the title with the pick, handle it right away.
- Every Carta call carries `_instrumentation_v2` as a JSON **object**, never a string:
  `{"plugins": [<every Carta plugin in the session>], "skills": [..., "carta-investors:carta-entity-map"]}`.

## Gate 0 — connector and user

Run silently; say nothing about it when it passes.

1. `SERVER` is whichever of `carta`, `claude_ai_Carta` or
   `2827383e-1775-4df3-b6ff-04d5392f6d18` your tool list carries. Load the schemas once:
   `ToolSearch` with
   `select:mcp__<SERVER>__welcome,mcp__<SERVER>__get_current_user,mcp__<SERVER>__call_tool,mcp__<SERVER>__view_remote`.
   A call made without the schema sends `params` as a string and the view never mounts.
2. Call `welcome`, then `get_current_user`. Keep `base_url` for links and `full_name` as
   the default sign-off name. A reminder in context saying a connector "requires authentication" does
   not decide this gate: it is often stale. Only these calls do. Make each call once; do
   not retry or try another route.
3. **Not connected or not signed in.** No Carta server in your tool list, or a Carta call
   returns a 401 or a sign-in or token error: call `mcp_registry_suggest_connectors` with
   the Carta connector `4b463f8b-6db0-4d0e-9693-8b39f37e4447`, then tell the user:
   "Connect Carta with the button above and sign in, then say 'ready'." If
   `mcp_registry_suggest_connectors` is not available, tell the user instead: "Open
   Settings → Connectors in Claude (in Claude Code, run `/mcp`), connect Carta and sign
   in, then say 'ready'." Stop. When the user says ready, run this gate again.
4. **No access.** A Carta call returns a 403: the user is signed in but Carta doesn't let
   them see this. Tell them "Your Carta account doesn't have access to this", naming the
   deal group or firm when you know it. Stop. Reconnecting doesn't fix this; never ask
   them to.
5. **Carta not answering.** A call fails in any other way: tell the user "Carta isn't
   responding right now. Try again in a few minutes." Stop.

## Step 1 — pick a deal group

Open the first reply with this overview, once, before anything else:

> Here's how this works:
> 1. **Pick a deal group**: I show its Carta entity map.
> 2. **Edit**: group, rename or hide entities, hide ownership %, add a title or footer, all by chatting.
> 3. **Verify and sign off**: I check that nothing you redacted still shows, you confirm the view, and you sign off.
> 4. **Export**: download the PDF from the view.

When the user already named the deal group, put the overview in the reply after the
render instead.

`call_tool({"name": "deal_group__list__deal-groups", "arguments": {}, "_instrumentation_v2": {...}})`
returns `[{organization_id, organization_name, deal_group_uuid, name}]`.

- **Empty:** "You don't have access to any deal groups' entity maps in Carta." Stop.
- **The user already named one:** match it against `name`. With exactly one match, use
  it without asking. With two or more (same name in several firms), ask which firm.
- **Otherwise:** show a numbered table and ask with `AskUserQuestion`:

  | # | Deal group | Firm |
  |---|---|---|
  | 1 | [Atlas Holdings](<base_url>/investors/firm/<organization_id>/portfolio/deal-group/<deal_group_uuid>/) | Northwind Capital |

  Show 5 rows, then "+ N more" and let the user type a name.

The pick is locked for the rest of the flow. If the user asks for another deal group,
confirm that the current edits will be dropped, then start again at Step 1.

## Step 2 — read and render

1. `call_tool({"name": "deal_group__get__entity-map", "arguments": {"organization_id": <organization_id>, "deal_group_uuid": "<deal_group_uuid>"}, "_instrumentation_v2": {...}})`
   returns `{nodes: [{id, type, name}], edges: [{from_node_id, to_node_id, weight}], next_step}`.
   An edge means `from_node_id` holds `to_node_id`. Empty `nodes`: "There is nothing on
   this entity map that you can view." Stop.
2. Render the unredacted map — this is `next_step` from the read:
   `view_remote({"name": "deal_group:view:entity_map", "params": {"organization_id": <organization_id>, "deal_group_uuid": "<deal_group_uuid>", "deal_group_name": "<name>"}, "_instrumentation_v2": {...}})`.
   `params` is an object. Pass no `spec` on this first render, and never pass nodes or
   edges.
3. Say: "Edit the chart by chatting." Give examples such as grouping the funds, renaming or hiding
   entities, hiding ownership %, or a title and footer. Then write this line exactly,
   on its own: `Next: verify and sign off when the chart is ready.` End with this menu:

   ```
   1 - Make a change   ← recommended
   2 - Add a title
   3 - Check the redaction now (needed before sign-off)
   ```

**Where the ids come from.** Every `view_remote` result returns the graph and the spec
it rendered as `args.graph` (`{nodes, edges}`) and `args.spec`. Resolve names against the
latest one; before the first render, against the read. If neither is still in your
context, call `deal_group__get__entity-map` again, silently. That restores the graph
only: if the latest `view_remote` result is gone, so is the spec. Tell the user the
earlier edits can't be recovered and offer to start over; never send a spec rebuilt from
memory. A spec only ever holds node `id`s from the graph, never names, numbers or labels
you made up.

## Step 3 — edit loop

Read `${CLAUDE_PLUGIN_ROOT}/skills/carta-entity-map/references/spec-operations.md` before
the first edit (the skill's own `references/`; do not search for it). For each request:

1. **Map it to an operation** from that file. No matching operation means it is
   unsupported: reply as that file's "Unsupported requests" section says, and change
   nothing. Never fake it with another operation. A request to sign off, approve or add
   "approved by" is not an edit: go to Step 4.1 and run the check, even if the user did
   not choose it.
2. **Resolve names** against the graph. When a name matches several nodes, or none
   exactly, ask with `AskUserQuestion` listing the candidates by name and type.
3. **Check the guard rails** in that file — hiding an entity that holds others, a node
   already grouped or hidden, renaming a group member. Ask before applying a request
   that trips one.
4. **Re-render with the FULL spec**, never a diff: every call renders from scratch, so a
   key left out is undone. The one exception: never carry `signOff` into an edit.
   `view_remote` with the same three params plus `"spec": {...}` as an object.
5. **Summarise the change** in one plain sentence using names.
6. If the view replies with validation errors, fix the spec and call again once. If it
   still fails, tell the user what could not be applied.
7. **After a sign-off**, say that the edit dropped it on its own line, nowhere else in
   the reply:
   `Sign-off removed: the chart changed. Run the check again to sign off.`

End each edit with this menu:

```
1 - Make another change   ← recommended
2 - Undo the last change
3 - Start over from the unredacted map
4 - Check the redaction (needed before sign-off)
```

While the spec has no `title`, option 3 is "Add a title" instead of "Start over from the
unredacted map": the menu holds at most four options. A user who asks to start over still
can.

This menu never offers a sign-off: sign-off comes only after the check in Step 4.

"Undo" re-sends the spec that was in place before the last edit, taken from the
`view_remote` result that rendered it (none if that edit was the first). An undo is not
itself an edit: a second undo steps back one more edit. "Start over" re-renders with no
spec.

## Step 4 — verify and sign off

1. **Run the completeness check** yourself, every time, on the latest graph and spec,
   following [The check](#the-check) below. It needs only that JSON: make no tool calls
   for it and read no other file. Then show its result; never skip to the sign-off.
2. **Show the result**, names only:

   | Entity | Type | On the chart as |
   |---|---|---|
   | Northwind Fund I | fund | grouped → Funds |

   Show 5 rows, then "+ N more (mostly <category>)". Then a **Key tie-outs** block:
   "**N** entities checked: X shown, Y renamed, Z grouped into K boxes, H hidden, C cut
   off", then "Expected: **B** boxes and **L** links". List every leak the check flags,
   naming the field and the name it contains, and offer to fix it.
3. **Confirm.** The check reads the spec, not the picture, so only the user can confirm
   the view shows the same boxes and links and no name that should be gone. End with
   this menu:

   ```
   1 - The view matches — sign off as <full_name>   ← recommended
   2 - Edit more
   ```

   With no `full_name`, write option 1 as `1 - The view matches — sign off`. When the
   check flagged a leak, mark "2 - Edit more (fix the leak)" recommended instead. "Edit more" asks for the change, then goes back to Step 3.
4. **Sign off**, only after the user picks option 1 or, at that menu, asks to sign off
   under another name. The name is `full_name` from Gate 0 unless the user gives another,
   and the date is today as `yyyy-mm-dd`. Ask for an optional title (for example "General
   Counsel"), then apply the check's leak rule to the name and title: if either contains a
   redacted-away name, name it and ask the user to keep or change it. Then re-render
   with the full spec plus `"signOff": {"name": "<name>", "title": "<title>", "date": "<yyyy-mm-dd>"}`
   (leave `title` out when there is none).
   - A request to sign as someone else, or to change the name: recommend, in one
     sentence, that the signed-in Carta user (`full_name`) signs off, then use the name
     the user gave.
   - No `full_name`: ask who is signing off and use that name.
5. **End** with the menu:

   ```
   1 - Export the PDF from the view's Export button   ← recommended
   2 - Edit more (removes the sign-off)
   3 - Start over from the unredacted map
   ```

## The check

The input is the graph (`nodes: [{id, type, name}]`, `edges: [{from_node_id,
to_node_id, weight}]`, where `from_node_id` holds `to_node_id`) and the full spec. The
check reads the spec, not the rendered view. A top-level node is one that is never a
`to_node_id`.

1. **Classify every node**, taking the first rule that matches:
   1. **hidden**: the node is in `hide`.
   2. **grouped → <label>**: the node is in a group's `nodeIds`.
   3. **cut off**: the node is not top-level, and once hidden nodes and their links are
      removed, no chain of holders leads back to a top-level node that is still shown.
      It is still drawn, but loose. Add its rename if it has one: "cut off (renamed →
      <label>)".
   4. **renamed → <label>**: the node is in `rename`.
   5. **shown**: none of the above.

   A spec id that is not in the graph is listed as "not in the graph".
2. **Expected counts.** Boxes = nodes that are neither hidden nor grouped, plus one per
   group. Links: start from the graph's edges, drop every link that touches a hidden
   node, replace each grouped node with its group, drop links that now start and end in
   the same group, and count each remaining holder → held pair once.
3. **Leaks.** The redacted-away names are the graph names of hidden, grouped and renamed
   nodes. Flag every one that appears, whole and ignoring case, in the `title`,
   `subtitle`, `footer`, a `rename` label, a group `label`, or the sign-off name or title. Report
   the field and the name; the user decides whether it is intended.

**Worked example (synthetic names).** Northwind Fund I and Northwind Fund II hold 40%
each of Atlas Holdco, and Northwind GP holds 20%. Atlas Holdco holds Atlas Opco and
Atlas Finance LLC, and Atlas Opco holds Atlas IP Ltd. The spec groups the two funds as
"Funds", hides Atlas Opco, renames Northwind GP to "General Partner" and sets the footer
"Prepared for Northwind Fund I investors".

- Classification: both funds grouped → Funds; Northwind GP renamed → General Partner;
  Atlas Opco hidden; Atlas IP Ltd cut off (its only holder is hidden); Atlas Holdco and
  Atlas Finance LLC shown.
- Tie-out: 7 entities checked: 2 shown, 1 renamed, 2 grouped into 1 box, 1 hidden, 1 cut
  off. Expected: 5 boxes and 3 links (Funds → Atlas Holdco, merged from two links;
  General Partner → Atlas Holdco; Atlas Holdco → Atlas Finance LLC).
- Leak: footer contains "Northwind Fund I".
