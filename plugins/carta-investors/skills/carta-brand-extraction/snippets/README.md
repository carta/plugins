# Brand board snippets

Templates and generators Claude uses to produce brand board artifacts from website analysis data.

## Analysis script

### `../scripts/analyze_website.py`

Python script that fetches a website URL, parses HTML + linked CSS, and extracts brand identity elements. Returns a JSON report to stdout with:

- `colors` — hex values ranked by frequency, with luminance-based classification
- `typography` — font families, sizes, weights (from CSS + Google Fonts detection)
- `logos` — candidate URLs from favicon, og:image, header/nav images, SVG elements
- `imagery` — hero/banner images and CSS background images
- `css_custom_properties` — design tokens (CSS custom properties related to colors, fonts, brand)

```bash
uv run analyze_website.py https://example.com
```

## Output templates

### `brand_board_html.html`

Self-contained HTML template. Claude fills in `{{PLACEHOLDER}}` values from the analysis data and user-provided assets. Sections: header, color palette (grouped swatches), typography (specimens), logo (light + dark bg), imagery grid, design tokens.

Add class `dark-mode` to `<body>` for dark brand identities.

### `brand_board_react.jsx`

React component `<BrandBoard>`. Props:

```jsx
<BrandBoard
  firmName="Acme Capital"
  websiteUrl="https://acme.com"
  colors={{ primary: [{hex: "#1a1a1a"}], secondary: [...], accent: [...], neutral: [...] }}
  fonts={[{ family: "Inter", weights: ["400", "700"], sizes: ["14px", "24px"] }]}
  logos={[{ src: "data:image/png;base64,...", background: "light" }]}
  imagery={[{ src: "https://...", alt: "Hero image" }]}
  tokens={[{ name: "Border Radius", value: "8px" }]}
  darkMode={false}
/>
```

### `brand_board_pdf.py`

PDF generator using reportlab. Claude calls:

```python
generate_brand_board_pdf(data, output_path, firm_name="Acme")
```

Produces a landscape A4 PDF with swatches, type specimens, logo placement, and token summary.

### `brand_board_pptx.py`

PPTX generator using python-pptx. Claude calls:

```python
generate_brand_board_pptx(data, output_path, firm_name="Acme")
```

Produces a 6-slide 16:9 deck: title, colors, typography, logo, imagery, tokens.

## Data flow

1. User provides a website URL (and optionally extra assets / brand guidelines)
2. Claude runs `analyze_website.py <url>` to extract raw brand signals
3. Claude classifies the raw colors into primary/secondary/accent/neutral groups using the frequency + context data
4. Claude reads the appropriate snippet template and generates the artifact
5. If the user provided additional assets (logo files, style guides, color specs), Claude incorporates those, letting explicit user input override extracted values
