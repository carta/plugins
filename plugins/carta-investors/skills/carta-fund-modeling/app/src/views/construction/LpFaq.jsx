// Only due-diligence questions a model can answer with numbers belong here.
import { useMemo, useState } from "react";
import { FS, sans, inkNum } from "../../ui/theme.js";
import { Btn, TextInput, Dropdown, Segmented } from "../../ui/components.jsx";
import { buildFaq, faqText, FAQ_CATEGORIES } from "../../model/construction/faq.js";
import { breakevenExits, tornado } from "../../model/construction/analysis.js";
import FaqChart, { MarketCompare } from "./FaqCharts.jsx";
import { buildMarket, performanceCohorts } from "../../model/construction/faqMarket.js";
import { useFirmData } from "../../state/FirmData.jsx";
import { trackClick } from "../../analytics.js";
import { WriteupDoc } from "./WriteupStep.jsx";
import LpCashFlows from "./LpCashFlows.jsx";

const subtle = "var(--ink-color-global-text-subtle)";

function Item({ item, open, onToggle, ctx }) {
  const id = `faq-${item.id}`;
  return (
    <div data-testid={id} className="card" style={{ padding: 0, marginBottom: 8, overflow: "hidden" }}>
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={`${id}-answer`} data-testid={`${id}-toggle`}
        style={{ ...sans, display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", cursor: "pointer", border: "none", borderRadius: 0, padding: "12px 16px",
          background: "transparent", color: "var(--ink-color-global-text-default)", fontSize: FS.bodyLg, fontWeight: 600 }}>
        <span aria-hidden="true" style={{ flex: "none", display: "inline-block", fontSize: 10, color: subtle, transition: "transform .15s", transform: open ? "rotate(90deg)" : "none" }}>▶</span>
        <span style={{ flex: 1 }}>{item.question}</span>
      </button>
      {open && (
        <div id={`${id}-answer`} data-testid={`${id}-answer`} style={{ padding: "0 16px 14px 38px" }}>
          <div style={{ ...sans, fontSize: FS.bodyLg, lineHeight: 1.55 }}>{item.answer}</div>
          {open && <FaqChart id={item.id} ctx={ctx} />}
          {item.figures?.length > 0 && (
            <div style={{ display: "flex", gap: "8px 24px", flexWrap: "wrap", marginTop: 10 }}>
              {item.figures.map((f) => (
                <div key={f.label} style={{ minWidth: 0 }}>
                  <div style={{ ...sans, fontSize: FS.micro, color: subtle }}>{f.label}</div>
                  <div style={{ ...inkNum, fontSize: FS.value, fontWeight: 700 }}>{f.value}</div>
                </div>
              ))}
            </div>
          )}
          {item.market && <MarketCompare market={item.market} />}
        </div>
      )}
    </div>
  );
}

export default function LpFaq({ plan, res, base, snapshot, companies, onEdit }) {
  const [view, setView] = useState("qa");
  const { opsBenchmarks } = useFirmData();
  const cohorts = useMemo(() => performanceCohorts(snapshot), [snapshot]);
  const [vintage, setVintage] = useState(null);
  const market = useMemo(() => buildMarket(plan, res, { snapshot, ops: opsBenchmarks, vintage }), [plan, res, snapshot, opsBenchmarks, vintage]);
  const light = plan.mode === "light";
  // Costly pieces are worked out from the plan as entered, once per change; the rest comes from whichever scenario is showing.
  const sensitivity = useMemo(() => (light ? null : tornado(plan, "tvpi")), [light, plan]);
  const breakeven = useMemo(() => (light ? null : breakevenExits(plan)), [light, plan]);
  const items = useMemo(() => buildFaq(plan, res, { scenarios: base?.scenarios, sensitivity, breakeven, market }), [plan, res, base, sensitivity, breakeven, market]);
  const ctx = useMemo(() => ({ plan, res, scenarios: base?.scenarios, sensitivity }), [plan, res, base, sensitivity]);
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(() => new Set(["size"]));
  const [copied, setCopied] = useState(false);

  const q = query.trim().toLowerCase();
  const shown = items.filter((i) => (category === "all" || i.category === category) && (!q || `${i.question} ${i.answer}`.toLowerCase().includes(q)));
  const counts = Object.fromEntries(FAQ_CATEGORIES.map((c) => [c.id, items.filter((i) => i.category === c.id).length]));
  const allOpen = shown.length > 0 && shown.every((i) => open.has(i.id));
  const toggle = (id) => setOpen((cur) => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const copy = async () => {
    trackClick("FundModeling.FundConstruction.Faq.Copy");
    try { await navigator.clipboard.writeText(faqText(shown)); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); }
  };
  const chip = (id, label, n) => {
    const on = category === id;
    return (
      <button key={id} type="button" aria-pressed={on} onClick={() => setCategory(id)} data-testid={`faq-cat-${id}`}
        style={{ ...sans, fontSize: FS.body, padding: "5px 12px", borderRadius: 16, cursor: "pointer",
          border: `1px solid ${on ? "var(--ink-color-global-border-active)" : "var(--ink-color-global-border-subtle)"}`,
          background: on ? "var(--ink-color-global-surface-lightgray-default)" : "transparent", color: on ? "var(--ink-color-global-text-default)" : subtle }}>
        {label} <span style={{ opacity: 0.7 }}>{n}</span>
      </button>
    );
  };

  const switcher = (
    <div style={{ marginBottom: 12 }}>
      <Segmented small value={view} onChange={(v) => { trackClick(`FundModeling.FundConstruction.Faq.View.${v}`); setView(v); }}
        options={[{ id: "qa", label: "Q&A", testId: "faq-view-qa" }, { id: "writeup", label: "Fund write-up", testId: "faq-view-writeup" }, { id: "lpflows", label: "LP cash flows", testId: "faq-view-lpflows" }]} />
    </div>
  );
  if (view === "lpflows") {
    return <div data-testid="mv-panel-faq">{switcher}<LpCashFlows plan={plan} res={res} onEdit={onEdit} /></div>;
  }
  if (view === "writeup") {
    return <div data-testid="mv-panel-faq">{switcher}<WriteupDoc plan={plan} res={res} snapshot={snapshot} companies={companies} faq={items} onEdit={onEdit} /></div>;
  }

  return (
    <div data-testid="mv-panel-faq">
      {switcher}
      <div style={{ ...sans, fontSize: FS.body, color: subtle, marginBottom: 12, maxWidth: "75ch" }}>
        The questions LPs commonly ask in due diligence on a fund, answered with this plan's numbers. The answers update as you change the plan. Thesis, team and strategy are in the fund write-up.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        {chip("all", "All", items.length)}
        {FAQ_CATEGORIES.filter((c) => counts[c.id] > 0).map((c) => chip(c.id, c.label, counts[c.id]))}
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search questions and answers" aria-label="Search questions" data-testid="faq-search" style={{ flex: "1 1 260px", maxWidth: 420 }} />
        <Btn onClick={() => setOpen(allOpen ? new Set([...open].filter((id) => !shown.some((i) => i.id === id))) : new Set([...open, ...shown.map((i) => i.id)]))} data-testid="faq-toggle-all">
          {allOpen ? "Collapse all" : "Expand all"}
        </Btn>
        <Btn onClick={copy} disabled={!shown.length} data-testid="faq-copy">{copied ? "Copied" : "Copy answers"}</Btn>
        {cohorts.length > 1 && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span style={{ ...sans, fontSize: FS.small, color: subtle }}>Compare performance with</span>
            <Dropdown testId="faq-vintage" minWidth={200} value={String((cohorts.find((c) => c.vintage === vintage) ?? cohorts[0]).vintage)}
              options={cohorts.map((c) => ({ id: String(c.vintage), label: `${c.vintage} vintage, ${c.age} years in` }))} onChange={(v) => setVintage(+v)} />
          </span>
        )}
        <span data-testid="faq-count" style={{ ...sans, fontSize: FS.small, color: subtle }}>{shown.length} of {items.length} questions</span>
      </div>
      {shown.length === 0
        ? <div data-testid="faq-empty" style={{ ...sans, color: subtle }}>No questions match. Try a different word or category.</div>
        : shown.map((i) => <Item key={i.id} item={i} open={open.has(i.id)} onToggle={() => toggle(i.id)} ctx={ctx} />)}
    </div>
  );
}
