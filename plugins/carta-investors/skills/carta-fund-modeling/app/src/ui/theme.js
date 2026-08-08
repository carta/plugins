// Design system — Swiss minimal, themed with real Carta (Ink) brand tokens, and
// conformed to the canonical micro-app theme contract.
// A stark WHITE canvas (Ink brand-black text), FLAT hairline surfaces (elevation only
// on hover), grid-driven. Numbers render in the system grotesk with tabular-nums.
// Export NAMES match the pattern every micro-app uses so views re-skin automatically.
//
// Token source: the pinned Ink token snapshot in src/ui/tokens.css (imported in
// main.jsx). The full Ink CSS custom properties are available on :root; this file's
// GLOBAL_CSS adds only local vars with no canonical Ink equivalent.
//
// Two roles look similar but stay split:
//   - ACCENT ("primary/active interactive") -> Ink primary-button bg. Active nav, selected
//     rows/slices, checked toggles, primary buttons are BLACK in light, WHITE in dark.
//   - BLUE ("links / focus / info accents") -> Ink link/focus blue (#285DA3), never
//     used for "active" state.
// Fonts: now aligned with this app's updated micro-app typography contract (a prior
// version of this file deliberately avoided ever loading a webfont here — see git history
// if you need the old rationale). Inter is loaded from the rsms.me CDN via index.html's
// <link> — never name a face in the font stack without a matching loader (if that <link>
// is ever removed, drop Inter from SANS too). SangBleu Versailles is self-hosted: the
// woff2 ships at public/fonts/ and is @font-face'd below, so it loads from a local file
// with zero network dependency. Offline-safe for Inter specifically: if the CDN request
// fails (no network), the browser just falls through to the next name in the stack — no
// error, no broken page, just a different-looking fallback font until connectivity returns.
//
// INK, PAPER, LINE, BORDER_DEFAULT, GREEN, RED, BLUE, FAINT, SHADE, ACCENT — internal only.
// Components inline these as var(--ink-...) strings directly; these consts exist only for
// the GLOBAL_CSS template literal below.
const INK            = "var(--ink-color-global-text-default)";
const PAPER          = "var(--ink-color-global-surface-background-default)";
const LINE           = "var(--ink-color-global-border-subtle)";
const BORDER_DEFAULT = "var(--ink-color-global-border-default)";
const GREEN          = "var(--ink-color-global-feedback-positive-strong)";
const RED            = "var(--ink-color-global-feedback-negative-strong)";
// Ink's real "feedback-notice" Tag semantic (variant="feedback-notice",
// "Requires Action" label) — the canonical Ink token is
// `--local-color-warning-solid: var(--ink-color-global-brand-yellow-80)`.
// Used for stale marks and "needs attention" pills — was a bespoke brass
// ochre (#A8741A) before; now the real Ink brand-yellow step.
export const NOTICE      = "var(--ink-color-global-brand-yellow-80)";
export const NOTICE_TINT = "var(--ink-color-global-brand-yellow-20)"; // subtle tint pairing, same pattern as every other Badge tone's bg
const BLUE           = "var(--ink-color-global-link-default)";
const FAINT          = "var(--ink-color-global-text-subtle)";
const SHADE          = "var(--ink-color-global-surface-lightgray-default)";
export const SIDEBAR_PANEL_BG = "var(--sidebar-panel-bg)"; // Companies-tab Performance sidebar (special exception — no Ink match)
const ACCENT         = "var(--ink-button-background-color-primary-base-default)";
export const MICRO          = "var(--micro-text)"; // local override — Ink text-very-subtle dark (#394040) is near-invisible
export const SHADOW         = "var(--shadow)"; // alias → ink-elevation-global-shadow-flat
export const SHADOW_HOVER   = "var(--shadow-hover)"; // alias → ink-elevation-global-shadow-medium
export const EASE           = "cubic-bezier(.2,.6,.2,1)";
export const EASE_OUT       = "cubic-bezier(.2,.7,.2,1)";

// primary-button surface — flat brand-black (inverts to white on dark)
export const GRAD_DARK = "var(--ink-button-background-color-primary-base-default)";

// .tape range-input thumb size (px) — single source of truth for the CSS below and
// any consumer computing a track-relative position accounting for thumb width.
export const TAPE_THUMB = 14;

// Inter is now loaded as a real webfont from the rsms.me CDN (see the <link> in
// index.html) — this mirrors Ink's REAL, actually-shipped stack, not a generic "system
// font stack" pattern (confirmed in real fund-admin: `@carta/ink/dist/ink.css`'s `body`
// rule is literally `font-family: "Inter var", "Open Sans", "Helvetica Neue", helvetica,
// arial, sans-serif`). This app doesn't load Ink's synthetic `"Inter Fallback"` face, so
// that name is dropped; `Inter` stays first (now backed by the CDN link, not just an
// opportunistic locally-installed match), then Ink's own real fallback chain verbatim.
export const SANS = "Inter, \"Open Sans\", \"Helvetica Neue\", Helvetica, Arial, sans-serif";
export const sans = { fontFamily: SANS };
// Real serif — Ink's real `--ink-font-global-family-prominent` chain verbatim:
// `SangBleu Versailles` first, now self-hosted (the woff2 ships at public/fonts/ and is
// @font-face'd in GLOBAL_CSS below, so it loads from a local file with zero network
// dependency), then `Georgia` (Ink's own designated fallback, a real system-installed
// serif), then the generic `serif` catch-all. Used by `H1` ONLY (components.jsx) — Ink
// reserves the real serif for the page title; `H2`/`H3` are sans (see
// `HEADING2_STYLE`/`H3` there).
export const serif = { fontFamily: "\"SangBleu Versailles\", Georgia, serif" };
// SANS with tight tracking — this app's own bolder display treatment for brand
// wordmarks and hero numbers (StatTile's `serif` prop, the top-bar/landing-page
// "Carta Fund Modeling" logotype, big colored reprice values). NOT a real serif
// despite some call sites' historical `serif`-named prop — kept as a distinct,
// honestly-named export so it's never confused with the real `serif` above.
export const tightSans = { fontFamily: SANS, letterSpacing: "-0.02em" };
// NOT a monospace typeface — same SANS/Inter family as `sans`, just with
// tabular-nums figures for column/value alignment. Named after Ink's real
// `.ink-num` recipe (theme-with-ink/tokens.css), which this mirrors — never
// switch to an actual monospace font for numeric alignment.
export const inkNum = { fontFamily: SANS, fontVariantNumeric: "tabular-nums", letterSpacing: "0" };

// ── Type scale — the single source of truth for font sizes across the app.
// Replaces the ~24 ad-hoc fontSize literals (many half-pixel: 9/9.5/10.5/11.5…)
// that had accreted inline. Every view/ui component references these steps so
// sizes stay consistent and the ramp is easy to retune in one place.
//
// Aligned to the canonical Ink type tokens (the pinned snapshot in tokens.css,
// `--ink-font-global-size-*`) per the micro-app theme contract:
//   bodyLg 13 = Ink `monospace`   value 14 = Ink `body-1`
//   h3     16 = Ink `heading-3/4` h2    20 = Ink `heading-2-desktop`
//   display 28 = Ink `display-1`  (body 12 = Ink `small-1`)
// TWO DELIBERATE sub-Ink divergences (Ink's floor is 12px; it has no 9–11px sizes):
// `micro` (10) and `small` (11) stay below the floor for this app's dense
// dashboard chrome — uppercase eyebrows, delta increments, the right-hand
// Performance sidebar — where a 12px floor would loosen the layout materially.
// Same "documented intentional divergence" precedent as the system-font stack
// (no webfont) and the 13px `.ledger.sheet` override below.
//   micro   labels/eyebrows, footnotes, delta increments        (sub-Ink)
//   small   chips, small labels, stale flags                    (sub-Ink)
//   body    table cells, secondary body, toggles                (Ink small-1)
//   bodyLg  primary body, buttons, inputs, method notes, tabs   (Ink monospace)
//   value   primary numeric values, table primary cells         (Ink body-1)
//   h3      sub-headings, sidebar headline value                (Ink heading-3/4)
//   h2      page titles                                         (Ink heading-2)
//   display hero numbers (Revenue/ARR, expanded reprice value)  (Ink display-1)
export const FS = {
  micro: 10,
  small: 11,
  body: 12,
  bodyLg: 13,
  value: 14,
  h3: 16,
  h2: 20,
  display: 28,
};

// Single source of truth for eyebrow (uppercase small-caps label) letter-spacing.
// Was three ad-hoc values (0.09/0.05/0.04em) across ~7 call sites, none of which
// landed inside Ink's documented eyebrow spec (theme-with-ink/brand.md: 0.06-0.08em).
export const EYEBROW_TRACKING = "0.07em";

// Ink's real Small 1 / Small 2 — both 12px/20px leading (theme-with-ink/tokens.css
// `--ink-font-global-{size,leading}-small-{1,2}`); the only difference is weight
// (small-1: 500, small-2: 400). `FS.body` already holds this pixel value (the
// FS-scale comment above documents it as "= Ink small-1") but with no fixed
// weight of its own — these give it a properly-weighted, nameable style object
// instead of leaving weight to each call site.
export const SMALL_1 = { ...sans, fontSize: FS.body, lineHeight: "20px", fontWeight: 500 };
export const SMALL_2 = { ...sans, fontSize: FS.body, lineHeight: "20px", fontWeight: 400 };

export const GLOBAL_CSS = `
  /* Self-hosted — the woff2 lives at public/fonts/ (copied verbatim into dist/fonts/ by
     Vite's public-dir passthrough, unhashed), so this loads from a local file with no
     network dependency, unlike Inter above. Georgia (serif's second link) covers the
     rare case this fails to load. */
  @font-face {
    font-family: "SangBleu Versailles";
    src: url("/fonts/SangBleuVersailles-Regular-WebS.woff2") format("woff2");
    font-weight: 400; font-style: normal; font-display: swap;
  }
  :root {
    color-scheme: light;

    /* === Local vars: no canonical Ink token === */
    --sidebar-panel-bg: light-dark(#F8F8F8, #242424);
    /* Ink text-very-subtle dark (#394040) is ~2:1 contrast — near-invisible on dark surfaces.
       Override to a legible mid-gray while preserving the light value. */
    --micro-text:       light-dark(#9C9F9F, #9CA1A1);

    /* === Composite/overlay vars expressed with Ink brand values === */
    --accent-soft:     light-dark(rgba(26,26,26,.06), rgba(255,255,255,.10));
    --track:           light-dark(var(--ink-color-global-brand-gray-40), var(--ink-color-global-brand-gray-90));
    --row-hover:       var(--ink-color-global-surface-lightgray-hover);
    --focus-ring:      light-dark(0 0 0 2px rgba(40,93,163,.45), 0 0 0 2px rgba(139,171,214,.5));
    --tag-gray-fg:     var(--ink-color-global-text-default);
    --tag-gray-bg:     var(--ink-color-global-surface-lightgray-default);
    --tag-yellow-fg:   light-dark(var(--ink-color-global-brand-yellow-80), var(--ink-color-global-brand-yellow-20));
    --tag-yellow-bg:   light-dark(var(--ink-color-global-brand-yellow-20), var(--ink-color-global-brand-yellow-100));
    --stripe-repriced: light-dark(var(--ink-color-global-brand-yellow-50), var(--ink-color-global-brand-yellow-70));
    --row-selected:    light-dark(rgba(40,93,163,.07), rgba(139,171,214,.12));
    --total-row-bg:    var(--ink-color-global-feedback-info-subtle);
    --hue-up:          light-dark(var(--ink-color-global-brand-green-70), rgba(91,192,179,.85));
    --hue-down:        light-dark(var(--ink-color-global-brand-red-70), rgba(239,113,113,.85));
    --hue-ring-up:     light-dark(0 0 0 2px rgba(45,158,144,.18), 0 0 0 0 transparent);
    --hue-ring-down:   light-dark(0 0 0 2px rgba(229,36,49,.16),  0 0 0 0 transparent);
    --grad-dark-hover: var(--ink-button-background-color-primary-base-hover);
    --grad-dark-text:  var(--ink-button-font-color-primary-base);

    /* === Backward-compatible aliases — CSS var references in component JSX use these directly === */
    --shadow:          var(--ink-elevation-global-shadow-flat);
    --shadow-hover:    var(--ink-elevation-global-shadow-medium);
    --border-default:  var(--ink-color-global-border-default);
    --ink-focus-border: var(--ink-color-global-border-focus-default);
    --ink-focus-ring:   var(--ink-color-global-brand-blue-30);
  }
  html.dark { color-scheme: dark; --lightningcss-light: ; --lightningcss-dark: initial; }

  * { -webkit-font-smoothing: antialiased; box-sizing: border-box; }
  body { background: var(--ink-color-global-surface-background-default); }
  body, .card, .panel, .navitem, .railitem, table.ledger tbody tr, input, select, button {
    transition: background-color .1s ${EASE}, border-color .1s ${EASE}, color .1s ${EASE}; }
  button { transition: background .1s ${EASE}, color .1s ${EASE}, border-color .1s ${EASE}, opacity .1s ${EASE}; }
  input, select { transition: border-color .1s ${EASE}, box-shadow .1s ${EASE}; }

  @keyframes pagein { from { opacity: 0; } to { opacity: 1; } }
  .pagein { animation: pagein .12s ${EASE_OUT} backwards; }
  @keyframes popin { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: none; } }
  .popin { animation: popin .1s ${EASE_OUT}; transform-origin: top left; }

  .actrow { transition: background .1s ${EASE}; }
  .actrow:hover { background: ${SHADE}; }
  /* shared dropdown/menu row (MenuItem in components.jsx) — Ink's Dropdown.Button hover
     tint (lightgray-hover, the same tint a selected row uses at rest); !important
     beats the row's own inline background (transparent or the selected tint) so
     hover always shows */
  .menu-item:hover { background: var(--ink-color-global-surface-lightgray-hover) !important; }

  /* Ink Dropdown.Trigger (FundPicker) — 36px outlined trigger; hover darkens the
     border, open promotes to the focus blue border + glow ring, matching
     Ink's real Dropdown.Trigger spec (.dd-trig / .dd-trig.is-open). */
  .dd-trigger { transition: border-color 120ms ease-out, box-shadow 120ms ease-out; }
  .dd-trigger:hover { border-color: var(--ink-color-global-border-hover); }
  .dd-trigger.is-open { border-color: var(--ink-color-global-border-focus-default); box-shadow: 0 0 0 4px var(--ink-color-global-border-focus-light); }

  /* Ink ButtonGroup (Segmented in components.jsx) — Ink's real ButtonGroup recipe.
     Container border + per-segment
     -1px-margin overlap so the hovered/selected segment paints its own 1px
     outline flush over the container border with no double line; dividers
     between segments suppress next to whichever segment is hovered/selected. */
  .seg-group { display: inline-flex; align-items: stretch; height: 40px; border: 1px solid var(--ink-color-global-border-default); border-radius: 4px; background: var(--ink-color-global-surface-background-default); transition: border-color 80ms ease-out, box-shadow 80ms ease-out; isolation: isolate; }
  .seg-group.is-sm { height: 32px; }
  /* Ink's own demo uses flex:1 1 0 (equal-width segments) because every sample
     row happens to share similar label lengths ("1M"/"3M"/"YTD"/"1Y"). This
     app's labels vary a lot more ("Exit now" vs "+3y"), so segments size to
     their own content instead — equal-width would clip the longest label. */
  .seg-btn { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 15px; border: 1px solid transparent; margin: -1px 0; background: transparent; color: var(--ink-color-global-text-default); font-weight: 500; font-size: 14px; line-height: 20px; cursor: pointer; white-space: nowrap; position: relative; transition: background-color 80ms ease-out, color 80ms ease-out, border-color 80ms ease-out; }
  .seg-btn:first-child { margin-left: -1px; border-top-left-radius: 4px; border-bottom-left-radius: 4px; }
  .seg-btn:last-child { margin-right: -1px; border-top-right-radius: 4px; border-bottom-right-radius: 4px; }
  .seg-group.is-sm .seg-btn { padding: 0 7px; font-size: 12px; line-height: 18px; }
  .seg-btn + .seg-btn::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 1px; background: var(--ink-color-global-border-default); }
  .seg-btn:hover:not(:disabled):not(.is-selected) { border-color: var(--ink-color-global-border-active); z-index: 2; }
  .seg-btn:hover:not(:disabled):not(.is-selected)::before { background: transparent !important; }
  .seg-btn:hover:not(:disabled):not(.is-selected) + .seg-btn::before { background: transparent; }
  .seg-btn.is-selected { background: var(--ink-button-background-color-primary-base-default); color: var(--ink-button-font-color-primary-base); border-color: var(--ink-button-background-color-primary-base-default); z-index: 1; }
  .seg-btn.is-selected:hover:not(:disabled) { background: var(--grad-dark-hover); border-color: var(--grad-dark-hover); }
  .seg-btn.is-selected + .seg-btn::before { background: transparent; }
  .seg-btn.is-selected::before { background: transparent !important; }
  .seg-btn:focus-visible { outline: 0; }
  .seg-group:has(.seg-btn:focus-visible) { border-color: var(--ink-color-global-border-focus-default); box-shadow: 0 0 0 4px var(--ink-color-global-border-focus-light); }
  .seg-group.is-disabled { border-color: var(--ink-color-global-border-disabled); }
  .seg-group.is-disabled .seg-btn { color: var(--ink-color-global-text-subtle); cursor: not-allowed; }
  .seg-group.is-disabled .seg-btn.is-selected { background: var(--ink-color-global-surface-disabled); color: var(--ink-color-global-text-subtle); border-color: var(--ink-color-global-border-disabled); }
  .seg-group.is-disabled .seg-btn + .seg-btn::before { background: var(--ink-color-global-border-disabled); }
  .seg-group.is-disabled .seg-btn.is-selected + .seg-btn::before { background: transparent; }
  .seg-group.is-disabled .seg-btn.is-selected::before { background: transparent !important; }
  .cardgo { transition: color .1s ${EASE}, transform .1s ${EASE}; }
  /* hover "go" hint — link-like affordance, so info-accent blue, not the black active color */
  .card:hover .cardgo { color: ${BLUE}; transform: translateX(2px); }

  /* ── price tape ── an editable-value control, so info-accent blue ── */
  input[type=range].tape { -webkit-appearance: none; appearance: none; width: 100%; height: 32px; background: transparent; cursor: pointer; }
  input[type=range].tape::-webkit-slider-runnable-track { height: 4px; border-radius: 0;
    background: linear-gradient(to right, var(--tape-accent, ${BLUE}) 0%, var(--tape-accent, ${BLUE}) var(--fill, 0%), var(--track) var(--fill, 0%)); }
  input[type=range].tape::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; box-sizing: border-box; width: ${TAPE_THUMB}px; height: ${TAPE_THUMB}px; margin-top: -5px;
    border-radius: 2px; background: var(--tape-accent, ${BLUE}); border: 2px solid ${PAPER}; transition: transform .1s ${EASE}; }
  input[type=range].tape::-webkit-slider-thumb:hover { transform: scale(1.12); }
  input[type=range].tape::-moz-range-track { height: 4px; border-radius: 0; background: var(--track); }
  input[type=range].tape::-moz-range-progress { height: 4px; border-radius: 0; background: var(--tape-accent, ${BLUE}); }
  input[type=range].tape::-moz-range-thumb { box-sizing: border-box; width: ${TAPE_THUMB}px; height: ${TAPE_THUMB}px; border-radius: 2px; background: var(--tape-accent, ${BLUE}); border: 2px solid ${PAPER}; }
  input[type=range].tape:focus-visible { outline: none; box-shadow: var(--focus-ring); }
  input[type=range].tape:disabled { opacity: .4; cursor: default; }

  .numin { border-radius: 4px !important; border: 1px solid ${BORDER_DEFAULT} !important; }
  .numin:hover:not(:focus):not(:disabled) { border-color: ${FAINT} !important; }
  .numin:focus { border-color: ${BLUE} !important; box-shadow: var(--focus-ring); outline: none; }
  .numin:focus-visible, button:focus-visible, select:focus-visible { outline: none; box-shadow: var(--focus-ring); border-radius: 4px; }
  input[type=search].numin { -webkit-appearance: none; appearance: none; }

  /* Ink's real Input/TextInput field: 36px height, 4px radius, 10px L/R padding,
     border-default at rest, border-active on hover, border-focus-default + a 4px
     border-focus-light ring on focus. Kept separate from .numin above (an older,
     slightly-off-spec hover/focus treatment still used by RepriceControl's inline
     numeric editor) rather than folding this into .numin's existing behavior. */
  .ink-input { border-radius: 4px; border: 1px solid var(--ink-color-global-border-default); }
  .ink-input:hover:not(:focus):not(:disabled) { border-color: var(--ink-color-global-border-active); }
  .ink-input:focus { border-color: var(--ink-color-global-border-focus-default); box-shadow: 0 0 0 4px var(--ink-color-global-border-focus-light); outline: none; }
  .ink-input:disabled { background: var(--ink-color-global-surface-lightgray-default); color: var(--ink-color-global-text-very-subtle); border-color: var(--ink-color-global-border-subtle); cursor: not-allowed; }
  .ink-input::placeholder { color: var(--ink-color-global-text-subtle); }
  /* -webkit-appearance:none on the input itself is what's needed so our own
     border-radius/border render instead of the browser's native rounded search
     pill — but that also drops the native clear-x button as a side effect,
     and (verified directly) no override on ::-webkit-search-cancel-button
     brings it back once the host input opts out of native appearance — a
     platform limitation, not something fixable in CSS alone. SearchInput
     renders its own clear button instead (see components.jsx) rather than relying
     on browser chrome that can't coexist with a custom border-radius. */
  input[type=search].ink-input { -webkit-appearance: none; appearance: none; }
  input[type=search].ink-input::-webkit-search-cancel-button { display: none; }

  /* Ink's real bordered/"Default" button strokes with
     --ink-button-border-color-secondary-base-default (gray-60, same value as
     --ink-color-global-border-default) — NOT border-subtle (gray-30, a hairline/
     divider color, too light for a button's own outline). Also darkens the
     border on hover per the real recipe. */
  .btn-ghost { border: 1px solid var(--ink-button-border-color-secondary-base-default) !important; border-radius: 4px; }
  .btn-ghost:hover:not(:disabled) { background: ${SHADE} !important; border-color: var(--ink-button-border-color-secondary-base-hover) !important; }
  /* Ink's real secondary-disabled recipe — a muted border/text on the same
     background, not the crude opacity-dim Btn falls back to for "locked". */
  .btn-ghost:disabled { border-color: var(--ink-button-border-color-secondary-disabled) !important; background: var(--ink-button-background-color-secondary-disabled) !important; color: var(--ink-button-font-color-secondary-disabled) !important; }
  .btn-primary { border-radius: 4px; box-shadow: none; }
  .btn-primary:hover:not(:disabled) { background: var(--grad-dark-hover) !important; }

  /* ── icon rail ── BLACK active with a left mark (active state, not a link) ── */
  .railitem { position: relative; border-radius: 0; }
  .railitem:hover { background: ${SHADE}; }
  .railitem.active { background: var(--accent-soft); color: ${ACCENT}; }
  .railitem.active::before { content: ""; position: absolute; left: 0; top: 8px; bottom: 8px; width: 2px; background: ${ACCENT}; }

  /* ── side-nav (also the narrow header) ── active = accent-soft wash + black text ── */
  .navitem { position: relative; border-radius: 0; }
  .navitem:hover { background: ${SHADE}; }
  .navitem.active { background: var(--accent-soft); border: 1px solid transparent !important; box-shadow: none; color: ${ACCENT}; }
  .addslice:hover { background: ${SHADE} !important; }

  .statcell { transition: background .1s ${EASE}; border-radius: 0; }
  .statcell:hover { background: ${SHADE}; }
  .statcell .go { opacity: 0; transition: opacity .1s ${EASE}; }
  .statcell:hover .go { opacity: .5; }

  /* active slice — BLACK wash (active/selected state, not a link) */
  .sliceitem.active { background: var(--accent-soft); border: 1px solid transparent !important; box-shadow: none; color: ${ACCENT}; }
  .sliceitem.active:hover { background: var(--accent-soft); }

  @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }

  /* ── tables — the canonical .ink-table recipe: white header, a
       border-default (medium gray) header rule, 500-weight 14px sentence-case labels,
       400-weight 14px cells, gray-30 row hover, flat total row. line-height:24px on
       both th/td (the canonical .ink-table recipe, "font: .../24px Inter") + the 10px
       vertical padding below is what gives every row its standard 44px height —
       without an explicit line-height the browser default falls short of that.
       Companies.jsx's main table is the one deliberate exception: its FV/MOIC/Deal-IRR
       cells use their own cellStack (minHeight:34 + flex column) to make room for an
       optional second delta line, so those rows grow taller than 44px when repriced. ── */
  /* scroll wrapper for tables that would otherwise overflow their container and
     push the whole page into horizontal scroll — mirrors the main Carta platform,
     where the table scrolls in place and the rest of the layout stays put.
     overflow-y is set explicitly to "hidden" (not the default "visible") so the
     browser doesn't auto-promote it to "auto" per the CSS overflow-pairing rule
     (setting only overflow-x forces overflow-y to compute as "auto" otherwise);
     that keeps useStickyHeader's ancestor walk (ui/table.jsx) from latching onto
     this div and skipping straight past it to the app's real scroller (contentRef
     in App.jsx), so sticky headers keep working unchanged. The wrapper has no
     constrained height, so nothing is ever actually clipped vertically. */
  .table-scroll { overflow-x: auto; overflow-y: hidden; }
  .table-scroll > table.ledger { width: max-content; min-width: 100%; }
  table.ledger { width: 100%; border-collapse: collapse; font-size: 14px; }
  table.ledger thead tr { border-bottom: 1px solid ${BORDER_DEFAULT}; }
  table.ledger tbody { font-variant-numeric: tabular-nums; }
  table.ledger tbody tr { border-bottom: 1px solid ${LINE}; transition: background .1s ${EASE}; }
  table.ledger tbody tr:last-child { border-bottom: none; }
  table.ledger tbody tr:hover { background: var(--row-hover); }
  table.ledger th { font-size: 14px; line-height: 24px; letter-spacing: normal; text-transform: none; color: ${INK}; font-weight: 500; white-space: nowrap; padding: 10px 12px; }
  /* floating clone of the header row, portaled to body while its home position has
     scrolled out of view — see the useStickyHeader hook in Companies.jsx. Mirrors
     Ink's own StickyTableHeader clone technique (a fixed-position duplicate rather
     than plain CSS position:sticky), which is what's needed once the table sits in
     a page-level scroll rather than its own fixed-height scroll box. */
  /* table-layout:fixed makes the clone strictly honor each th's measured width
     (colWidths from useStickyHeader) instead of auto-sizing around its own
     (bodyless) content, so its columns land exactly on the real table's below it. */
  /* the fixed-position, clipped "viewport slot" the clone renders into — sized
     to the table's .table-scroll wrapper (or the table itself, when there's no
     such wrapper) so a horizontally-scrolled clone doesn't render past the real
     table's visible width; see useStickyHeader's hEl tracking in ui/table.jsx. */
  .sticky-clone-slot { position: fixed; z-index: 30; overflow: hidden; }
  table.ledger.sticky-clone { table-layout: fixed; }
  table.ledger.sticky-clone th { background: ${PAPER}; box-shadow: inset 0 -1px ${BORDER_DEFAULT}; }
  table.ledger td { font-weight: 400; line-height: 24px; padding: 10px 12px; }
  table.ledger th:first-child, table.ledger td:first-child { padding-left: 2px; }
  table.ledger th:last-child, table.ledger td:last-child { padding-right: 2px; }
  table.ledger.sheet th:first-child, table.ledger.sheet td:first-child { padding-left: 20px; }
  table.ledger.sheet th:last-child, table.ledger.sheet td:last-child { padding-right: 20px; }
  /* fund-modeling override: the 12-column .sheet tables ride tight padding so the full row
     fits without a horizontal scrollbar (deliberate app-specific override of the canonical
     20px-edge default) — font-size stays the standard 14px, matching every other table. */
  table.ledger.sheet th, table.ledger.sheet td { padding-left: 6px; padding-right: 6px; font-size: 14px; }
  table.ledger.sheet th:first-child, table.ledger.sheet td:first-child { padding-left: 12px; }
  table.ledger.sheet th:last-child, table.ledger.sheet td:last-child { padding-right: 12px; }
  /* Roomier .sheet variant — Overview's fund table (13 columns, all reported figures
     with no per-row interaction) reads as cramped at the standard .sheet 6px gutter;
     a wider inner-column gutter helps it scan without giving up the .sheet density
     tables with more columns still need. Opt-in per table via an extra "roomy" class. */
  table.ledger.sheet.roomy th, table.ledger.sheet.roomy td { padding-left: 10px; padding-right: 10px; }
  /* Ink NewTable.Row preset="totals" — light-blue wash + medium weight, border-top
     instead of the row hairline, no bottom border. Matches
     the tr-level background pattern above (:hover) — td cells have no background of
     their own, so it shows straight through. font-weight needs !important: the plain
     table.ledger td rule (a directly-targeted td rule, font-weight 400) otherwise wins
     over an inherited value from the tr, regardless of selector specificity. */
  .totrow { background: var(--total-row-bg) !important; border-top: 1px solid ${BORDER_DEFAULT} !important; border-bottom: none !important; }
  .totrow:hover { background: var(--total-row-bg) !important; }
  .totrow td { font-weight: 500 !important; }

  /* Ink sortable headers (canonical Ink NewTable recipe): label = small
     transparent button; gray-30 hover; blue focus ring; active direction darkens the
     triangle via aria-sort; inactive triangle is gray-50 (decorative, below text-contrast). */
  /* gap matches Ink's real sort-button spec (8px); padding/margin stay a compact
     dense-grid hit-box rather than Ink's literal 32px-tall button — an intentional
     divergence consistent with this app's other sub-Ink density choices (see FS above). */
  .ink-sort-btn { display: inline-flex; align-items: center; gap: 8px; padding: 3px 6px; margin: -3px -6px; background: transparent; border: 1px solid transparent; border-radius: 4px; font: inherit; color: ${INK}; cursor: pointer; white-space: nowrap; transition: background .1s ${EASE}; }
  .ink-sort-btn:hover { background: ${SHADE}; }
  .ink-sort-btn:focus-visible { border-color: ${BLUE}; box-shadow: var(--focus-ring); outline: none; }
  .ink-sort-icon { flex: none; }
  .ink-sort-icon__asc, .ink-sort-icon__desc { fill: #CECFCF; }
  th[aria-sort="ascending"] .ink-sort-icon__asc { fill: ${INK}; }
  th[aria-sort="descending"] .ink-sort-icon__desc { fill: ${INK}; }

  /* Ink's standard underline Tab recipe (theme-with-ink components.md "## Tab") —
     the active indicator is a 3px bottom border on the item itself, never a
     separate pill/element. disabled tabs get the muted-text/no-hover treatment
     inline styles apply on top of these rules (see Companies.jsx usage). */
  /* Matches theme-with-ink's HorizontalNav resource (components-horizontalnav.html)
     exactly — the "## Tab" recipe in components.md is a looser generic approximation
     (8px-padded 3px border-bottom, 24px leading) that reads with a visibly bigger
     gap between the label and its underline than the real product. HorizontalNav's
     own measured spec: 44px-tall items with the label vertically centered, a 2px
     underline pinned to the bottom edge via ::after (not part of the box's own
     padding/border), 14px/20px type, weight 400 → 500 on the active item. */
  .ink-tabs { display: flex; align-items: center; gap: 24px; height: 44px; border-bottom: 1px solid var(--ink-color-global-border-subtle); }
  .ink-tab { position: relative; display: inline-flex; align-items: center; height: 44px; padding: 0; margin: 0; background: transparent; border: 0; font: 400 ${FS.value}px/20px ${SANS}; color: var(--ink-color-global-text-subtle); cursor: pointer; border-radius: 0; box-shadow: none; white-space: nowrap; }
  .ink-tab:hover, .ink-tab:focus { color: ${INK}; }
  .ink-tab.is-active { color: ${INK}; font-weight: 500; }
  .ink-tab.is-active::after { content: ""; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; background: var(--ink-color-global-border-active); }

  /* Ink's real NewCheckbox recipe (theme-with-ink resources/components-checkbox.html) —
     20px square, 4px radius, box stays WHITE in both themes (only the border/glyph
     recolor), Gray-90 check glyph, 8px gap to the label, 14px/20px type. Focus and
     hover key off the real (visually-hidden) <input>'s own pseudo-classes via the
     sibling ".box" span, rather than a manually-toggled "is-*" class — no JS
     needed to keep the states in sync. */
  .ink-chk { display: inline-flex; align-items: center; gap: 8px; font: 400 ${FS.value}px/20px ${SANS}; color: ${INK}; cursor: pointer; user-select: none; position: relative; }
  .ink-chk input { position: absolute; opacity: 0; pointer-events: none; width: 20px; height: 20px; }
  .ink-chk .box { flex: 0 0 auto; width: 20px; height: 20px; border: 1px solid var(--ink-color-global-border-default); border-radius: 4px; background: var(--ink-color-global-brand-white); display: inline-flex; align-items: center; justify-content: center; transition: border-color .12s ease, box-shadow .12s ease; }
  .ink-chk .box svg { display: block; width: 14px; height: 14px; opacity: 0; color: #394040; }
  .ink-chk:hover .box { border-color: var(--ink-color-global-border-hover); }
  .ink-chk input:checked ~ .box svg { opacity: 1; }
  .ink-chk input:focus-visible ~ .box { border-color: var(--ink-color-global-border-focus-default); box-shadow: 0 0 0 4px var(--ink-color-global-border-focus-light); }
  .ink-chk input:disabled ~ .box { background: var(--ink-color-global-surface-disabled); border-color: var(--ink-color-global-border-disabled); }
  .ink-chk input:disabled ~ .box svg { color: var(--ink-color-global-text-disabled); }
  .ink-chk:has(input:disabled) { cursor: not-allowed; color: var(--ink-color-global-text-disabled); }

  /* Ink Tag variants — "mini" size for dense tables: 20px height, 11px text, 4px radius.
     feedback-informational ("default") is a bordered semantic tag (reuses this app's own
     --blue); flex-gray-light / flex-yellow-light are borderless category tags — solid tint
     fill, no stroke — per the real Tag component's flex-{color}-{tone} variant names. */
  .tag { display: inline-flex; align-items: center; height: 20px; padding: 0 7px; font-size: 11px; font-weight: 650; white-space: nowrap; border-radius: 4px; box-sizing: border-box; }
  .tag--fb-info { border: 1px solid ${BLUE}; background: var(--accent-soft); color: ${BLUE}; }
  .tag--flex-gray-light   { background: var(--tag-gray-bg); color: var(--tag-gray-fg); }
  .tag--flex-yellow-light { background: var(--tag-yellow-bg); color: var(--tag-yellow-fg); }

  /* Cards flat by default; subtle elevation ONLY on hover (never always-on). */
  .card { background: ${PAPER}; border: 1px solid ${LINE}; border-radius: 0; box-shadow: none; }
  .card:hover { box-shadow: var(--shadow-hover); }
  /* Ink's real Tile has no hover elevation — StatBar (components.jsx) opts out of the
     app's usual card-lifts-on-hover convention to match. */
  .card.stat-bar:hover { box-shadow: none; }
  .panel { background: ${PAPER}; border: 1px solid ${LINE}; border-radius: 0; box-shadow: none; }
  .panel:hover { box-shadow: var(--shadow-hover); }

  /* ── Cohort Standing: 3 per-metric bars side by side, stacked on narrow
     viewports (a shrink-to-fit would make the tick labels illegible) ── */
  .bench-bars { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
  @media (max-width: 860px) { .bench-bars { grid-template-columns: 1fr; gap: 18px; } }

  #print-report { display: none; }
  @media print {
    @page { margin: 14mm 12mm; }
    body { background: #fff !important; }
    /* Hide the entire app (the #root mount is a full-height div → it would print as
       a blank leading page); reveal only the body-level #print-report portal. */
    body > :not(#print-report) { display: none !important; }
    #app-screen { display: none !important; }
    /* Force LIGHT tokens inside the report so it prints legibly even when the app
       is in dark mode. Setting color-scheme:light makes all light-dark() Ink tokens
       auto-resolve to their light values; only local vars with no light-dark() need
       explicit print-safe overrides here. */
    #print-report {
      display: block !important;
      color-scheme: light;
      --micro-text: #8A8D8D;
      --shadow: none;
      --shadow-hover: none;
      color: #1A1A1A; background: #FFFFFF;
    }
    #print-report table.ledger tbody tr:hover { background: transparent; }
    #print-report .report-block { break-inside: avoid; }
  }
`;
