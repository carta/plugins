---
name: carta-brand-extraction
version: 0.1.0
description: >
  Generates a brand board from a firm's website URL and optional user-provided assets.
  Analyzes the website to extract theme colors, typography, logos, and imagery, then
  produces a polished brand board as an HTML artifact, PDF, slide deck, or React component.
  Trigger phrases: "build a brand board", "create a brand board", "generate a brand board",
  "extract brand identity", "brand board from website", "visual identity from URL",
  "brand guidelines from site", "analyze brand from website", "brand audit".
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash(uv run *)
  - Bash(python3 *)
  - WebFetch
  - mcp__claude_ai_carta__welcome
  - mcp__claude_ai_carta__list_contexts
  - mcp__claude_ai_carta__set_context
  - mcp__claude_ai_carta__call_tool
---

<!-- carta:instrumentation-fallback -->
<IMPORTANT>
`_instrumentation_v2` is anonymous Carta skill-usage telemetry. ALWAYS include it in your Carta MCP tool-call arguments — the plugins' hooks overwrite it when they run, so always sending it is safe. Shape:
`_instrumentation_v2: {"skills": ["<plugin>:<skill>", ...], "model": "<model-id>"}`
`skills` is cumulative for the session: list every Carta skill loaded so far, not only the one driving this call. Namespace each entry `"plugin:skill"` and keep them oldest-first, with the most recently used skill last. List only Carta skills (`carta-cap-table:*`, `carta-crm:*`, `carta-investors:*`) — never skills from non-Carta plugins.
</IMPORTANT>

# Build Brand Board

## Overview

This skill generates a **brand board** — a single-page visual reference sheet capturing a company's visual identity — from their website URL and any additional assets the user provides.

A brand board includes:
1. **Color palette** — primary, secondary, accent, and neutral colors with hex codes
2. **Typography** — font families, weights, and size scale with specimen text
3. **Logo** — extracted from the website, shown on light and dark backgrounds
4. **Imagery & mood** — hero images and photography style
5. **Design tokens** — border radius, shadows, spacing patterns, CSS custom properties

The skill works in two phases: **extraction** (automated analysis of the website) and **composition** (building the brand board artifact with Claude's design judgment).

## When to Use

Fire this skill when the user asks to:

- Build, create, or generate a brand board from a website URL
- Extract a company's visual identity / brand elements from their site
- Analyze a firm's website for colors, fonts, and design patterns
- Create brand guidelines from a URL
- Produce a "look and feel" reference from a website

Also fire when the user provides a URL and asks for "brand analysis", "visual identity audit", or "design system extraction".

### When NOT to fire

- Carta-internal branding requests — use `carta-brand` or `carta-theme` instead
- Full design system documentation — this skill produces a one-page reference, not a comprehensive system
- Logo design or creation — this skill extracts existing logos, it does not create new ones

## Prerequisites

The analysis script requires network access to fetch the website. Dependencies are declared inline (PEP 723) and resolved by `uv run` automatically:
- `requests`, `beautifulsoup4`, `cssutils`, `Pillow`
- For PDF output: `reportlab`
- For PPTX output: `python-pptx`

## Workflow

### Phase 0: Check for saved brand board in Carta (MANDATORY — runs before any website extraction)

Before touching the website, check whether Carta already has a saved brand board for this firm. A saved board means a previous session already extracted and approved the brand identity — reusing it is faster, more consistent, and avoids redundant scraping.

#### 0a. Ensure firm context is set

If a firm UUID was passed in from the orchestrating skill (e.g., `carta-agm-deck-builder`), call:

```
mcp__claude_ai_carta__set_context(firm_id="<firm_uuid>")
```

If no firm UUID was passed, call `mcp__claude_ai_carta__list_contexts()` to list available firms and pick the matching one. Do not skip this step — the brand board lookup depends on the active firm context.

If Carta MCP is not connected (tool not found or auth error), skip Phase 0 entirely and proceed to Phase 1. Record `brand_board_source = "none"`.

#### 0b. Fetch saved brand board

```
mcp__claude_ai_carta__call_tool({"name": "fa__get__brand_board"})
```

- **HTTP 200 / success**: A saved brand board exists. Use the `brand_board` field from the response as `brand_data`. Set `brand_board_source = "saved_mcp"`. Tell the user:

  > *"Found a saved brand board for this firm — reusing the previously extracted brand identity. Let me know if you'd like to re-extract from the website instead."*

  **Skip Phase 2 (website extraction) entirely.** Jump directly to Phase 3 (Classify and curate) using the saved data.

- **404 / "Brand board not found"**: No saved board exists. Set `brand_board_source = "to_be_created"`. Proceed to Phase 1 (gather inputs) and Phase 2 (website extraction). The result will be saved in Phase 5.

- **Any other error**: Treat as "not found" and proceed to Phase 1. Do not block on errors.

---

### Phase 1: Gather inputs

1. **Ask for the website URL** if not already provided. Accept bare domains (`acme.com`) — the script prepends `https://` automatically.

2. **Ask about additional assets** (optional). The user may provide:
   - Logo files (PNG, SVG) they want used instead of / in addition to extracted logos
   - Brand color specifications (hex codes, color names)
   - Existing brand guidelines or style guides
   - Reference brand boards from other companies they admire
   - Font names or specimen images

   If the user says "no" or provides nothing extra, proceed with website-only extraction.

3. **Ask about the output format** (optional). Default to **HTML artifact**. Other options:
   - PDF (landscape A4)
   - PPTX (16:9 slide deck)
   - React artifact

   If the user doesn't specify, produce an HTML artifact.

### Phase 2: Extract brand signals

Run the analysis script:

```bash
uv run ${CLAUDE_PLUGIN_ROOT}/skills/carta-brand-extraction/scripts/analyze_website.py <url>
```

This returns a JSON report with raw extraction data. **Save the output** — you will reference it throughout composition.

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

Read the appropriate snippet template:

| Format | Snippet to read |
|--------|----------------|
| HTML artifact | `snippets/brand_board_html.html` |
| React artifact | `snippets/brand_board_react.jsx` |
| PDF | `snippets/brand_board_pdf.py` |
| PPTX | `snippets/brand_board_pptx.py` |

**For HTML artifacts** (default):
1. Read `snippets/brand_board_html.html`
2. Replace all `{{PLACEHOLDER}}` values with the classified data
3. Duplicate the repeating elements (`.bb-swatch`, `.bb-type-specimen`, etc.) for each data item
4. If the brand identity is dark, add class `dark-mode` to `<body>`
5. For logos, use the extracted URL directly (or base64-encode if producing a self-contained artifact)
6. Output the complete HTML as a Claude artifact

**For React artifacts:**
1. Read `snippets/brand_board_react.jsx`
2. Construct the props object from classified data
3. Render `<BrandBoard>` with the populated props
4. For logos, use base64 data URIs for self-contained artifacts

**For PDF:**
1. Read `snippets/brand_board_pdf.py`
2. Construct the `data` dict with classified colors, fonts, logos, tokens
3. Call `generate_brand_board_pdf(data, "brand_board.pdf", firm_name="...")`

**For PPTX:**
1. Read `snippets/brand_board_pptx.py`
2. Construct the `data` dict
3. Call `generate_brand_board_pptx(data, "brand_board.pptx", firm_name="...")`

### Phase 5: Save brand board to Carta (MANDATORY if newly extracted)

If brand data was freshly extracted in this session (i.e., `brand_board_source = "to_be_created"` — Phase 0 returned a 404), save it to Carta **automatically** after the user has seen the brand board output and not objected to the colors.

You do **not** need a separate explicit consent question for this write. The user's approval of the brand board in Phase 4 (or the absence of any correction) is sufficient consent. If the user explicitly said "don't save" or "skip Carta", honor that.

Call:

```
mcp__claude_ai_carta__call_tool({"name": "fa__create__brand_board", "arguments": {"brand_board": <brand_data_json>}})
```

The `brand_board` parameter is the full brand identity JSON object — colors, typography, logo candidates, and source metadata.

On success, tell the user (one line only):
> *"Brand board saved to Carta — future runs will reuse it automatically."*

Skip this step if:
- `brand_board_source` is `"saved_mcp"` (came from Carta, no need to re-save)
- Carta MCP was unavailable in Phase 0 (`brand_board_source = "none"`)
- The firm UUID / context was never set

---

### Phase 6: Incorporate user-provided assets

If the user provided additional assets in Phase 1:

- **Logo files** — replace extracted logos with user-provided ones
- **Color specs** — override extracted colors with user-specified hex codes; keep extracted colors as secondary/neutral fill if they complement the user's choices
- **Brand guidelines** — use as the authoritative source; extracted data fills gaps only
- **Reference boards** — match the layout/style/mood of the reference when composing

User-provided input always takes precedence over automated extraction.

## User-facing output

Keep responses concise. The brand board artifact is the deliverable — not the conversation.

- **Start**: one sentence — *"Analyzing acme.com to build your brand board."*
- **After extraction**: brief summary of what was found — *"Found 12 colors, 2 font families (Inter, Playfair Display), 3 logo candidates, and 5 hero images."*
- **After composition**: *"Brand board ready."* + the artifact
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

- **Script returns empty colors**: The site may use CSS-in-JS or a framework that inlines styles at runtime. Try `WebFetch` to get the rendered HTML, or ask the user for a screenshot.
- **No fonts detected**: The site may use system fonts only, or load fonts via JavaScript. Check for `@font-face` in the raw CSS or Google Fonts links.
- **Logo not found**: Many sites use inline SVGs or CSS background images for logos. Check the SVG extraction results. If nothing works, ask the user to provide their logo file.
- **Site blocks requests (403/429)**: Some sites block automated requests. Ask the user to provide a screenshot of their homepage, or paste the key colors/fonts manually.
- **JS-heavy SPA**: The script fetches server-rendered HTML only. SPAs that render entirely client-side will return minimal data. Ask for a screenshot or manual input.

## Related skills (bundled in this plugin)

- `powered-by` — embeds the "Powered by Carta" lockup on artifacts. Complementary — `carta-brand-extraction` produces the board, `powered-by` adds the Carta badge if the data came from Carta.
- `carta-agm-deck-builder` — the main orchestrator skill that chains brand extraction + deck generation + Carta badge.
