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

import { createContext, useContext, useEffect, useRef, useState } from "react";
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

/** Multi-select in a dropdown: the same 40px field as `Select`, opening a checkbox list.
 *
 *  NOT a native <select multiple>. Native wins everywhere else in this kit — it brings
 *  keyboard, screen-reader and scroll behaviour for free — but that trade stops paying for
 *  multi-select: it needs ctrl/cmd-click to add a second item, drops the whole selection on
 *  a plain click, and shows about four of 22 rows at a time. Losing a selection you spent
 *  six clicks building is worse than any styling detail.
 *
 *  So the FIELD borrows Select's recipe exactly (40px, 0 12px padding, overlaid chevron,
 *  two-part focus) and the menu is a real checkbox list. Options are <label><input
 *  type=checkbox> — the platform gives each row a hit target, a tab stop and the
 *  checked-state announcement, none of which a div-and-aria reimplementation gets right
 *  for free.
 *
 *  `selected` is a Set of codes. Empty means "all" to the CALLER; this component only
 *  reports what was clicked, which keeps "no filter" and "everything ticked" from needing
 *  to be told apart here.
 */
export function MultiSelect({ label, options, selected, onToggle, onAll, allLabel, minWidth = 0 }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const wrapRef = useRef(null);

  // Close on outside click and on Escape. Without the outside-click half, the menu stays
  // open behind whatever the user clicks next and covers the grid it is filtering.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const n = selected.size;
  const noun = label ? label.toLowerCase() : "options";
  // The field reads as a summary, not a list: 22 comma-joined labels would overflow any
  // sane width, and truncating them mid-name reads as data loss.
  const summary = n === 0
    ? allLabel
    : n === 1
      ? (options.find((o) => o.value === [...selected][0]) || {}).label || `${n} selected`
      : `${n} of ${options.length} selected`;

  return (
    <span
      ref={wrapRef}
      style={{ display: "inline-flex", flexDirection: "column", gap: 4, position: "relative" }}
    >
      {label && <span style={{ fontSize: FS.sm, color: C.textSubtle }}>{label}</span>}
      <span
        style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          aria-expanded={open}
          aria-haspopup="true"
          title={n ? `${n} of ${options.length} ${noun} shown` : `All ${noun} shown`}
          style={{
            height: 40,
            padding: "0 34px 0 12px",
            minWidth,
            font: `400 ${FS.md}px/1 ${SANS}`,
            color: C.textDefault,
            background: C.surfaceDefault,
            border: `1px solid ${focus || open ? C.linkDefault : hover ? C.borderHover : C.borderDefault}`,
            borderRadius: RADIUS,
            boxShadow: focus ? `0 0 0 4px ${C.focusRing}` : "none",
            outline: "none",
            cursor: "pointer",
            textAlign: "left",
            whiteSpace: "nowrap",
          }}
        >
          {summary}
        </button>
        <span style={{
          position: "absolute", right: 11, display: "inline-flex",
          pointerEvents: "none", color: C.textSubtle,
        }}>
          <ChevronDown />
        </span>
      </span>

      {open && (
        <div
          role="group"
          aria-label={label}
          style={{
            position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 20,
            minWidth: 220, maxHeight: 320, overflowY: "auto",
            background: C.surfaceDefault,
            border: `1px solid ${C.borderDefault}`,
            borderRadius: RADIUS,
            boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
            padding: 4,
          }}
        >
          <button
            type="button"
            onClick={() => { onAll(); }}
            style={{
              display: "block", width: "100%", textAlign: "left",
              font: `400 ${FS.sm}px/1.4 ${SANS}`,
              color: n === 0 ? C.linkDefault : C.textSubtle,
              background: "transparent", border: "none", borderRadius: RADIUS,
              padding: "6px 8px", cursor: "pointer",
            }}
          >
            {allLabel}
          </button>
          <span style={{
            display: "block", height: 1, background: C.borderSubtle, margin: "4px 0",
          }} />
          {options.map((o) => (
            <label
              key={o.value}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "6px 8px", borderRadius: RADIUS, cursor: "pointer",
                font: `400 ${FS.sm}px/1.4 ${SANS}`, color: C.textDefault,
                whiteSpace: "nowrap",
              }}
            >
              <input
                type="checkbox"
                checked={selected.has(o.value)}
                onChange={() => onToggle(o.value)}
                style={{ margin: 0, cursor: "pointer" }}
              />
              {o.label}
            </label>
          ))}
        </div>
      )}
    </span>
  );
}
