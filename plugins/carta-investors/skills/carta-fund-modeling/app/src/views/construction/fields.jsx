import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FS, sans, inkNum, NOTICE_TINT } from "../../ui/theme.js";
import { H3, TextInput, InfoTip, HelpCircleIcon, fundLabel, ChevronIcon, useDismissable, POPOVER_SHADOW } from "../../ui/components.jsx";
import { fmtYm, fmtCount } from "../../ui/format.js";
import { addMonthsYm, DEFAULTS_CURRENCY } from "../../model/construction/plan.js";

export { fmtYm, fmtCount };

/** Shown on a plan in another currency: the starting `amounts` weren't converted, only relabeled. */
export function UsdDefaultsNotice({ ccy, amounts }) {
  if (ccy === DEFAULTS_CURRENCY) return null;
  return (
    <div role="note" data-testid="usd-defaults-notice" style={{ ...sans, fontSize: FS.small, padding: "8px 12px", margin: "0 0 16px", borderRadius: 4,
      background: NOTICE_TINT, color: "var(--ink-color-global-text-default)" }}>
      The starting {amounts} are sized for a {DEFAULTS_CURRENCY} fund and weren't converted to {ccy || "this plan's currency"}. Review each amount.
    </div>
  );
}

/** Readable fund name for "suggested from" notes: Carta names carry an ALL-CAPS slug prefix. */
export const sourceLabel = (name) => (/^[A-Z0-9-]+ \(.+\)$/.test(name ?? "") ? fundLabel(name) : name);

const labelStyle = { ...sans, fontSize: FS.small, fontWeight: 600, color: "var(--ink-color-global-text-default)", display: "block", marginBottom: 6 };
export const hintStyle = { ...sans, fontSize: FS.micro, color: "var(--ink-color-global-text-subtle)", marginTop: 5 };
export const errStyle = { ...hintStyle, color: "var(--ink-color-global-feedback-negative-strong)" };
export const cellNum = { ...inkNum, textAlign: "right", whiteSpace: "nowrap" };

/** Truthy inside a section card, whose header already carries the title; an Element value is the header slot for the step's tooltip. */
export const EmbeddedContext = createContext(false);

/** Inside a section card the title is the card's, so only the tooltip renders, portaled into the header slot. */
export function StepHeader({ title, children }) {
  const embedded = useContext(EmbeddedContext);
  const tip = children && (
    <span data-testid="step-intro" style={{ display: "inline-flex", verticalAlign: "middle", marginLeft: 6 }} onClick={(e) => e.stopPropagation()}>
      <InfoTip portal width={320} label={`About ${typeof title === "string" ? title : "this section"}`}
        trigger={<span role="img" aria-label={`About ${typeof title === "string" ? title : "this section"}`} tabIndex={0} style={{ display: "flex", cursor: "default", color: "var(--ink-color-global-feedback-info-strong)" }}><HelpCircleIcon size={16} strokeWidth={1.6} /></span>}>
        {children}
      </InfoTip>
    </span>
  );
  if (embedded) return embedded instanceof Element && tip ? createPortal(tip, embedded) : null;
  return (
    <div style={{ marginBottom: 16 }}>
      <H3 as="h2" style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>{title}{tip}</H3>
    </div>
  );
}

/** Any `aside` other than undefined (even null) gives the label a fixed-height row, so a row of fields lines up. */
export function Field({ label, aside, hint, error, children, testId }) {
  return (
    <div data-testid={testId} style={{ minWidth: 0 }}>
      {label && (aside === undefined
        ? <label style={labelStyle}>{label}</label>
        : <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, height: 24, marginBottom: 6 }}>
            <label style={{ ...labelStyle, marginBottom: 0 }}>{label}</label>{aside}
          </div>)}
      {children}
      {error ? <div style={errStyle} role="alert">{error}</div> : hint ? <div style={hintStyle}>{hint}</div> : null}
    </div>
  );
}

export function ErrorLine({ children }) {
  if (!children) return null;
  return <div style={{ ...errStyle, marginTop: 8 }} role="alert">{children}</div>;
}

export const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "24px 32px", alignItems: "start" };

/** Shown in `scale` units but stored raw; keeps its own text while typing so "1." or an empty box isn't overwritten. */
export function NumInput({ value, onChange, scale = 1, step = "any", decimals = 4, suffix, testId, invalid, width = 220, ariaLabel, placeholder }) {
  const shown = value == null || !Number.isFinite(value) ? "" : String(+(value / scale).toFixed(decimals));
  const [text, setText] = useState(shown);
  useEffect(() => { if (parseFloat(text) !== parseFloat(shown)) setText(shown); }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <TextInput type="number" inputMode="decimal" step={step} value={text} data-testid={testId} aria-label={ariaLabel} placeholder={placeholder}
        aria-invalid={invalid || undefined}
        // Scrolling the page over a focused number box would change its value; let go of it instead.
        onWheel={(e) => e.currentTarget.blur()}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseFloat(e.target.value);
          onChange(Number.isFinite(n) ? n * scale : null);
        }}
        style={{ ...inkNum, width: "100%", maxWidth: width, minWidth: 64 }} />
      {suffix && <span style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", whiteSpace: "nowrap" }}>{suffix}</span>}
    </span>
  );
}

export function UnitToggle({ value, options, onChange, label }) {
  return (
    <span role="group" aria-label={label} style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
      {options.map((o, i) => (
        <span key={o.id} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          {i > 0 && <span aria-hidden="true" style={{ color: "var(--ink-color-global-border-default)" }}>·</span>}
          <button type="button" aria-pressed={value === o.id} data-testid={o.testId} title={o.title} onClick={() => onChange(o.id)}
            style={{ ...sans, fontSize: FS.small, padding: "2px 0", border: "none", background: "transparent", cursor: "pointer",
              fontWeight: value === o.id ? 700 : 500, textDecoration: value === o.id ? "underline" : "none", textUnderlineOffset: 4,
              color: value === o.id ? "var(--ink-color-global-text-default)" : "var(--ink-color-global-link-default)" }}>{o.label}</button>
        </span>
      ))}
    </span>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ymKey = (y, m) => `${String(y).padStart(4, "0")}-${String(m + 1).padStart(2, "0")}`;
const calBtn = { ...sans, fontSize: FS.body, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", border: "none", background: "transparent", cursor: "pointer", padding: "8px 10px", borderRadius: 4, color: "var(--ink-color-global-link-default)" };

/** `value`, `min` and `max` are "YYYY-MM" strings; nothing changes until OK. */
export function MonthField({ value, onChange, min, max, testId, ariaLabel, placeholder = "Select month", width = 170 }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(null);
  const [year, setYear] = useState(2027);
  const [alignRight, setAlignRight] = useState(false);
  const ref = useRef(null);
  useDismissable(open, setOpen, ref);
  const yearOf = (ym) => +(ym ?? "").slice(0, 4) || null;
  const show = () => {
    const rect = ref.current?.getBoundingClientRect?.();
    setAlignRight(!!rect && rect.left + 340 > (typeof window !== "undefined" ? window.innerWidth : 1e9));
    setDraft(value || null);
    setYear(yearOf(value) ?? yearOf(min) ?? new Date().getFullYear());
    setOpen(true);
  };
  const minYear = yearOf(min), maxYear = yearOf(max);
  const off = (key) => (min && key < min) || (max && key > max);
  const commit = () => { if (draft) onChange(draft); setOpen(false); };
  const arrow = (dir, disabled) => (
    <button type="button" onClick={() => setYear((y) => y + dir)} disabled={disabled} data-testid={`${testId}-${dir < 0 ? "prev" : "next"}`} aria-label={dir < 0 ? "Previous year" : "Next year"}
      style={{ border: "none", background: "transparent", cursor: disabled ? "default" : "pointer", padding: 6, borderRadius: 4, display: "inline-flex", opacity: disabled ? 0.3 : 1, color: "var(--ink-color-global-link-default)" }}>
      <ChevronIcon size={20} strokeWidth={2.2} style={{ transform: dir < 0 ? "rotate(180deg)" : "none" }} />
    </button>
  );
  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button type="button" onClick={() => (open ? setOpen(false) : show())} aria-haspopup="dialog" aria-expanded={open} aria-label={ariaLabel} data-testid={testId} data-value={value || ""}
        className={`dd-trigger${open ? " is-open" : ""}`}
        style={{ ...sans, display: "inline-flex", alignItems: "center", justifyContent: "space-between", gap: 10, height: 40, padding: "0 12px", minWidth: width, boxSizing: "border-box",
          border: "1px solid var(--ink-color-global-border-default)", borderRadius: 4, background: "var(--ink-color-global-surface-background-default)", cursor: "pointer",
          fontSize: FS.bodyLg, color: value ? "var(--ink-color-global-text-default)" : "var(--ink-color-global-text-subtle)" }}>
        <span>{value ? fmtYm(value) : placeholder}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none" }}>
          <rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" />
        </svg>
      </button>
      {open && (
        <div className="popin" role="dialog" aria-label={ariaLabel ?? "Pick a month"} data-testid={`${testId}-popover`}
          style={{ position: "absolute", top: "calc(100% + 6px)", [alignRight ? "right" : "left"]: 0, width: 300, zIndex: 60, padding: "16px 16px 8px", boxSizing: "border-box",
            background: "var(--ink-color-global-surface-background-default)", border: "1px solid var(--ink-color-global-border-subtle)", borderRadius: 12, boxShadow: POPOVER_SHADOW }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 4px 10px" }}>
            <span data-testid={`${testId}-year`} style={{ ...sans, fontSize: 20, fontWeight: 700 }}>{year}</span>
            <span style={{ display: "inline-flex", gap: 4 }}>{arrow(-1, minYear != null && year <= minYear)}{arrow(1, maxYear != null && year >= maxYear)}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
            {MONTHS.map((name, i) => {
              const key = ymKey(year, i);
              const disabled = !!off(key), on = draft === key;
              return (
                <button key={key} type="button" disabled={disabled} aria-pressed={on} data-testid={`${testId}-m-${key}`} onClick={() => setDraft(key)}
                  style={{ ...sans, fontSize: FS.bodyLg, height: 44, borderRadius: 22, border: "none", cursor: disabled ? "default" : "pointer", fontWeight: on ? 700 : 500,
                    background: on ? "var(--ink-color-global-link-default)" : "transparent", color: on ? "#fff" : disabled ? "var(--ink-color-global-text-disabled, var(--ink-color-global-text-subtle))" : "var(--ink-color-global-text-default)",
                    opacity: disabled ? 0.35 : 1 }}>{name}</button>
              );
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 4, paddingTop: 8 }}>
            <button type="button" onClick={() => setOpen(false)} data-testid={`${testId}-cancel`} style={calBtn}>Cancel</button>
            <button type="button" onClick={commit} disabled={!draft} data-testid={`${testId}-ok`} style={{ ...calBtn, opacity: draft ? 1 : 0.4, cursor: draft ? "pointer" : "default" }}>OK</button>
          </div>
        </div>
      )}
    </div>
  );
}

const ymIndex = (ym) => { const [y, m] = ym.split("-").map(Number); return y * 12 + m - 1; };
const pickerLabel = { ...sans, fontSize: FS.micro, fontWeight: 600, color: "var(--ink-color-global-text-subtle)", display: "block", marginBottom: 4, whiteSpace: "nowrap" };

/** Fund months count from the start date, which is month `base`; without a start date it falls back to a bare month number. */
export function MonthPicker({ label, value, onChange, startDate, termMonths, base = 1, count = (m) => `month ${m}`, empty, emptyAt, testId, ariaLabel, width = 150 }) {
  const hint = value == null ? (emptyAt != null ? null : empty) : count(value);
  const head = label && <label style={pickerLabel}>{label}{hint ? <span style={{ fontWeight: 400 }}> · <span data-testid={testId && `${testId}-count`}>{hint}</span></span> : null}</label>;
  if (!startDate) {
    return <div>{head}<NumInput value={value} onChange={onChange} decimals={0} step={1} width={80} placeholder={empty ? "end" : undefined} testId={testId} ariaLabel={ariaLabel} /></div>;
  }
  // An open end ("until the fund ends") shows as a button; picking a month starts from `emptyAt`.
  if (value == null && empty && emptyAt != null) {
    return (
      <div>
        {head}
        <button type="button" className="btn-ghost" data-testid={testId} aria-label={ariaLabel} onClick={() => onChange(emptyAt)}
          style={{ ...sans, fontSize: FS.body, height: 40, width, textAlign: "left", padding: "0 12px", borderRadius: 4, cursor: "pointer",
            border: "1px solid var(--ink-color-global-border-default)", background: "var(--ink-color-global-surface-background-default)", color: "var(--ink-color-global-text-subtle)" }}>
          Fund end
        </button>
      </div>
    );
  }
  return (
    <div>
      {head}
      <MonthField value={value == null ? "" : addMonthsYm(startDate, value - base)} min={startDate} max={termMonths > 0 ? addMonthsYm(startDate, termMonths - base) : undefined} testId={testId} ariaLabel={ariaLabel} width={width}
        onChange={(ym) => onChange(ym ? ymIndex(ym) - ymIndex(startDate) + base : null)} />
      {!label && hint && <div style={{ ...hintStyle, marginTop: 3 }} data-testid={testId && `${testId}-count`}>{hint}</div>}
    </div>
  );
}

const withCommas = (n) => (n == null || !Number.isFinite(n) ? "" : n.toLocaleString("en-US", { maximumFractionDigits: 2 }));

/** Commas are optional while typing; the box is re-formatted with thousands separators on blur. */
export function AmountInput({ value, onChange, ccy, testId, invalid, width = 220, ariaLabel }) {
  const [text, setText] = useState(withCommas(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(withCommas(value)); }, [value, focused]);
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <TextInput type="text" inputMode="decimal" value={text} data-testid={testId} aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseFloat(e.target.value.replace(/[,\s]/g, ""));
          onChange(Number.isFinite(n) ? n : null);
        }}
        style={{ ...inkNum, width: "100%", maxWidth: width, minWidth: 64 }} />
      {ccy && <span style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", whiteSpace: "nowrap" }}>{ccy}</span>}
    </span>
  );
}

/** Percent input: shown as 0–100, stored as a fraction. */
export const PctInput = (p) => <NumInput scale={0.01} decimals={2} suffix="%" {...p} />;

export function LiquidationTip({ endLabel, light = false }) {
  return (
    <InfoTip portal placement="top" width={340} label="How holdings are valued when the fund ends">
      <div data-testid="liquidation-tip">
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Sold at the fund's end{endLabel ? ` (${endLabel})` : ""}</div>
        {light
          ? <div>Any company the fund still holds when its term ends is treated as sold that month at its prevailing value. A held company's value grows on a straight line from what was invested to its expected exit value, so a company halfway to its exit is sold halfway there.</div>
          : <div>Any company the fund still holds when its term ends is treated as sold that month at its prevailing value: the fund's ownership × the post-money valuation of the last round the company raised.</div>}
        <div style={{ marginTop: 6 }}>That cash goes through the waterfall like any other exit, so DPI equals TVPI at the end.</div>
        <div style={{ marginTop: 6, opacity: 0.8 }}>This is conservative: a company that would have exited later at a higher value only gets credit for its {light ? "value on that date" : "last-round value"}.</div>
      </div>
    </InfoTip>
  );
}
