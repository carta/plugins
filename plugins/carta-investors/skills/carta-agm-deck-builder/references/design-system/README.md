# Deck design system

A small, theme-driven design system for slide decks. **Edit one file to retheme everything.**

## Files

```
design-system/
├── tokens.css   ← edit this to retheme: colors, fonts, weights
├── system.css   ← typography + slide chrome + layout primitives
├── charts.js    ← line / donut / horizontal-bar charts (declarative)
└── README.md    ← this file
```

## Loading

```html
<link rel="stylesheet" href="design-system/tokens.css">
<link rel="stylesheet" href="design-system/system.css">
<script defer src="design-system/charts.js"></script>
```

Charts auto-render on `DOMContentLoaded`. Re-render after token swaps with `DSCharts.refreshAll()`.

---

## How theming works

Two layers in `tokens.css`:

**1. Brand layer** — the only place raw colors live:
```css
--brand-paper, --brand-ink, --brand-ink-mute, --brand-rule,
--brand-accent-1, --brand-accent-2, --brand-accent-3,
--brand-on-accent, --brand-on-accent-em
--brand-font-display, --brand-font-body
```

**2. Intent layer** (`--ds-*`) — what the system actually consumes (`--ds-bg`, `--ds-ink`, `--ds-accent`, `--ds-em`, `--ds-chart-series-1`, etc.). All slide CSS and all charts read only from these.

Slide variants `.ds-dark` and `.ds-alt` re-map intents — so applying `class="ds-dark"` to a `<section>` flips the entire palette without per-element overrides. Charts inside a `.ds-dark` slide automatically re-pick their colors at render time.

### Reskin in three lines

Replace these in `tokens.css` and reload:
```css
--brand-accent-1: #1B3A5C;     /* navy */
--brand-accent-2: #C97356;     /* coral */
--brand-font-body: "Source Sans 3", sans-serif;
```
Every slide, every chart, every label, every chart axis updates.

---

## Typography classes

| Class            | Use for                        |
|------------------|--------------------------------|
| `.ds-display`    | Cover / closing hero (88px)    |
| `.ds-h1`         | Slide titles (64px)            |
| `.ds-h2`         | Card / sub-section titles      |
| `.ds-lede`       | Standfirst paragraph           |
| `.ds-body`       | Running text                   |
| `.ds-body--sm`   | Smaller running text (16px)    |
| `.ds-eyebrow`    | Section label above title      |
| `.ds-label`      | Caption / metric label         |
| `.ds-num`        | Big number (96px)              |
| `.ds-num--sm`    | Mid number (56px)              |
| `.ds-num__unit`  | Trailing unit (×, %, M) — auto-colored via `--ds-accent` |

Color modifiers: `.ds-on-accent`, `.ds-on-accent-2`, `.ds-on-mute`.
Use `<em>` inside `.ds-display` / `.ds-h1` / `.ds-h2` for highlighted phrases — color comes from `--ds-em` automatically.

## Layout primitives

- `.ds-pad` — full-bleed padded slide container
- `.ds-pad--header` — adds top space for the page-number chrome
- `.ds-rule` — 1px hairline
- `.ds-chrome-logo`, `.ds-chrome-page`, `.ds-chrome-foot` — slide chrome anchors

## Slide variants

Apply on the `<section>`:
- `class="ds-dark"` — accent-1 background, on-accent ink (cover, closing)
- `class="ds-alt"` — alternate light surface
- *(no class)* — paper background

---

## Logo color treatment (rule, not preference)

Every logo on a slide — the brand mark, partner marks, the Carta mark — **must** receive the correct color treatment for the surface it sits on, in **both the live render and every export path**.

**Never** ship a single rasterised logo that gets reused across light and dark slides.

How this template enforces it:

- **Brand logo.** `brands/<name>.css` declares two URLs:
  ```css
  --brand-logo-light: url("../assets/brand-logo.png");        /* dark mark, used on light slides */
  --brand-logo-dark:  url("../assets/brand-logo-cream.png");  /* light mark, used on dark slides */
  ```
  Use `<div class="ds-chrome-logo"></div>` and the system picks the right URL automatically based on the slide's surface class. On a `.ds-dark` slide, mark the chrome with `data-variant="dark"` to force the inverted asset.
- **Carta mark.** Drawn as inline SVG with `fill="currentColor"`. It inherits `--ds-ink`, which the surface variant remaps. Never bake a hard color into the SVG.
- **Export.** `build/build.js` honours both: it loads the brand logo source file matching the slide variant (no screenshotting), and rasterises the Carta SVG with the slide's resolved ink color baked in onto a transparent canvas. The result: light slides export with dark logos and dark slides export with cream logos, with no background bleed.

Adding a new logo (e.g. a partner mark) to a deck:

1. Drop **two** asset files in `assets/` — one for light surfaces, one for dark.
2. Either declare both as CSS variables in the brand or per-slide via `--logo-light` / `--logo-dark` custom properties, and a small CSS rule that picks based on surface.
3. If the export emits this logo, make sure it routes through the same source-file-by-variant path the brand logo uses — no full-element screenshots.

---

## Charts

Three primitives. Render declaratively:

```html
<div data-ds-chart="line"  data-config='{ ... }'></div>
<div data-ds-chart="donut" data-config='{ ... }'></div>
<div data-ds-chart="hbar"  data-config='{ ... }'></div>
```

### Line — `data-ds-chart="line"`

```jsonc
{
  "width": 920, "height": 300,
  "padding": { "top": 20, "right": 30, "bottom": 40, "left": 60 },
  "gridLines": 4,
  "xLabels": ["2020","2021","2022","2023","2024","2025"],
  "yLabels": ["2.5×","2.0×","1.5×","1.0×"],
  "yDomain": [1.0, 2.5],
  "series": [
    { "values": [1.06, 1.18, 1.5, 1.7, 1.9, 2.4],
      "area": true, "dots": true, "highlightLast": true, "endLabel": "2.4×" },
    { "values": [1.04, 1.1,  1.32, 1.4, 1.5, 1.6], "dashed": true }
  ]
}
```
Series default to `--ds-chart-series-1..5` in order. Override per-series with `"color": "var(--ds-accent-2)"`.

### Donut — `data-ds-chart="donut"`

```jsonc
{
  "size": 480, "radius": 180, "thickness": 68, "gap": 0.5,
  "centerLabel": "Active companies",
  "centerNumber": "142",
  "segments": [
    { "label": "Software",       "value": 62 },
    { "label": "Sustainability", "value": 28 },
    { "label": "Consumer",       "value": 52 }
  ]
}
```
Segments default to `--ds-cat-1..5`. Percentages computed from values.

### Horizontal bar — `data-ds-chart="hbar"`

```jsonc
{
  "max": 118,
  "rows": [
    { "label": "AI & infra",  "value": 118, "valueLabel": "$118M", "series": 1 },
    { "label": "Sustainability","value": 48, "valueLabel": "$48M",  "series": 2 }
  ]
}
```
`series` (1–5) picks `--ds-cat-N` for the bar fill.

### API

```js
DSCharts.renderAll();          // re-render every chart
DSCharts.render(rootElement);  // re-render charts inside a subtree
DSCharts.refreshAll();         // alias of renderAll() — call after token swaps
DSCharts.renderOne(el);        // re-render a single chart node
```

---

## Adding a new slide variant

1. Add a class to the `<section>` (e.g. `.ds-mono`).
2. In `tokens.css`, add a block that re-points intent tokens:
   ```css
   .ds-mono {
     --ds-bg: #111;
     --ds-ink: #fff;
     --ds-accent: #fff;
     /* … */
   }
   ```
3. Charts and text inside that section pick up the new tokens automatically.

## Adding a new chart kind

In `charts.js`, write a `renderFoo(host)` that reads `tok(host, '--ds-…')` for any color and add it to the `KIND` map. Same declarative pattern: `<div data-ds-chart="foo" data-config='…'>`.
