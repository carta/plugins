# The Code adapter — side-panel artifact flow

How `carta-issuance` collects input and confirmation on a **live side panel**. This is the
single source of truth for the rendering machinery; the SKILL.md phases name *what* each
surface shows and point here for *how* to open it.

**Read this only on the Code path** — i.e. when
[Phase 0 Step 1](../SKILL.md#step-1--detect-the-environment-from-the-tool-surface) found
`preview_start` in the tool surface. In Cowork (~95% of usage) none of this applies; read
[cowork-adapter.md](cowork-adapter.md) instead. Read it once before opening the first panel.

This file implements the Code adapter's three capabilities: `collectConfig` (the config
panel, §2), `showReview` (the review panel, §2), and `confirm` (the panel's own button, §3–4).

`carta-issuance` opens two surfaces, in order:

| # | Surface | Phase | Collects | Button → action |
|---|---|---|---|---|
| 1 | **issuance-config** | 0.5 → [1.5](../SKILL.md#phase-15--save--validate-before-review-or-save-only) | one full key-value block per stakeholder — every field, per person | **Review** → `config_submit` (saves + validates, Phase 1.5) · **Save** → `save_only` (saves only) |
| 2 | **issuance-review** | 2 | read-only summary of the already-saved-and-validated drafts (nothing editable here) | **Confirm & Issue** → `submit` · **Back to edit** → `back_to_edit` |

Both use the same three mechanics below: pick the surface, render it, wake on submit.

---

## 1. You are already on this path

Surface selection happened in
[Phase 0 Step 1](../SKILL.md#step-1--detect-the-environment-from-the-tool-surface):
`preview_start` present → Code adapter (this file). If you are reading this file, the side
panel **is** the surface for both Phase 0.5 and Phase 2 — there is nothing further to pick,
probe, or degrade.

**Do not run a filesystem probe.** Earlier versions of this skill shelled out to
`find … generate.py` to detect the renderer. That probe is gone: it always returned
`RENDERER_MISSING` in Cowork (costing a round trip to learn what the tool list already
said), and in Code it re-derived a fact `preview_start`'s presence already establishes.

**Do not fall back to chat from here.** Once `preview_start` is present, the panel path is
the path. "The panel might not work here," "this looks chat-only," "Bash may not be
available" — none of these are grounds to abandon the adapter mid-run; each has, for real,
been used to justify skipping a working panel. If a panel genuinely fails to render, that is
an error to surface, not a signal to silently re-collect everything via `AskUserQuestion`.

`render-panel` needs the `artifact-manager` plugin, which is separate and could in principle
be absent even when `preview_start` is present. If invoking `artifact-manager:render-panel`
errors because the sub-skill isn't installed, say so plainly and stop — do not improvise a
degraded surface:

> *"The issuance panel needs the `artifact-manager` plugin, which isn't installed. Install it
> and try again."*

---

## 2. Render the side panel

This is the Code adapter's rendering path (§1) — render it whenever this adapter is
selected. The panel is rendered by the `artifact-manager:render-panel` sub-skill,
which runs `generate.py` itself. **You hand render-panel five inputs and invoke it —
you do not run `generate.py`, and you do not re-probe** (§1 already gated this path).

Track these as **literal values** and substitute them into every Bash command —
**env vars do NOT persist across Bash tool calls**, so a `$VAR` set in one call is
gone in the next.

**Never prefix a command with `cd`.** `OUT_DIR` (and every path built from it) is already
absolute — invoke `uv run <script>` and friends directly from the current directory. A
command written as `cd "$OUT_DIR" && uv run …` still works, but its literal text no longer
starts with `uv run`, so it falls outside the pre-authorized `Bash(uv run *)` tool
permission and prompts for approval every time. Passing absolute paths as arguments keeps
the command's leading verb matching the allowed pattern.

| Input | Form | Per-surface value |
|---|---|---|
| `ARTIFACT_YAML` | `${CLAUDE_PLUGIN_ROOT}/skills/carta-issuance/<kind>/references/artifact.yaml` | see call-sites |
| `ARTIFACT_NAME` | `carta-cap-table-<kind>-<CORP_ID>` | per-corp; entries accumulate so parallel corps don't collide |
| `ARTIFACT_FILENAME` | `<CORP_ID>_<suffix>.html` | see call-sites |
| `OUT_DIR` | `~/.carta/cache/<kind>/<CORP_ID>` (absolute, `~` expanded) | see call-sites |
| `SUB_FLAGS` | the `--substitute` / `--substitute-file` array | built per surface |

**Call sites:**

| Surface | `<kind>` | `OUT_DIR` | `ARTIFACT_FILENAME` | submit `action` |
|---|---|---|---|---|
| issuance-config | `issuance-config` | `~/.carta/cache/issuance-config/<CORP_ID>` | `<CORP_ID>_config.html` | `config_submit` / `save_only` |
| issuance-review | `issuance-review` | `~/.carta/cache/issuance-review/<CORP_ID>` | `<CORP_ID>_review.html` | `submit` |

**Skeleton** (fill the `<…>` per surface). Copy the fonts so the panel renders in
Carta type; build `SUB_FLAGS` with scalars inline and any block that carries
quotes/newlines via `--substitute-file` (inline `--substitute` would mangle the
escaping, and the Write tool creates `OUT_DIR`):

```bash
OUT_DIR="$HOME/.carta/cache/<kind>/<CORP_ID>"
mkdir -p "$OUT_DIR"
REFS="${CLAUDE_PLUGIN_ROOT}/skills/carta-issuance/<kind>/references"
cp "$REFS/Inter-roman.var.woff2" "$OUT_DIR/" 2>/dev/null || true
cp "$REFS/SangBleuVersailles-Regular-WebS.ttf" "$OUT_DIR/" 2>/dev/null || true

SUB_FLAGS=(--substitute "CORP_NAME=<value>")
SUB_FLAGS+=(--substitute "CORP_ID=<value>")
# … the rest of this surface's scalars …
SUB_FLAGS+=(--substitute-file "<BLOCK_KEY>=$OUT_DIR/<block>.html")   # quotes/newlines
```

Then: **invoke `artifact-manager:render-panel`** with the five inputs above
(render-panel's Step 1a runs `generate.py --config <ARTIFACT_YAML> --out-name
<ARTIFACT_FILENAME>`). The dynamic HTML blocks are produced by `build_config.py` (config
panel) or assembled per the `issuance-review` sub-skill (review panel) — **never
hand-author panel HTML** (a hand-built block once shipped dead `class="btn-card"`
buttons and stamped a plan id where a document-set id belonged; large hand-authored
blocks also trip the Desktop output content-filter). `{{SAVE_PORT}}` and the preview
port are filled by render-panel, not here.

After the panel opens, tell the user one line and **stop** (see §4). **Always include the
panel's own URL as a fallback** — render-panel's Step 6 returns
`http://localhost:<port>/<ARTIFACT_FILENAME>` to you; Claude Desktop's side panel is sometimes
collapsed or docked out of view, so stating the link up front lets the user open it directly
instead of first reporting "I don't see it" and waiting for a reply:

> Configure the issuance in the side panel and click **Continue** when ready. If the panel
> doesn't appear, open http://localhost:\<port\>/\<file\>.html directly.

---

## 3. Wake on submit

Each artifact declares `capabilities: [save, submit-watcher]`, so render-panel
starts a background submit-watcher (clearing any stale signal first).

| Tier | How you wake | Where the payload is |
|---|---|---|
| Side panel | watcher exits → background-completion notification | `cat "$OUT_DIR/<CORP_ID>_action_request.json"` |
| Chat | the `AskUserQuestion` answer | the selected option |

**Side panel — JSON action-request** (machine-to-machine; stays structured). The
signal file carries `{ action, … }` plus, on the **config** panel only, the `rows` the
user entered — one full field set per stakeholder. The **review** panel is read-only, so
its signal carries no `rows` at all, just `{ action, corp_id, corp_name, draft_set_id }` —
full shapes in the [config](../issuance-config/SKILL.md) and
[review](../issuance-review/SKILL.md) sub-skills.

**The watcher is one-shot** — by the time you read the file it has already exited, so an
`AskUserQuestion` in a *later* recovery loop is safe (there is no wake left to block). A signal
you haven't branched on yet is never "stale" — every click overwrites the file and re-signals,
so treat each wake as real and branch on it directly (SKILL.md Phase 3); asking the user to
confirm their own click already happened both violates §4 below and is what once made a
Continue click look like it silently did nothing.

---

## 4. The one-confirmation rule

**While the panel is open, emit no `AskUserQuestion`.** The surface's own button
**is** the confirmation. An open `AskUserQuestion` suspends Claude's event loop, so
the submit-watcher's completion notification is never delivered — the click
silently does nothing and the issue never runs. (This is the bug that once stacked
a redundant "Issue now / Save as draft" prompt on top of the panel.)

The carve-outs, by timing:

- **Before** any surface opens — data-gathering `AskUserQuestion`s are fine (e.g. the
  Rule 144 prompt, plan/legend/vesting resolution). No watcher is running yet.
- **While** a surface is open — none. The button is the only signal.
- **After** the watcher has fired — recovery `AskUserQuestion`s are fine. You are back
  in chat, the one-shot watcher has exited, and server short-circuits (validation
  errors, duplicates, warnings) are gathered and acknowledged here before each retry
  mutate.

The HITL prompt the SDK fires on the mutate is a *separate*, final irreversibility
gate — it shows raw tool input, not the reviewed surface, so it is **never** the
review gate.

---

## 5. Panel lifecycle gotchas

- **The panel cannot reliably close itself.** `window.close()` is blocked for a
  host-opened webview and there is no preview-close tool, so on submit the panel shows
  an honest "Sent to Claude — follow the rest in the chat" hand-off with a **Done**
  button the user dismisses. A best-effort `preview_eval` `window.close()` on the
  panel's `serverId` is fine (a silent no-op if blocked) but **don't claim it closed
  or wait on it** — proceed straight to the next step.
- **A config panel's server may linger and be reused next session.** Known
  render-panel limitation; not something to block on.
- **The panel does not poll for progress** — Claude reports the mutate result in chat.
