# Slide design system — creative toolkit

You compose each slide as a `<section>` inside `<deck-stage>`. There are no fill-in-the-blank templates — you design each slide's layout using the primitives below, tailored to the data and the firm's brand.

## Deck shell

`deck-shell.html` wraps all slides. Fill once per deck:

| Placeholder | Example |
|---|---|
| `{{FIRM_NAME}}` | Acme Capital |
| `{{YEAR}}` | 2026 |
| `{{GOOGLE_FONTS_QUERY}}` | `Inter:wght@200;300;400;500;600;700` |
| `{{BRAND_SLUG}}` | acme-capital |
| `{{SLIDES}}` | All `<section>` blocks concatenated |

`deck-stage.js` is loaded by the shell. It sizes every child `<section>` to 1920×1080. Copy it to the working directory root alongside the assembled HTML.

---

## Slide anatomy

Every slide is a `<section>` with optional surface class and chrome:

```html
<section class="ds-dark"><!-- or no class (paper) or "ds-alt" -->
  <!-- chrome (logo, page number, Carta badge) — auto-injected by carta-mark.js -->
  <div class="ds-chrome-logo" data-variant="dark"></div>
  <div class="ds-chrome-page"><span>03</span><span class="ds-chrome-page__dot"></span><span>Performance</span></div>

  <div class="ds-pad ds-pad--header">
    <!-- slide content here -->
  </div>
</section>
```

### Surface variants

| Class | Background | Use for |
|---|---|---|
| *(none)* | `--brand-paper` (light) | Most content slides |
| `ds-alt` | `--brand-paper-alt` | Alternate light surface for visual break |
| `ds-dark` | `--brand-accent-1` (dark) | Cover, closing, section breaks — high-impact moments |

### Chrome elements

- `.ds-chrome-logo` — firm logo, top-left (add `data-variant="dark"` on `.ds-dark` slides)
- `.ds-chrome-page` — slide number + section name, bottom-left
- `.ds-chrome-foot` — "Powered by Carta" badge, bottom-right (auto-injected by `carta-mark.js`)

---

## Typography

| Class | Size | Use for |
|---|---|---|
| `.ds-display` | 88px | Cover/closing hero headlines |
| `.ds-h1` | 64px | Slide titles |
| `.ds-h2` | 40px | Card/sub-section titles |
| `.ds-lede` | 26px | Standfirst paragraphs |
| `.ds-body` | 19px | Running text |
| `.ds-body--sm` | 16px | Compact text, footnotes |
| `.ds-eyebrow` | 14px uppercase | Section label above title |
| `.ds-label` | 14px uppercase | Chart/metric labels |
| `.ds-label--sm` | 12px uppercase | Compact labels |
| `.ds-num` | 96px | Hero KPI numbers |
| `.ds-num--sm` | 56px | Mid-size KPI numbers |
| `.ds-num__unit` | 0.45em | Trailing unit (×, %, $M) — auto-colored via `--ds-accent` |

**Emphasis**: wrap text in `<em>` inside `.ds-display`, `.ds-h1`, `.ds-h2` — it renders in `--ds-em` color (brand accent-2) with no italic.

**Color modifiers**: `.ds-on-accent` (accent-1), `.ds-on-accent-2` (accent-2), `.ds-on-mute` (muted).

---

## Layout primitives

| Class / element | Purpose |
|---|---|
| `.ds-pad` | Full-bleed padded container (140px sides, 140px top) |
| `.ds-pad--header` | Extra top padding (180px) for page chrome |
| `.ds-rule` | 1px hairline divider |
| CSS grid | Use `display:grid` with `grid-template-columns` for multi-column layouts |

---

## Accent & color utilities

These classes make brand colors visible throughout the deck — use them liberally.

### Accent bars
```html
<div class="ds-accent-bar"></div>              <!-- 56px × 4px, accent-1 -->
<div class="ds-accent-bar ds-accent-bar--wide"></div>  <!-- full width -->
<div class="ds-accent-bar ds-accent-bar--2"></div>     <!-- accent-2 -->
<div class="ds-accent-bar ds-accent-bar--3"></div>     <!-- accent-3 -->
```

### Accent borders
```html
<div class="ds-accent-border">Content with accent-1 left border</div>
<div class="ds-accent-border ds-accent-border--2">accent-2</div>
<div class="ds-accent-border ds-accent-border--3">accent-3</div>
```

### Accent dots (for inline indicators)
```html
<span class="ds-accent-dot"></span>       <!-- accent-1 -->
<span class="ds-accent-dot--2"></span>    <!-- accent-2 -->
<span class="ds-accent-dot--3"></span>    <!-- accent-3 -->
```

### KPI highlight (color the number itself)
```html
<div class="ds-num ds-kpi-highlight">2.4<span class="ds-num__unit">×</span></div>
<div class="ds-num ds-kpi-highlight--2">$142<span class="ds-num__unit">M</span></div>
```

### Cards
```html
<div class="ds-card">Card with accent-1 top border + rounded bg</div>
<div class="ds-card ds-card--2">accent-2 top border</div>
<div class="ds-card ds-card--3">accent-3 top border</div>
<div class="ds-card ds-card--flat">no top border</div>
```

### Pills (tag badges)
```html
<span class="ds-pill">Software</span>
<span class="ds-pill ds-pill--2">Series B</span>
<span class="ds-pill ds-pill--3">Top Performer</span>
```

### Swatches (legend dots)
```html
<span class="ds-swatch" data-series="1"></span>  <!-- --ds-cat-1 -->
<span class="ds-swatch" data-series="2"></span>  <!-- --ds-cat-2 -->
```

---

## Charts

Three declarative primitives. Add the element and `charts.js` renders SVG on DOMContentLoaded.

### Line chart
```html
<div data-ds-chart="line" data-config='{
  "width": 920, "height": 300,
  "padding": {"top": 20, "right": 30, "bottom": 40, "left": 60},
  "gridLines": 4,
  "xLabels": ["2020","2021","2022","2023","2024","2025"],
  "yLabels": ["2.5×","2.0×","1.5×","1.0×"],
  "yDomain": [1.0, 2.5],
  "series": [
    {"values": [1.06,1.18,1.5,1.7,1.9,2.4], "area": true, "dots": true, "highlightLast": true, "endLabel": "2.4×"},
    {"values": [1.04,1.1,1.32,1.4,1.5,1.6], "dashed": true}
  ]
}'></div>
```
- Series auto-color to `--ds-chart-series-1..5`. Override with `"color": "var(--ds-accent-2)"`.
- First series: always `"area": true, "dots": true, "highlightLast": true, "endLabel"`.
- Benchmark/comparison series: `"dashed": true`.

### Donut chart
```html
<div data-ds-chart="donut" data-config='{
  "size": 480, "radius": 180, "thickness": 68, "gap": 0.5,
  "centerLabel": "Active companies",
  "centerNumber": "142",
  "segments": [
    {"label": "Software", "value": 62},
    {"label": "Sustainability", "value": 28},
    {"label": "Consumer", "value": 52}
  ]
}'></div>
```
- Segments auto-color to `--ds-cat-1..5`.
- Always include `"centerLabel"` and `"centerNumber"`.

### Horizontal bar chart
```html
<div data-ds-chart="hbar" data-config='{
  "max": 118,
  "rows": [
    {"label": "AI & infra", "value": 118, "valueLabel": "$118M", "series": 1},
    {"label": "Enterprise SaaS", "value": 66, "valueLabel": "$66M", "series": 1},
    {"label": "Sustainability", "value": 48, "valueLabel": "$48M", "series": 2}
  ]
}'></div>
```
- `series` (1–5) picks `--ds-cat-N` for the bar fill.
- Always include `"valueLabel"` on each row.

---

## Visual design principles

These are NOT optional. Every deck must follow them:

### 1. Use all three brand colors

Every deck must visibly feature `--brand-accent-1`, `--brand-accent-2`, and `--brand-accent-3`. A deck that looks monochrome is a failure. Distribute color through:
- `.ds-dark` slides (accent-1 background)
- Chart series colors (automatic via tokens)
- `.ds-card` top borders (rotate accent-1/2/3 across cards)
- `.ds-accent-bar` as section dividers and decorative elements
- `.ds-kpi-highlight` to color key numbers
- `.ds-pill` tags for categories
- `<em>` text in headlines

### 2. Alternate slide surfaces for rhythm

Don't use the same background for 5+ slides in a row. Interleave:
- Paper (default) for most content
- `.ds-alt` for visual breathing room (stats grids, card layouts)
- `.ds-dark` for high-impact moments (cover, section breaks, closing, key milestone slides)

### 3. Every quantitative slide gets a chart

Text-only tables and bullet-point lists of numbers are never acceptable when a chart would work. If a slide has quantitative data, it gets a line, donut, or hbar chart. Tables are acceptable only alongside a chart or for detail-heavy data that doesn't lend itself to visualization.

### 4. Design for the data

Don't force a layout. Let the data shape the slide:
- 2–4 KPIs → stats grid with big numbers
- Time series → line chart with KPI strip header
- Composition/breakdown → donut chart with legend
- Rankings/comparisons → hbar chart
- Many items → paginate across slides rather than cramming

### 5. White space is a feature

Resist the urge to fill every pixel. Generous padding, sparse layouts, and breathing room between elements signal professionalism. A slide with 3 big numbers and a chart looks better than one with 8 numbers, a chart, a table, and a footnote.

---

## Logo color treatment

Every logo must use the correct color variant for its slide surface:
- Light surfaces → dark logo (`--brand-logo-light`)
- `.ds-dark` surfaces → light/cream logo (`--brand-logo-dark`)

Use `<div class="ds-chrome-logo"></div>` on light slides and `<div class="ds-chrome-logo" data-variant="dark"></div>` on dark slides. The CSS picks the right logo automatically.

Never ship a single logo variant across both surfaces.
