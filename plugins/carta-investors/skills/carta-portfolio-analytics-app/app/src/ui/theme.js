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
// Fonts: Inter loads as a real webfont from the rsms.me CDN (see the <link> in
// webapp/index.html) — a prior version of this file deliberately avoided loading a
// webfont at all; see git history if you need that rationale. SangBleu Versailles
// self-hosts from webapp/fonts/, @font-face'd below.
//
// INK, PAPER, LINE, BORDER_DEFAULT, GREEN, RED, BLUE, FAINT, SHADE, ACCENT — internal only.
// Components inline these as var(--ink-...) strings directly; these consts exist only for
// the GLOBAL_CSS template literal below.
const INK            = "var(--ink-color-global-text-default)";
const PAPER          = "var(--ink-color-global-surface-background-default)";
const LINE           = "var(--ink-color-global-border-subtle)";
const BORDER_DEFAULT = "var(--ink-color-global-border-default)";
// Ink's real Tile border hardcodes the raw gray-30 swatch, not the border-subtle
// semantic hairline token used for table rows/dropdown panels — a shade darker.
const CARD_BORDER    = "var(--ink-color-global-brand-gray-30)";
const GREEN          = "var(--ink-color-global-feedback-positive-strong)";
const RED            = "var(--ink-color-global-feedback-negative-strong)";
// Ink's real "feedback-notice" Tag semantic (variant="feedback-notice",
// "Requires Action" label) — the canonical Ink token is
// `--local-color-warning-solid: var(--ink-color-global-brand-yellow-80)`.
// Used for stale marks and "needs attention" pills — was a bespoke brass
// ochre (#A8741A) before; now the real Ink brand-yellow step.
export const NOTICE      = "var(--ink-color-global-brand-yellow-80)";
export const NOTICE_TINT = "var(--ink-color-global-brand-yellow-20)"; // subtle tint pairing, same pattern as every other Badge tone's bg
// Literal, not a token: feedback-warning-strong drops to #B58A00 in dark mode,
// and the star must read as the same yellow in both themes.
export const STAR_FILL = "#F8D648";
// Intentional override: one shade lighter than Ink's gray-10 (#F1F1F1), which
// reads too heavy behind a 1.5px sparkline.
export const SPARK_PANEL = "#F7F7F7";
const BLUE           = "var(--ink-color-global-link-default)";
const FAINT          = "var(--ink-color-global-text-subtle)";
const SHADE          = "var(--ink-color-global-surface-lightgray-default)";
const ACCENT         = "var(--ink-button-background-color-primary-base-default)";
// SideNav's real active indicator (orange-60 light / orange-40 dark) — see
// theme-with-ink/resources/components-sidenav.html's --sn-stripe.
const STRIPE         = "var(--ink-color-global-highlight-strong)";
export const MICRO          = "var(--micro-text)"; // local override — Ink text-very-subtle dark (#394040) is near-invisible
export const EASE           = "cubic-bezier(.2,.6,.2,1)";
export const EASE_OUT       = "cubic-bezier(.2,.7,.2,1)";

// primary-button surface — flat brand-black (inverts to white on dark)
export const GRAD_DARK = "var(--ink-button-background-color-primary-base-default)";

// .tape range-input thumb size (px) — single source of truth for the CSS below and
// any consumer computing a track-relative position accounting for thumb width.
export const TAPE_THUMB = 14;

// Inter loads for real now (see header); the fallback chain still matches Ink's
// actual resolved stack (@carta/ink/dist/ink.css's literal body rule) verbatim, not a
// generic "-apple-system/BlinkMacSystemFont/system-ui" substitute.
const SANS = "Inter,'Open Sans','Helvetica Neue',Helvetica,Arial,sans-serif";
export const sans = { fontFamily: SANS };
export const serif = { fontFamily: SANS, letterSpacing: "-0.02em" }; // headings (grotesk, tight)
export const mono = { fontFamily: SANS, fontVariantNumeric: "tabular-nums", letterSpacing: "0" }; // figures (grotesk, tabular)

// ── Type scale — the single source of truth for font sizes across the app.
// Every view/ui component references these steps so sizes stay consistent and
// the ramp is easy to retune in one place.
//
// Aligned to the canonical Ink type tokens (the pinned snapshot in tokens.css,
// `--ink-font-global-size-*`) per the micro-app theme contract:
//   small/body 12 = Ink `small-1`   bodyLg 13 = Ink `monospace`
//   value 14 = Ink `body-1`         h3 16 = Ink `heading-3/4`
//   h2 20 = Ink `heading-2-desktop` display 28 = Ink `display-1`
// ONE DELIBERATE sub-Ink divergence (Ink's floor is 12px): `micro` (11) for
// uppercase eyebrows and delta increments in dense dashboard chrome, where the
// 12px floor would loosen the layout materially. Prose never uses it.
//   micro   eyebrows, footnotes, delta increments                 (sub-Ink)
//   small   chips, small labels, stale flags                     (Ink small-1)
//   body    table cells, secondary body, toggles                 (Ink small-1)
//   bodyLg  primary body, captions, buttons, inputs, tabs        (Ink monospace)
//   value   primary numeric values, table primary cells          (Ink body-1)
//   h3      sub-headings, sidebar headline value                 (Ink heading-3/4)
//   h2      page titles                                          (Ink heading-2)
//   display hero numbers (Revenue/ARR, expanded reprice value)   (Ink display-1)
export const FS = {
  micro: 11,
  small: 12,
  body: 12,
  bodyLg: 13,
  value: 14,
  h3: 16,
  h2: 20,
  display: 28,
};

export const GLOBAL_CSS = `
  /* Self-hosted — the woff2 lives at webapp/fonts/, so this loads from a local file
     with no network dependency, unlike Inter above. No H1/display-serif consumer
     exists in this app yet; loaded for parity with the other micro-apps' contract. */
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
    /* Canonical Ink focus recipe: a 4px ring in border-focus-light (not a flat 2px
       glow) — matches .ink-input/.dd-trigger/.seg-group so every focus state in the
       app agrees, instead of two divergent focus-ring systems. */
    --focus-ring:      0 0 0 4px var(--ink-color-global-border-focus-light);
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
    /* shadow-medium: for floating/at-rest-elevated surfaces (MultiSelect's popover, components.jsx). */
    --shadow-hover:    var(--ink-elevation-global-shadow-medium);
    /* shadow-small: for hover-only elevation on genuinely clickable cards/tiles — a lighter
       lift than a floating panel's, per the micro-app theme contract's Shadows rule. */
    --card-shadow-hover: var(--ink-elevation-global-shadow-small);
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
  @keyframes pa-spin { to { transform: rotate(360deg); } }

  .actrow { transition: background .1s ${EASE}; }
  .actrow:hover { background: ${SHADE}; }
  /* shared dropdown/menu row (MenuItem in components.jsx) — Ink's Dropdown.Button hover
     tint (lightgray-hover, the same tint a selected row uses at rest); !important
     beats the row's own inline background (transparent or the selected tint) so
     hover always shows */
  .menu-item:hover { background: var(--ink-color-global-surface-lightgray-hover) !important; }
  /* Material-style suggestion chip (MultiSelect quick picks) — grey fill, no
     stroke, darkens on hover the same way a menu row does. */
  .suggestion-chip { background: var(--ink-color-global-surface-lightgray-default); transition: background .1s ${EASE}; }
  .suggestion-chip:hover { background: var(--ink-color-global-surface-lightgray-hover); }

  /* Ink Dropdown.Trigger — 36px outlined trigger; hover darkens the
     border, open promotes to the focus blue border + glow ring, matching
     Ink's real Dropdown.Trigger spec (.dd-trig / .dd-trig.is-open). */
  .dd-trigger { transition: border-color 120ms ease-out, box-shadow 120ms ease-out, background-color 120ms ease-out; }
  .dd-trigger:hover { border-color: var(--ink-color-global-border-hover); background: var(--ink-color-global-surface-lightgray-hover); }
  /* Hand-rolled toolbar buttons (Expand all, and the toolbar Btn variant) share
     the trigger's hover fill so a ribbon can't have one control that lights up
     and one that doesn't. */
  .toolbar-btn { transition: border-color 120ms ease-out, background-color 120ms ease-out; }
  .toolbar-btn:hover:not(:disabled) { border-color: var(--ink-color-global-border-hover); background: var(--ink-color-global-surface-lightgray-hover); }
  .dd-trigger.is-open { border-color: var(--ink-color-global-border-focus-default); box-shadow: 0 0 0 4px var(--ink-color-global-border-focus-light); }

  /* Trend sparkline line. Dark mode lightens the same hue rather than swapping
     in a token — the area gradients are raw hex and cannot follow.
     The flat hex first is load-bearing: unlike every other light-dark() here,
     this sets stroke directly, so a dropped declaration falls back to SVG's
     default stroke:none — an invisible line, not a mis-coloured one. */
  .spark-line-up   { stroke: #3BA570; stroke: light-dark(#3BA570, #55C68F); }
  .spark-line-down { stroke: #D8432A; stroke: light-dark(#D8432A, #F0705A); }

  /* Ink ButtonGroup (Segmented in components.jsx) — Ink's real ButtonGroup recipe.
     Container border + per-segment
     -1px-margin overlap so the hovered/selected segment paints its own 1px
     outline flush over the container border with no double line; dividers
     between segments suppress next to whichever segment is hovered/selected. */
  .seg-group { display: inline-flex; align-items: stretch; height: 40px; border: 1px solid var(--ink-color-global-border-subtle); border-radius: 4px; background: var(--ink-color-global-surface-background-default); transition: border-color 80ms ease-out, box-shadow 80ms ease-out; isolation: isolate; }
  .seg-group.is-sm { height: 32px; }
  /* Matches TOOLBAR_CONTROL_STYLE (components.jsx) — for a Segmented sitting
     in the Companies filter ribbon alongside Dropdown/SearchInput controls. */
  .seg-group.is-toolbar { height: 36px; }
  /* Ink's own demo uses flex:1 1 0 (equal-width segments) because every sample
     row happens to share similar label lengths ("1M"/"3M"/"YTD"/"1Y"). This
     app's labels vary a lot more ("Exit now" vs "+3y"), so segments size to
     their own content instead — equal-width would clip the longest label. */
  .seg-btn { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 14px; border: 1px solid transparent; margin: -1px 0; background: transparent; color: var(--ink-color-global-text-default); font-weight: 500; font-size: 14px; line-height: 20px; cursor: pointer; white-space: nowrap; position: relative; transition: background-color 80ms ease-out, color 80ms ease-out, border-color 80ms ease-out; }
  .seg-btn:first-child { margin-left: -1px; border-top-left-radius: 4px; border-bottom-left-radius: 4px; }
  .seg-btn:last-child { margin-right: -1px; border-top-right-radius: 4px; border-bottom-right-radius: 4px; }
  .seg-group.is-sm .seg-btn { padding: 0 7px; font-size: 12px; line-height: 18px; }
  .seg-btn + .seg-btn::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 1px; background: var(--ink-color-global-border-subtle); }
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
  /* Ink's standard underline Tab recipe (theme-with-ink components.md "## Tab"),
     matching carta-fund-modeling's own .ink-tabs/.ink-tab rules verbatim — for
     switching between peer views in place (e.g. a modal's Table/Charts toggle),
     as opposed to .seg-group's boxed look for a mutually-exclusive setting. */
  .ink-tabs { display: flex; align-items: center; gap: 24px; height: 44px; border-bottom: 1px solid var(--ink-color-global-border-subtle); }
  .ink-tab { position: relative; display: inline-flex; align-items: center; height: 44px; padding: 0; margin: 0; background: transparent; border: 0; font: 400 ${FS.value}px/20px ${SANS}; color: var(--ink-color-global-text-subtle); cursor: pointer; border-radius: 0; box-shadow: none; white-space: nowrap; }
  .ink-tab:hover, .ink-tab:focus { color: ${INK}; }
  .ink-tab.is-active { color: ${INK}; font-weight: 500; }
  .ink-tab.is-active::after { content: ""; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; background: var(--ink-color-global-border-active); }
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
  .numin:focus-visible, button:focus-visible, select:focus-visible, a.btn-primary:focus-visible { outline: none; box-shadow: var(--focus-ring); border-radius: 4px; }
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
  .btn-primary { border-radius: 4px; box-shadow: none; }
  .btn-primary:hover:not(:disabled) { background: var(--grad-dark-hover) !important; }

  /* ── icon rail ── BLACK active with a left mark (active state, not a link) ── */
  .railitem { position: relative; border-radius: 0; }
  .railitem:hover { background: ${SHADE}; }
  .railitem.active { background: var(--accent-soft); color: ${ACCENT}; }
  .railitem.active::before { content: ""; position: absolute; left: 0; top: 8px; bottom: 8px; width: 2px; background: ${ACCENT}; }

  /* ── side-nav ── real Ink SideNav treatment: full-bleed rows (no border-radius —
     .sn__item has none), active = page background + a 3px orange left stripe + bold
     label, per theme-with-ink/resources/components-sidenav.html's .sn__item.is-active. ── */
  .navitem { position: relative; border-radius: 0; background: transparent; transition: background-color .05s linear; }
  .navitem:hover { background: ${SHADE}; }
  .navitem.active { background: var(--ink-color-global-surface-background-default); box-shadow: inset 3px 0 0 0 ${STRIPE}; font-weight: 600; }
  .navitem.active:hover { background: ${SHADE}; }
  /* Active row's icon sits on its own orange tile (dark glyph — I's color prop
     handles the glyph itself; this only draws the tile). Base tile matches
     theme-with-ink's .sn__icon (20x20, radius 3) exactly; only the active tile
     enlarges to 22x22/square — the glyph inside stays 20px either way. */
  .navitem-icon { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 3px; flex: none; }
  .navitem.active .navitem-icon { width: 22px; height: 22px; border-radius: 0; background: ${STRIPE}; }
  .addslice:hover { background: ${SHADE} !important; }

  /* ── sidebar action buttons (currency / update data / theme) — bordered chips,
     not list rows, so they read as actions rather than more nav tabs ── */
  .sidebar-action:hover { background: var(--ink-color-global-surface-lightgray-hover) !important; }

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
       Some tables are the deliberate exception: a cell that uses its own
       cellStack (minHeight:34 + flex column) to make room for an optional
       second delta line grows taller than 44px. ── */
  table.ledger { width: 100%; border-collapse: collapse; font-size: 14px; }
  table.ledger thead tr { border-bottom: 1px solid ${BORDER_DEFAULT}; }
  table.ledger tbody { font-variant-numeric: tabular-nums; }
  table.ledger tbody tr { border-bottom: 1px solid ${LINE}; transition: background .1s ${EASE}; }
  table.ledger tbody tr:last-child { border-bottom: none; }
  /* .no-row-lines tables (Heatmap in charts.jsx) run border-collapse:separate, so a
     <tr>'s own border-bottom above never renders on any cell — only the frozen
     label column gets one back, via box-shadow layered on its own vertical divider. */
  table.ledger.no-row-lines tbody tr:not(:last-child) td.frozen-col {
    box-shadow: inset -0.5px 0 0 var(--ink-color-global-border-subtle), inset 0 -1px 0 ${LINE};
  }
  /* :not(.no-row-hover) belongs on this rule itself — a separate lower-specificity
     override rule can never outrank this one's own :not(:has(...)) clause. */
  table.ledger tbody tr:hover:not(.no-row-hover):not(:has(> td[rowspan]:hover)) { background: var(--row-hover); }
  table.ledger th { font-size: 14px; line-height: 24px; letter-spacing: normal; text-transform: none; color: ${INK}; font-weight: 600; white-space: nowrap; padding: 14px 16px 14px 0; }
  /* PivotDashboard's own row-hover pair (not a .ledger table). No fade here —
     a delayed tr background drifts out of sync with td.pivot-frozen's instant
     swap while sweeping across rows, splitting the highlight across two rows. */
  /* :not(:has(...)) excludes hovering the rowSpan'd company-name cell — it
     visually spans every metric row in the company, so a plain tr:hover would
     highlight only its own (first) row while the pointer sits over a lower one. */
  table.pivot-table tbody tr:hover:not(:has(> td[rowspan]:hover)) { background: var(--row-hover); }
  table.pivot-table tbody tr:hover:not(:has(> td[rowspan]:hover)) td.pivot-frozen { background: var(--row-hover) !important; }
  /* floating clone of the header row, portaled to body while its home position has
     scrolled out of view. Mirrors Ink's own sticky-header clone technique
     (a fixed-position duplicate rather than plain CSS position:sticky), which
     is what's needed once the table sits in a page-level scroll rather than
     its own fixed-height scroll box. */
  /* table-layout:fixed makes the clone strictly honor each th's measured width
     instead of auto-sizing around its own (bodyless) content, so its columns
     land exactly on the real table's below it. */
  table.ledger.sticky-clone { position: fixed; z-index: 30; table-layout: fixed; }
  /* border-bottom (not box-shadow) so this doesn't collide with .frozen-col's
     own box-shadow below — same property on the same cell would drop one. */
  table.ledger.sticky-clone th { background: ${PAPER}; border-bottom: 1px solid ${BORDER_DEFAULT}; }
  /* Left padding 0, right padding 16 — the gutter between columns comes from the
     preceding cell's padding-right, so a th and its td share the same left edge
     and every header sits exactly over its own column. 12 + 24 + 12 = 48px row. */
  table.ledger td { font-weight: 400; line-height: 24px; padding: 12px 16px 12px 0; }
  table.ledger th:first-child, table.ledger td:first-child { padding-left: 2px; }
  table.ledger th:last-child, table.ledger td:last-child { padding-right: 2px; }
  table.ledger.sheet th:first-child, table.ledger.sheet td:first-child { padding-left: 20px; }
  table.ledger.sheet th:last-child, table.ledger.sheet td:last-child { padding-right: 20px; }
  /* the 12-column .sheet tables ride tight padding so the full row
     fits without a horizontal scrollbar (deliberate app-specific override of the canonical
     20px-edge default) — font-size stays the standard 14px, matching every other table. */
  table.ledger.sheet th, table.ledger.sheet td { padding-left: 6px; padding-right: 6px; font-size: 14px; }
  table.ledger.sheet th:first-child, table.ledger.sheet td:first-child { padding-left: 12px; }
  table.ledger.sheet th:last-child, table.ledger.sheet td:last-child { padding-right: 12px; }
  /* Roomier .sheet variant — a wide, all-reported-figures table with no
     per-row interaction reads as cramped at the standard .sheet 6px gutter;
     a wider inner-column gutter helps it scan without giving up the .sheet density
     tables with more columns still need. Opt-in per table via an extra "roomy" class. */
  table.ledger.sheet.roomy th, table.ledger.sheet.roomy td { padding-left: 10px; padding-right: 10px; }
  /* Frozen column (position:sticky;left:0 — see KpiTable): opaque background
     (a custom property so :hover below can repaint it) plus a right-edge
     divider via box-shadow — a sticky cell's own collapsed border can fail
     to repaint mid-scroll, so border-right won't reliably survive here. */
  table.ledger td.frozen-col, table.ledger th.frozen-col { background: var(--frozen-col-bg, var(--ink-color-global-surface-background-default)); box-shadow: inset -0.5px 0 0 var(--ink-color-global-border-subtle); transition: background .1s ${EASE}; }
  /* Cells elsewhere take their gutter from the previous column's padding-right,
     but the frozen column ends in a keyline — so the next one pads itself off it. */
  table.ledger td.frozen-col + td, table.ledger th.frozen-col + th { padding-left: 16px; }
  /* :not([rowspan]) excludes a group-spanning frozen cell; :not(:has(...)) excludes
     a row's OTHER frozen cells while only the rowspan'd one is hovered. */
  table.ledger tbody tr:hover:not(.no-row-hover):not(:has(> td[rowspan]:hover)) td.frozen-col:not([rowspan]) { --frozen-col-bg: var(--row-hover); }
  /* Small key-value table (label | value rows, no header) — the Company page's
     replacement for a StatBar stat strip. Matches Ink's real NewTable
     "Key-pair value" sample: both columns plain, left-aligned, regular
     weight (no bold/right-align emphasis on the value side), and the key
     column tinted with the real surface-brown-default token to set it off
     from the plain-white value column. */
  /* table-layout:fixed honors the colgroup's fixed label-column width (set in
     KVTable) instead of auto-sizing to each table's own content — so every kv
     table's label column lines up at the same width, page-wide. */
  table.ledger.kv { table-layout: fixed; }
  table.ledger.kv td { padding: 9px 16px; text-align: left; font-weight: 400; }
  /* .sheet's own :first-child/:last-child rules (3 classes) outrank the plain
     .kv td rule (2 classes) above, so the edge columns need the same
     specificity here to actually get 16px instead of .sheet's 12px. */
  table.ledger.kv td:first-child, table.ledger.kv td:last-child { padding-left: 16px; padding-right: 16px; }
  table.ledger.kv td.kv-label { background: var(--ink-color-global-surface-brown-default); }
  table.ledger.kv td.kv-value { font-variant-numeric: tabular-nums; }
  table.ledger.kv td.kv-asof { color: var(--ink-color-global-text-subtle); font-size: 13px; text-align: right; white-space: nowrap; }
  table.ledger.kv td.kv-rank { font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
  table.ledger.kv .kv-sub { font-size: 12px; font-weight: 400; color: var(--ink-color-global-text-subtle); margin-top: 2px; }
  /* Row-hover on a key-value table is disabled via the .no-row-hover class on
     each <tr> (KVTable, components.jsx) — the general tr:hover rule above
     already excludes it via :not(.no-row-hover), so there's no rule to add
     here. A table-scoped override rule at the same or lower specificity can
     never win that fight; see that rule's own comment. */
  /* Same reasoning for one non-clickable row inside an otherwise-hoverable
     table — e.g. an expanded accordion's detail row (RankedTable.jsx). */
  table.ledger tbody tr.no-row-hover:hover { background: transparent; }
  /* Expanded "selected group" (RankedTable.jsx): the open row and its detail
     drawer read as ONE active block. A shared accent-soft wash spans both, the
     hairline that used to wedge between them is dropped, and an accent left-bar
     runs down the pair — anchored to the chevron column — so the drawer reads as
     contained by its row rather than floating below it. The group's bottom edge
     is the drawer row's own border-bottom (kept from the base tbody tr rule),
     which closes it off from the next company. */
  table.ledger tbody tr.row-open,
  table.ledger tbody tr.row-open:hover,
  table.ledger tbody tr.drawer-open,
  table.ledger tbody tr.drawer-open:hover { background: var(--accent-soft); }
  /* Frozen cells paint their own opaque background (see .frozen-col), so repaint
     them to the wash too — mirrors the :hover frozen-col rule — otherwise the
     highlight stops short of the left edge on the chevron/Company columns. */
  table.ledger tbody tr.row-open td.frozen-col,
  table.ledger tbody tr.row-open:hover td.frozen-col { --frozen-col-bg: var(--accent-soft); }
  /* No hairline between the open row and its drawer. */
  table.ledger tbody tr.row-open { border-bottom: none; }
  /* Accent left-bar down the group, flush to the row's left edge. Drawn as a
     background gradient (not a border) so the chevron cell can keep its own
     right-edge divider as a separate box-shadow below. */
  table.ledger tbody tr.row-open td.frozen-col:first-child,
  table.ledger tbody tr.row-open:hover td.frozen-col:first-child {
    background: linear-gradient(${ACCENT}, ${ACCENT}) 0 0 / 2px 100% no-repeat, var(--accent-soft);
    box-shadow: inset -0.5px 0 0 var(--ink-color-global-border-subtle); }
  table.ledger tbody tr.drawer-open > td {
    background: linear-gradient(${ACCENT}, ${ACCENT}) 0 0 / 2px 100% no-repeat, var(--accent-soft);
    padding-bottom: 4px; }
  /* Ink NewTable.Row preset="totals" — light-blue wash + medium weight, border-top
     instead of the row hairline, no bottom border. Matches
     the tr-level background pattern above (:hover) — td cells have no background of
     their own, so it shows straight through. font-weight needs !important: the plain
     table.ledger td rule (a directly-targeted td rule, font-weight 400) otherwise wins
     over an inherited value from the tr, regardless of selector specificity. */
  .totrow { background: var(--total-row-bg) !important; border-top: 1px solid ${BORDER_DEFAULT} !important; border-bottom: none !important; }
  .totrow:hover { background: var(--total-row-bg) !important; }
  .totrow td { font-weight: 500 !important; }
  /* A frozen column sets its OWN background (see .frozen-col above), which
     paints over the tr-level wash instead of letting it show through —
     unlike every other td here. Repaint it to match so the total row's
     blue wash reaches the table's left edge instead of stopping short. */
  table.ledger tr.totrow td.frozen-col { background: var(--total-row-bg) !important; box-shadow: inset -0.5px 0 0 var(--ink-color-global-border-subtle) !important; }

  /* Ink sortable headers (canonical Ink NewTable recipe): label = small
     transparent button; gray-30 hover; blue focus ring; active direction darkens the
     triangle via aria-sort; inactive triangle is gray-50 (decorative, below text-contrast). */
  /* gap matches Ink's real sort-button spec (8px); padding/margin stay a compact
     dense-grid hit-box rather than Ink's literal 32px-tall button — an intentional
     divergence consistent with this app's other sub-Ink density choices (see FS above). */
  /* Vertical-only negative margin. A horizontal one would pull the label off its
     column's left edge, so the header text would no longer sit over its own data. */
  .ink-sort-btn { display: inline-flex; align-items: center; gap: 6px; padding: 3px 6px 3px 0; margin: -3px 0; background: transparent; border: 1px solid transparent; border-radius: 4px; font: inherit; color: ${INK}; cursor: pointer; white-space: nowrap; transition: background .1s ${EASE}; }
  .ink-sort-btn:hover { background: ${SHADE}; }
  .ink-sort-btn:focus-visible { border-color: ${BLUE}; box-shadow: var(--focus-ring); outline: none; }
  /* Column-header filter funnel: hidden until the header is hovered or focused,
     always shown (in the info colour) while that column has an active filter. */
  .col-filter-btn { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; padding: 0; border: 1px solid transparent; border-radius: 4px; background: transparent; color: var(--ink-color-global-text-subtle); cursor: pointer; opacity: 0; transition: opacity .1s ${EASE}, background .1s ${EASE}; }
  th:hover .col-filter-btn, .col-filter-btn:focus-visible, .col-filter-btn.is-active, .col-filter-btn.is-open { opacity: 1; }
  .col-filter-btn:hover { background: ${SHADE}; }
  .col-filter-btn.is-active { color: var(--ink-color-global-feedback-info-strong); }
  .col-filter-btn:focus-visible { border-color: ${BLUE}; box-shadow: var(--focus-ring); outline: none; }
  /* The hidden funnel still reserves its 20px + 4px gap after a header's caret. A
     right-aligned column's figures take the same gutter so they end under the text. */
  table.ledger td.num-gutter { padding-right: calc(16px + 24px); }
  table.ledger td.num-gutter:last-child { padding-right: calc(2px + 24px); }
  .ink-sort-icon { flex: none; }
  .ink-sort-icon__asc, .ink-sort-icon__desc { fill: #CECFCF; }
  th[aria-sort="ascending"] .ink-sort-icon__asc { fill: ${INK}; }
  th[aria-sort="descending"] .ink-sort-icon__desc { fill: ${INK}; }

  /* Ink Tag variants — "mini" size for dense tables: 20px height, 11px text, 4px radius.
     feedback-informational ("default") is a bordered semantic tag (reuses this app's own
     --blue); flex-gray-light / flex-yellow-light are borderless category tags — solid tint
     fill, no stroke — per the real Tag component's flex-{color}-{tone} variant names. */
  .tag { display: inline-flex; align-items: center; height: 20px; padding: 0 7px; font-size: 11px; font-weight: 650; white-space: nowrap; border-radius: 4px; box-sizing: border-box; }
  .tag--fb-info { border: 1px solid ${BLUE}; background: var(--accent-soft); color: ${BLUE}; }
  .tag--flex-gray-light   { background: var(--tag-gray-bg); color: var(--tag-gray-fg); }
  .tag--flex-yellow-light { background: var(--tag-yellow-bg); color: var(--tag-yellow-fg); }

  /* Cards flat by default; subtle elevation ONLY on hover (never always-on).
     Border is the raw gray-30 Tile swatch (CARD_BORDER), not the border-subtle
     hairline used for table rows/dropdown panels — a shade darker, per Ink's
     real Tile recipe. */
  .card { background: ${PAPER}; border: 1px solid ${CARD_BORDER}; border-radius: 0; box-shadow: none; }
  .card:hover { box-shadow: var(--card-shadow-hover); }
  /* Ink's real Tile has no hover elevation — StatBar (components.jsx) opts out of the
     app's usual card-lifts-on-hover convention to match. */
  .card.stat-bar:hover { box-shadow: none; }
  /* The KPI chart wall (CompanyPage's InkKpiChart cards) has its own in-graph hover
     state (crosshair + tooltip) — the card itself isn't a clickable tile, so it
     opts out of the lift the same way StatBar does. */
  .card.chart-card:hover { box-shadow: none; }
  .panel { background: ${PAPER}; border: 1px solid ${CARD_BORDER}; border-radius: 0; box-shadow: none; }
  .panel:hover { box-shadow: var(--card-shadow-hover); }
  /* Plain bordered wrapper for a small key-value table — deliberately NOT
     .card/.panel. Both of those carry a hover-elevation shadow, which on a
     table reads as "this is clickable" when it isn't; a table never gets that
     signal, so this wrapper has no hover rule at all. */
  .kv-table-wrap { background: ${PAPER}; border: 1px solid ${CARD_BORDER}; border-radius: 0; }

  /* ── 3 per-metric bars side by side, stacked on narrow
     viewports (a shrink-to-fit would make the tick labels illegible) ── */
  .bench-bars { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
  @media (max-width: 860px) { .bench-bars { grid-template-columns: 1fr; gap: 18px; } }

  /* Elements only meant for the printed tearsheet (e.g. its title block) are
     hidden on screen and revealed under @media print. */
  .print-only { display: none; }

  /* Company page tabs: every panel is in the DOM (so the tearsheet can print them
     all, stacked); on screen only the active one shows. */
  .company-tab-panel.is-inactive { display: none; }

  /* The company page prints in place — the Download PDF button just calls
     window.print(). App chrome (sidebar, tab nav, header controls, in-page
     buttons) carries .no-print so it drops on paper; the live cards print as-is. */
  @media print {
    @page { margin: 14mm 12mm; }
    body { background: #fff !important; }
    .no-print { display: none !important; }
    .print-only { display: block !important; }
    .company-tab-panel.is-inactive { display: block !important; }

    /* The app clips itself to the viewport: #app-screen is height:100vh /
       overflow:clip and its inner scroller is height:100vh / overflow-y:auto, so
       a naive print would capture only the first screen. Un-clip both so the whole
       page flows across printed pages. */
    #app-screen, #app-screen > div {
      height: auto !important;
      max-height: none !important;
      overflow: visible !important;
    }
    #app-screen { display: block !important; }

    /* Force LIGHT tokens so the sheet prints legibly even from dark mode. Setting
       color-scheme:light makes all light-dark() Ink tokens resolve to their light
       values; only local vars with no light-dark() need explicit overrides here. */
    #app-screen {
      color-scheme: light;
      --micro-text: #8A8D8D;
      --shadow: none;
      --shadow-hover: none;
      --card-shadow-hover: none;
      color: #1A1A1A; background: #FFFFFF;
    }
    table.ledger tbody tr:hover { background: transparent; }
    /* Keep a section's card from splitting across a page break. */
    .card, [id^="card-"] { break-inside: avoid; }
  }
`;
