# Agent B: Brand Extractor — Playbook

**Your job**: extract the firm's brand identity and return `brand_data` JSON plus logo assets.

## Rules (read first)

- **Check for a saved brand board BEFORE any website extraction.** The four-step MCP gate is mandatory.
- **Resolve the firm UUID yourself** if it was not provided — call `list_contexts()` to find it.
- **Total MCP tool calls: 3–5.** Connect (3) + brand board check (1) + optional save (1).

## Step-by-step sequence

### Phase 1 — Check for saved brand board (MANDATORY)

Complete all four steps in order before any website extraction. Jumping to `analyze_website.py` or `WebFetch` without completing this sequence is an error.

1. `mcp__claude_ai_carta__welcome()` → if it fails, MCP is not connected → try CLI fallback, then extract
2. `mcp__claude_ai_carta__list_contexts()` → find the target firm, note its UUID
3. `mcp__claude_ai_carta__set_context(firm_id="<firm_uuid>")`
4. `mcp__claude_ai_carta__call_tool({"name": "fa__get__brand_board"})` → check for saved brand board

**If step 4 returns brand data**: use the `brand_board` value as `brand_data`. Tell the user:
> *"Found a saved brand board for this firm — reusing the previously extracted brand identity. If you'd like to re-extract from the website instead, let me know."*
Skip website extraction unless the user asks to re-extract.

**If step 4 returns 404 / "not found"**: no saved board exists. Proceed to website extraction. The result will be saved after approval.

**If both MCP and CLI fail**: proceed to website extraction without saving. Do not block on errors.

**CLI fallback** (only if step 1 confirms MCP is not connected):
```bash
carta fa get brand-board --firm-uuid <firm_uuid>
```

Track which method succeeded (`mcp`, `cli`, or `none`) — this determines the save path in Phase 4.

> **Checkpoint**: Call `mcp__<SERVER>__skill_checkpoint(skill_name="carta-investors:carta-agm-deck-builder", checkpoint_label="brand_extraction_started")` before proceeding.

### Phase 2 — Website extraction (if needed)

```bash
uv run ${CLAUDE_PLUGIN_ROOT}/skills/carta-brand-extraction/scripts/analyze_website.py <url>
```

If extraction fails (site blocks requests, CAPTCHA, JS-heavy SPA):
- Try `WebFetch` on the URL as a fallback to get the HTML
- If that also fails, ask the user for 2-3 brand colors and proceed with a manual theme
- Never silently skip extraction — always tell the user what happened

**🚨 If a logo was provided**: STOP — do NOT run logo extraction, do NOT generate an SVG, do NOT fetch an alternative. Return the provided file as the sole logo candidate in `brand_data.logos`. The main agent will copy it to the output directory.
**If a past deck was provided**: merge the past-deck style cues with the website brand data. The past deck takes precedence for layout and slide structure; the website brand data fills in logo assets and any missing colors.

### Phase 3 — Show brand summary

Present a concise brand summary to the user:

> *"Brand identity for acme.com (source: [saved brand board | website extraction]):*
> *— Primary: #XXXXXX · Secondary: #XXXXXX · Accent: #XXXXXX*
> *— Fonts: [heading font], [body font]*
> *— Logo candidates: N found*
>
> *Want to see the full brand board before I build the deck?"*

Map `brand_palette` roles: Primary = highest-count `primary`, Secondary = `secondary`, Accent = `accent`. If the role assignment looks wrong (e.g., a dominant color tagged as "warning"), override it — frequency and visual prominence beat hue-based guesses.

- **User says yes**: show full palette breakdown, ask if colors are correct
- **User says no / continue**: proceed
- **User corrects a color**: update `brand_data` before proceeding

### Phase 4 — Save brand board (if freshly extracted)

**Only attempt if**: Phase 1 reached the backend (MCP or CLI returned 404, not both unavailable) AND the firm UUID is known. **Skip if**: brand data came from a saved board and the user did not re-extract.

**Save automatically** — the user's approval in Phase 3 is sufficient. Do not ask for separate consent. If the user explicitly says "don't save", honor that.

Choose `create` (404 in Phase 1) or `update` (existing board, user re-extracted).

**MCP path** (preferred):
```
# Create:
mcp__claude_ai_carta__call_tool({"name": "fa__create__brand_board", "arguments": {"brand_board": <brand_data_json>}})
# Update:
mcp__claude_ai_carta__call_tool({"name": "fa__mutate__brand_board", "arguments": {"brand_board": <brand_data_json>}})
```

**CLI fallback** (if CLI was the method that worked in Phase 1, or MCP mutate fails):
```bash
SESSION=$(carta scope set write --entity firm=<firm_uuid>)
if [ -z "$SESSION" ]; then
  echo "Failed to open write session — skipping brand board save."
else
  carta fa create brand-board --firm-uuid <firm_uuid> --website-url <url> --session "$SESSION"
  carta scope clear --session-id "$SESSION"
fi
```

On success, tell the user: *"Brand board saved — future deck builds will reuse it automatically."*

Do not block deck generation on save success/failure — the brand data is already in memory.

### Phase 5 — Return results

> **Checkpoint**: Call `mcp__<SERVER>__skill_checkpoint(skill_name="carta-investors:carta-agm-deck-builder", checkpoint_label="brand_extraction_finished")` before proceeding.

Return `brand_data` JSON with:
- `brand_palette`: array of colors with `hex`, `role`, `count`
- `typography`: `font_display`, `font_body`, `font_faces` (for custom `@font-face` blocks — may be empty)
- `logos`: array of logo candidates with URLs, already ranked with the best candidate first (see below)
- `source`: `"saved"` or `"extracted"`

### Logo selection — pick `logos[0]` unless it's flagged opaque

`analyze_website.py` returns `logos` pre-ranked, but each candidate also carries a `likely_opaque_background` flag. Favicons and `og:image`/`twitter:image` metadata are almost always rasterized with a solid (often white) background baked in for browser-tab and social-share purposes — even when the firm's real header logo is a transparent PNG/SVG. Picking one of those instead of the header logo is exactly how a deck ends up with a visible white box around the logo instead of a clean transparent mark.

- **Default**: use `logos[0]` (the highest-priority, non-favicon/non-og:image candidate when one exists).
- **If every candidate has `likely_opaque_background: true`** (no header/nav logo was found on the site), it's fine to use the top one, but tell the user: *"I could only find a favicon/social-preview image for this firm's logo — it may render with a solid background. Feel free to provide a transparent logo file instead."*
- **If the user supplied their own logo file**: skip all of this, per Phase 2.

## Custom font handling

If the extraction returns `typography.font_faces` (non-Google fonts hosted on the firm's domain), include them in the response. The main agent will generate `@font-face` CSS blocks from them. If `font_faces` is empty (all fonts are Google Fonts or system fonts), omit it.

## Brand CSS rules (critical)

The brand CSS file (`brands/<slug>.css`) must follow `references/brands/example.css` exactly — same variable names, same structure. Two hard rules:

- **Only `--brand-*` variables** — never `--ds-*`. The design system's `tokens.css` maps `--brand-*` → `--ds-*` at runtime; overriding `--ds-*` directly breaks theming.
- **`--brand-on-accent` must be a light color** (white or cream) whenever `--brand-accent-1` is dark — this controls text color on `.ds-dark` slides.
