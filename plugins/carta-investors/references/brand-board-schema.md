# Brand board schema

The saved brand board is the JSON `carta-brand-extraction` stores in Carta (`fa__get__brand_board`, `fa__create__brand_board`, `fa__mutate__brand_board`). A skill that makes a deck, PDF, LP letter, dashboard, one-pager or email may read the saved board and build the **brand tokens** below from it instead of extracting again.

A board has one of three shapes, by where it came from. Read the field you need from whichever shape is present, and leave a token out when its field is missing. Never invent a value.

## Website shape (`analyze_website.py`)

| Field | Contents |
|-------|----------|
| `url` | The page analyzed |
| `title`, `description` | Page title and meta description |
| `brand_palette` | Object keyed by role: `background`, `text`, `border`, `neutral`, `link`, `primary`, `secondary`, `accent`, `danger`, `warning`, `success`, `info`, `muted`; a role with no color is absent. Each role holds a list of `{hex, count, score}`, best first |
| `colors` | Up to 20 colors, best first: `hex`, `count`, `score`, `classification`, `role`, and when known `used_as`, `element_contexts` |
| `typography.families` | `[{name, count}]`, most used first |
| `typography.sizes`, `typography.weights` | `[{value, count}]` |
| `typography.google_fonts` | Family names loaded from Google Fonts |
| `typography.font_faces` | `[{family, weight, style, sources: [{url, format}]}]` for custom fonts: the file URLs needed to load them |
| `typography.type_scale` | Per-selector entries with `selector`, `size`, `weight`, `family` where found |
| `logos` | Candidates, best first: `{url, source, likely_opaque_background}` or, for an inline logo, `{svg, source, likely_opaque_background}` |
| `imagery` | `[{url, alt, context}]` hero and large images |
| `css_custom_properties` | Brand-related CSS variables, `{"--name": "value"}` |

## Deck shape (`analyze_deck.py`)

| Field | Contents |
|-------|----------|
| `source` | `pptx` or `pdf` |
| `colors_exact` | `true` for a PowerPoint theme, `false` for a PDF (a best guess) |
| `accent_candidates` | `[{hex, label}]`, best first, neutrals left out. May be empty |
| `fonts` | `{heading, body}`. Both are `null` for a PDF |
| `logo_candidates` | `[{path, width, height, from}]`, best first. `path` is a local file, so it does not persist in Carta |

## Deck-builder shape

`carta-agm-deck-builder` hands back a trimmed board: `brand_palette` as a list of `{hex, role, count}`, `typography` with `font_display`, `font_body` and `font_faces`, `logos` (ranked, best first) and `source` (`saved` or `extracted`). When `brand_palette` is a list, take the first entry with the wanted `role`.

## Brand tokens

The block a consumer works from. Every token is optional; omit the ones the board does not carry.

```
brand_tokens:
  primary: "#RRGGBB"
  secondary: "#RRGGBB"
  accent: "#RRGGBB"
  neutral: "#RRGGBB"
  background: "#RRGGBB"
  text: "#RRGGBB"
  heading_font: "<family>"
  body_font: "<family>"
  logo: "<data: URI or https URL>"
```

| Token | Website shape | Deck shape | Deck-builder shape |
|-------|---------------|------------|--------------------|
| `primary`, `secondary`, `accent` | `brand_palette.<role>[0].hex` | `accent_candidates[0]`, `[1]`, `[2]` `.hex` | first `brand_palette` entry with that `role` |
| `neutral`, `background`, `text` | `brand_palette.<role>[0].hex` | not extracted | first entry with that `role` |
| `heading_font` | the heading family chosen from `typography.families` | `fonts.heading` | `typography.font_display` |
| `body_font` | the body family chosen from `typography.families` | `fonts.body` | `typography.font_body` |
| `logo` | `logos[0].url`, else a data: URI built from its `svg` | `logo_candidates[0].path` (local file) | `logos[0]` URL |

Custom fonts need their file URLs to render: read them from `typography.font_faces[].sources[].url` when the family is listed there.

## Logos that persist

When saving a board, keep every logo that persists on its own (an https URL, a `data:` URI or an inline `svg`) and leave out only a deck's local file paths (`logo_candidates[].path`). A consumer that renders in a browser or a Cowork artifact uses a `data:` URI, an https URL or the inline `svg`; a local `path` only works for a file made on the same machine.
