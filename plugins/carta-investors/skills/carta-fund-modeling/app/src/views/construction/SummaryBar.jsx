import { useEffect, useRef, useState } from "react";
import { FS, sans, inkNum } from "../../ui/theme.js";
import { fmtMIn, fmtX, fmtPct } from "../../ui/format.js";
import { stepLabel } from "../../model/construction/plan.js";
import { fmtCount } from "./fields.jsx";

function useTopbarHeight() {
  const [h, setH] = useState(0);
  useEffect(() => {
    const bar = document.querySelector('[data-testid="app-topbar"]');
    if (!bar) return undefined;
    const measure = () => setH(bar.getBoundingClientRect().height);
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);
  return h;
}

/** The app scrolls inside its content pane, not the window; null means the window. */
function scrollerOf(el) {
  for (let n = el?.parentElement; n && n !== document.body; n = n.parentElement) {
    if (/(auto|scroll|overlay)/.test(getComputedStyle(n).overflowY)) return n;
  }
  return null;
}

/** Two thresholds keep the bar from flickering between full and slim. */
function useCompact(ref) {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const scroller = scrollerOf(ref.current);
    const target = scroller ?? window;
    const y = () => (scroller ? scroller.scrollTop : window.scrollY ?? document.documentElement.scrollTop ?? 0);
    const on = () => setCompact((c) => (c ? y() > 60 : y() > 180));
    on();
    target.addEventListener("scroll", on, { passive: true });
    return () => target.removeEventListener("scroll", on);
  }, [ref]);
  return compact;
}

function Figure({ label, value, sub, testId, compact }) {
  return (
    <div data-testid={testId} style={{ minWidth: 0 }}>
      <div style={{ ...sans, fontSize: FS.micro, color: "var(--ink-color-global-text-subtle)", whiteSpace: "nowrap" }}>{label}</div>
      <div style={{ ...inkNum, fontSize: compact ? FS.bodyLg : FS.h3, fontWeight: 700, color: "var(--ink-color-global-text-default)", whiteSpace: "nowrap" }}>{value}</div>
      {sub && !compact && <div style={{ ...sans, fontSize: FS.micro, color: "var(--ink-color-global-text-subtle)", whiteSpace: "nowrap" }}>{sub}</div>}
    </div>
  );
}

export default function SummaryBar({ plan, result }) {
  const top = useTopbarHeight();
  const ref = useRef(null);
  const compact = useCompact(ref);
  const ccy = plan.general.currency;
  const ok = result?.ok;
  const m = ok ? result.metrics : null;
  // A blocked Light plan can still show its capital, fees and companies; returns wait.
  const part = ok ? null : result?.partial;
  const t = ok ? result.totals : part?.totals ?? null;
  const companies = ok ? m.initialDeals : part?.companies ?? null;
  const held = ok ? (m.reserveRatio == null ? null : m.reserveRatio / (1 + m.reserveRatio)) : part?.held ?? null;
  const irr = (v) => (v == null ? "—" : fmtPct(v, 1));
  return (
    <div ref={ref} data-testid="construction-summary" data-compact={compact || undefined} style={{ position: "sticky", top, zIndex: 15, margin: "0 0 var(--ink-spacing-global-vertical-normal)",
      background: "var(--ink-color-global-surface-background-default)", paddingTop: 8 }}>
      <div className="card" style={{ padding: compact ? "8px 20px" : "14px 20px", display: "grid", gap: compact ? "4px var(--ink-spacing-global-horizontal-large)" : "var(--ink-spacing-global-vertical-small) var(--ink-spacing-global-horizontal-large)",
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", alignItems: "start" }}>
        <Figure compact={compact} testId="sum-commitment" label="Total commitment" value={fmtMIn(plan.general.committed, ccy)} />
        <Figure compact={compact} testId="sum-investable" label="Investable capital" value={t ? fmtMIn(t.investable, ccy) : "—"}
          sub={t && t.committed > 0 ? `${fmtPct(t.investable / t.committed, 0)} of commitment` : null} />
        <Figure compact={compact} testId="sum-tvpi" label="Projected net TVPI" value={ok ? fmtX(m.tvpi) : "—"} sub={ok ? `DPI ${fmtX(m.dpi)}` : null} />
        <Figure compact={compact} testId="sum-moic" label="Projected gross MOIC" value={ok ? fmtX(m.grossMoic) : "—"} />
        <Figure compact={compact} testId="sum-irr" label="Projected net IRR" value={ok ? irr(m.netIrr) : "—"} sub={ok ? `Gross ${irr(m.grossIrr)}` : null} />
        <Figure compact={compact} testId="sum-companies" label="Total companies" value={companies != null ? fmtCount(companies) : "—"}
          sub={companies != null ? `${held == null ? "—" : fmtPct(held, 0)} held for follow-ons` : null} />
        <Figure compact={compact} testId="sum-expenses" label="Fees + fund expenses" value={t ? fmtMIn(t.fees + t.expenses, ccy) : "—"}
          sub={t ? `${fmtMIn(t.fees, ccy)} fees · ${fmtMIn(t.expenses, ccy)} expenses` : null} />
      </div>
      {!ok && result?.blockedBy && (
        <div data-testid="summary-blocked" style={{ ...sans, fontSize: FS.micro, color: "var(--ink-color-global-text-subtle)", margin: "6px 4px 0" }}>
          {part ? "Returns appear" : "Projections appear"} once these steps are complete: {result.blockedBy.map(stepLabel).join(", ")}.
        </div>
      )}
    </div>
  );
}
