// Shared UI kit — Ink component recipes, one implementation each.
//
// Values are copied from skill-dev:theme-with-ink's `components.md`, which is a
// mechanical port of Ink's real rendered CSS. They are not approximations and not
// re-derived from a screenshot: where a number appears here it is the literal value in
// that file (40px field height, 0 12px padding, 14px/weight-400 text,
// border-default at rest, border-hover on hover, and the two-part focus recipe).
//
// theme-with-ink itself cannot theme this app — its contract is vanilla-only, no React
// and no CSS-in-JS. So this file ports its recipes into the styling model the app
// actually uses, which is what build-micro-app's retrofit mode is for.
//
// Before this existed, each view hand-rolled its own controls: four <select>s sharing a
// copy-pasted `padding: "5px 8px"` and no appearance reset, so they rendered ~30px tall
// with OS chrome and did not match Ink's 40px fields sitting next to them.

import { createContext, useContext, useState } from "react";
import { C, FS, RADIUS, SANS } from "./theme.js";

/** Ink's chevron-down. Static: this app's menus only ever open downward.
 *
 *  `stroke` is set via the style prop rather than the SVG presentation attribute —
 *  Safari < 15.4 silently ignores a var() reference in a presentation attribute and
 *  falls back to `none`, rendering nothing.
 */
function ChevronDown({ size = 16 }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
      style={{ stroke: "currentColor", flex: "0 0 auto" }}
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/** A labelled select following Ink's field recipe.
 *
 *  Native <select> for the menu itself: it is keyboard-accessible, screen-reader
 *  correct and scroll-aware for free. Ink's own `.ink-menu` recipe is for a custom
 *  anchored menu built with JS — reimplementing that here would trade all of the above
 *  for a visual detail nobody asked for. The FIELD is what was wrong, so the field is
 *  what this fixes: 40px, appearance:none, and our own chevron.
 */
export function Select({ label, value, onChange, options, hint, minWidth = 0 }) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);

  return (
    <label style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      {label && (
        <span style={{ fontSize: FS.sm, color: C.textSubtle }}>{label}</span>
      )}
      <span
        style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          title={hint}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          style={{
            // Ink .ink-input: 40px tall, 0 12px padding, 14px/400.
            height: 40,
            // Extra right padding leaves room for the chevron overlaid below.
            padding: "0 34px 0 12px",
            minWidth,
            font: `400 ${FS.md}px/1 ${SANS}`,
            color: C.textDefault,
            background: C.surfaceDefault,
            border: `1px solid ${focus ? C.linkDefault : hover ? C.borderHover : C.borderDefault}`,
            borderRadius: RADIUS,
            // The OS chrome is what made these look foreign next to Ink's fields.
            appearance: "none",
            WebkitAppearance: "none",
            // Ink's two-part focus: recolor the border AND add a 4px pale-blue ring.
            boxShadow: focus ? `0 0 0 4px ${C.focusRing}` : "none",
            outline: "none",
            cursor: "pointer",
          }}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {/* Overlaid, not a sibling: keeps the control one hit target, and pointer-events
            none lets the click fall through to the select underneath. */}
        <span style={{
          position: "absolute", right: 11, display: "inline-flex",
          pointerEvents: "none", color: C.textSubtle,
        }}>
          <ChevronDown />
        </span>
      </span>
    </label>
  );
}

/** Ink's Tag — regular weight (400), tone-matched border, radius-subtle, sentence case.
 *
 *  The border carries the SEMANTIC TONE rather than a shared neutral gray, and the
 *  weight stays 400: bolding a status label is the most common drift away from this
 *  recipe. Height is left to content — Ink fixes standalone badges at 28px, but a dense
 *  table row needs to be more compact than that assumes.
 */
export const TAG_TONES = {
  neutral: { fg: C.textSubtle, bd: C.borderDefault, bg: C.surfaceUnderlay },
  info: { fg: C.linkDefault, bd: C.linkDefault, bg: C.infoSubtle },
  positive: { fg: C.feedbackPositive, bd: C.feedbackPositive, bg: C.positiveSubtle },
  negative: { fg: C.feedbackNegative, bd: C.feedbackNegative, bg: C.surfaceUnderlay },
  notice: { fg: C.feedbackNotice, bd: C.feedbackNotice, bg: C.feedbackNoticeSubtle },
};

export function Tag({ tone = "neutral", children, title }) {
  const t = TAG_TONES[tone] || TAG_TONES.neutral;
  return (
    <span
      title={title}
      style={{
        display: "inline-block", padding: "1px 7px",
        borderRadius: RADIUS,
        fontSize: FS.sm, fontWeight: 400, whiteSpace: "nowrap",
        color: t.fg, background: t.bg, border: `1px solid ${t.bd}`,
      }}
    >
      {children}
    </span>
  );
}

// A table can set one alignment for every cell inside it, instead of every Th/Td
// repeating the same `align`. Used by the Scorecard, where all twelve columns are
// centred; Benchmarks passes `align` per cell and is unaffected.
//
// Deliberately a context rather than a new default: flipping the default would silently
// re-align every existing table, including ones whose right-aligned money columns are
// right-aligned on purpose.
const AlignContext = createContext(null);

export function TableAlign({ align, children }) {
  return <AlignContext.Provider value={align}>{children}</AlignContext.Provider>;
}

/** Ink's table header cell: sentence case, 14px/weight-500, full-contrast text, with a
 *  border-default (medium gray) under-rule — clearly darker than the hairline between
 *  body rows, nowhere near the near-black text color. Deliberately NOT the
 *  uppercase/tracked/tiny "ledger" look, which Ink drops. */
export function Th({ children, align, width, colSpan, group }) {
  const ctx = useContext(AlignContext);
  // Explicit prop wins, then the table-wide value, then the historical default.
  align = align || ctx || "left";
  return (
    <th
      colSpan={colSpan}
      style={{
        padding: "8px 10px", fontSize: FS.md, fontWeight: 500, color: C.textDefault,
        textAlign: align, whiteSpace: "nowrap", width,
        // A `group` heading spans several columns above the real ones, so it takes the
        // hairline: the darker under-rule belongs on the row that actually labels the
        // columns, or the table reads as having two competing header baselines.
        borderBottom: `1px solid ${group ? C.borderSubtle : C.borderDefault}`,
      }}
    >{children}</th>
  );
}

/** Ink's table body cell: 14px/weight-400, border-subtle hairline between rows. */
export function Td({ children, align, subtle, mono, ellipsis, title }) {
  const ctx = useContext(AlignContext);
  align = align || ctx || "left";
  return (
    <td title={title} style={{
      padding: "7px 10px", fontSize: FS.md, fontWeight: 400, textAlign: align,
      color: subtle ? C.textQuiet : C.textDefault,
      fontVariantNumeric: mono ? "tabular-nums" : undefined,
      borderBottom: `1px solid ${C.borderSubtle}`, whiteSpace: "nowrap",
      ...(ellipsis ? { overflow: "hidden", textOverflow: "ellipsis" } : null),
    }}>{children}</td>
  );
}
