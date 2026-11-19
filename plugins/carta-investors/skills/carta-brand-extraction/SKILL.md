---
name: carta-brand-extraction
version: 0.1.0
description: >
  Captures a firm's brand (colors, fonts, logo, imagery) from its website and/or a deck or PDF
  it already has, shows it as a brand board (HTML, PDF, PPTX or React), saves it to Carta, and
  hands it to whatever artifact the user is making: a deck, PDF, LP letter, dashboard, one-pager
  or email.
  Trigger phrases: "build a brand board", "extract our brand from our website", "get our brand
  colors and fonts", "brand from this deck", "brand audit", "save our firm's branding",
  "use our brand on this PDF / dashboard / one-pager / email".
  Do NOT use to build the AGM or other fund deck (use carta-agm-deck-builder), or to brand the
  LP Summary page or its PDF export ("brand my LP profiles", use carta-lp-summary); those skills
  call this one themselves.
allowed-tools:
  - Read
  - Write(./carta-brand-extraction/**)
  - Edit(./carta-brand-extraction/**)
  - Bash(uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-brand-extraction/scripts/analyze_website.py" *)
  - Bash(uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-brand-extraction/scripts/analyze_deck.py" *)
  - mcp__claude_ai_carta__welcome
  - mcp__claude_ai_carta__list_contexts
  - mcp__claude_ai_carta__set_context
  - mcp__claude_ai_carta__call_tool
  - mcp__claude_ai_carta__read_tool
  - mcp__claude_ai_carta__skill_checkpoint
  - mcp__carta__welcome
  - mcp__carta__list_contexts
  - mcp__carta__set_context
  - mcp__carta__call_tool
  - mcp__carta__read_tool
  - mcp__carta__skill_checkpoint
  - mcp__claude_ai_Carta__welcome
  - mcp__claude_ai_Carta__list_contexts
  - mcp__claude_ai_Carta__set_context
  - mcp__claude_ai_Carta__call_tool
  - mcp__claude_ai_Carta__read_tool
  - mcp__claude_ai_Carta__skill_checkpoint
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__welcome
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__list_contexts
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__set_context
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__call_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__read_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__skill_checkpoint
  - AskUserQuestion
  - ToolSearch
---

<!-- carta:plugin-version -->
<carta-plugin>carta-investors:7.55.1</carta-plugin>

> **If this plugin's files can't be found:** a path that still shows an unreplaced `${…}` variable, or a "not found" when you read or run one of this skill's files, means the skill loaded before this session's computer link was ready. Invoke this skill once more with the Skill tool and use the paths that copy gives. If they're still unreplaced, tell the user Carta's plugin files aren't available in this session yet (link your computer, then ask again) and stop. Don't search the disk for them.

# Firm Brand

## Overview

This skill captures a firm's **brand** from its website and/or a deck or PDF it already has, shows it as a **brand board**, saves it to Carta, and hands it to whatever artifact the user is making: a deck, PDF, LP letter, LP summary, dashboard, one-pager or email.

A brand board includes:
1. **Color palette** — primary, secondary, accent, and neutral colors with hex codes
2. **Typography** — font families, weights, and size scale with specimen text
3. **Logo** — extracted from the website, shown on light and dark backgrounds
4. **Imagery & mood** — hero images and photography style
5. **Design tokens** — border radius, shadows, spacing patterns, CSS custom properties

The skill works in two phases: **extraction** (automated analysis of the website or deck) and **composition** (building the brand board artifact with Claude's design judgment). A second mode, *Use the brand on another artifact*, skips the board and returns the saved brand as a short token block (see that section below).

The saved board's fields, and the brand tokens built from them, are described in `${CLAUDE_PLUGIN_ROOT}/references/brand-board-schema.md` (the plugin's own `references/`, not this skill's). Read it by that path when you build the token block; do not search for it.

## When to Use

Fire this skill when the user asks to:

- Build, create, or generate a brand board from a website URL
- Extract a company's visual identity / brand elements from their site
- Extract a firm's brand from a deck it drops in: a pitch deck or LP letter (PowerPoint (`.pptx`, `.ppsx`, `.potx`) or PDF)
- Analyze a firm's website for colors, fonts, and design patterns
- Create brand guidelines from a URL
- Produce a "look and feel" reference from a website
- Use the firm's brand on another artifact: "use our brand on this PDF", "match our branding", "brand this dashboard / one-pager / email"

Also fire when the user provides a URL and asks for "brand analysis", "visual identity audit", or "design system extraction".

### When NOT to fire

- Fund decks, the LP Summary page and its PDF belong to `carta-agm-deck-builder` and `carta-lp-summary`, which call this skill for the brand
- Full design system documentation — this skill produces a one-page reference, not a comprehensive system
- Logo design or creation — this skill extracts existing logos, it does not create new ones

## Prerequisites

The analysis script requires network access to fetch the website. Dependencies are declared inline (PEP 723) and resolved by `uv run` automatically:
- `requests`, `beautifulsoup4`, `cssutils`, `Pillow`
- For PDF output: `reportlab`
- For PPTX output: `python-pptx`

## Workflow

> **Checkpoint**: Call `mcp__<SERVER>__skill_checkpoint(skill_name="carta-investors:carta-brand-extraction", checkpoint_label="skill_started")` before proceeding. `<SERVER>` is the one Carta MCP server, of those `allowed-tools` grants `skill_checkpoint` on, that this session is connected to. If the tool is deferred, load it first with `ToolSearch(query: "select:mcp__<SERVER>__skill_checkpoint")`. If it is still unavailable, or any checkpoint call fails, carry on: checkpoints never stop a run. A run that has not recorded `skill_started` records no other checkpoint.

Each run records each checkpoint at most once, and exactly one of `skill_finished` or `skill_failed`. A step reached again later in the same run (a re-extraction from the website after reusing a saved board, a board recomposed with the user's own assets in Phase 6, a second output format) does not checkpoint again.

### Phase 0: Check for saved brand board in Carta (MANDATORY — runs before any website extraction)

Before touching the website, check whether Carta already has a saved brand board for this firm. A saved board means a previous session already extracted and approved the brand identity — reusing it is faster, more consistent, and avoids redundant scraping.

#### 0a. Ensure firm context is set

If a firm UUID was passed in from the orchestrating skill, call:

```
mcp__<SERVER>__set_context(firm_id="<firm_uuid>")
```

If no firm UUID was passed, call `mcp__<SERVER>__list_contexts()` to list available firms and pick the matching one. Do not skip this step — the brand board lookup depends on the active firm context.

If Carta MCP is not connected (tool not found or auth error), skip Phase 0 entirely and proceed to Phase 1. Record `brand_board_source = "none"`.

#### 0b. Fetch saved brand board

```
mcp__<SERVER>__read_tool({"name": "fa__get__brand_board"})
```

- **HTTP 200 / success**: A saved brand board exists. Use the `brand_board` field from the response as `brand_data`. Set `brand_board_source = "saved_mcp"`. Tell the user:

  > *"Found a saved brand board for this firm — reusing the previously extracted brand identity. Let me know if you'd like to re-extract from the website instead."*

  **Skip Phase 2 (website extraction) entirely.** Jump directly to Phase 3 (Classify and curate) using the saved data, or, in *Use the brand on another artifact* mode, straight to its token block.

- **404 / "Brand board not found"**: No saved board exists. Set `brand_board_source = "to_be_created"`. Proceed to Phase 1 (gather inputs) and Phase 2 (website extraction). The result will be saved in Phase 5.

- **Any other error**: Treat as "not found" and proceed to Phase 1. Do not block on errors.

---

### Phase 1: Gather inputs

Ask **at most one question**, and only for what is missing: a website URL or a deck.

1. Take the source from the user's message first: a URL or bare domain (`acme.com`; the script prepends `https://` automatically), an attached or named deck (a PowerPoint (`.pptx`, `.ppsx`, `.potx`) or PDF pitch deck or LP letter), a logo file, hex codes or font names they typed. Then from the saved Carta board (Phase 0) or firm context. If any of these gives a source, ask nothing.
2. Skip any question the saved board or the user's message already answers.
3. Only when there is no URL, no deck and no saved board, ask once for the website URL or a deck. A deck alone is a complete source: when the user gave one and no URL, don't ask for a URL.
4. Do not ask about extra assets or the output format. Default to an **HTML brand board** (Phase 4 says what else is accepted). Use whatever the user attached or typed in their first message in Phase 6; a later request for another format is handled in Phase 4.

### Phase 2: Extract brand signals

Every file this skill writes goes in the working folder, `./carta-brand-extraction/` (the current directory plus `carta-brand-extraction/`): the saved analysis report, deck logo candidates, and the PDF or PPTX board. Create the folder before anything writes to it (`analyze_deck.py` and both board generators do; for the saved report, create it with a first `Write` there).

Run the analysis script:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-brand-extraction/scripts/analyze_website.py" <url>
```

This returns a JSON report with raw extraction data. **Save the output** to `./carta-brand-extraction/analysis.json` — you will reference it throughout composition.

**From a deck.** When the user gave a PowerPoint (`.pptx`, `.ppsx`, `.potx`) or PDF deck, run the deck reader on it (alongside the website analysis when there is a URL too), saving logo candidates in the working folder:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-brand-extraction/scripts/analyze_deck.py" "<deck file path>" --out-dir "./carta-brand-extraction"
```

It prints `accent_candidates` (`#RRGGBB`, best first, neutrals already left out), `fonts` (`heading`, `body`) and `logo_candidates` (saved file paths, best first). A PowerPoint's colours and fonts come exactly from its theme (`"colors_exact": true`). A PDF's colours are the ones its first pages paint most (`"colors_exact": false`) and it has no fonts: tell the user the colours are a best guess from the PDF. An empty `accent_candidates` means the deck has no brand colour: ask the user for one. Exit 1 prints why the file couldn't be read (not a deck, password-protected); tell the user and ask for another file or the website.

If the script fails (e.g., the site blocks automated access, CAPTCHA, JS-heavy SPA with no server-rendered content):
- Try `WebFetch` on the URL as a fallback to get the HTML
- If the page requires JavaScript rendering, inform the user and ask them to provide a screenshot or manually list their brand colors/fonts
- Never silently skip extraction — always tell the user what happened

### Phase 3: Classify and curate

This is where Claude's design judgment matters. The raw extraction data has frequency-ranked colors and multiple font families. You must **classify** them:

#### Colors

Group the extracted colors into four categories:

- **Primary** — the 1-2 most prominent brand colors (often used in headers, CTAs, navigation). These define the brand. Look for colors that appear in the logo, primary buttons, or hero sections.
- **Secondary** — supporting colors used for backgrounds, section differentiation, or secondary UI elements. Usually 1-3 colors.
- **Accent** — highlight colors for CTAs, links, hover states, or emphasis. Often the most saturated/vibrant colors on the site.
- **Neutral** — grays, off-whites, and dark tones used for text, borders, and backgrounds. Include the primary text color and the page background.

**Classification heuristics:**
- Colors in CSS custom properties named `--primary`, `--brand`, `--accent` are strong signals
- Colors used in `<header>`, `<nav>`, or `.hero` contexts are likely primary
- Very light colors (luminance > 220) are likely background neutrals
- Very dark colors (luminance < 40) are likely text neutrals
- If the user provided explicit brand colors, those override extraction

#### Typography

- Identify the **heading font** (used in `h1`-`h3`, `.hero`, display text)
- Identify the **body font** (used in `p`, `body`, general content)
- Note any **accent fonts** (used sparingly for special elements)
- Google Fonts detected by the script are high-confidence signals
- Include weight and size ranges observed
- The script also extracts `@font-face` source URLs (`typography.font_faces`) for custom/self-hosted fonts. These are the actual font file URLs needed to load the fonts at render time — without them, the browser only has the family name and falls back to system fonts

#### Logos

- Prefer logos extracted from `<header>` or `<nav>` over favicon
- Prefer SVG over raster when available
- If the user provided a logo file, use that as the primary logo
- Show the logo on both light and dark backgrounds in the brand board

#### Imagery

- Select 3-6 hero/banner images that best represent the brand's visual style
- Skip icons, tiny decorative elements, and tracking pixels
- Note the overall mood: professional, playful, minimal, bold, etc.

#### Design Tokens

- Extract observed border-radius values, shadow styles, and spacing patterns from CSS custom properties
- These are supplementary — include them if present, skip if the site doesn't use CSS custom properties

### Phase 4: Compose the brand board

When another skill invoked this one for the brand, skip the board: hand the classified brand back to it and go straight to the checkpoint at the end of this phase, then Phase 5.

Read the appropriate snippet template by its full path (the files are in this skill's own `snippets/` folder; do not search for them):

| Format | Snippet to read |
|--------|----------------|
| HTML artifact | `${CLAUDE_PLUGIN_ROOT}/skills/carta-brand-extraction/snippets/brand_board_html.html` |
| React artifact | `${CLAUDE_PLUGIN_ROOT}/skills/carta-brand-extraction/snippets/brand_board_react.jsx` |
| PDF | `${CLAUDE_PLUGIN_ROOT}/skills/carta-brand-extraction/snippets/brand_board_pdf.py` |
| PPTX | `${CLAUDE_PLUGIN_ROOT}/skills/carta-brand-extraction/snippets/brand_board_pptx.py` |

**For HTML artifacts** (default):
1. Read `${CLAUDE_PLUGIN_ROOT}/skills/carta-brand-extraction/snippets/brand_board_html.html`
2. Replace all `{{PLACEHOLDER}}` values with the classified data
3. Duplicate the repeating elements (`.bb-swatch`, `.bb-type-specimen`, etc.) for each data item
4. If the brand identity is dark, add class `dark-mode` to `<body>`
5. For logos, use the extracted URL directly (or base64-encode if producing a self-contained artifact)
6. Output the complete HTML as a Claude artifact

**For React artifacts:**
1. Read `${CLAUDE_PLUGIN_ROOT}/skills/carta-brand-extraction/snippets/brand_board_react.jsx`
2. Construct the props object from classified data
3. Render `<BrandBoard>` with the populated props
4. For logos, use base64 data URIs for self-contained artifacts

**For PDF:**
1. Read `${CLAUDE_PLUGIN_ROOT}/skills/carta-brand-extraction/snippets/brand_board_pdf.py`
2. Construct the `data` dict with classified colors, fonts, logos, tokens
3. Call `generate_brand_board_pdf(data, "carta-brand-extraction/brand_board.pdf", firm_name="...")`
4. Give the user the full path: the current directory plus `carta-brand-extraction/brand_board.pdf`

**For PPTX:**
1. Read `${CLAUDE_PLUGIN_ROOT}/skills/carta-brand-extraction/snippets/brand_board_pptx.py`
2. Construct the `data` dict
3. Call `generate_brand_board_pptx(data, "carta-brand-extraction/brand_board.pptx", firm_name="...")`
4. Give the user the full path: the current directory plus `carta-brand-extraction/brand_board.pptx`

Close with *"Brand board ready."* and the next step: *"Next: use this brand on a deck, PDF, LP summary, dashboard or email, or tell me what to change."* The first time, add one line that a logo file, hex codes, a PDF, PPTX or React board are also accepted.

> **Checkpoint**: Call `mcp__<SERVER>__skill_checkpoint(skill_name="carta-investors:carta-brand-extraction", checkpoint_label="skill_finished")` once the brand has reached the user or the skill that invoked this one, as defined under Troubleshooting.

### Phase 5: Save brand board to Carta

Save when the brand was freshly extracted in this session: `brand_board_source = "to_be_created"` (Phase 0 returned a 404) creates the board, and `brand_board_source = "saved_mcp"` where the user asked to re-extract or changed the brand replaces it.

**First save (no saved board).** This is a Tier 1 write (informative friction only): do it **automatically** after the user has seen the brand (the board or the token block) or it was handed back to the skill that invoked this one, with no separate consent question, but say this one line first, before any write:

> *"Saving this brand to Carta so decks and reports reuse it."*

**Replacing a saved board.** The write overwrites the brand that every deck and report uses, so it needs a yes first. After the user has seen the brand, or it was handed back, ask one question with `AskUserQuestion`: *"Replace the saved brand with this new one?"*, options *"Replace the saved brand"* and *"Keep the saved brand"*. Write only on *"Replace the saved brand"*, and say no notice line before the answer.

- *"Keep the saved brand"*: write nothing. The new brand still goes to the artifact in this conversation.
- When another skill's sub-agent invoked this one (no user to ask, or `AskUserQuestion` unavailable because you are running as a sub-agent): do not write. Hand the new brand back without saving it, and say in one line that the saved brand was kept.
- Otherwise, when `AskUserQuestion` is not available, ask the same question in chat with the two options as a numbered list, and wait for the answer.

If the user already said "don't save" or "skip Carta" earlier, honor that and write nothing, not even the notice or the question.

Build the payload from the full brand identity JSON — colors, typography, logos, and source metadata. Keep the logos the persistence rule in `${CLAUDE_PLUGIN_ROOT}/references/brand-board-schema.md` keeps (the plugin's own `references/`, not this skill's). When it leaves out a deck's local logo path, tell the user in one line that the deck logo stays on this machine and the colours and fonts were saved.

Create (no saved board):

```
mcp__<SERVER>__call_tool({"name": "fa__create__brand_board", "arguments": {"brand_board": <brand_data_json>}})
```

Update (a saved board exists, the user re-extracted and answered *"Replace the saved brand"*). An update must never remove a logo the new extraction could not replace: when the new payload has no persistable logo, copy `logos` from the saved board (Phase 0's `brand_data`) into it before calling:

```
mcp__<SERVER>__call_tool({"name": "fa__mutate__brand_board", "arguments": {"brand_board": <brand_data_json>}})
```

On success, tell the user (one line only):
> *"Brand saved to Carta — any artifact you make later (a deck, PDF, LP summary, dashboard or email) can reuse it."*

If the call fails, do not retry: follow the `fa__create__brand_board` / `fa__mutate__brand_board` row under Troubleshooting and carry on.

Skip this step if:
- `brand_board_source` is `"saved_mcp"` and the user did not re-extract or change the brand (nothing new to save)
- `brand_board_source` is `"saved_mcp"`, the brand was re-extracted, and the user answered *"Keep the saved brand"* or a sub-agent ran it (the saved brand stays)
- Carta MCP was unavailable in Phase 0 (`brand_board_source = "none"`)
- The firm UUID / context was never set

---

### Phase 6: Incorporate user-provided assets

If the user provided additional assets in their message:

- **Logo files** — replace extracted logos with user-provided ones
- **A deck** — its colours, fonts and logo override the website's; the website fills gaps only
- **Color specs** — override extracted colors with user-specified hex codes; keep extracted colors as secondary/neutral fill if they complement the user's choices
- **Brand guidelines** — use as the authoritative source; extracted data fills gaps only
- **Reference boards** — match the layout/style/mood of the reference when composing

User-provided input always takes precedence over automated extraction.

## Use the brand on another artifact

When the user wants their brand on something they are making, and not a board ("use our brand on this PDF", "match our branding", "brand this dashboard / one-pager / email"):

1. Run Phase 0. A saved board is the source (`brand_board_source = "saved_mcp"`).
2. With no saved board (404, or Carta not connected), run Phases 1-3 first (one question at most, for a website or deck). Skip the Phase 4 board unless the user asks to see it.
3. Read `${CLAUDE_PLUGIN_ROOT}/references/brand-board-schema.md` and build the brand tokens by the schema's mapping. Leave out any token the board does not carry; never guess one.
4. Give the user the tokens in one short code block, and apply them to the artifact in this conversation: colours as the artifact's theme values or CSS variables, the two fonts (with their `@font-face` file URLs from `typography.font_faces` when the family is listed there), and the logo in the header. Say in one line which tokens you used.
5. Run Phase 5 now, after step 4, when the brand was freshly extracted.
6. Call `skill_finished` as defined under Troubleshooting.

## User-facing output

Keep responses concise. The brand board artifact is the deliverable — not the conversation.

- **Start**: one sentence — *"Analyzing acme.com to build your brand board."*
- **After extraction**: brief summary of what was found — *"Found 12 colors, 2 font families (Inter, Playfair Display), 3 logo candidates, and 5 hero images."*
- **After composition**: *"Brand board ready."* + the artifact + the next step from Phase 4
- **Do NOT** dump the raw JSON analysis, list every extracted color, or narrate each classification decision
- **Do NOT** explain the template structure or which snippet was used

If the extraction is thin (few colors, no clear fonts, no logos), say so and ask the user if they can provide additional brand assets to fill the gaps.

## Verification checklist

Before delivering the brand board:

- [ ] Color palette has at least primary + one other group populated
- [ ] Colors are shown as actual swatches (not just hex codes in text)
- [ ] Typography section shows real specimen text in the detected fonts (or names the fonts clearly if embedding isn't possible)
- [ ] Logo is displayed (or noted as "not found" with a suggestion to provide one)
- [ ] Imagery section has at least 2-3 images (or is omitted if none were found)
- [ ] The board looks visually cohesive — uses the extracted brand colors in its own styling where appropriate
- [ ] User-provided assets override extracted values where they conflict
- [ ] The firm name and URL appear in the header
- [ ] Output format matches what the user requested (or defaults to HTML)

## Troubleshooting

> **Checkpoint on every stop before this run has recorded `skill_finished`**, once this run has recorded `skill_started`: call `mcp__<SERVER>__skill_checkpoint(skill_name="carta-investors:carta-brand-extraction", checkpoint_label="skill_failed", notes="<one-line reason>")` instead of `skill_finished`. That includes a run where neither the website nor a deck nor the user's own input gave enough to compose a board, a board generator that fails, and plugin files still unavailable after the second invocation. `skill_finished` means the brand reached the user (the board or the token block) or the skill that invoked this one; a stop before that is a failure, and counting it as finished makes failed runs look like fast successful ones. Cases that recover and continue (a skipped Phase 0 when Carta is not connected, an error from the saved-board lookup treated as not found, a `WebFetch` fall-back, a screenshot or manual colours and fonts from the user, another deck after `analyze_deck.py` exits 1, a failed save to Carta, a saved brand kept instead of replaced) do not checkpoint. Paths before `skill_started` record nothing: a request this skill should not fire on (see "When NOT to fire").

| Symptom | Cause | Tell the user |
|---------|-------|---------------|
| Script returns empty colors | The site uses CSS-in-JS or a framework that inlines styles at runtime | "I couldn't read colors from the page itself." Try `WebFetch` for the rendered HTML, else ask for a screenshot |
| No fonts detected | The site uses system fonts only, or loads fonts with JavaScript | "No custom fonts found." Check for `@font-face` in the raw CSS or Google Fonts links, else ask for the font names |
| Logo not found | Inline SVG or a CSS background image holds the logo | "I couldn't find your logo." Check the SVG results; if nothing works, ask for the logo file |
| Site blocks requests (403/429) | The site blocks automated requests | "The site blocked my request." Ask for a screenshot of the homepage, or the key colors and fonts pasted in |
| JS-heavy SPA returns little | The script reads server-rendered HTML only | "The page builds itself in the browser, so I got little from it." Ask for a screenshot or manual input |
| `analyze_deck.py` exits 1 | Not a deck, or password-protected | "I couldn't read that file." Ask for another deck or the website |
| The user asks to delete or remove the saved brand | This skill has no delete command; saving a new brand replaces the saved one only after a yes | "I can't delete a saved brand from here. Carta support can remove it. I can replace it with a new brand if you want." |
| `fa__create__brand_board` or `fa__mutate__brand_board` fails | Carta rejected or could not take the write | "Could not save to Carta; your brand is still here for this conversation. Try again later." Do not retry |

## Related skills (bundled in this plugin)

| Skill | Relationship |
|-------|--------------|
| `carta-agm-deck-builder` | Calls this skill for the firm's brand before it builds a deck |
| `carta-lp-summary` | Calls this skill for the firm's brand before it brands the LP Summary page and its PDF |

Other artifact skills can read the saved brand board directly (`${CLAUDE_PLUGIN_ROOT}/references/brand-board-schema.md` lists its fields) instead of re-extracting.
