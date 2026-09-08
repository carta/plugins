// Design system — Swiss minimal, themed with real Carta (Ink) brand tokens. A stark
// white canvas (Ink brand-black text), FLAT hairline surfaces, grid-driven, near-instant
// motion. Numbers render in the grotesk with tabular-nums (no monospace) — a deliberate
// break from the ledger look. Export NAMES match the pattern used by every existing
// microapp (investor-dashboard, fund-modeling) so views re-skin automatically.
//
// Token source: the vendored Ink `tokens.css` snapshot — a versioned, mechanically-
// extracted snapshot traced to a specific Ink release (see that file's header for the
// exact upstream commit) — NOT the live `ask-ink` MCP tool. The two sources have drifted
// on some exact hex values (different Ink brand-generation snapshots); tokens.css is
// preferred because it's pinned and traceable, not because ask-ink is wrong per se.
// Two color roles that look similar are semantically different in Ink and must stay split:
//   - ACCENT ("primary/active interactive") -> Ink brand-black. Active nav, selected
//     rows/slices, checked toggles, and primary buttons are BLACK, not blue.
//   - BLUE ("links / focus / info accents") -> Ink's actual link/focus blue (#285DA3),
//     never used for "active" state. This is the single most common mistake when
//     reskinning a Carta surface — see the Canonical Theme Contract.
export const INK = "var(--ink)"; // primary text (Ink brand-black, #1A1A1A)
export const NAVY = "var(--navy)"; // wordmark (also brand-black)
export const PAPER = "var(--paper)"; // page canvas (white)
export const SIDE = "var(--side)"; // rail / framed surface
export const LINE = "var(--line)"; // hairline stroke (Ink border-subtle / gray-40, #DEDFDF)
export const BORDER_DEFAULT = "var(--border-default)"; // medium-weight border (Ink border-default / gray-60, #A7AAAA) — table header rules, input borders
export const GREEN = "var(--green)"; // positive financial deltas (Ink feedback-positive-strong)
export const RED = "var(--red)"; // negative financial deltas / destructive (Ink feedback-negative-strong)
export const BLUE = "var(--blue)"; // links + focus + informational accents ONLY (Ink link/focus blue)
export const FAINT = "var(--faint)"; // secondary text (Ink text-subtle / gray-80, #656B6B)
export const SHADE = "var(--shade)"; // tinted fills (Ink gray-10, #F1F1F1)
// Table row/cell hover wash — Ink's surface-lightgray-hover (gray-40), the
// token the microapp theme contract's table recipe names for this. Defined per theme
// below; a cell that opens something wears it, and only those cells do.
export const ROW_HOVER = "var(--row-hover)";
export const CARD = "var(--card)";
export const ACCENT = "var(--accent)"; // primary/active interactive — BLACK (not blue — see header note)
// Sidebar-only exception to the black-not-orange rule above: Ink SideNav's own
// active-row stripe is orange-60, per Ink's components-sidenav.html.
export const SIDENAV_STRIPE = "var(--ink-color-global-brand-orange-60)";
export const MICRO = "var(--micro)"; // quiet label grey (Ink text-disabled / gray-60, #A7AAAA) — used for
// actual readable text (uppercase eyebrows, axis labels); gray-50 (#CECFCF) is too light for text contrast
// and is only correct for decorative icon fills (e.g. SortCaret's inactive triangle) — don't repoint this
// shared token there, hardcode gray-50 locally in that one spot instead.

// Radius default: Ink radius-flat (0) for structural surfaces (cards/panels/tables),
// radius-subtle (4px) for interactive controls (buttons/inputs/tags) — per
// Ink's rule #5. If the app you're theming has an existing deliberate
// radius convention (e.g. a sharper/flatter system), preserve that instead — this is a
// default, not a mandate. RADIUS below drives cards/panels; bump per-component radii
// (e.g. in Btn) independently if the app wants the subtle 4px on controls.
export const RADIUS = 0; // card/panel/table radius — flat
export const SHADOW = "var(--shadow)"; // flat by default (no static shadow)
export const SHADOW_HOVER = "var(--shadow-hover)"; // subtle elevation — HOVER ONLY (see .card:hover below)
export const EASE = "cubic-bezier(.2,.6,.2,1)";
export const EASE_OUT = "cubic-bezier(.2,.7,.2,1)";

// primary-button surface — flat brand-black (inverts to white on dark)
export const GRAD_DARK = "var(--grad-dark)";

// Ink Banner info variant. INFO_STRONG is feedback-info-strong, distinct from
// BLUE (link/focus) — same value in light, diverges in dark.
export const INFO_STRONG = "var(--ink-color-global-feedback-info-strong)";
export const BANNER_SURFACE_INFO = "var(--banner-surface-info)"; // flips to black in dark, per the banner spec
export const BANNER_TEXT = "var(--banner-text)"; // banner body copy — gray-90 light / gray-60 dark

// .tape range-input thumb size (px) — single source of truth for both the CSS below and
// any consumer that needs to compute a track-relative position accounting for the
// thumb's own width.
export const TAPE_THUMB = 14;

// Aligned with the Ink theme contract's real-font approach. Inter is
// loaded from the same rsms.me CDN that contract uses for one-shot artifacts (see the
// <link> in index.html) — never name a face here without a matching loader; if that
// <link> is ever removed, drop "Inter" from SANS too. SangBleu Versailles is
// self-hosted (the woff2 lives at webapp/fonts/, served directly by serve.py), so it
// loads from a local file with zero network
// dependency — see the @font-face below. Offline-safe for Inter specifically: if the
// CDN request fails (no network), the browser just falls through to the next name in
// SANS below — no error, no broken page, just a different-looking font.
//
// Both stacks below are Ink's own real resolved chains (source: @carta/ink/dist/ink.css's
// literal body/h1 rules — see Ink's tokens.css and the Canonical Theme Contract's
// Typography bullet) — do NOT substitute a generic -apple-system/Segoe UI/system-ui
// "system font stack" here (the previous version of this file did exactly that); that is
// NOT what Ink does, even though it looks like standard practice from other design systems.
const SANS = "Inter,'Open Sans','Helvetica Neue',Helvetica,Arial,sans-serif";
export const sans = { fontFamily: SANS };
// Family-prominent chain (Ink's h1/display heading font) — reserved for H1 only, never
// for body text or h2-h4. Georgia is a real, always-available system serif, kept as the
// fallback for the rare case the self-hosted woff2 fails to load. Georgia only ships
// weight 400/700 as a system font (no native 500/600 face) — a font-weight: 500 request
// on it silently falls back to 400 per the CSS font-matching spec.
const SERIF = "'SangBleu Versailles',Georgia,serif";
export const serif = { fontFamily: SERIF, letterSpacing: "-0.02em" }; // H1 only (display/prominent)

// ── Type scale — single source of truth for font sizes, matching carta-fund-modeling's
// FS steps exactly (ui/theme.js there) so the two microapps read consistently. Aligned
// to the canonical Ink type tokens (Ink's tokens.css `--ink-font-global-size-*`):
//   bodyLg 13 = Ink `monospace`   value 14 = Ink `body-1`
//   h3     16 = Ink `heading-3/4` h2    20 = Ink `heading-2-desktop`
//   display 28 = Ink `display-1`  (body 12 = Ink `small-1`)
// `micro` (10) and `small` (11) are a DELIBERATE sub-Ink divergence, same as
// fund-modeling's: Ink's floor is 12px, but this app's dense budget-crosstab chrome
// (uppercase eyebrows, cell micro-captions, quarter sub-headers) would loosen
// noticeably at a 12px floor.
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

// Eyebrow (uppercase small-caps label) letter-spacing — matches fund-modeling's
// EYEBROW_TRACKING and falls inside Ink's brand.md's documented eyebrow
// spec (0.06–0.08em).
export const EYEBROW_TRACKING = "0.07em";

// Named spacing rhythm for panel/drawer chrome, sized off this file's own FS scale.
export const SPACING = {
  tight: 8,          // inline label/value pairs, icon-to-text
  contentGutter: 16, // between sibling sections in a drawer body
  section: 20,       // top-level drawer body gap (matches FS.h2)
  loose: 28,         // separating a whole new kind-specific section (matches FS.display)
};

// Quiet uppercase micro-caption — the "unmapped" / "sum" / source markers that
// annotate a table cell without competing with the figure in it. Smaller and
// less tracked than Eyebrow, which is a block-level section label; this one
// sits inline inside a cell. Shared because three copies of it had already
// been written across the two Budget-vs-Actuals views.
export const microCaption = {
  fontSize: FS.micro, fontWeight: 400, letterSpacing: ".04em",
  textTransform: "uppercase", cursor: "help",
};

// NOT a monospace typeface — same SANS/Inter family as `sans`, just with
// tabular-nums figures for column/value alignment. Named after Ink's real
// `.ink-num` recipe (Ink's tokens.css), which this mirrors — never
// switch to an actual monospace font for numeric alignment.
export const inkNum = { fontFamily: SANS, fontVariantNumeric: "tabular-nums", letterSpacing: "0" };

export const GLOBAL_CSS = `
  /* Self-hosted — the woff2 lives at webapp/fonts/ and is served directly by
     serve.py at /fonts/, so this loads from a local file with no network
     dependency, unlike Inter above. Georgia (SERIF's second link) covers the
     rare case this fails to load. */
  @font-face {
    font-family: "SangBleu Versailles";
    src: url("/fonts/SangBleuVersailles-Regular-WebS.woff2") format("woff2");
    font-weight: 400; font-style: normal; font-display: swap;
  }
  :root {
    /* Values that match an Ink token in ui/tokens.css exactly (both light and
       dark branches, verified hex-for-hex) reference it by var() instead of
       repeating the hex here — re-syncing tokens.css keeps them current with
       no edit needed in this file. Anything below with a literal value has
       no exact Ink-token equivalent (app-specific composite: gradient,
       trend-arrow hue, tinted shadow, focus ring alpha) and is intentionally
       still hand-specified — see html.dark below for its dark counterpart.
       Ink brand-black drives text + active/primary UI. Ink link/focus blue
       (#285DA3) is scoped to links/focus-rings/info-accents only — see
       header note above. */
    --ink: var(--ink-color-global-text-default);
    --navy: var(--ink-color-global-text-default);
    --paper: var(--ink-color-global-surface-background-default);
    --side: var(--ink-color-global-surface-background-default);
    --line: var(--ink-color-global-border-subtle);
    --border-default: var(--ink-color-global-border-default);
    --green: var(--ink-color-global-feedback-positive-strong);
    --red: var(--ink-color-global-feedback-negative-strong);
    --blue: var(--ink-color-global-link-default);
    --faint: var(--ink-color-global-text-subtle);
    --shade: var(--ink-color-global-surface-lightgray-default);
    --card: var(--ink-color-global-surface-background-default);
    --micro: var(--ink-color-global-border-default);
    --accent: #1A1A1A; --accent-soft: rgba(26,26,26,.06);
    /* The cells an open panel is reading. Ink's warning-subtle is nearly
       invisible on white, so this is its strong pair let down against the
       page — one declaration, because --paper flips with the theme. */
    --cell-held: color-mix(in srgb, var(--ink-color-global-feedback-warning-strong) 22%, var(--paper));
    --grad-dark: #1A1A1A; --grad-dark-hover: #2A2A2A; --grad-dark-text: #FFFFFF; --track: #E6E6E6; --row-hover: #E9EAEA;
    --hue-up: rgba(45,158,144,1); --hue-down: rgba(229,36,49,.95);
    --hue-ring-up: 0 0 0 2px rgba(45,158,144,.18); --hue-ring-down: 0 0 0 2px rgba(229,36,49,.16);
    --shadow: none; --shadow-hover: 0 4px 26px -4px rgba(0,16,76,.10);
    --focus-ring: 0 0 0 2px rgba(40,93,163,.45);
    /* Ink Banner spec deliberately flips banner surfaces to black in dark
       mode rather than using feedback-info-subtle's own dark value. */
    --banner-surface-info: var(--ink-color-global-feedback-info-subtle);
    --banner-text: var(--ink-color-global-brand-gray-90);
    /* An over-budget bar fill, not feedback-negative-strong: that token's
       dark arm (#FAD9D7) is tuned for text and renders pale pink as a
       large fill — see Ink's charts.md's conditional-bar-color
       section. Negative L2 from the intensity ladder instead. */
    --local-mark-negative: #E52431;
    /* One hue (link blue) at three intensities, keyed to role rather than a
       fourth unrelated series — the ladder from Ink's patterns.md.
       dark: the widest-horizon or most-emphasized figure (annual budget, a
       net-cashflow line). tint: a secondary series sharing the chart with
       the full blue (YTD budget, cashflow expenses). pale: a plan/budget
       backdrop bar sitting behind the primary (lime) actual bar. */
    --local-series-blue-dark: #0D366B;
    --local-series-blue-tint: #86B6EF;
    --local-series-blue-pale: #CDE2FB;
    /* charts.md's single-series house pick (lime-3) is a pure data accent
       with no semantic baggage, unlike blue (reserved for links/focus) or
       green/red. A paler tint of it for the same "provisional/secondary
       portion of one metric" role blue-tint served above. */
    --local-series-lime-tint: color-mix(in srgb, var(--ink-color-global-data-viz-lime-3) 40%, white);
    color-scheme: light;
  }
  html.dark {
    /* The var()-referenced tokens above resolve to their dark branch
       automatically once color-scheme is dark — nothing to repeat here.
       Only the hand-specified, no-Ink-equivalent values need a dark
       counterpart. */
    --accent: #FFFFFF; --accent-soft: rgba(255,255,255,.10);
    --grad-dark: #FFFFFF; --grad-dark-hover: #CECFCF; --grad-dark-text: #1A1A1A; --track: #394040; --row-hover: #2D2D2D;
    --banner-surface-info: var(--ink-color-global-brand-black);
    --banner-text: var(--ink-color-global-brand-gray-60);
    --hue-up: rgba(91,192,179,.85); --hue-down: rgba(255,107,107,.85);
    --hue-ring-up: 0 0 0 0 transparent; --hue-ring-down: 0 0 0 0 transparent;
    --shadow: none; --shadow-hover: 0 4px 26px -4px rgba(0,0,0,.35);
    --focus-ring: 0 0 0 2px rgba(110,155,214,.5);
    --local-mark-negative: #EF7171;
    color-scheme: dark;
  }

  * { -webkit-font-smoothing: antialiased; box-sizing: border-box; }
  body { background: ${PAPER}; }
  body, .card, .panel, .navitem, .railitem, table.ledger tbody tr, input, select, button {
    transition: background-color .1s ${"cubic-bezier(.2,.6,.2,1)"}, border-color .1s ${"cubic-bezier(.2,.6,.2,1)"}, color .1s ${"cubic-bezier(.2,.6,.2,1)"}; }
  button { transition: background .1s ${EASE}, color .1s ${EASE}, border-color .1s ${EASE}, opacity .1s ${EASE}; }
  input, select { transition: border-color .1s ${EASE}, box-shadow .1s ${EASE}; }

  @keyframes pagein { from { opacity: 0; } to { opacity: 1; } }
  .pagein { animation: pagein .12s ${EASE_OUT} backwards; }
  @keyframes popin { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: none; } }
  .popin { animation: popin .1s ${EASE_OUT}; transform-origin: top left; }

  .actrow { transition: background .1s ${EASE}; }
  .actrow:hover { background: ${SHADE}; }
  .cardgo { transition: color .1s ${EASE}, transform .1s ${EASE}; }
  /* "go" navigation hint on hover — link-like affordance, so it uses the info-accent
     blue rather than the black active/primary color. */
  .card:hover .cardgo { color: ${BLUE}; transform: translateX(2px); }

  /* ── price tape ── an editable-value control, so it uses the info-accent blue ── */
  input[type=range].tape { -webkit-appearance: none; appearance: none; width: 100%; height: 32px; background: transparent; cursor: pointer; }
  input[type=range].tape::-webkit-slider-runnable-track { height: 4px; border-radius: 0;
    background: linear-gradient(to right, ${BLUE} 0%, ${BLUE} var(--fill, 0%), var(--track) var(--fill, 0%)); }
  input[type=range].tape::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; box-sizing: border-box; width: ${TAPE_THUMB}px; height: ${TAPE_THUMB}px; margin-top: -5px;
    border-radius: 2px; background: ${BLUE}; border: 2px solid ${PAPER}; transition: transform .1s ${EASE}; }
  input[type=range].tape::-webkit-slider-thumb:hover { transform: scale(1.12); }
  input[type=range].tape::-moz-range-track { height: 4px; border-radius: 0; background: var(--track); }
  input[type=range].tape::-moz-range-progress { height: 4px; border-radius: 0; background: ${BLUE}; }
  input[type=range].tape::-moz-range-thumb { box-sizing: border-box; width: ${TAPE_THUMB}px; height: ${TAPE_THUMB}px; border-radius: 2px; background: ${BLUE}; border: 2px solid ${PAPER}; }
  input[type=range].tape:focus-visible { outline: none; box-shadow: var(--focus-ring); }
  input[type=range].tape:disabled { opacity: .4; cursor: default; }

  .numin { border-radius: 4px !important; border: 1px solid ${LINE} !important; }
  .numin:focus { border-color: ${BLUE} !important; box-shadow: var(--focus-ring); outline: none; }
  .numin:focus-visible, button:focus-visible, select:focus-visible { outline: none; box-shadow: var(--focus-ring); border-radius: 4px; }
  input[type=search].numin { -webkit-appearance: none; appearance: none; }

  .btn-ghost { border: 1px solid ${LINE} !important; border-radius: 4px; }
  /* A toolbar control's border is border-default, not the hairline the plain
     ghost button uses — Ink's own filter trigger is the darker gray, and the
     Dropdown beside it already draws it. */
  .btn-toolbar { border-color: var(--ink-button-border-color-secondary-base-default) !important; }
  .btn-toolbar:hover:not(:disabled) { border-color: var(--ink-button-border-color-secondary-base-hover) !important; }
  .btn-toolbar.is-open:not(:disabled) { border-color: var(--ink-color-global-border-focus-default) !important; box-shadow: 0 0 0 4px var(--ink-color-global-border-focus-light) !important; }
  .btn-ghost:hover:not(:disabled) { background: ${SHADE} !important; }
  .btn-primary { border-radius: 4px; box-shadow: none; }
  .btn-primary:hover:not(:disabled) { background: var(--grad-dark-hover) !important; }

  /* ── GlobalFilter ── copied literally from Ink's
       resources/components-globalfilter.html. Values are that file's, verbatim;
       don't re-tune them here. The warm menu surface and the gray-30 active row
       have no semantic Ink token, so both compose the palette exactly as the
       source card's --local-color-* rules do. */
  .gf-reset { height: 28px; padding: 0 8px; border: 0; background: transparent; color: var(--ink-color-global-text-default); font: 500 12px/1 Inter,sans-serif; cursor: pointer; border-radius: 4px; }
  .gf-reset:hover { background: var(--ink-color-global-surface-lightgray-hover); }
  .tag-close-btn { margin-left: 6px; display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border: 0; border-radius: 3px; background: transparent; color: currentColor; cursor: pointer; padding: 0; transition: background-color 120ms ease-out; }
  .tag-close-btn:hover { background: rgba(0,0,0,.06); }
  .tag-close-btn:active { background: rgba(0,0,0,.12); }

  /* ── Dropdown ── trigger and menu-row chrome, ported from
       carta-fund-modeling's .dd-trigger / .menu-item. Hover and open-focus
       states need real :hover, so they live here rather than inline. */
  .dd-trigger { transition: border-color 120ms ease-out, box-shadow 120ms ease-out; }
  .dd-trigger:hover { border-color: var(--ink-color-global-border-hover); }
  .dd-trigger.is-open { border-color: var(--ink-color-global-border-focus-default); box-shadow: 0 0 0 4px var(--ink-color-global-border-focus-light); }
  .menu-item:hover { background: var(--ink-color-global-surface-lightgray-hover) !important; }

  .gf-panel { display: flex; width: 560px; height: 416px; border: 1px solid var(--ink-color-global-border-subtle); border-radius: 8px; background: var(--ink-color-global-surface-background-default); overflow: hidden; box-shadow: 0 8px 24px rgba(20,24,24,0.12), 0 2px 6px rgba(20,24,24,.06); }
  .gf-panel__menu { width: 180px; background: light-dark(#FBFAF9, #2D2D2D); border-right: 1px solid var(--ink-color-global-border-subtle); padding: 8px 0; overflow-y: auto; }
  .gf-navitem { display: flex; align-items: center; justify-content: space-between; height: 36px; padding: 0 16px; gap: 10px; font: 400 14px/20px Inter,sans-serif; color: var(--ink-color-global-text-default); cursor: pointer; border: 0; background: transparent; width: 100%; text-align: left; }
  .gf-navitem:hover { background: var(--ink-color-global-surface-lightgray-default); }
  .gf-navitem--active { background: light-dark(var(--ink-color-global-brand-gray-30), var(--ink-color-global-brand-gray-90)); font-weight: 500; }
  .gf-panel__right { display: flex; flex-direction: column; flex: 1; min-width: 0; }
  .gf-panel__view { flex: 1; padding: 20px 24px; overflow-y: auto; }
  .gf-view__title { font: 500 14px/20px Inter,sans-serif; margin: 0 0 14px; color: var(--ink-color-global-text-default); }
  .gf-search { height: 36px; width: 100%; padding: 0 12px 0 32px; border: 1px solid var(--ink-color-global-border-default); border-radius: 4px; font: 400 14px/20px Inter,sans-serif; color: var(--ink-color-global-text-default); background: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'><circle cx='7' cy='7' r='4.5' stroke='%23656B6B' fill='none' stroke-width='1.35'/><path d='M10.5 10.5L14 14' stroke='%23656B6B' stroke-width='1.35' stroke-linecap='round'/></svg>") 10px 50% / 16px 16px no-repeat var(--ink-color-global-surface-background-default); box-sizing: border-box; }
  .gf-search:focus { outline: none; border-color: var(--ink-color-global-border-focus-default); box-shadow: 0 0 0 4px var(--ink-color-global-border-focus-light); }
  .gf-check-list { display: flex; flex-direction: column; gap: 10px; margin-top: 12px; }
  .gf-check-row { display: flex; align-items: center; gap: 10px; font: 400 14px/20px Inter,sans-serif; color: var(--ink-color-global-text-default); cursor: pointer; }
  .gf-check-row input { width: 16px; height: 16px; accent-color: var(--ink-color-global-border-active); margin: 0; }
  /* Radio rows reuse the checkbox row's metrics — a breakout is single-select,
     so the control is a radio while the row itself stays identical. */
  .gf-radio-sub { margin: 6px 0 2px 26px; }
  .gf-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 24px; border-top: 1px solid var(--ink-color-global-border-subtle); background: var(--ink-color-global-surface-background-default); }
  .gf-btn { height: 32px; padding: 0 12px; border-radius: 4px; font: 500 12px/18px Inter,sans-serif; border: 1px solid transparent; cursor: pointer; }
  .gf-btn--ghost { background: transparent; color: var(--ink-color-global-text-default); }
  .gf-btn--ghost:hover { background: var(--ink-color-global-surface-lightgray-hover); }
  .gf-btn--primary { background: var(--ink-button-background-color-primary-base-default); color: var(--ink-button-font-color-primary-base); }
  .gf-btn--primary:hover { background: var(--ink-button-background-color-primary-base-hover); }

  /* ── icon rail ── square items, BLACK active with a left mark (not blue — active
       state, not a link) ── */
  .railitem { position: relative; border-radius: ${RADIUS}px; }
  .railitem:hover { background: ${SHADE}; }
  .railitem.active { background: var(--accent-soft); color: ${ACCENT}; }
  .railitem.active::before { content: ""; position: absolute; left: 0; top: 8px; bottom: 8px; width: 2px; background: ${ACCENT}; }

  /* ── left-nav sidebar (Sidebar.jsx) — Ink SideNav's inset left-stripe
     active treatment, not a background wash. box-shadow keeps the icon/label
     from shifting between active and resting. ── */
  .navitem { position: relative; border-radius: ${RADIUS}px; background: transparent; }
  .navitem:hover { background: ${SHADE}; }
  .navitem.active { background: transparent; border: 1px solid transparent !important; box-shadow: inset 3px 0 0 0 ${SIDENAV_STRIPE}; color: ${ACCENT}; }
  .navitem.active:hover { background: ${SHADE}; }
  .addslice:hover { background: ${SHADE} !important; }

  .statcell { transition: background .1s ${EASE}; border-radius: ${RADIUS}px; }
  .statcell:hover { background: ${SHADE}; }
  /* A figure that opens its journal entries. Applied per cell rather than
     per row: on these tables most cells are not clickable, and washing a
     whole row would promise more than it does. */
  /* Washed by the table, not by :hover — the three cells of one figure are
     sibling <td>s, so CSS can only ever reach the one under the cursor. */
  .cellopen.washed { background: ${ROW_HOVER}; }
  /* The cells the open panel is reading. The app's selected language, so it
     cannot be mistaken for the cell under the cursor. */
  .cellopen.held { background: var(--cell-held); }
  .statcell .go { opacity: 0; transition: opacity .1s ${EASE}; }
  .statcell:hover .go { opacity: .5; }

  /* active slice — BLACK wash (active/selected state, not a link) */
  .sliceitem.active { background: var(--accent-soft); border: 1px solid transparent !important; box-shadow: none; color: ${ACCENT}; }
  .sliceitem.active:hover { background: var(--accent-soft); }

  @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }

  /* ── tables — sourced from Ink's components.md's literal .ink-table
       recipe (a vetted vanilla-CSS port of Ink's real NewTable), not derived from
       a general type-scale doc. th: white bg, border-default (medium gray, NOT the
       near-invisible border-subtle) under the header, 500-weight 14px sentence-case
       labels. td: 400-weight 14px. Row hover = gray-30. This superseded an earlier,
       less-precise pass that used 12/13px and a too-light header border. ── */
  table.ledger { width: 100%; border-collapse: collapse; font-size: ${FS.value}px; }
  table.ledger thead tr { border-bottom: 1px solid ${BORDER_DEFAULT}; }
  table.ledger tbody { font-variant-numeric: tabular-nums; }
  table.ledger tbody tr { border-bottom: 1px solid ${LINE}; transition: background .1s ${EASE}; }
  table.ledger tbody tr:last-child { border-bottom: none; }
  table.ledger tbody tr:hover { background: var(--row-hover); }
  table.ledger th { font-size: ${FS.value}px; letter-spacing: normal; text-transform: none; color: ${INK}; font-weight: 500; white-space: nowrap; padding: 9px 12px; }
  table.ledger td { font-weight: 400; padding: 10px 12px; }
  table.ledger th:first-child, table.ledger td:first-child { padding-left: 2px; }
  table.ledger th:last-child, table.ledger td:last-child { padding-right: 2px; }
  table.ledger.sheet th:first-child, table.ledger.sheet td:first-child { padding-left: 20px; }
  table.ledger.sheet th:last-child, table.ledger.sheet td:last-child { padding-right: 20px; }

  /* Cards are flat by default (no static shadow); a subtle elevation shadow appears
     ONLY on hover — matching Entity Map's node-card treatment. Never make this
     always-on. */
  .card { background: ${CARD}; border: 1px solid ${LINE}; border-radius: ${RADIUS}px; box-shadow: none; }
  .card:hover { box-shadow: var(--shadow-hover); }
  .panel { background: ${SIDE}; border: 1px solid ${LINE}; border-radius: ${RADIUS}px; box-shadow: none; }
  .panel:hover { box-shadow: var(--shadow-hover); }

  /* Floating slot for the sticky-header clone (BudgetActualsOutline.jsx's
     useStickyHeader, ported from carta-fund-modeling's ui/table.jsx). The
     clone itself is real React markup portaled to document.body, not a
     cloneNode() — this rule is just its fixed, clipped viewport. */
  .sticky-clone-slot { position: fixed; z-index: 30; overflow: hidden; }

  /* ── Ink charts (ui/components.jsx's InkLineChart / InkBarChart) ──────────
     Ported from Ink's charts.md. That contract inlines its own token
     block since a skill card can't link a stylesheet; this app already
     links one (ui/tokens.css), so these rules reference it directly. */
  .ink-chart { position: relative; }
  .ink-chart__title {
    font: 500 14px/24px ${SANS};
    color: ${INK};
    margin: 0;
  }
  .ink-chart__sub {
    font: 400 12px/20px ${SANS};
    color: ${FAINT};
    margin: 0 0 12px;
  }
  /* Title+sub in a left column, a filter or picker in its own right column —
     for charts whose header carries an interactive control. The text
     column shrinks and wraps rather than running under the control. */
  .ink-chart__header-row {
    display: flex; align-items: flex-start; justify-content: space-between;
    gap: 16px; flex-wrap: nowrap;
  }
  .ink-chart__header-text { flex: 1 1 auto; min-width: 0; }
  .ink-chart__header-control { flex: 0 0 auto; }
  .ink-chart__plot { position: relative; }
  .ink-chart__plot svg { display: block; }
  .ink-chart__dots rect { fill: var(--ink-color-global-border-subtle); }
  /* Headline: the number is the answer, the plot is the context. Label,
     value and delta read as one block — only the type's own leading sits
     between them, per charts.md's "stacked text needs no margin" rule. */
  .ink-chart__headline { margin: 0; }
  .ink-chart__headline .ink-chart__title { margin-bottom: 0; }
  .ink-chart__headline-row {
    display: flex; align-items: baseline;
    gap: 8px;
  }
  .ink-chart__headline-value {
    font: 600 20px/28px ${SANS};
    font-variant-numeric: tabular-nums;
    color: ${INK};
  }
  .ink-chart__headline-delta {
    font: 500 12px/20px ${SANS};
    font-variant-numeric: tabular-nums;
  }
  .ink-num--positive { color: ${GREEN}; }
  .ink-num--negative { color: ${RED}; }
  .ink-chart__series-label { font: 500 12px ${SANS}; }
  .ink-chart__reference {
    stroke: var(--ink-color-global-border-default);
    stroke-width: 1px;
    stroke-dasharray: 4 4;
  }
  .ink-chart__reference-label { font: 400 12px ${SANS}; fill: ${FAINT}; }
  .ink-chart__axis { font: 400 12px ${SANS}; fill: ${FAINT}; }
  /* Always-computed, hidden on screen — the hover tooltip already shows the
     value. The HTML export reveals these instead, since exported charts
     have no hover behind them. */
  .ink-chart__value-label { display: none; font: 500 11px ${SANS}; fill: ${INK}; }
  .ink-chart__axis-line, .ink-chart__tick {
    stroke: var(--ink-color-global-border-default); stroke-width: 1px;
  }
  .ink-chart__cross { stroke: var(--ink-color-global-border-default); stroke-width: 1px; opacity: 0; }
  .ink-chart__mark { opacity: 0; }
  /* Provisional (in-progress period): dashed on a line, hatched on a bar —
     never opacity, which is already spoken for by hover-dim. */
  .ink-chart__provisional { stroke-dasharray: 5 3; }
  .ink-chart.is-hovering .ink-chart__cross,
  .ink-chart.is-hovering .ink-chart__mark { opacity: 1; }
  .ink-chart.is-hovering .ink-chart__col.is-dim,
  .ink-chart.is-hovering .ink-chart__bar.is-dim { opacity: .38; }
  @media (prefers-reduced-motion: no-preference) {
    .ink-chart__cross, .ink-chart__mark, .ink-chart__tip { transition: opacity 80ms ease-out; }
  }
  .ink-chart__tip {
    position: absolute; left: 0; top: 0;
    transform: translate(-50%, calc(-100% - 8px));
    pointer-events: none; opacity: 0;
    background: ${PAPER};
    border: 1px solid ${LINE};
    border-radius: var(--ink-size-global-radius-subtle);
    padding: 8px 12px;
    font: 400 12px/20px ${SANS};
    color: ${INK};
    white-space: nowrap; z-index: 2;
  }
  .ink-chart.is-hovering .ink-chart__tip { opacity: 1; }
  .ink-chart__tip.is-below { transform: translate(-50%, 8px); }
  .ink-chart__tip--compact { padding: 4px 8px; }
  .ink-chart__tip-head { font-weight: 600; margin-bottom: 0; }
  .ink-chart__tip-total {
    display: flex; align-items: center; gap: 8px;
    padding-top: 4px; margin-top: 4px;
    border-top: 1px solid ${LINE};
    font-weight: 600;
  }
  .ink-chart__tip-row, .ink-chart__tip-compact { display: flex; align-items: center; gap: 8px; }
  .ink-chart__tip-sw {
    width: 10px; height: 10px; flex: 0 0 10px;
    border-radius: var(--ink-size-global-radius-flat);
  }
  .ink-chart__tip-name { color: ${FAINT}; }
  .ink-chart__tip-val, .ink-chart__tip-total .ink-chart__tip-val {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .ink-chart__tip-compact .ink-chart__tip-val { margin-left: 12px; }
  .ink-chart__legend {
    display: flex; flex-wrap: wrap;
    gap: 16px;
    margin: 12px 0 0;
    padding: 0;
    list-style: none;
  }
  .ink-chart__legend li {
    display: inline-flex; align-items: center;
    gap: 8px;
    font: 400 12px/20px ${SANS};
    color: ${FAINT};
  }
  .ink-chart__legend-sw {
    width: 10px; height: 10px; flex: 0 0 10px;
    border-radius: var(--ink-size-global-radius-flat);
  }
  .ink-chart__legend-sw--rule { height: 0; border-top: 1px dashed var(--ink-color-global-border-default); }
  .ink-chart__bar, .ink-chart__col path, .ink-chart__col rect { cursor: default; }
  .ink-chart--clickable .ink-chart__bar,
  .ink-chart--clickable .ink-chart__col { cursor: pointer; }
`;
