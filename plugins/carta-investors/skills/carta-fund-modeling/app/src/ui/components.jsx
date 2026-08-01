import { useState, useEffect, useRef, forwardRef } from "react";
import { createPortal } from "react-dom";
import { FS, SANS, serif, tightSans, sans, mono, MICRO, NOTICE, NOTICE_TINT, EASE, GRAD_DARK, EYEBROW_TRACKING } from "./theme.js";

// SVG/text fontFamily attributes need a plain string (not a style object) —
// reuse theme.js's own SANS constant rather than hand-duplicating it.
const SANS_STACK = SANS;

/** Dismiss-on-outside-click + Escape for a popover/menu. Pass the open flag, the
 *  useState setter, and a ref (or array of refs) covering every element a click
 *  inside should NOT dismiss; while `open`, a mousedown outside all of them or an
 *  Escape keypress calls `setOpen(false)`. The single source for what used to be
 *  copy-pasted in FundPicker, MultiFundPicker, App's UpdateDataButton, and
 *  Companies' ResetMenu. Accepts multiple refs so a popover portaled to
 *  document.body (outside its trigger's own DOM subtree, e.g. GlobalFilter) can
 *  pass both its trigger ref and its portaled panel ref instead of hand-rolling
 *  the same listener pair inline. */
export function useDismissable(open, setOpen, refs) {
  useEffect(() => {
    if (!open) return;
    const refList = Array.isArray(refs) ? refs : [refs];
    const onDoc = (e) => { if (!refList.some((r) => r.current && r.current.contains(e.target))) setOpen(false); };
    const onEsc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onEsc); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- setOpen/refs are stable
}

/** Hairline SF-style icons — consistent stroke, no emoji anywhere. */
const icon = (paths) => ({ size = 14, strokeWidth = 1.8, style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none", display: "block", ...style }}>
    {paths.map((d, i) => <path key={i} d={d} />)}
  </svg>
);
/** Config-driven brand monogram — no shipped logo asset. Reads snapshot.branding.mark
 *  ({ text, bg, fg }); falls back to a neutral dot so the loading state still renders. */
export function Mark({ branding, size = 30, style }) {
  const m = branding?.mark || {};
  const text = (m.text ?? "·").slice(0, 3);
  const fontSize = text.length >= 3 ? 20 : text.length === 2 ? 25 : 32;
  // Monochrome by design — the Swiss shell ignores per-firm brand colors so the
  // mark reads as a sharp near-black tile (inverts cleanly in dark mode).
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" style={{ display: "block", ...style }} aria-hidden>
      <rect width="64" height="64" rx="3" style={{ fill: "var(--ink-color-global-text-default)" }} />
      <text x="32" y="43" textAnchor="middle" fontFamily={SANS_STACK}
        fontSize={fontSize} fontWeight="700" letterSpacing="-1" style={{ fill: "var(--ink-color-global-surface-background-default)" }}>{text}</text>
    </svg>
  );
}
export const LockIcon = icon(["M5.5 11h13a1 1 0 011 1v8a1 1 0 01-1 1h-13a1 1 0 01-1-1v-8a1 1 0 011-1z", "M8 11V7.5a4 4 0 018 0V11"]);
export const ChevronIcon = icon(["M9 6l6 6-6 6"]);
// Ink's Dropdown.Trigger caret — a real chevron-down (not the right-chevron
// rotated 90°), static since this app's popovers always open downward. Ink
// only rotates this for an upward (top-*) placement, which fund-modeling's
// popovers never use.
export const ChevronDownIcon = icon(["M6 9l6 6 6-6"]);
export const SearchIcon = icon(["M3 11a8 8 0 1 0 16 0a8 8 0 1 0 -16 0", "M21 21l-4.35-4.35"]);
export const RefreshIcon = icon(["M21 12a9 9 0 11-2.6-6.4", "M21 3v6h-6"]);
export const PrintIcon = icon(["M6 9V3h12v6", "M6 17H4a2 2 0 01-2-2v-4a2 2 0 012-2h16a2 2 0 012 2v4a2 2 0 01-2 2h-2", "M6 13h12v8H6z"]);
export const SunIcon = icon(["M12 17a5 5 0 100-10 5 5 0 000 10z", "M12 1v2", "M12 21v2", "M4.2 4.2l1.4 1.4", "M18.4 18.4l1.4 1.4", "M1 12h2", "M21 12h2", "M4.2 19.8l1.4-1.4", "M18.4 5.6l1.4-1.4"]);
export const MoonIcon = icon(["M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"]);
export const SwitchIcon = icon(["M16 3l4 4-4 4", "M20 7H8a4 4 0 00-4 4v1", "M8 21l-4-4 4-4", "M4 17h12a4 4 0 004-4v-1"]);
// Chat rail toggle — a single-stroke speech bubble with a tail, matching the
// stroked-outline weight of the other topbar glyphs (no fill, no emoji).
export const ChatIcon = icon(["M21 11.5a8.5 8.5 0 01-8.5 8.5H8l-4 3v-4.6A8.5 8.5 0 1121 11.5z"]);
export const CloseIcon = icon(["M18 6L6 18", "M6 6l12 12"]);
// Solid delta-direction triangle — the plain Unicode glyph, matching the
// design spec's delta caret exactly, same as Overview.jsx's own fund
// table/NAV-chart delta carets. Centralized so every vs-baseline/vs-prior
// delta (sidebar, Firm metrics, Companies rows, Overview) shares one glyph
// instead of drifting into separate one-off shapes.
export const DeltaCaret = ({ up }) => (
  <span aria-hidden="true" style={{ fontSize: FS.micro, lineHeight: 1 }}>{up ? "▲" : "▼"}</span>
);
// Info/help glyph — needs a circle + dot the shared `icon()` factory (paths-only)
// can't express, so it's hand-rolled like `Mark` above rather than forced through it.
export const HelpCircleIcon = ({ size = 14, strokeWidth = 1.8, style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none", display: "block", ...style }}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 2.2-2.4 3.7" />
    <path d="M12 17.5h.01" />
  </svg>
);

export const Eyebrow = ({ children, color = "var(--ink-color-global-text-subtle)", style }) => (
  <div style={{ ...sans, fontSize: FS.micro, letterSpacing: EYEBROW_TRACKING, textTransform: "uppercase", color, fontWeight: 600, ...style }}>
    {children}
  </div>
);

/** Real top-of-page title — one per view (Firm Overview, Companies, GP Economics,
 *  etc.), matching Ink's actual `heading-1` convention: confirmed against Ink's
 *  live `Page.Header`/`Heading variant="heading-1"` component, real fund-admin's
 *  frontend (128 page-level uses of `heading-1`, vs. `heading-2` reserved for
 *  in-page sub-sections), and this marketplace's own `carta-home-build` welcome
 *  artifact's `.page-title` (SangBleu, 28px/48px, weight 400). Renders the real
 *  `serif` stack (theme.js) — SangBleu Versailles, falling back to Georgia since
 *  this app never loads the webfont — not the tight-tracked-sans `tightSans`
 *  used elsewhere for brand wordmarks/hero numbers. `fontWeight: 400` matches
 *  Ink exactly — Georgia only has two real weights (400/700; there's no native
 *  500/600 face, so a request for anything between just falls back to 400
 *  anyway), so 400 costs nothing and removes a divergence. `lineHeight: 1.1`
 *  matches this app's other `FS.display` uses (hero numbers) instead of Ink's
 *  literal 48px leading, which reads as excessive whitespace at this app's
 *  density. */
const HEADING1_STYLE = { ...serif, fontSize: FS.display, fontWeight: 400, lineHeight: 1.1, color: "var(--ink-color-global-text-default)" };

export const H1 = ({ children, right, actions, id }) => (
  <div id={id} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12, gap: 12, flexWrap: "wrap", scrollMarginTop: 20 }}>
    <h1 style={{ ...HEADING1_STYLE, margin: 0 }}>{children}</h1>
    <span style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
      {right && <span style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)" }}>{right}</span>}
      {actions}
    </span>
  </div>
);

/** Ink's real Heading 2 — 20px/36/500, sans, sentence case, text-default — per
 *  tokens.css's `heading-2-desktop` spec. Both `Heading2` (plain block) and `H2`
 *  (in-page section header with a `right`/`actions` slot, e.g. "GP returns"
 *  inside the GP Economics page) render this exact style; they differ only in
 *  layout, not typography, so a correction to one spec updates both. `H2` is
 *  ONE LEVEL BELOW the real page title — see `H1` above — matching real
 *  fund-admin's own heading-2 usage for in-page/sub-flow headings rather than
 *  top-of-route titles. */
const HEADING2_STYLE = { ...sans, fontSize: FS.h2, lineHeight: "36px", fontWeight: 500, color: "var(--ink-color-global-text-default)" };

export const Heading2 = ({ children, style }) => (
  <div style={{ ...HEADING2_STYLE, ...style }}>
    {children}
  </div>
);

export const H2 = ({ children, right, actions, id }) => (
  <div id={id} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12, gap: 12, flexWrap: "wrap", scrollMarginTop: 20 }}>
    <h2 style={{ ...HEADING2_STYLE, margin: 0 }}>{children}</h2>
    <span style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
      {right && <span style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)" }}>{right}</span>}
      {actions}
    </span>
  </div>
);

/** Card/section title, one tier below `H2` — matches Ink's real Heading 3 exactly:
 *  16px/28px leading/weight 500, sans (`--ink-font-global-family-base`), same as
 *  `H2`'s exact-match treatment. Was copy-pasted identically at ~17 call sites
 *  across every view; centralizing means a future spec correction is a one-file
 *  fix instead of a repeat grep-and-replace sweep — same reasoning that produced
 *  `H2`/`Eyebrow`/`MethodNote`/`SourceNote` below. `as` picks the wrapper tag
 *  (default `span`, pass `as="div"` for a title that needs its own block/margin). */
export const H3 = ({ children, style, as = "span" }) => {
  const Tag = as;
  return <Tag style={{ ...sans, fontSize: FS.h3, lineHeight: "28px", fontWeight: 500, color: "var(--ink-color-global-text-default)", ...style }}>{children}</Tag>;
};

/** Methodology line — sits at the TOP of a block, directly under the H2 title.
 *  Summarizes how the figures below are computed. Pair with <SourceNote> at the
 *  bottom for "source + as of". Standard across every view. */
export const MethodNote = ({ children, style }) => (
  <p style={{ ...sans, fontSize: FS.body, color: "var(--ink-color-global-text-subtle)", lineHeight: 1.55, margin: "-4px 0 16px", maxWidth: 920, ...style }}>
    {children}
  </p>
);

/** Source / footnote line — sits at the BOTTOM of a chart or table. Pass the
 *  data source + any methodology caveats as children. The `asOf` prop is accepted
 *  but no longer rendered: the data date is always shown in the sidebar's
 *  DataStatus, so repeating it on every card is redundant. */
export const SourceNote = ({ children, style }) => (
  <p style={{ ...sans, fontSize: FS.micro, color: "var(--ink-color-global-text-subtle)", lineHeight: 1.6, margin: "10px 0 0", maxWidth: 920, ...style }}>
    {children}
  </p>
);

/** Sticky in-page section nav — chips that scroll to each section and highlight
 *  the one in view. `sections` is an array of `[id, label]`; each target block
 *  should be `<section id="…" style={{ scrollMarginTop: 64 }}>`. Shared across
 *  every multi-section tab. */
export function SectionChips({ sections }) {
  const [active, setActive] = useState(sections[0]?.[0]);
  const ids = sections.map((s) => s[0]).join(",");
  useEffect(() => {
    const els = sections.map(([id]) => document.getElementById(id)).filter(Boolean);
    if (typeof IntersectionObserver === "undefined" || !els.length) return;
    const obs = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
      if (vis[0]) setActive(vis[0].target.id);
    }, { rootMargin: "-45% 0px -50% 0px", threshold: [0, 0.1, 0.5, 1] });
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [ids]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (id) => { const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); };
  return (
    <div style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--ink-color-global-surface-background-default)", padding: "2px 0 0", marginBottom: 18,
      display: "flex", gap: 22, flexWrap: "wrap", borderBottom: `1px solid var(--ink-color-global-border-subtle)` }}>
      {sections.map(([id, label]) => {
        const on = active === id;
        return (
          <button key={id} onClick={() => go(id)}
            style={{ ...sans, fontSize: FS.bodyLg, fontWeight: on ? 650 : 500, padding: "8px 2px 10px", marginBottom: -1,
              border: "none", borderBottom: `2px solid ${on ? "var(--ink-color-global-text-default)" : "transparent"}`, borderRadius: 0, cursor: "pointer",
              background: "transparent", color: on ? "var(--ink-color-global-text-default)" : "var(--ink-color-global-text-subtle)", whiteSpace: "nowrap" }}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

// Animated number — eases toward target; respects reduced motion
export function useAnimated(target) {
  const [val, setVal] = useState(target);
  const raf = useRef(null);
  const reduced = useRef(
    typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  useEffect(() => {
    if (target == null || !isFinite(target)) { setVal(target); return; }
    if (reduced.current || (typeof document !== "undefined" && document.hidden)) { setVal(target); return; }
    cancelAnimationFrame(raf.current);
    const start = performance.now(), from = isFinite(val) ? val : target, dur = 320;
    const tick = (t) => {
      const k = Math.min(1, (t - start) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      setVal(from + (target - from) * e);
      if (k < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    // rAF stalls when the window is occluded — guarantee we land on target
    const settle = setTimeout(() => { cancelAnimationFrame(raf.current); setVal(target); }, dur + 140);
    return () => { clearTimeout(settle); cancelAnimationFrame(raf.current); };
  }, [target]); // eslint-disable-line
  return val;
}

export const Num = ({ value, fmt, style }) => {
  const v = useAnimated(value);
  return <span style={{ fontVariantNumeric: "tabular-nums", ...style }}>{fmt(v)}</span>;
};

/** iOS-style switch. `disabled` is truly inert; `locked` keeps the control
 *  interactive-but-muted so the click still fires onChange — the parent's setter
 *  then no-ops and surfaces a "read-only" warning (used on the Baseline scenario). */
export function Toggle({ checked, onChange, labels = ["On", "Off"], disabled, locked, small, title }) {
  const muted = disabled || locked;
  // `small` = a denser switch for tight control clusters (fund-modeling scenario toggles)
  const tw = small ? 30 : 38, th = small ? 18 : 22, kn = small ? 14 : 18;
  return (
    <button
      onClick={(e) => { e.stopPropagation(); if (!disabled) onChange(!checked); }}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      title={muted ? "Locked — duplicate into a scenario to edit" : title}
      style={{ ...sans, display: "inline-flex", alignItems: "center", gap: small ? 6 : 8, fontSize: small ? FS.small : FS.body, fontWeight: 500,
        border: "none", background: "transparent", color: checked ? "var(--ink-color-global-text-default)" : "var(--ink-color-global-text-subtle)",
        cursor: locked ? "not-allowed" : disabled ? "default" : "pointer", opacity: muted ? 0.45 : 1, padding: 0, whiteSpace: "nowrap" }}
    >
      <span style={{ position: "relative", width: tw, height: th, borderRadius: th / 2, flex: "none",
        background: checked ? "var(--ink-button-background-color-primary-base-default)" : "var(--track)", transition: `background .1s ${EASE}` }}>
        <span style={{ position: "absolute", top: 2, left: checked ? tw - kn - 2 : 2, width: kn, height: kn, borderRadius: kn / 2,
          background: "var(--ink-color-global-surface-background-default)", transition: `left .1s ${EASE}` }} />
      </span>
      {checked ? labels[0] : labels[1]}
    </button>
  );
}

// `disabled` is truly inert; `locked` keeps the button clickable-but-muted so its
// onClick still fires (the parent setter no-ops + warns on a read-only scenario).
// `kind="link"` is chromeless inline text (no border/bg/fixed height) — the
// single source for the app's ~8 hand-rolled "See positions ▾"/"Edit Waterfall"/
// "Select all"-style buttons. Its fontSize/color still come through the trailing
// `style` spread, so callers keep their own size (bodyLg/small/body) and can mute
// the color (e.g. "Revert to Carta configuration") same as before.
/** The Companies filter ribbon's shared 36px/12px/14px chrome — Dropdown's trigger,
 *  SearchInput, and Btn's `size="toolbar"` variant below all read from this ONE
 *  object, so a new ribbon control can't quietly drift on height/padding/font the
 *  way the Filters/Reset buttons once did (they were hand-tuned per call site
 *  before landing here — height and font-size got copied, padding didn't). */
const TOOLBAR_CONTROL_STYLE = { height: 36, padding: "0 12px", fontSize: 14, lineHeight: "20px" };
export const Btn = forwardRef(({ children, onClick, kind = "ghost", size = "small", style, disabled, locked, title, className, ...rest }, ref) => {
  const isLink = kind === "link";
  // `title`/`className` are destructured out (not left in `rest`) so a caller
  // that passes either can never silently clobber the locked-state tooltip or
  // the kind-based chrome via JSX's later-attribute-wins spread order — the
  // computed and caller-supplied values are merged explicitly instead.
  const kindClassName = kind === "primary" ? "btn-primary" : isLink ? undefined : "btn-ghost";
  // `size="small"` (default) is Ink's real small-button recipe (32px, 0 7px).
  // `size="comfortable"` restores this app's
  // pre-Ink-match auto-height/8px-16px look for contexts a 32px pill reads as
  // cramped in (modal dialogs) — was hand-rolled as an identical inline style
  // override at ConfirmDialog's and ScenarioDialog's 4 Btn call sites; use the
  // prop instead of re-deriving the override at a new call site. `size="toolbar"`
  // is for a Btn sitting in the Companies filter ribbon alongside Dropdown/
  // SearchInput controls — see TOOLBAR_CONTROL_STYLE above.
  const nonLinkBase = { borderRadius: 4, border: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
    background: kind === "primary" ? GRAD_DARK : "var(--ink-color-global-surface-background-default)" };
  return (
    <button
      ref={ref}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={className ? [kindClassName, className].filter(Boolean).join(" ") : kindClassName}
      title={locked ? "Locked — duplicate into a scenario to edit" : title}
      {...rest}
      style={{
        ...sans, fontSize: FS.body, fontWeight: isLink ? 600 : 500,
        cursor: locked ? "not-allowed" : disabled ? "default" : "pointer",
        boxShadow: "none",
        opacity: disabled || locked ? 0.45 : 1,
        whiteSpace: "nowrap",
        ...(isLink
          ? { height: "auto", padding: 0, borderRadius: 0, border: "none", background: "none" }
          : size === "comfortable"
          ? { ...nonLinkBase, height: "auto", padding: "8px 16px" }
          : size === "toolbar"
          ? { ...nonLinkBase, ...TOOLBAR_CONTROL_STYLE }
          : { ...nonLinkBase, height: 32, padding: "0 7px" }),
        color: isLink ? "var(--ink-color-global-link-default)"
          : kind === "primary" ? "var(--grad-dark-text)"
          : kind === "danger" ? "var(--ink-color-global-feedback-negative-strong)"
          : "var(--ink-color-global-text-default)",
        ...style,
      }}
    >
      {children}
    </button>
  );
});

/** Segmented control — Ink's ButtonGroup recipe: a bordered container, segments
 *  share 1px hairline dividers, selected segment
 *  is a primary-button fill (black/white text, inverting in dark mode). CSS
 *  lives in theme.js (.seg-group/.seg-btn) — the per-segment hover/selected
 *  border-overlap and divider suppression need real :hover/:has(), not
 *  achievable with inline styles alone.
 *  `disabled` is truly inert (real HTML disabled, Ink's disabled-group
 *  colors); `locked` keeps it clickable-but-muted (dimmed, not-allowed
 *  cursor) so the click still fires onChange — the parent setter then
 *  no-ops + warns (used on the read-only Baseline scenario). */
export function Segmented({ options, value, onChange, small, disabled, locked }) {
  const muted = disabled || locked;
  return (
    <div className={`seg-group${small ? " is-sm" : ""}${disabled ? " is-disabled" : ""}`} role="group"
      style={{ opacity: muted ? 0.5 : 1 }}>
      {options.map((o) => {
        const opt = typeof o === "string" ? { id: o, label: o } : o;
        const on = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            className={`seg-btn${on ? " is-selected" : ""}`}
            onClick={() => { if (!disabled) onChange(opt.id); }}
            disabled={disabled}
            aria-pressed={on}
            title={muted ? "Locked — duplicate into a scenario to edit" : undefined}
            style={{ ...sans, cursor: locked ? "not-allowed" : disabled ? "default" : "pointer" }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** Fund scope dropdown — "All Funds" plus one entry per fund (names, not ids).
 *  Replaces the overflowing per-view segmented strips. `value` is "ALL" or a
 *  fund id; options come from snapshot.funds. Custom menu (not native select)
 *  so 18 long fund names render cleanly and theme in dark mode. */
export const ALL_FUNDS = "ALL";

/** The fund display name embeds an ALL-CAPS slug prefix for dense tables
 *  ("KRAKATOA-VENTURES-FUND-IV-L-P (Krakatoa Ventures Fund IV, 2021)"). The
 *  picker only needs the readable, already-title-cased part — strip the slug
 *  and surface "Krakatoa Ventures Fund IV (2021)". Falls back to the raw label
 *  (e.g. "All Funds") when there's no parenthetical. */
export function fundLabel(s) {
  if (!s) return s;
  const m = s.match(/\(([^)]+)\)\s*$/);
  if (!m) return s;
  const inner = m[1];
  const i = inner.lastIndexOf(", ");
  if (i === -1) return inner;
  const name = inner.slice(0, i), vintage = inner.slice(i + 2);
  return /^\d{4}$/.test(vintage) ? `${name} (${vintage})` : name;
}

/** fundLabel() with the trailing "(vintage)" stripped too — for views that
 *  already show vintage in its own column/line (Overview's Vintage column,
 *  CohortStanding's "2022 · 41 funds in cohort" line) and would otherwise
 *  show it twice. */
export function fundNameOnly(s) {
  return fundLabel(s)?.replace(/\s*\(\d{4}\)$/, "");
}

/** A single row inside a dropdown/menu popover — Ink's Dropdown.Button /
 *  Dropdown.Checkbox recipe (single-select: 14px/20px Inter, 8px/12px padding;
 *  multi-select checkbox rows: 14px/24px Inter, 6px/12px padding — see `dense`).
 *  The shared recipe behind FundPicker's/MultiFundPicker's option rows and
 *  Companies' ResetMenu items. Hover highlight is CSS-driven (`.menu-item:hover`)
 *  so every menu gets the same feedback without each caller wiring its own
 *  onMouseEnter/onMouseLeave.
 *  Text is always weight 400 / full `text-default`, regardless of hover,
 *  selected, or checked state — confirmed against Ink's real Dropdown.Item
 *  component: every state variant (Default/Hover/Keyboard-focus/Disabled for
 *  Checkbox/Radio/Text) renders Regular weight; only the transient mouse-down
 *  state bumps to Medium/500, unrelated to selection. Ink conveys checked/
 *  selected state entirely via the checkbox/radio glyph — never bold, never a
 *  dimmed label.
 *  `dense` switches to the multi-select checkbox-row metrics (6px vertical
 *  padding, 24px line-height, no fixed min-height) instead of the
 *  single-select default (8px padding, 20px line-height, 36px min-height).
 *  `selected` only affects the checkmark and the optional row tint — not
 *  weight. `tint` (defaults to `selected`) washes the row background with
 *  the same lightgray-hover tint hover uses (Ink: selected and hover share
 *  one tint) — set `tint={false}` for a checkbox-style list where checked
 *  state is conveyed by the leading checkbox, not a row tint
 *  (MultiFundPicker). `checkmark` renders Ink's trailing check glyph when
 *  the row is the current single-select value (a composition on top of
 *  the real Ink primitives — Ink's raw Text-type Dropdown.Item has no
 *  built-in "this is the selected one" state of its own).
 *  `leading` renders before the label (a checkbox/color swatch). */
export function MenuItem({ children, onClick, selected, tint = selected, checkmark, dense, leading, style, role = "option" }) {
  return (
    <button role={role} aria-selected={role === "option" ? selected : undefined} onClick={onClick} className="menu-item"
      style={{ ...sans, display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", whiteSpace: "nowrap",
        padding: dense ? "6px 12px" : "8px 12px", minHeight: dense ? undefined : 36, border: "none", borderRadius: 4, cursor: "pointer",
        boxSizing: "border-box", fontSize: 14, lineHeight: dense ? "24px" : "20px", fontWeight: 400,
        color: "var(--ink-color-global-text-default)",
        background: tint ? "var(--ink-color-global-surface-lightgray-hover)" : "transparent",
        ...style }}>
      {leading}
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{children}</span>
      {checkmark && selected && (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden style={{ flex: "none", color: "var(--ink-color-global-text-default)" }}>
          <path d="M2.5 7.5l3 3 6-7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

/** Shared Ink Dropdown.Trigger chrome (36px, border-default, hover/open-focus
 *  glow via the `.dd-trigger` class) — single source for both the generic
 *  single-select `Dropdown` and `MultiFundPicker` below, so the two triggers
 *  can't drift out of sync (they're both Ink Dropdown variants and should
 *  look identical at rest). Reads TOOLBAR_CONTROL_STYLE (defined above, next
 *  to Btn) for height/padding/font — the same object Btn's `size="toolbar"`
 *  reads, so a Dropdown and a Btn sitting in the same ribbon can't drift.
 *  `extra` merges in per-caller sizing (e.g. Dropdown's minWidth/maxWidth). */
const ddTriggerStyle = (extra) => ({
  ...sans, display: "inline-flex", alignItems: "center", justifyContent: "space-between", gap: 8,
  ...TOOLBAR_CONTROL_STYLE, boxSizing: "border-box", border: `1px solid var(--ink-color-global-border-default)`,
  borderRadius: 4, background: "var(--ink-color-global-surface-background-default)",
  color: "var(--ink-color-global-text-default)", cursor: "pointer", fontWeight: 500,
  ...extra,
});

/** Ink's real dropdown/menu popover elevation (two-layer shadow, 6px radius) —
 *  single source for Dropdown's popover below and ResetMenu's (Companies.jsx),
 *  so every "click a trigger, see a small menu" popover in the app stays
 *  visually identical instead of hand-rolling a close-but-not-quite shadow. */
export const POPOVER_SHADOW = "0 8px 24px rgba(20,24,24,.12), 0 2px 6px rgba(20,24,24,.08)";

/** Ink's Dropdown compound component (Trigger + Box + Button), single-select.
 *  Generic: knows nothing
 *  about funds. `options` is `[{id, label, separatorBefore?}]`; a
 *  `separatorBefore: true` option gets a hairline divider above it (e.g. an
 *  "All ___" option separated from the real list below it — see FundPicker).
 *  `value`/`onChange` behave like a native select. `minWidth`/`maxWidth` size
 *  the trigger (and the popover, which matches the trigger's width).
 *  `triggerLabel` prefixes the trigger text as "{triggerLabel}: {value}" (a
 *  self-labeling trigger, per Carta's dropdown convention, instead of a
 *  separate uppercase label row above the control) — the popover's own
 *  option rows are unaffected. `nullLabel` renders in place of an option
 *  label when `value` is `null`/doesn't match any option (a "Mixed" state
 *  across a scope with no single current value) instead of silently
 *  falling back to the first option. `locked` matches the app's other
 *  controls (Segmented, Btn): clickable-but-dimmed with a "duplicate into a
 *  scenario to edit" tooltip — it's a visual cue only, since the actual
 *  write-guard lives in the `onChange` callback's own `updateSlice`. */
export function Dropdown({ options, value, onChange, minWidth = 260, maxWidth = 460, testId, triggerLabel, nullLabel, locked }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useDismissable(open, setOpen, ref);

  const current = value != null ? options.find((o) => o.id === value) : undefined;
  const label = current ? current.label : (nullLabel ?? options[0]?.label);

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block", opacity: locked ? 0.45 : 1 }}>
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} data-testid={testId}
        className={`dd-trigger${open ? " is-open" : ""}`}
        title={locked ? "Locked — duplicate into a scenario to edit" : undefined}
        style={{ ...ddTriggerStyle({ minWidth, maxWidth }), cursor: locked ? "not-allowed" : "pointer" }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{triggerLabel ? `${triggerLabel}: ${label}` : label}</span>
        <ChevronDownIcon size={16} strokeWidth={1.5} style={{ flex: "none" }} />
      </button>
      {open && (
        <div className="popin" role="listbox" style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, minWidth: "100%",
          maxHeight: 340, overflowY: "auto", background: "var(--ink-color-global-surface-background-default)", border: `1px solid var(--ink-color-global-border-subtle)`, borderRadius: 6,
          boxShadow: POPOVER_SHADOW, zIndex: 50, padding: "4px 0", transformOrigin: "top left" }}>
          {options.map((o) => {
            const on = o.id === value;
            return (
              <MenuItem key={o.id} onClick={() => { onChange(o.id); setOpen(false); }} selected={on} checkmark
                style={{ borderTop: o.separatorBefore ? `1px solid var(--ink-color-global-border-subtle)` : "none",
                  marginTop: o.separatorBefore ? 4 : 0, paddingTop: o.separatorBefore ? 10 : 8 }}>
                {o.label}
              </MenuItem>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Fund-scope single-select — "All Funds" plus one entry per fund (names, not
 *  ids). A thin fund-domain wrapper around the generic `Dropdown` above:
 *  builds the option list (with the "All Funds" divider) and hands it off. */
export function FundPicker({ funds, value, onChange, allLabel = "All Funds", includeAll = true }) {
  const opts = [
    ...(includeAll ? [{ id: ALL_FUNDS, label: allLabel }] : []),
    ...funds.map((f, i) => ({ id: f.id, label: fundLabel(f.name || f.id), separatorBefore: includeAll && i === 0 })),
  ];
  return <Dropdown options={opts} value={value} onChange={onChange} testId="fund-picker" />;
}

/** Multi-select fund dropdown — a checkbox list with a select-all/clear row, used
 *  to filter which funds/entities a chart shows. `selected` is a Set (or array) of
 *  fund ids; `onChange` receives a new Set. Pass `colorOf` (id→hex) to show the
 *  chart's series swatches beside each option. Trigger reads "All funds" /
 *  "N of M funds". */
/** Ink's real 22×22 checkbox glyph for Dropdown.Checkbox rows: a white box
 *  that never fills, border-default border, 4px radius; checked/indeterminate
 *  draw a glyph on top. Ink's real `NewCheckbox` React component isn't
 *  importable here (micro-apps can't pull in `@carta/ink`), so this
 *  reproduces its visual spec directly. */
function MultiCheckbox({ checked, indeterminate }) {
  return (
    <span aria-hidden style={{ flex: "none", width: 22, height: 22, borderRadius: 4, boxSizing: "border-box",
      border: `1px solid var(--ink-color-global-border-default)`, background: "var(--ink-color-global-surface-background-default)",
      display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
      {checked && (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M3 8.3l3.4 3.4L13 5" stroke="var(--ink-color-global-text-default)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {indeterminate && !checked && (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M3.5 8h9" stroke="var(--ink-color-global-text-default)" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      )}
    </span>
  );
}

/** Multi-select fund dropdown — Ink's Dropdown.Checkbox recipe: 22×22 checkboxes,
 *  14px/24px-line-height rows (6/12 padding — see MenuItem's `dense`), 4px popover
 *  radius, Ink's "elevation/small" single-layer shadow (`0 4px 12px rgba(0,0,0,.08)`)
 *  — a lighter box shadow than the single-select Dropdown's. The trigger is a plain
 *  small `Btn` (Ink's `<Button type="default" size="small">`) rather than the
 *  single-select's boxed field-style trigger.
 *  "Select all" is modeled as Ink's real master-checkbox pattern (a row using
 *  the same 22×22 checkbox, indeterminate when some-but-not-all are checked)
 *  rather than an invented footer link — `NewCheckbox` has a real
 *  `indeterminate` prop for exactly this. `selected` is a Set (or array) of
 *  fund ids; `onChange` receives a new Set. Pass `colorOf` (id→hex) to show
 *  the chart's series swatches beside each option. Trigger reads "All funds" /
 *  "N of M funds". */
export function MultiFundPicker({ funds, selected, onChange, colorOf, label = "funds", align = "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useDismissable(open, setOpen, ref);

  const sel = selected instanceof Set ? selected : new Set(selected || []);
  const ids = funds.map((f) => f.id);
  const nOn = ids.filter((id) => sel.has(id)).length;
  const allOn = nOn === ids.length && ids.length > 0;
  const someOn = nOn > 0 && !allOn;
  const triggerLabel = allOn ? `All ${label}` : nOn === 0 ? `No ${label}` : `${nOn} of ${ids.length} ${label}`;
  const toggle = (id) => { const n = new Set(sel); n.has(id) ? n.delete(id) : n.add(id); onChange(n); };
  const setAll = (on) => onChange(new Set(on ? ids : []));

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      {/* Shares `ddTriggerStyle`/`.dd-trigger` with the single-select Dropdown
          above — multi- and single-select are both Ink Dropdown variants and
          must look identical at rest. */}
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open} data-testid="multi-fund-picker"
        className={`dd-trigger${open ? " is-open" : ""}`}
        style={ddTriggerStyle({ whiteSpace: "nowrap" })}>
        {triggerLabel}
        <ChevronDownIcon size={16} strokeWidth={1.5} style={{ flex: "none" }} />
      </button>
      {open && (
        <div className="popin" role="listbox" aria-multiselectable="true"
          style={{ position: "absolute", top: "calc(100% + 4px)", [align]: 0, minWidth: 240, maxHeight: 320,
            overflowY: "auto", background: "var(--ink-color-global-surface-background-default)", border: `1px solid var(--ink-color-global-border-subtle)`, borderRadius: 4,
            boxShadow: "0 4px 12px rgba(0,0,0,.08)", zIndex: 50, padding: "6px 0" }}>
          <MenuItem onClick={() => setAll(!allOn)} dense tint={false} selected={allOn}
            style={{ borderBottom: `1px solid var(--ink-color-global-border-subtle)`, borderRadius: 0, marginBottom: 4, paddingBottom: 10, fontWeight: 650 }}
            leading={<MultiCheckbox checked={allOn} indeterminate={someOn} />}>
            {allOn ? "Clear all" : "Select all"}
          </MenuItem>
          {funds.map((f) => {
            const on = sel.has(f.id);
            return (
              <MenuItem key={f.id} onClick={() => toggle(f.id)} selected={on} dense tint={false}
                leading={<><MultiCheckbox checked={on} />{colorOf && colorOf[f.id] && <span style={{ flex: "none", width: 9, height: 9, borderRadius: 2, background: colorOf[f.id] }} />}</>}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{fundLabel(f.name || f.id)}</span>
              </MenuItem>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const StaleFlag = ({ markDate, days }) => (
  <span
    title={`Mark dated ${markDate} — ${days} days old; likely conservative`}
    style={{ ...sans, fontSize: FS.small, color: NOTICE, background: NOTICE_TINT,
      border: `1px solid ${NOTICE}`, padding: "2px 8px", borderRadius: 4, fontWeight: 600, whiteSpace: "nowrap" }}
  >
    stale {markDate}
  </span>
);

/** Labelled `.tape` range slider — the single source for the app's planning
 *  "knobs" (fee load, follow-on split, average check, glidepath pacing, waterfall
 *  terms, return-the-fund target). Replaces Reserves' MiniKnob, Glidepath's Knob,
 *  GpEconomics' WaterfallKnob, and PowerLaw's inline range. A header row (label +
 *  formatted value) sits over the track. `.tape` styling lives in theme.js.
 *
 *  Props: label, value, min, max, step, onChange(number), fmt(value)=>string.
 *  Optional — accent (tape fill + default value color; e.g. an AllocBar segment
 *  color), valueColor (override the value-text color), valueSize (default small),
 *  labelKind "subtle" (default) | "strong" (600-weight, default-text label),
 *  fill (0..1 override when the caller drives the fill directly), disabled (inert),
 *  locked (interactive-but-muted — click still fires onChange; parent no-ops+warns),
 *  title, and style (the wrapper — carries per-call flex sizing). */
export function Slider({ label, value, min, max, step, onChange, fmt, accent, valueColor, valueSize = FS.small,
  labelKind = "subtle", fill, disabled, locked, title, style }) {
  const muted = disabled || locked;
  const pct = fill != null
    ? Math.max(0, Math.min(1, fill)) * 100
    : (max > min ? ((value - min) / (max - min)) * 100 : 0);
  const lockedTitle = "Locked — create a scenario to edit";
  return (
    <div style={{ opacity: muted ? 0.6 : 1, ...style }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ ...sans, fontSize: FS.small, fontWeight: labelKind === "strong" ? 600 : 400,
          color: labelKind === "strong" ? "var(--ink-color-global-text-default)" : "var(--ink-color-global-text-subtle)" }}>{label}</span>
        <span style={{ ...mono, fontSize: valueSize, fontWeight: 700, color: valueColor ?? accent ?? "var(--ink-color-global-text-default)" }}>{fmt(value)}</span>
      </div>
      <input className="tape" type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        aria-label={label} title={locked ? lockedTitle : title}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ "--fill": pct + "%", "--tape-accent": accent ?? "var(--ink-color-global-link-default)",
          cursor: locked ? "not-allowed" : disabled ? "default" : "pointer" }} />
    </div>
  );
}

/** Big-figure stat tile — a label, a large value, and an optional sub/delta line.
 *  The single source for the app's ~7 hand-rolled tiles (App's MetricBar,
 *  Overview's SupportStat, Reserves' Big, Glidepath's Tile, LpReturns' scorecard,
 *  GpEconomics' carry/waterfall figures, CohortStanding's StatStrip). Chrome-less
 *  by design — the caller supplies the surrounding card/divider layout; this owns
 *  only the label+value+sub block so the type ramp lives in one place.
 *
 *  Props: label, value (node or string — pass <Num> for an animated figure), sub
 *  (node rendered below, e.g. a vs-baseline delta). Optional — color (value color),
 *  labelPos "top" (label above value — the eyebrow scorecard look) | "bottom"
 *  (value above label — the display-figure look), size "display" (default) | "h3"
 *  (compact), serif (tight-tracked sans display look instead of tabular mono —
 *  see `tightSans` in theme.js; NOT the real serif, which is `H1`-only), labelTone
 *  "eyebrow" (uppercase micro, default for top) | "strong" (600-weight default-text)
 *  | "muted" (micro subtle) | "plain" (12px/400 sentence-case, Ink's real Tile
 *  label style — text-subtle, which is Ink's gray-80 in this app's palette),
 *  align, style. */
export function StatTile({ label, value, sub, color = "var(--ink-color-global-text-default)",
  labelPos = "top", size = "display", serif: useSerif, labelTone, align = "left", style }) {
  const tone = labelTone ?? (labelPos === "top" ? "eyebrow" : "strong");
  const valStyle = useSerif
    ? { ...tightSans, fontSize: size === "h3" ? FS.h3 : FS.display, fontWeight: 700, color, letterSpacing: "0", lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }
    : { ...mono, fontSize: size === "h3" ? FS.h3 : FS.display, fontWeight: 700, color, letterSpacing: "0", lineHeight: 1.05 };
  const labelEl = tone === "eyebrow"
    ? <Eyebrow color={MICRO} style={{ whiteSpace: "nowrap" }}>{label}</Eyebrow>
    : <div style={tone === "muted"
        ? { ...sans, fontSize: FS.micro, color: "var(--ink-color-global-text-subtle)" }
        : tone === "plain"
        ? { ...sans, fontSize: FS.body, fontWeight: 400, color: "var(--ink-color-global-text-subtle)" }
        : { ...sans, fontSize: FS.small, fontWeight: 600, color: "var(--ink-color-global-text-default)" }}>{label}</div>;
  const valueEl = <div style={{ ...valStyle, marginTop: labelPos === "top" ? 6 : 0 }}>{value}</div>;
  const subEl = sub != null && (
    <div style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", marginTop: labelPos === "top" ? 5 : 2 }}>{sub}</div>
  );
  return (
    <div style={{ textAlign: align, ...style }}>
      {labelPos === "top" ? <>{labelEl}{valueEl}{subEl}</> : <>{valueEl}<div style={{ marginTop: 5 }}>{labelEl}{subEl}</div></>}
    </div>
  );
}

/** Bordered "Summary" stat row — the single source for the app's ~5 hand-rolled
 *  headline stat bars (App's MetricBar, Reserves' rv-summary, LpReturns'
 *  lp-scorecard, Glidepath's current-multiples row, GpEconomics' waterfall
 *  preset row), matching Ink's real Tile/Summary pattern (ink.carta.com/
 *  components/Tile): one bordered card, equal-width key-value pairs on a
 *  plain gap (no divider hairlines between them — the design spec has none),
 *  each a big value over its label.
 *
 *  `title` renders as Ink's real Tile header — 20px/500, sentence case,
 *  `text-default` — matching the design spec's "Summary" tile exactly, not the
 *  uppercase eyebrow look used for stat labels below it. `bare` skips the
 *  card border/padding entirely (just
 *  the divided stat row) for callers that already sit inside their own card
 *  (GpEconomics' waterfall config box).
 *
 *  Ink's real order is label-above-value (confirmed in the design spec —
 *  the label sits above its value); StatBar defaults to
 *  `labelPos="top"` to match. `labelTone` defaults to `"plain"` — Ink's real
 *  label is 12px/regular-weight sentence case, NOT the uppercase small-caps
 *  eyebrow look StatTile otherwise defaults to for top-positioned labels.
 *  No card in this bar should render small caps; if a future call site
 *  really wants the eyebrow look it must opt in explicitly.
 *
 *  Ink's Tile has no hover elevation (unlike this app's other `.card`s, which
 *  lift on hover) — the card wrapper below adds `stat-bar` to suppress it
 *  (`.card.stat-bar:hover` in theme.js).
 *
 *  Props: stats (array of StatTile prop objects — label, value, sub, color;
 *  a `key` falls back to `label`), title, bare, style (card/row wrapper),
 *  itemStyle (per-stat override), labelPos/labelTone/serif/size (forwarded
 *  to every StatTile, default "top"/"plain"/true/"display" — a per-stat value
 *  of the same name overrides), basis (each item's flex-basis + min-width in
 *  px, default 150 — tune per call site to match its stat count/label length),
 *  gap (real CSS gap on the row, default 0 — every call site spaces stats via
 *  each StatTile's own padding instead; set `gap` explicitly if a caller
 *  zeroes that padding, e.g. GpEconomics' `bare` waterfall row, so removing
 *  padding doesn't leave stats with no separation at all). */
export function StatBar({ stats, title, bare, style, itemStyle, labelPos = "top", labelTone = "plain", serif = true, size, basis = 150, gap = 0 }) {
  const row = (
    <div style={{ display: "flex", flexWrap: "wrap", gap, ...(bare ? style : undefined) }}>
      {stats.map((s, i) => (
        <StatTile key={s.key ?? s.label ?? i} label={s.label} value={s.value} sub={s.sub} color={s.color}
          labelPos={s.labelPos ?? labelPos} serif={s.serif ?? serif} labelTone={s.labelTone ?? labelTone} size={s.size ?? size}
          style={{ flex: `1 1 ${basis}px`, minWidth: basis, padding: "0 20px", ...itemStyle }} />
      ))}
    </div>
  );
  if (bare) return row;
  return (
    <div className="card stat-bar" style={{ padding: "18px 8px", ...style }}>
      {title && <Heading2 style={{ margin: "2px 12px 16px" }}>{title}</Heading2>}
      {row}
    </div>
  );
}

// Tone → { fg, border, bg } for Badge's default chrome. Modeled on Ink's REAL
// Tag component: border = tone-strong, background = tone-subtle tint, per Ink's
// semantic Tag variants. `warning` uses Ink's real "feedback-notice" semantic
// Tag variant ("Requires Action") — brand-yellow-80/-20, not a custom color;
// see NOTICE/NOTICE_TINT in theme.js for the full derivation.
const BADGE_TONE = {
  neutral:  { fg: "var(--ink-color-global-text-subtle)", border: "var(--ink-color-global-border-subtle)", bg: "var(--ink-color-global-surface-lightgray-default)" },
  info:     { fg: "var(--ink-color-global-link-default)", border: "var(--ink-color-global-link-default)", bg: "var(--accent-soft)" },
  positive: { fg: "var(--ink-color-global-feedback-positive-strong)", border: "var(--ink-color-global-feedback-positive-strong)", bg: "var(--ink-color-global-feedback-positive-subtle)" },
  negative: { fg: "var(--ink-color-global-feedback-negative-strong)", border: "var(--ink-color-global-feedback-negative-strong)", bg: "var(--ink-color-global-feedback-negative-subtle)" },
  warning:  { fg: NOTICE, border: NOTICE, bg: NOTICE_TINT },
  strong:   { fg: "var(--ink-color-global-text-default)", border: "var(--ink-color-global-text-default)", bg: "var(--ink-color-global-surface-lightgray-default)" },
  // `neutral`'s fg (text-subtle) is the raw Ink token — near-invisible on dark
  // surfaces (see MICRO's own doc comment in theme.js). `muted` uses the app's
  // corrected MICRO override instead, for annotation badges that want a quiet
  // gray without falling back to the broken raw token.
  muted:    { fg: MICRO, border: "var(--ink-color-global-border-subtle)", bg: "var(--ink-color-global-surface-lightgray-default)" },
};

/** Small semantic pill — the single source for the app's status/annotation tags
 *  (SPV, PROJ, RESERVE-LIGHT, EXITED, MANAGING, "scenario mark", activity lanes,
 *  etc.), built as Ink's real Tag component at `size="mini"`: 20px height,
 *  0 8px padding, 11px/500/line-height 20, border-radius 4px, no forced uppercase.
 *  `variant="text"` is NOT an Ink Tag — it's a bare chromeless inline
 *  annotation (MANAGING, EXITED) for when even a mini tag reads as too heavy.
 *  Props: children, tone (neutral|info|positive|negative|warning|strong),
 *  variant ("text" | undefined), title, style. */
export function Badge({ children, tone = "neutral", variant, title, style }) {
  const t = BADGE_TONE[tone] || BADGE_TONE.neutral;
  if (variant === "text")
    return (
      <span title={title} style={{ ...sans, display: "inline-flex", alignItems: "center", fontSize: FS.micro,
        fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", whiteSpace: "nowrap", color: t.fg, ...style }}>
        {children}
      </span>
    );
  return (
    <span title={title} style={{ ...sans, display: "inline-flex", alignItems: "center", height: 20, padding: "0 8px",
      fontSize: 11, fontWeight: 500, lineHeight: "20px", letterSpacing: 0, whiteSpace: "nowrap", boxSizing: "border-box",
      borderRadius: 4, color: t.fg, background: t.bg, border: `1px solid ${t.border}`, ...style }}>
      {children}
    </span>
  );
}

// variant → { fg, border, bg } for Bubble, per Ink's real Bubble component
// (feedback-* intent variants only — the equity-* variants and non-semantic
// `type` color keys aren't used anywhere in this app, so they're omitted).
// `notice`/`pending` share NOTICE/NOTICE_TINT (brand-yellow-80/-20) since this
// app's pinned tokens.css has no --ink-color-global-highlight-* tokens.
const BUBBLE_TONE = {
  positive: { fg: "var(--ink-color-global-feedback-positive-strong)", border: "var(--ink-color-global-feedback-positive-strong)", bg: "var(--ink-color-global-feedback-positive-subtle)" },
  negative: { fg: "var(--ink-color-global-feedback-negative-strong)", border: "var(--ink-color-global-feedback-negative-strong)", bg: "var(--ink-color-global-feedback-negative-subtle)" },
  info:     { fg: "var(--ink-color-global-feedback-info-strong)", border: "var(--ink-color-global-feedback-info-strong)", bg: "var(--ink-color-global-feedback-info-subtle)" },
  neutral:  { fg: "var(--ink-color-global-feedback-neutral-strong)", border: "var(--ink-color-global-feedback-neutral-strong)", bg: "var(--ink-color-global-feedback-neutral-subtle)" },
  notice:   { fg: NOTICE, border: NOTICE, bg: NOTICE_TINT },
  pending:  { fg: NOTICE, border: NOTICE, bg: NOTICE_TINT },
};

/** Ink's real Bubble — "highlights one or two words for more visibility."
 *  inline-flex, 18px tall, 0 8px padding, 12px/500/line-height 1, fully
 *  rounded (radii/max), 1px border, sized to its text content (no height
 *  override). Not interactive — no hover/click; for interactive chips/filters
 *  use Badge/Segmented instead. Docs: https://ink.carta.com/components/Bubble/usage
 *  Props: children, variant (positive|negative|info|neutral|notice|pending), style. */
export function Bubble({ children, variant = "positive", style }) {
  const t = BUBBLE_TONE[variant] || BUBBLE_TONE.positive;
  return (
    <span style={{ ...sans, display: "inline-flex", alignItems: "center", height: 18, padding: "0 8px",
      fontSize: 12, fontWeight: 500, lineHeight: 1, letterSpacing: "0.01em", whiteSpace: "nowrap", boxSizing: "border-box",
      borderRadius: 999, color: t.fg, background: t.bg, border: `1px solid ${t.border}`, ...style }}>
      {children}
    </span>
  );
}

const GLOBAL_FILTER_PANEL_WIDTH = 500;

/** Global filter — trigger button + removable tags inline; the panel (left
 *  side-nav + right checkbox pane) portals to `document.body` and is
 *  positioned in fixed viewport coordinates computed from the trigger's own
 *  rect. A plain `position: absolute` popover here would be clipped: the
 *  Companies toolbar sits inside the app's scrollable middle column (between
 *  the left nav and a right-side performance panel), and that column's own
 *  `overflow: auto` clips ANY child that spills past its box regardless of
 *  which side it opens toward (the sticky table header clone in
 *  Companies.jsx escapes the same containment issue via `createPortal` for
 *  the same reason). The portal alone fixes the clipping; opening direction
 *  is auto-flipped on top of that: it opens rightward (the natural direction
 *  for a dropdown) and only flips to open leftward when the trigger sits
 *  close enough to the effective right boundary that opening rightward would
 *  run past it. `rightBoundarySelector` (optional) names a CSS selector for
 *  an element whose left edge is that boundary — e.g. a right-side panel
 *  GlobalFilter shouldn't cover — falling back to the browser window's right
 *  edge when omitted or not found, so this stays a generic component with no
 *  built-in knowledge of any specific page's layout; the caller passes the
 *  selector for whatever it needs GlobalFilter to stop short of. Generic
 *  over its filter shape: `filters` is `{ showRealized, statuses }`;
 *  `statusOptions` is `[{value, label, count}]`. */
export function GlobalFilter({ filters, onChange, statusOptions, rightBoundarySelector }) {
  const [open, setOpen] = useState(false);
  const [activePane, setActivePane] = useState("status");
  const [draft, setDraft] = useState(filters);
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) { setPos(null); return; }
    // Resolved once per open, not on every reposition — the boundary element's
    // identity doesn't change while the popover is open, only its position does.
    const boundaryEl = rightBoundarySelector ? document.querySelector(rightBoundarySelector) : null;
    const reposition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const rightBound = boundaryEl ? boundaryEl.getBoundingClientRect().left : window.innerWidth;
      const opensLeft = rect.left + GLOBAL_FILTER_PANEL_WIDTH + 8 > rightBound;
      const desiredLeft = opensLeft ? rect.right - GLOBAL_FILTER_PANEL_WIDTH : rect.left;
      const left = Math.min(Math.max(desiredLeft, 8), rightBound - GLOBAL_FILTER_PANEL_WIDTH - 8);
      setPos({ top: rect.bottom + 6, left });
    };
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, rightBoundarySelector]);

  useDismissable(open, setOpen, [ref, panelRef]);

  useEffect(() => { if (!open) setDraft(filters); }, [open, filters]);

  const apply = () => { onChange(draft); setOpen(false); };
  const resetDraft = () => setDraft({ showRealized: false, statuses: [] });
  const activeCount = filters.statuses.length + (filters.showRealized ? 1 : 0);

  const removeStatus = (v) => onChange({ ...filters, statuses: filters.statuses.filter((x) => x !== v) });
  const removeRealized = () => onChange({ ...filters, showRealized: false });
  const toggleDraftStatus = (v) => {
    const s = draft.statuses.includes(v) ? draft.statuses.filter((x) => x !== v) : [...draft.statuses, v];
    setDraft({ ...draft, statuses: s });
  };

  const tag = (label, onRemove, key) => (
    <Badge key={key} tone="info" style={{ gap: 4, paddingRight: 4, cursor: "default" }}>
      {label}
      <button onClick={onRemove}
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center",
          background: "transparent", border: "none", cursor: "pointer", padding: 0,
          width: 14, height: 14, color: "inherit", borderRadius: 2, fontSize: 13, lineHeight: 1 }}
        aria-label={`Remove ${label} filter`}>×</button>
    </Badge>
  );

  const navItems = [
    { key: "status", label: "Status", count: draft.statuses.length },
    { key: "realized", label: "Realized", count: draft.showRealized ? 1 : 0 },
  ];

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      {/* size="toolbar" matches this row's other triggers (Dropdown, SearchInput) —
          Ink's own small Button is 32px/7px padding; the ribbon needs the shared
          TOOLBAR_CONTROL_STYLE chrome instead. */}
      <Btn ref={triggerRef} size="toolbar" onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open}>
        Filters
        {activeCount > 0 && <Badge tone="info">{activeCount}</Badge>}
        {/* size=16 matches Ink's real Dropdown carat — same size every other ribbon trigger's chevron uses. */}
        <ChevronDownIcon size={16} strokeWidth={1.5} style={{ transition: `transform ${EASE}`, transform: open ? "rotate(180deg)" : "rotate(0deg)" }} />
      </Btn>

      {filters.statuses.map((v) => {
        const label = statusOptions.find((o) => o.value === v)?.label ?? v;
        return tag(label, () => removeStatus(v), v);
      })}
      {filters.showRealized && tag("Show realized", removeRealized, "realized")}

      {open && pos && createPortal(
        <div ref={panelRef} className="popin" style={{ position: "fixed", top: pos.top, left: pos.left,
          zIndex: 150, width: GLOBAL_FILTER_PANEL_WIDTH, background: "var(--ink-color-global-surface-background-default)",
          border: `1px solid var(--ink-color-global-border-subtle)`, borderRadius: 8, boxShadow: POPOVER_SHADOW,
          display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ display: "flex" }}>
            {/* Side nav */}
            <div style={{ width: 156, borderRight: `1px solid var(--ink-color-global-border-subtle)`, padding: "8px 4px",
              display: "flex", flexDirection: "column", gap: 2 }}>
              {navItems.map(({ key, label, count }) => (
                <MenuItem key={key} onClick={() => setActivePane(key)} selected={activePane === key} tint={activePane === key}>
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                    {label}
                    {count > 0 && <Badge tone="info">{count}</Badge>}
                  </span>
                </MenuItem>
              ))}
            </div>

            {/* Right pane */}
            <div style={{ flex: 1, padding: "12px 16px", overflowY: "auto", maxHeight: 300 }}>
              {activePane === "status" && (
                <>
                  <p style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", margin: "0 0 8px", fontWeight: 500 }}>Filter by status</p>
                  {statusOptions.length === 0 && (
                    <p style={{ ...sans, fontSize: FS.body, color: "var(--ink-color-global-text-subtle)", margin: 0 }}>No status data available.</p>
                  )}
                  {statusOptions.map(({ value, label, count }) => (
                    <label key={value} style={{ ...sans, display: "flex", alignItems: "center", gap: 10,
                      padding: "7px 0", cursor: "pointer", fontSize: FS.bodyLg, color: "var(--ink-color-global-text-default)" }}>
                      <input type="checkbox" checked={draft.statuses.includes(value)}
                        onChange={() => toggleDraftStatus(value)}
                        style={{ accentColor: "var(--ink-button-background-color-primary-base-default)", width: 14, height: 14, cursor: "pointer" }} />
                      <span style={{ flex: 1 }}>{label}</span>
                      <span style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)" }}>{count}</span>
                    </label>
                  ))}
                </>
              )}
              {activePane === "realized" && (
                <>
                  <p style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", margin: "0 0 8px", fontWeight: 500 }}>Realized companies</p>
                  <label style={{ ...sans, display: "flex", alignItems: "center", gap: 10,
                    padding: "7px 0", cursor: "pointer", fontSize: FS.bodyLg, color: "var(--ink-color-global-text-default)" }}>
                    <input type="checkbox" checked={draft.showRealized}
                      onChange={(e) => setDraft({ ...draft, showRealized: e.target.checked })}
                      style={{ accentColor: "var(--ink-button-background-color-primary-base-default)", width: 14, height: 14, cursor: "pointer" }} />
                    <span>Include realized companies</span>
                  </label>
                </>
              )}
            </div>
          </div>

          {/* Footer */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8,
            padding: "10px 16px", borderTop: `1px solid var(--ink-color-global-border-subtle)` }}>
            <Btn onClick={resetDraft}>Reset</Btn>
            <Btn kind="primary" onClick={apply}>Apply</Btn>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

/** Ink's real Input/TextInput field: 36px height, 4px radius, 10px L/R padding,
 *  14px/20px Inter, border-default at rest, border-active on hover,
 *  border-focus-default + a 4px border-focus-light ring on focus — via the
 *  `.ink-input` class in theme.js. The shared primitive behind `SearchInput`
 *  below; use directly for any other plain text field that needs to match Ink
 *  exactly. Accepts layout props (flex, minWidth, etc.) and style overrides via
 *  `style`; forwards a ref to the underlying `<input>`. */
export const TextInput = forwardRef(({ style, className, ...props }, ref) => (
  <input
    ref={ref}
    className={className ? `ink-input ${className}` : "ink-input"}
    style={{ ...sans, ...TOOLBAR_CONTROL_STYLE, padding: "0 10px" /* Ink's real Input padding — narrower
      than TOOLBAR_CONTROL_STYLE's 12px (a Dropdown-trigger measurement); height/fontSize/lineHeight
      still come from the shared constant so this can't drift from the ribbon's other controls */,
      background: "var(--ink-color-global-surface-background-default)", color: "var(--ink-color-global-text-default)",
      boxSizing: "border-box", ...style }}
    {...props}
  />
));

/** Search field — `TextInput` with a leading magnifying-glass icon, matching
 *  Ink's own GlobalFilter search field (same 36px input, icon inset at 10px,
 *  text padded to clear it) rather than a bare placeholder with no icon. Native
 *  `type="search"` still supplies the browser's own clear-x affordance; only
 *  its default magnifying-glass-less chrome and 12px padding were non-canonical
 *  before. Accepts layout props (flex, minWidth, etc.) via `style`. */
export function SearchInput({ placeholder, value, onChange, style, ...props }) {
  // `-webkit-appearance:none` (needed so our own border-radius renders instead of
  // the browser's native rounded search pill — see theme.js .ink-input) also drops
  // the native clear-x as an unfixable side effect, so this renders its own instead
  // of relying on browser chrome that can't coexist with a custom border-radius.
  const clear = () => onChange({ target: { value: "" } });
  return (
    <div style={{ position: "relative", display: "inline-flex", ...style }}>
      <SearchIcon size={14} strokeWidth={1.8}
        style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
          color: "var(--ink-color-global-text-subtle)", pointerEvents: "none" }} />
      <TextInput
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        style={{ paddingLeft: 32, paddingRight: value ? 28 : undefined, width: "100%" }}
        {...props}
      />
      {value && (
        <button type="button" onClick={clear} aria-label="Clear search"
          style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 16, height: 16, padding: 0, border: "none", borderRadius: 2,
            background: "transparent", color: "var(--ink-color-global-text-subtle)",
            cursor: "pointer", fontSize: 14, lineHeight: 1 }}>×</button>
      )}
    </div>
  );
}
