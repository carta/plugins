import { useEffect, useState } from "react";
import { FS, sans } from "../../ui/theme.js";
import { Badge, CheckCircleIcon, ChevronDownIcon } from "../../ui/components.jsx";
import { fmtMIn, fmtPct } from "../../ui/format.js";
import { validateGeneral, effectiveGeneral, validateFees, validateRecycling, validateWaterfall, validateLps, deriveGeneral, waterfallTerms } from "../../model/construction/plan.js";
import { validateLightFees, validatePortfolio, validateOutcomes } from "../../model/construction/light.js";
import GeneralStep from "./GeneralStep.jsx";
import FeesStep from "./FeesStep.jsx";
import RecyclingStep from "./RecyclingStep.jsx";
import LpsStep from "./LpsStep.jsx";
import LightFeesStep from "./LightFeesStep.jsx";
import WaterfallStep from "./WaterfallStep.jsx";
import PortfolioStep from "./PortfolioStep.jsx";
import OutcomesStep from "./OutcomesStep.jsx";
import { EmbeddedContext, fmtYm } from "./fields.jsx";

const isEmpty = (e) => Object.keys(e).length === 0;
const secId = (id) => `fc-sec-${id}`;

/** Heights of the app's top bar and the pinned summary bar, so the jump bar pins just below both. */
function usePinnedHeight() {
  const [h, setH] = useState(0);
  useEffect(() => {
    const els = ['[data-testid="app-topbar"]', '[data-testid="construction-summary"]'].map((q) => document.querySelector(q)).filter(Boolean);
    const measure = () => setH(els.reduce((sum, el) => sum + el.getBoundingClientRect().height, 0));
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(measure);
    els.forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, []);
  return h;
}

function JumpBar({ sections, top, onJump, trailing }) {
  const [active, setActive] = useState(sections[0].id);
  const ids = sections.map((s) => s.id).join(",");
  useEffect(() => {
    const els = sections.map((s) => document.getElementById(secId(s.id))).filter(Boolean);
    if (typeof IntersectionObserver === "undefined" || !els.length) return undefined;
    const obs = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
      if (vis[0]) setActive(vis[0].target.id.replace("fc-sec-", ""));
    }, { rootMargin: "-30% 0px -60% 0px", threshold: [0, 0.1, 0.5, 1] });
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [ids]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = (id) => {
    onJump?.(id);
    const el = document.getElementById(secId(id));
    const calm = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (el) el.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
    setActive(id);
  };
  return (
    <nav aria-label="Jump to section" data-testid="jump-bar" style={{ position: "sticky", top, zIndex: 13, display: "flex", gap: 8, overflowX: "auto",
      padding: "8px 0", margin: "0 0 16px", background: "var(--ink-color-global-surface-background-default)",
      borderBottom: "1px solid var(--ink-color-global-border-subtle)" }}>
      <span style={{ ...sans, fontSize: FS.micro, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", alignSelf: "center",
        color: "var(--ink-color-global-text-subtle)", paddingRight: 4, whiteSpace: "nowrap" }}>Jump to</span>
      {sections.map((s, i) => {
        const on = active === s.id;
        return (
          <button key={s.id} onClick={() => go(s.id)} aria-current={on ? "true" : undefined} data-testid={`jump-${s.id}`}
            style={{ ...sans, display: "inline-flex", alignItems: "center", gap: 6, fontSize: FS.body, fontWeight: on ? 600 : 500, whiteSpace: "nowrap",
              padding: "6px 12px", minHeight: 32, cursor: "pointer", borderRadius: 16,
              border: `1px solid ${on ? "var(--ink-color-global-border-active)" : "var(--ink-color-global-border-subtle)"}`,
              background: on ? "var(--ink-color-global-surface-lightgray-default)" : "transparent",
              color: on ? "var(--ink-color-global-text-default)" : "var(--ink-color-global-text-subtle)" }}>
            {s.ok ? <span style={{ color: "var(--ink-color-global-feedback-positive-strong)", display: "inline-flex" }}><CheckCircleIcon size={14} /></span> : <span style={{ fontSize: FS.micro }}>{i + 1}</span>}
            {s.label}
          </button>
        );
      })}
      {trailing}
    </nav>
  );
}

function SectionCard({ s, index, scrollMargin, open, onToggle }) {
  const View = s.view;
  const bodyId = `${secId(s.id)}-body`;
  // Where the section's explanation tooltip goes: beside its title.
  const [introSlot, setIntroSlot] = useState(null);
  return (
    <section id={secId(s.id)} className="card" data-testid={`section-${s.id}`} data-open={open} style={{ padding: 0, marginBottom: 24, scrollMarginTop: scrollMargin }}>
      <h2 style={{ margin: 0, display: "flex", alignItems: "center" }}>
        <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={bodyId} data-testid={`toggle-${s.id}`} className="fc-sec-head"
          style={{ ...sans, display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", cursor: "pointer", border: "none", borderRadius: 0,
            padding: "16px 24px", color: "inherit", background: "transparent",
            borderBottom: open ? "1px solid var(--ink-color-global-border-subtle)" : "none" }}>
          <span aria-hidden="true" style={{ width: 24, height: 24, flex: "none", display: "grid", placeItems: "center", borderRadius: 12,
            fontSize: FS.small, fontWeight: 700, color: s.ok ? "var(--ink-color-global-feedback-positive-strong)" : "var(--ink-color-global-text-default)",
            background: "var(--ink-color-global-surface-background-default)", border: `1px solid ${s.ok ? "var(--ink-color-global-feedback-positive-strong)" : "var(--ink-color-global-border-default)"}` }}>
            {s.ok ? <CheckCircleIcon size={16} /> : index + 1}
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: FS.h3, lineHeight: "24px", fontWeight: 600, color: "var(--ink-color-global-text-default)" }}>
              {s.label}<span ref={setIntroSlot} /> {s.optional && <Badge tone="neutral" style={{ marginLeft: 6, verticalAlign: "middle" }}>optional</Badge>}
            </span>
            {s.summary && <span style={{ display: "block", fontSize: FS.body, color: "var(--ink-color-global-text-subtle)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.summary}</span>}
          </span>
          <span aria-hidden="true" style={{ flex: "none", display: "inline-flex", color: "var(--ink-color-global-text-subtle)",
            transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}><ChevronDownIcon size={18} /></span>
        </button>
        {s.aside && <span style={{ flex: "none", padding: "0 24px 0 4px", fontSize: FS.body, fontWeight: 400 }}>{s.aside}</span>}
      </h2>
      {/* Stays mounted when collapsed, so half-typed inputs keep their text. */}
      <div id={bodyId} hidden={!open} style={{ padding: "24px", display: open ? undefined : "none" }}>
        <EmbeddedContext.Provider value={introSlot ?? true}><View {...s.props} /></EmbeddedContext.Provider>
      </div>
    </section>
  );
}

export function Sections({ sections, testId, focus, focusKey, stepId, jumpBar = true, ...props }) {
  const pinned = usePinnedHeight();
  // Sections show their green check only once the step they belong to is confirmed.
  const confirmed = !stepId || !!props.plan?.confirmed?.[stepId];
  // Every section starts folded to its summary line; jumping to one, or arriving to change it, opens it.
  const [closed, setClosed] = useState(() => new Set(sections.map((s) => s.id)));
  const list = sections.map((s) => ({ ...s, ok: s.ok && confirmed, props }));
  const toggle = (id) => setClosed((c) => { const n = new Set(c); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const openIt = (id) => setClosed((c) => { if (!c.has(id)) return c; const n = new Set(c); n.delete(id); return n; });
  useEffect(() => {
    if (!focus || !sections.some((x) => x.id === focus)) return;
    openIt(focus);
    const raf = requestAnimationFrame(() => document.getElementById(secId(focus))?.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(raf);
  }, [focus, focusKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const allOpen = closed.size === 0;
  const noneOpen = closed.size === list.length;
  const toggleAll = (
    <button type="button" onClick={() => setClosed(allOpen ? new Set(list.map((s) => s.id)) : new Set())} data-testid="toggle-all"
      style={{ ...sans, marginLeft: "auto", flex: "none", fontSize: FS.body, fontWeight: 500, cursor: "pointer", padding: "6px 4px", whiteSpace: "nowrap",
        border: "none", background: "transparent", color: "var(--ink-color-global-link-default)" }}>{allOpen ? "Collapse all" : "Expand all"}</button>
  );
  return (
    <div data-testid={testId}>
      {/* With every card folded the cards are the navigation; the jump bar earns its place once something is open. */}
      {noneOpen || !jumpBar
        ? <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>{toggleAll}</div>
        : <JumpBar sections={list} top={pinned} onJump={openIt} trailing={toggleAll} />}
      {list.map((s, i) => <SectionCard key={s.id} s={s} index={i} scrollMargin={pinned + 64} open={!closed.has(s.id)} onToggle={() => toggle(s.id)} />)}
    </div>
  );
}

const general = (plan) => {
  const g = plan.general;
  const d = deriveGeneral(g);
  const bits = [g.committed > 0 ? `${fmtMIn(g.committed, g.currency)} committed${d.gpCommitted > 0 ? ` (${fmtMIn(d.gpCommitted, g.currency)} GP)` : ""}` : "Committed capital not set"];
  bits.push(g.evergreen ? "evergreen" : g.termYears ? `${g.termYears}-year term` : null);
  if (d.investmentPeriodEnd) bits.push(`invests until ${fmtYm(d.investmentPeriodEnd)}`);
  return bits.filter(Boolean).join(" · ");
};
const totalsOf = (result) => (result?.ok ? result.totals : result?.partial?.totals ?? null);
const waterfall = (plan, result) => {
  const w = plan.waterfall, ccy = plan.general.currency, t = result?.ok ? result.totals : null;
  const hurdle = w.hurdleType === "multiple" ? (w.hurdleMultiple != null ? `${w.hurdleMultiple}×` : null) : (w.preferredReturn != null ? fmtPct(w.preferredReturn, 0) : null);
  const pref = !waterfallTerms(w).prefOn ? "no pref" : hurdle ? `${hurdle} pref` : "pref not set";
  return [`${w.type === "european" ? "European" : "American"}`, pref, `${fmtPct(w.carryRate, 0)} carry`,
    ...(t ? [`${fmtMIn(t.lpDistributed, ccy)} to partners`, `${fmtMIn(t.gpCarryRealized + t.gpCarryUnrealized, ccy)} GP carry`] : [])].join(" · ");
};
const costs = (plan, result) => {
  const t = totalsOf(result), ccy = plan.general.currency;
  return t ? `${fmtMIn(t.fees, ccy)} fees · ${fmtMIn(t.expenses, ccy)} expenses · ${fmtMIn(t.investable, ccy)} investable` : undefined;
};

const advancedSections = (plan, result) => {
  const lpCommitted = deriveGeneral(plan.general).lpCommitted;
  const tiers = plan.fees?.tiers ?? [];
  const expenses = plan.fees?.expenses ?? [];
  const r = plan.recycling;
  return [
    { id: "general", label: "General", view: GeneralStep, ok: isEmpty(validateGeneral(plan.general)), summary: general(plan) },
    { id: "fees", label: "Fees & expenses", view: FeesStep, ok: isEmpty(validateFees(plan.fees, plan.general)),
      summary: costs(plan, result) ?? `${tiers[0] ? `${fmtPct(tiers[0].rate, 2)} management fee` : "No management fee"}${tiers.length > 1 ? ` + ${tiers.length - 1} more tier${tiers.length > 2 ? "s" : ""}` : ""} · ${expenses.length} expense line${expenses.length === 1 ? "" : "s"}` },
    { id: "recycling", label: "Exit recycling", view: RecyclingStep, optional: true, ok: isEmpty(validateRecycling(r)),
      summary: r?.enabled ? `On · ${fmtPct(r.pctOfProceeds, 0)} of proceeds, capped at ${fmtPct(r.capPct, 0)} of commitments${result?.ok ? ` · ${fmtMIn(result.totals.recycled, plan.general.currency)} recycled` : ""}` : "Off" },
    { id: "waterfall", label: "Waterfall", view: WaterfallStep, ok: isEmpty(validateWaterfall(plan.waterfall)), summary: waterfall(plan, result) },
    lpsSection(plan, lpCommitted),
  ];
};

const lpsSection = (plan, lpCommitted) => ({
  id: "lps", label: "Limited partners", view: LpsStep, optional: true, ok: isEmpty(validateLps(plan.lps ?? [], lpCommitted)),
  summary: plan.lps?.length ? `${plan.lps.length} LP${plan.lps.length === 1 ? "" : "s"} entered` : "Not entered. Modeled as one pooled LP.",
});

const lightTermsSections = (plan, result) => [
  { id: "general", label: "General", view: GeneralStep, ok: isEmpty(validateGeneral(effectiveGeneral(plan))), summary: general(plan) },
  { id: "fees", label: "Fees & expenses", view: LightFeesStep, ok: isEmpty(validateLightFees(plan.light.fees, plan.general)), summary: costs(plan, result) },
  { id: "waterfall", label: "Waterfall", view: WaterfallStep, ok: isEmpty(validateWaterfall(plan.waterfall)), summary: waterfall(plan, result) },
  lpsSection(plan, deriveGeneral(effectiveGeneral(plan)).lpCommitted),
];

const lightPortfolioSections = (plan) => [
  { id: "portfolio", label: "Portfolio", view: PortfolioStep, ok: isEmpty(validatePortfolio(plan.light)) },
  { id: "outcomes", label: "Outcomes", view: OutcomesStep, ok: isEmpty(validateOutcomes(plan.light)) },
];

export const LightTermsStep = (props) => <Sections testId="terms-step" stepId="terms" sections={lightTermsSections(props.plan, props.result)} {...props} />;
export const LightPortfolioStep = (props) => <Sections testId="light-portfolio-step" stepId="portfolio" sections={lightPortfolioSections(props.plan)} {...props} />;
export const AdvancedTermsStep = (props) => <Sections testId="terms-step" stepId="terms" sections={advancedSections(props.plan, props.result)} {...props} />;
// The section cards are the step's own frame, so the page shell skips its outer card for these.
[LightTermsStep, LightPortfolioStep, AdvancedTermsStep].forEach((c) => { c.flat = true; });
