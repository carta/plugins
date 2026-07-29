/*
 * Brand Board React Artifact
 *
 * Self-contained React component for rendering a brand board as a Claude artifact.
 * Claude populates the props from analyze_website.py output and any user-provided assets.
 *
 * Props:
 *   firmName       — company/firm name
 *   websiteUrl     — the analyzed URL
 *   colors         — { primary: [{hex, label}], secondary: [...], accent: [...], neutral: [...] }
 *   fonts          — [{ family, weights, sizes, sampleText? }]
 *   logos          — [{ src, background: "light"|"dark" }]
 *   imagery        — [{ src, alt }]
 *   tokens         — [{ name, value }]
 *   darkMode       — boolean, inverts the board background
 */

const STYLES = {
  board: (dark) => ({
    fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
    background: dark ? "#1a1a1a" : "#f8f8f8",
    color: dark ? "#f0f0f0" : "#1a1a1a",
    padding: 40,
    maxWidth: 1200,
    margin: "0 auto",
  }),
  header: {
    textAlign: "center",
    marginBottom: 48,
    paddingBottom: 32,
    borderBottom: "1px solid #e0e0e0",
  },
  h1: { fontSize: 36, fontWeight: 700, letterSpacing: -0.5, marginBottom: 8 },
  subtitle: { fontSize: 14, color: "#888", fontWeight: 400 },
  url: { fontSize: 13, color: "#aaa", marginTop: 4 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: 1.5,
    color: "#999",
    marginBottom: 20,
  },
  section: { marginBottom: 48 },
  colorGroup: { flex: 1, minWidth: 180 },
  colorGroupLabel: { fontSize: 12, fontWeight: 500, color: "#666", marginBottom: 8 },
  swatchBox: (hex) => ({
    width: 72,
    height: 72,
    borderRadius: 8,
    background: hex,
    border: "1px solid rgba(0,0,0,0.08)",
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
  }),
  swatchLabel: {
    fontSize: 11,
    fontFamily: '"Roboto Mono", monospace',
    color: "#777",
    marginTop: 6,
  },
  card: (dark) => ({
    padding: 24,
    background: dark ? "#222" : "#fff",
    border: `1px solid ${dark ? "#333" : "#e8e8e8"}`,
    borderRadius: 8,
  }),
  logoCard: (darkBg) => ({
    padding: 24,
    background: darkBg ? "#1a1a1a" : "#fff",
    border: `1px solid ${darkBg ? "#333" : "#e8e8e8"}`,
    borderRadius: 8,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 200,
    minHeight: 120,
  }),
  logoImg: { maxWidth: 240, maxHeight: 100, objectFit: "contain" },
  imageryCard: {
    borderRadius: 8,
    overflow: "hidden",
    border: "1px solid #e8e8e8",
    aspectRatio: "16 / 10",
  },
  imageryImg: { width: "100%", height: "100%", objectFit: "cover" },
  tokenName: {
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: "#999",
    marginBottom: 8,
  },
  tokenValue: {
    fontSize: 14,
    fontFamily: '"Roboto Mono", monospace',
    color: "#555",
  },
  footer: {
    marginTop: 48,
    paddingTop: 24,
    borderTop: "1px solid #e0e0e0",
    textAlign: "center",
    fontSize: 11,
    color: "#bbb",
  },
};

function ColorSwatch({ hex }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <div style={STYLES.swatchBox(hex)} />
      <span style={STYLES.swatchLabel}>{hex}</span>
    </div>
  );
}

function ColorGroup({ label, colors }) {
  if (!colors || colors.length === 0) return null;
  return (
    <div style={STYLES.colorGroup}>
      <div style={STYLES.colorGroupLabel}>{label}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {colors.map((c, i) => (
          <ColorSwatch key={i} hex={c.hex} />
        ))}
      </div>
    </div>
  );
}

function TypeSpecimen({ font, darkMode }) {
  const ff = `"${font.family}", sans-serif`;
  return (
    <div style={STYLES.card(darkMode)}>
      <div style={STYLES.sectionTitle}>{font.family}</div>
      <div style={{ fontFamily: ff, fontSize: 32, fontWeight: 700, marginBottom: 8 }}>
        {font.sampleText || "The quick brown fox jumps over the lazy dog"}
      </div>
      <div style={{ fontFamily: ff, fontSize: 16, lineHeight: 1.6, color: darkMode ? "#aaa" : "#555", marginBottom: 6 }}>
        ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789
      </div>
      <div style={{ fontFamily: ff, fontSize: 12, color: "#999" }}>
        {"!@#$%^&*()_+-=[]{}|;:'\",.<>?/"}
      </div>
      <div style={{ marginTop: 12, fontSize: 11, color: "#aaa", fontFamily: '"Roboto Mono", monospace' }}>
        Weights: {font.weights?.join(", ") || "400"} · Sizes: {font.sizes?.join(", ") || "14px, 16px"}
      </div>
    </div>
  );
}

export function BrandBoard({
  firmName = "Company",
  websiteUrl = "",
  colors = {},
  fonts = [],
  logos = [],
  imagery = [],
  tokens = [],
  darkMode = false,
}) {
  return (
    <div style={STYLES.board(darkMode)}>
      {/* Header */}
      <div style={STYLES.header}>
        <h1 style={STYLES.h1}>{firmName}</h1>
        <div style={STYLES.subtitle}>Brand Board</div>
        {websiteUrl && <div style={STYLES.url}>{websiteUrl}</div>}
      </div>

      {/* Color Palette */}
      <div style={STYLES.section}>
        <div style={STYLES.sectionTitle}>Color Palette</div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <ColorGroup label="Primary" colors={colors.primary} />
          <ColorGroup label="Secondary" colors={colors.secondary} />
          <ColorGroup label="Accent" colors={colors.accent} />
          <ColorGroup label="Neutral" colors={colors.neutral} />
        </div>
      </div>

      {/* Typography */}
      {fonts.length > 0 && (
        <div style={STYLES.section}>
          <div style={STYLES.sectionTitle}>Typography</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {fonts.map((f, i) => (
              <TypeSpecimen key={i} font={f} darkMode={darkMode} />
            ))}
          </div>
        </div>
      )}

      {/* Logo */}
      {logos.length > 0 && (
        <div style={STYLES.section}>
          <div style={STYLES.sectionTitle}>Logo</div>
          <div style={{ display: "flex", gap: 32, alignItems: "center", flexWrap: "wrap" }}>
            {logos.map((logo, i) => (
              <div key={i} style={STYLES.logoCard(logo.background === "dark")}>
                <img src={logo.src} alt={`${firmName} logo`} style={STYLES.logoImg} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Imagery & Mood */}
      {imagery.length > 0 && (
        <div style={STYLES.section}>
          <div style={STYLES.sectionTitle}>Imagery &amp; Mood</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16 }}>
            {imagery.map((img, i) => (
              <div key={i} style={STYLES.imageryCard}>
                <img src={img.src} alt={img.alt || ""} style={STYLES.imageryImg} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Design Tokens */}
      {tokens.length > 0 && (
        <div style={STYLES.section}>
          <div style={STYLES.sectionTitle}>Design Tokens</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
            {tokens.map((t, i) => (
              <div key={i} style={STYLES.card(darkMode)}>
                <div style={STYLES.tokenName}>{t.name}</div>
                <div style={STYLES.tokenValue}>{t.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={STYLES.footer}>
        Generated from {websiteUrl} · Brand Board
      </div>
    </div>
  );
}
