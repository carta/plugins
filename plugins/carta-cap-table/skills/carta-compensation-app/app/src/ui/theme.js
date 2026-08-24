// Design tokens for the CTC dashboard — real Carta Ink brand tokens.
//
// Token source: the pinned Ink snapshot in src/ui/tokens.css, linked by
// webapp/index.html. Every value below is a `var(--ink-*)` reference rather than a
// copied hex literal — so an upstream token change lands here by replacing that one
// file, and light/dark both resolve for free (each Ink token is declared with CSS's
// light-dark(), and tokens.css sets color-scheme on :root).
//
// A previous version of this file claimed to "mirror Carta's Ink tokens" while
// actually hardcoding invented hex (#00449E accent, #00857D teal, #8A5B00 warn).
// Plausible-looking, but none of it traced to a real token.
//
// THE COLOR-ROLE RULE, which is the one most often gotten backwards:
//   * interactivePrimary — brand BLACK. Active nav, selected rows, checked toggles,
//     primary buttons. This is "active/primary", and it is not blue. Use it for a brand
//     mark or a FILLED surface; for text or a rule drawn on the page, use
//     interactivePrimaryOnPage, which adapts (see the note at that key).
//   * linkDefault — Ink link/focus BLUE. Links, focus rings, info accents, editable
//     values. Never used to mean "active".
// The old palette collapsed both onto a single blue `accent`, which is exactly the
// conflation this retrofit exists to split apart.
//
// Kept as a JS object rather than a stylesheet because this app styles inline and has
// no CSS build step in the runtime path — the values are var() strings, so the browser
// still resolves them from tokens.css.

// Ink's real font chains, copied verbatim from @carta/ink's own body/h1 rules.
// Deliberately NOT the `-apple-system, BlinkMacSystemFont, "Segoe UI"` system stack
// this file used to carry: that pattern looks like standard practice borrowed from
// other design systems, but it is not what Ink does.
//
// Inter is self-hosted from /fonts/ (see webapp/index.html) rather than pulled from
// the rsms.me CDN the scaffold template uses. That is deliberate and predates this
// retrofit: sw.js passes cross-origin requests straight through, so a CDN font would
// never be cached — on an airgapped machine the page would stall on it before falling
// back to system sans. Keep the self-hosted loader; only ever name a face here that
// has one.
export const SANS = 'Inter, "Open Sans", "Helvetica Neue", Helvetica, Arial, sans-serif';

// H1/display only. SangBleu is not vendored for this app, so Georgia — a real,
// always-available system serif — carries it. Georgia ships only 400/700 as a system
// font, so never request an intermediate weight on this stack.
export const SERIF = '"SangBleu Versailles", Georgia, serif';

export const MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace';

// Canonical Ink semantics. `C` keeps its object shape so existing views re-skin
// without edits; the legacy key names are preserved as aliases below.
export const C = {
  // Surfaces
  surfaceDefault: "var(--ink-color-global-surface-background-default)",
  surfaceUnderlay: "var(--ink-color-global-surface-background-underlay)",

  // Text
  textDefault: "var(--ink-color-global-text-default)",
  textSubtle: "var(--ink-color-global-text-subtle)",
  // Quiet-but-readable label text (uppercase eyebrows, axis labels). An explicit
  // EXTENSION with no exact Ink token: Ink's real text-disabled resolves to gray-50,
  // which is too light to read as a label, so this deliberately reaches for gray-60.
  textQuiet: "var(--ink-color-global-brand-gray-60)",

  // Borders — two weights, and mixing them up is a visible error.
  //   borderSubtle  hairlines between table rows and inside panels
  //   borderDefault an interactive element's own edge (inputs, secondary buttons) and
  //                 the table header's under-rule. Medium gray, clearly darker than a
  //                 hairline but nowhere near the near-black text color.
  borderSubtle: "var(--ink-color-global-border-subtle)",
  borderDefault: "var(--ink-color-global-border-default)",
  borderHover: "var(--ink-color-global-border-hover)",

  // Interactive roles — see the color-role rule in the header comment.
  //
  // interactivePrimary is brand black and DOES NOT ADAPT: --ink-color-global-brand-black
  // is a flat #1A1A1A, not a light-dark() pair like the text tokens. That is right for a
  // brand mark on a known-light surface, and wrong for anything that has to stay legible
  // on a surface that flips — in dark mode it renders #1A1A1A on an #121212 background,
  // i.e. invisible. The selected tab's label and underline both used it and both
  // disappeared in dark mode.
  //
  // So the role is split in two:
  //   interactivePrimary        the brand mark / a filled surface's own colour. Unchanged.
  //   interactivePrimaryOnPage  the same ROLE as foreground text or a rule drawn directly
  //                             on the page. Adapts, because the page does.
  //
  // interactivePrimaryOnPage tracks text-default deliberately rather than being a second
  // hand-mixed pair: "selected" here is conveyed by full-contrast text plus weight and an
  // underline, and full-contrast text is exactly what text-default means on either
  // surface. A bespoke pair would be one more thing to keep in step with Ink.
  interactivePrimary: "var(--ink-color-global-brand-black)",
  interactivePrimaryOnPage: "var(--ink-color-global-text-default)",
  linkDefault: "var(--ink-color-global-link-default)",
  focusRing: "var(--ink-color-global-border-focus-light)",

  // Feedback
  feedbackPositive: "var(--ink-color-global-feedback-positive-strong)",
  feedbackNegative: "var(--ink-color-global-feedback-negative-strong)",
  // Ink calls this tone `feedback-notice` — there is no "warning" Tag variant, despite
  // the .ink-tag--warning class name in components.md.
  feedbackNotice: "var(--ink-color-global-brand-yellow-80)",
  feedbackNoticeSubtle: "var(--ink-color-global-brand-yellow-20)",

  // Tints the table/tag recipes call for.
  rowHover: "var(--ink-color-global-brand-gray-30)",
  selectedRow: "var(--ink-color-global-brand-blue-20)",
  totalRow: "var(--ink-color-global-brand-blue-10)",
  infoSubtle: "var(--ink-color-global-brand-blue-10)",
  positiveSubtle: "var(--ink-color-global-feedback-positive-subtle)",
};

// ---- Legacy aliases -------------------------------------------------------------
// Views were written against these names. Aliasing rather than renaming every call
// site keeps this retrofit visual-only — a mechanical rename would churn the two PRs
// currently in review for reasons unrelated to their content. The mapping is where the
// real decisions are:
C.bg = C.surfaceDefault;
C.surface = C.surfaceDefault;
C.surfaceAlt = C.surfaceUnderlay;
C.border = C.borderSubtle;          // was #E3E6E9 — a hairline, so border-subtle
C.borderStrong = C.borderDefault;   // was #C8CDD3 — an edge weight, so border-default
C.text = C.textDefault;
C.textFaint = C.textQuiet;
// `accent` was one blue doing double duty as both "active" and "link". Every current
// call site is a link/focus/info accent (nav underline, focus outline, selected tab),
// so it maps to linkDefault. The follow-up this note asked for has since happened: the
// selected tab moved to the brand-black role via interactivePrimaryOnPage. A filled
// active/selected SURFACE would take interactivePrimary itself, which currently has no
// call site.
C.accent = C.linkDefault;
C.accentSoft = C.infoSubtle;
C.teal = C.feedbackPositive;        // was #00857D — the positive/at-market tone
C.warn = C.feedbackNotice;          // was #8A5B00 — Ink's notice tone, not a brown
C.warnSoft = C.feedbackNoticeSubtle;

// Type scale. Numbers, because the app styles inline; each step is annotated with the
// Ink typography token it corresponds to so drift is visible in review.
//
// `md` corrected 13 -> 14: Ink's real table/body size is 14px, and 13 was below every
// step in Ink's scale. This is the one change here with a visible density cost, and it
// is the correct value.
export const FS = {
  xs: 11,   // caption / eyebrow — below Ink's smallest step, kept for grid density
  sm: 12,   // --ink-font-body-small
  md: 14,   // --ink-font-body-default — Ink's real table/body size
  lg: 16,   // --ink-font-body-large
  xl: 20,   // --ink-font-heading-2-desktop (weight 500, sans — never serif)
  xxl: 28,  // --ink-font-heading-1-desktop (weight 400, serif/prominent)
};

// Ink's radius split: flat (0) for structural surfaces, subtle (4px) for interactive
// controls. This app previously used a single 6px, which is not an Ink step; 4px is the
// honest mapping for what RADIUS is actually used on here (chips, buttons, cards).
export const RADIUS = 4;

/** Injected once at mount: resets and the few rules inline styles can't express. */
export const GLOBAL_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    background: ${C.surfaceDefault};
    color: ${C.textDefault};
    font-family: ${SANS};
  }
  table { border-collapse: collapse; }
  th, td { text-align: left; }
  button { font-family: inherit; cursor: pointer; }
  select { font-family: inherit; }

  /* Ink's real focus recipe is two-part: recolor the element's own border to
     link-default AND add a 4px pale-blue ring. A single flat 2px outline in an
     arbitrary blue (what this file had) only approximates it. */
  :focus-visible {
    outline: none;
    border-color: ${C.linkDefault};
    box-shadow: 0 0 0 4px ${C.focusRing};
  }

  /* Suppress the UA's own focus ring on MOUSE focus.
     The rule above only matches :focus-visible, which a click does not trigger — so a
     clicked control kept the browser's default near-black outline. Where that outline
     lands on near-black text (the active tab label) the text vanishes into its own
     focus ring.

     Engines disagree on :focus-visible, so this is a baseline, not the whole fix: the
     tab buttons additionally set outline:none inline and draw their own ring from an
     observed keydown. Keyboard focus elsewhere still gets the Ink ring above.

     NOTE: this whole string is a template literal — never use a backtick in these
     comments. A backticked CSS property here silently terminates GLOBAL_CSS and the
     app dies at parse time with a misleading error pointing at another file. */
  :focus:not(:focus-visible) {
    outline: none;
    box-shadow: none;
  }
  ::selection { background: ${C.selectedRow}; }
`;
