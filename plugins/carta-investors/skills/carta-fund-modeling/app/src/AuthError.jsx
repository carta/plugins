import React from "react";
import { cartaLogoSvg } from "./assets/carta-logo.js";

// Shown instead of the dashboard when there is no valid token — not the shell's
// crash overlay, whose "paste back to Claude" CTA is wrong for a session issue.
// The app never mounts here, so declare the display @font-face that theme.js
// would otherwise add.
const CSS = `
@font-face {
  font-family: "SangBleu Versailles";
  src: url("/fonts/SangBleuVersailles-Regular-WebS.woff2") format("woff2");
  font-weight: 400; font-style: normal; font-display: swap;
}
#fm-auth-screen .wm svg { display: block; width: 88px; height: auto; }`;

const SERIF = '"SangBleu Versailles", Georgia, serif';
const SANS = 'Inter, "Open Sans", "Helvetica Neue", Helvetica, Arial, sans-serif';

const styles = {
  screen: {
    position: "fixed", inset: 0, zIndex: 100000, overflow: "auto", boxSizing: "border-box",
    backgroundColor: "#1A1A1A", color: "#fff", fontFamily: SANS,
    backgroundImage: "radial-gradient(rgba(255,255,255,0.06) 1.4px, transparent 1.6px)",
    backgroundSize: "42px 42px",
  },
  wm: { position: "absolute", top: 32, left: "clamp(24px, 6vw, 96px)" },
  body: {
    position: "absolute", top: "50%", transform: "translateY(-50%)",
    left: "clamp(24px, 6vw, 96px)", maxWidth: 760, paddingRight: 24,
  },
  h1: {
    fontFamily: SERIF, fontWeight: 400, fontSize: "clamp(4rem, 12vw, 8rem)",
    lineHeight: 1, letterSpacing: "-0.02em", margin: "0 0 12px",
  },
  sub: {
    fontFamily: SERIF, fontWeight: 400, fontSize: "clamp(1.25rem, 3vw, 2rem)",
    lineHeight: 1.3, color: "rgba(255,255,255,0.9)", margin: "0 0 28px",
  },
  hint: { fontSize: 15, lineHeight: 1.6, color: "rgba(255,255,255,0.6)", margin: 0 },
  code: {
    fontFamily: 'ui-monospace, "SF Mono", Consolas, monospace', fontSize: "0.92em",
    background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: 5, padding: "2px 7px", whiteSpace: "nowrap",
  },
};

export default function AuthError() {
  return (
    <div id="fm-auth-screen" style={styles.screen}>
      <style>{CSS}</style>
      <div className="wm" style={styles.wm} role="img" aria-label="Carta"
           dangerouslySetInnerHTML={{ __html: cartaLogoSvg }} />
      <div style={styles.body}>
        <h1 style={styles.h1}>401</h1>
        <p style={styles.sub}>We couldn't open this dashboard.</p>
        <p style={styles.hint}>
          The secure link that opened this dashboard is no longer valid. To reopen it,
          invoke the <code style={styles.code}>carta-fund-modeling</code> skill in Claude again.
        </p>
      </div>
    </div>
  );
}
