# Portfolio Valuations — Cowork Widgets

Render the portfolio dashboard and bulk runner as published artifacts with data
baked in. Reached from Step 2.2b when `env_mode: "artifact"` — `Artifact` is
available and neither `mcp__Claude_Preview__preview_start` nor
`mcp__Claude_Browser__preview_start` is present. When either preview tool
is present (see Step 2.2a's `preview_tool_family`), the environment is
`env_mode: "preview-server"` instead (regardless of whether `Artifact` is
also present, and regardless of whether it's the desktop app or the CLI),
and the preview panel (`references/desktop-preview.md`) takes priority.

**This step runs after Step 3.2's data load** — the portfolio data is already
in context when you arrive here.

---

## Dashboard widget

### Step 1: Build the classified payload and filled HTML

Fetch all pages of `list:portfolio_dashboard` first (always `page_size: 100`) — do not run the
script until the last page is received.

Write the response to `.claude/preview/dashboard-data.json` using **Bash**:

```bash
mkdir -p .claude/preview
cat > .claude/preview/dashboard-data.json << 'PAYLOAD'
<response JSON>
PAYLOAD
```

Then run the build script, passing `--firm-id` (the resolved `org_pk` from
Step 1) and `--base-url` (`{BASE_URL}` per `references/deep-link.md` Step 1 —
the resolved **app** host, not the bare API host) so the script can build the
prep card's "Request access" link:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-portfolio-valuations/scripts/build_artifact.py" --template cowork-dashboard --firm-id "<org_pk>" --base-url "<BASE_URL>" < .claude/preview/dashboard-data.json > .claude/preview/dashboard-artifact.html
```

Do **not** manually construct the data payload or do template substitution
in context — the script handles all of that. Do **not** capture stdout
inline; always redirect to the file above.

### Step 2: Publish the artifact

**Never `Read` the built HTML.** `Artifact` takes a path, so the file never has to
enter context.

If the session flag `dashboard_artifact_url` is **not** set, call
`Artifact({action: "list", scope: "mine"})` and look for a **Portfolio Valuations**
artifact; if one is there, store its url as `dashboard_artifact_url`. If the flag **is**
already set (published earlier this session), skip the list call.

Then publish — one call either way, `url` being the only difference:

```
Artifact({
  file_path: ".claude/preview/dashboard-artifact.html",
  url: "<dashboard_artifact_url — omit entirely on a first publish>",
  title: "Portfolio Valuations",
  description: "Portfolio valuations dashboard — company buckets, valuations, financing rounds, and tender offers.",
  favicon: "📊",
  label: "Refreshed portfolio data"
})
```

The data is baked in, so no `capabilities` are needed. Store the returned url as
`dashboard_artifact_url` — that skips the list call on every subsequent render this
session and keeps the redeploy on the same URL.

Give the user the URL and tell them:
> 📊 Your portfolio dashboard is ready. The card at the top shows how many
> companies are ready to value — click **Get started** to open the bulk runner.
> If it doesn't drop straight into the chat box, copy the prompt from the
> panel that appears and paste it in.

The run card's **Get started** action tries `sendPrompt(text)` first, but on
Cowork that call is always a no-op — a page published via the `Artifact` tool
has no chat-composer capability at all (the runtime only grants
`artifact`/`downloads`/`mcp`/`self`, none of which touch the composer), unlike
the Runner widget/Plan card below, which really do get `sendPrompt` because
they render through `show_widget` instead. So on this dashboard the
copy-to-chat popover is not a rare fallback — it is what fires on every
click here. Don't promise the user the composer will pre-fill; say the
copy panel is how this one works.

**Get started** does NOT send a plain "review" prompt — it asks to **open the
bulk runner**. On Cowork it arrives as the chat message *"Open the bulk runner
for all the companies my firm can value."*; on Code Desktop the preview pane
posts `{intent:"open_runner"}` to the local server (handled in
`references/desktop-preview.md` Step 4). **In both cases, respond by opening
the bulk runner** — first show the **Plan card** (section below), which leads to
the **Runner widget** on the customize path. Do not start a run before the user
selects in the runner.

Skip Step 3.2's markdown table. Proceed directly to Step 2.3 (action prompt).

---

## Plan card

Reached when the user chose "Runner widget" in the format prompt from
SKILL.md Step 2.2b (interactive runner path). **Show this plan card first** —
before the full runner list. It summarizes the auto-suggested bulk-create plan
(method rule set + per-method counts) so the user can bulk-create in one click
without scrolling a long list, or open the full list to customize. If the user
chose "Inline view" instead, read `references/md-table-runner.md` — do not
follow this section.

The plan card **owns the valuation date** (it has its own date picker). Because
of that, the interactive runner path does **not** ask the Step 3 date question
inline — the card collects the date and threads it into both buttons.

### Step 1: Build the plan-card HTML

Use the same classified payload as the runner list — the card and the list read
the **identical** `eligible[]` array (`{name, approach, hasPrevious}` per entry;
`value` optional). The card groups by the suggested `approach`, so no separate
classification is needed. Derive the payload exactly as the Runner widget's
Step 2 below describes.

Write the payload into the template's `"__INJECTED_DATA__"` token via the build
script and save to `.claude/preview/runner-plan-artifact.html`:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-portfolio-valuations/scripts/build_artifact.py" --template cowork-runner-plan --pre-classified < <(printf '%s' '{"eligible":[…]}') > .claude/preview/runner-plan-artifact.html
```

(Any means of feeding the `{"eligible":[…]}` JSON on stdin works — a heredoc or a
written file is fine; the script only needs it on stdin.)

### Step 2: Show the plan-card widget

If `mcp__visualize__read_me` output is not yet in context this session, call it
now (skip if already in context). Read `.claude/preview/runner-plan-artifact.html`
and pass the **full file contents verbatim** as `widget_code`:

```
title:            "portfolio_valuations_plan"
widget_code:      <full contents of runner-plan-artifact.html>
loading_messages: ["Loading plan…", "Preparing companies…"]
```

`sendPrompt(text)` is injected as a global into the widget's JS context (same as
the runner list). The card's two buttons use it:

- **Create draft valuations** (primary) → pre-fills the composer with
  `Bulk-create valuations for the following companies:\n- {name} (method: {method}, date: {date})…`
  for every eligible company with its suggested method — the **same prompt shape
  the runner list emits**, so the bulk-runner flow parses it unchanged. The user
  presses **Enter** to send.
- **Adjust by company** (secondary) → pre-fills the composer with
  `Open the bulk runner so I can customize the methods and values (valuation date: {date}).`
  When you receive that message, **open the Runner widget** (section below) with
  the same eligible set, and seed its date field with the `{date}` the message
  carries so it does not re-ask.

As with the runner list, `sendPrompt` may exist but silently no-op, so the card
**always** shows a copy-to-chat panel after either button — never assume a
silent click failed.

Tell the user:
> 🏃 Here's your bulk-create plan. Click **Create draft valuations** to create
> every valuation with its suggested method (then press **Enter**), or **Adjust
> by company** to open the full list and change methods or values first. If the
> chat box doesn't fill in, a copy-to-paste box appears below the plan instead.

---

## Runner widget

Reached when the user clicks **Adjust by company** on the Plan card above (the
customize path), or directly when the bulk-runner flow routes here for a
pre-selected set. If the user chose "Inline view" in Step 2.2b instead, read
`references/md-table-runner.md` — do not follow this section.

When arriving from the Plan card's **Adjust by company** button, seed the
runner's valuation-date field with the date the button's message carried so the
user isn't asked again.

### Step 1: Print the recommended plan inline

Before showing the widget, print the recommended plan as inline markdown text
in the chat response. Derive it from the classified payload already in context:

- **Draft valuations** (bucket: `draft`) → "Previous period" (they have a prior)
- **No valuation** (bucket: `noValuation`) → "GPC" (no prior to copy)
- **Final valuations with events** → apply event → approach mapping:
  - `newFinancingRound` → Post-Money (note the post-money EV)
  - `newTenderOffer` or `newShareTransfer` → Backsolve
- **Final valuations with no events** (bucket: `current`/`final`) → "Previous
  period" (carry forward the existing approach) — same treatment as the
  `md-table-runner.md` text runner's Priority 3 rule (Step 3 there). Do not
  omit this bucket: a company whose valuation is already `FINAL` and has had
  no financing round, tender offer, or share transfer since still belongs in
  the plan as an optional refresh — the widget must offer the same
  companies the text runner offers, just through checkboxes instead of a
  typed row-number reply.

Format as a short grouped list, e.g.:

```
**Recommended plan — {N} companies:**

**Previous period ({N}):** Company A, Company B, …
**GPC ({N}):** Company C, Company D, …
**Backsolve ({N}):** Company E (recent tender offer)
**Post-Money ({N}):** Company F (recent financing — $50M post)
```

### Step 2: Build the runner HTML

Read the runner template:

```bash
cat "${CLAUDE_PLUGIN_ROOT}/skills/carta-portfolio-valuations/templates/runner.html"
```

Replace the `"__INJECTED_DATA__"` token with a minimal JSON object containing
only `eligible` — an array of `{name, approach, hasPrevious, previousApproaches}`
entries derived from the classified payload. Use the same approach defaults
as Step 1's plan:

```json
{"eligible":[{"name":"Company A","approach":"copy_from_previous","hasPrevious":true,"previousApproaches":[{"kind":"gpc","weight":"1.0"}]},{"name":"Company B","approach":"gpc","hasPrevious":false},{"name":"Company F","approach":"post_money","hasPrevious":true,"previousApproaches":[{"kind":"gpc","weight":"1.0"}],"value":50000000},…]}
```

The template reads only `name`, `approach`, `hasPrevious`,
`previousApproaches`, and (optionally) `value` from each entry — do not
include any other fields. This keeps the injected payload small.

**`hasPrevious`** — `true` for companies in the `draft` or `final` buckets
(they have a prior valuation to copy), `false` for companies in the
`noValuation` bucket. The widget uses this to disable the "Copy from
previous" method option for companies with no prior valuation to copy — do
not omit it or every row's dropdown offers a method that can't actually run
for `noValuation` companies.

**The `eligible` array includes `final`-bucket companies with no events, not
just `draft`/`noValuation`/`final`-with-events.** A company sitting at
`FINAL` with nothing new since is still a candidate for a refresh — omitting
it here would silently exclude companies the text runner (`md-table-runner.md`)
offers, which is exactly the mismatch this note exists to prevent. Give it
`approach: "copy_from_previous"`, `hasPrevious: true`, and
`previousApproaches` from its own `latestValuation.approaches`.

**`previousApproaches`** — the `latestValuation.approaches` array, each entry
a weighted approach object, e.g. `[{"kind":"gpc","weight":"1.0"}]` or
`[{"kind":"gpc","weight":"0.5"},{"kind":"other_indication_of_value","weight":"0.5"}]`
— for companies with `hasPrevious: true`. Omit for `noValuation` companies
(there is nothing to copy). The widget shows this on the "Same as previous
period" option, method(s) first — e.g. "GPC (Same as previous period)" for
a single approach, or "GPC 50% DCF 50% (Same as previous period)" for a
blend — so the user isn't copying forward blind. Weights render only when
there are 2+ approaches; a single approach is always 100%, so the percent
would be noise. Do not reformat or translate the `kind` codes; the template
owns the code → label mapping via its own `APPROACH_MAP`.

**Include `value` whenever Step 1's plan already surfaces a known number** for
that company — a Post-Money entry with `newFinancingRound.postMoney`, or a
Custom Value entry with a known company value. Pass the raw numeric amount
(not formatted with commas or a `$` prefix); the widget pre-fills the Value
field with it so the user doesn't have to re-enter a number already shown in
the plan text. Omit `value` (or leave it `null`) for GPC, Backsolve, and
M&A rows, and for Post-Money/Custom Value rows where no number is known yet —
the field stays blank and editable in those cases.

Write the filled HTML to `.claude/preview/runner-artifact.html` via Bash.

### Step 3: Call read_me (first time only)

If `mcp__visualize__read_me` output is not yet in context this session, call
it now. Skip if already in context.

### Step 4: Show the widget

Read `.claude/preview/runner-artifact.html` with the `Read` tool. Pass
the **full file contents verbatim** as the `widget_code` parameter.

Call `mcp__visualize__show_widget`:
```
title:            "portfolio_valuations_runner"
widget_code:      <full contents of runner-artifact.html>
loading_messages: ["Loading runner…", "Preparing companies…"]
```

`sendPrompt(text)` is injected as a global into the widget's JS context.
The runner template uses this pattern — when the user clicks **Create N draft
valuations**, the prompt **pre-fills the chat composer**; the user then
presses **Enter** to send it (a host-side human-in-the-loop step — it is
not auto-submitted).

**Do not assume `sendPrompt` succeeded just because it exists as a
function.** On some hosts (observed in Claude Code Desktop's `show_widget`
surface) `sendPrompt` is defined but silently no-ops — nothing pre-fills
and no error is thrown. The template therefore always shows the
copy-to-chat panel after **Create N draft valuations** is clicked, regardless of
whether `sendPrompt` ran — the user can paste the prompt manually if the
composer never received it. Never assume a silent click means the button
is broken; check whether the copy panel appeared with the run prompt.

Tell the user:
> 🏃 Bulk runner is ready. Review the method and value for each company, then
> click **Create draft valuations** and press **Enter** to send. If the chat box
> doesn't fill in, a copy-to-paste box will appear below the runner instead.

---

## Refreshing after a run

After any bulk valuation run completes, fetch all pages with new
`portfolio_valuations:list:portfolio_dashboard` calls (`page_size: 100`),
overwrite `.claude/preview/dashboard-data.json` with the response via Bash heredoc,
then re-run:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-portfolio-valuations/scripts/build_artifact.py" --template cowork-dashboard --firm-id "<org_pk>" --base-url "<BASE_URL>" < .claude/preview/dashboard-data.json > .claude/preview/dashboard-artifact.html
```

`dashboard-data.json` holds the raw API response, so this takes no
`--pre-classified` flag — same as the initial build in Step 1. Pass the same
`--firm-id` / `--base-url` as Step 1 so the "Request access" link keeps working
after the refresh.

Republish it by passing the same `file_path` and the stored
`dashboard_artifact_url` — never `Read` the file first. Do this silently. Do not
re-show the runner widget unless the user explicitly asks to run more valuations.

**Overwrite `dashboard-data.json` before rebuilding.** The build script reads
only that file; rebuilding without overwriting it first republishes the previous
run's data to the same URL and returns success, so the artifact reloads and
shows nothing new.
