// Portfolio — 30-second triage across the whole book.
//   quadrant  growth × value bubble chart (size = a third metric)
//   signals   rule-based watchlist (missed forecast, low runway, declining)
import { useMemo, useState } from "react";
import { FS, sans, mono, MICRO } from "../ui/theme.js";
import { H2, Dropdown, Segmented, Badge, Btn, TextInput, MultiSelect, Eyebrow } from "../ui/components.jsx";
import { QuadrantScatter, fmtVal } from "../ui/charts.jsx";
import { metricOf, latest, growth, qoqChange, metricOptions,
  numericMetrics, isCharted } from "../model/kpi.js";
import { allTags, tagId, companyMatchesTags } from "../model/tags.js";
import { portfolioSignals } from "../model/signals.js";
import { MEASURES, OPS, TONES, measureOf, opOf, ruleCondition, customPortfolioSignals, newRuleId } from "../model/rules.js";
import { openCompany, takePendingPortfolioMode } from "../state/focus.js";
import Benchmarks from "./Benchmarks.jsx";
import { trackClick } from "../analytics.js";
import { withCommas } from "../ui/format.js";

const isQuarterEnd = (d) => ["-03-", "-06-", "-09-", "-12-"].some((q) => String(d).includes(q));
const findMetric = (data, re) => (data.metrics || []).find((m) => re.test(m.label));

// Preset quadrant charts: each names a metric by label, a Y mode, and the
// narrative for reading that combination.
const PRESETS = [
  {
    id: "size-speed", label: "Size vs. Speed",
    xRe: /^revenue$/i, yRe: /^revenue$/i, yMode: "value", sizeRe: /^cash and cash equivalents$/i,
    blurb: "Bigger bubbles = more cash on hand. Companies in the top-right are large, fast-growing, and well-funded. Watch for top-left: high revenue but slow growth may signal stagnation. Bottom-right: fast growth but small cash bubble means they'll need to raise soon.",
  },
  {
    id: "burn-signal", label: "Burn Signal",
    xRe: /^cash and cash equivalents$/i, yRe: /^revenue$/i, yMode: "growth", sizeRe: /^ebitda$/i,
    blurb: "Left side = cash is shrinking; right side = cash is growing. Top-right companies are growing revenue and cash — the ideal. Large bubbles (high EBITDA) in the top-right confirm profitability. Bottom-left with a small bubble is your highest-risk quadrant: burning cash, slowing revenue, losing money.",
  },
  {
    id: "efficient-growth", label: "Efficient Growth",
    xRe: /^revenue$/i, yRe: /^gross margin$/i, yMode: "value", sizeRe: /^headcount$/i,
    blurb: "Top-right = growing fast with healthy margins — the sweet spot. Small bubbles there mean capital-efficient teams. Large bubbles in the bottom-right are growing revenue but with thin margins and big headcount — watch for unit economics pressure. Top-left companies have strong margins but need a growth catalyst.",
  },
];
const NONE_SIZE = "__NONE__";

export default function Portfolio({ data, dashboard }) {
  const [mode, setMode] = useState(() => takePendingPortfolioMode() || "quadrant");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 36 }}>
      {/* Title + mode switcher, kept tight against the mode's own intro prose —
          every mode below opens with a paragraph that explains this heading, so the
          36px page gap must not land between them. */}
      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <H2>Insights</H2>
          <Segmented options={[{ id: "quadrant", label: "Quadrant" }, { id: "signals", label: "Signals" }, { id: "benchmarks", label: "Benchmarks" }]} value={mode} onChange={(m) => { trackClick("PortfolioAnalytics.Portfolio.SetMode"); setMode(m); }} />
        </div>
        {mode === "quadrant" && <Quadrant data={data} dashboard={dashboard} />}
        {mode === "signals" && <Signals data={data} dashboard={dashboard} />}
        {mode === "benchmarks" && <Benchmarks data={data} />}
      </section>
    </div>
  );
}

/* ---------- Growth × value quadrant ---------- */
function Quadrant({ data, dashboard }) {
  const { metrics, dollar, defaultSizeKey } = useMemo(() => {
    const m = numericMetrics(data.metrics);
    const d = m.filter((mm) => mm.unit === "Dollar");
    return { metrics: m, dollar: d, defaultSizeKey: (findMetric(data, /^revenue$/i) || d[0] || {}).key };
  }, [data]);
  // Customize picks — independent of the preset choice, so switching back to
  // Customize restores whatever was last set here.
  const [xKey, setXKey] = useState(() => (findMetric(data, /^revenue$/i) || metrics[0] || {}).key);
  const [yKey, setYKey] = useState(() => (findMetric(data, /gross profit|ebitda/i) || dollar[1] || metrics[1] || {}).key);
  const [yMode, setYMode] = useState("value"); // value | growth
  const [sizeKey, setSizeKey] = useState(() => defaultSizeKey);
  const [presetId, setPresetId] = useState(PRESETS[0].id);

  const preset = presetId === "customize" ? null : PRESETS.find((p) => p.id === presetId);
  // A preset's metric may not exist on this firm's data — fall back to the app's
  // own default, never to a stale Customize "None" pick a preset never chose.
  const { activeXKey, activeYKey, activeYMode, activeSizeKey } = useMemo(() => ({
    activeXKey: preset ? ((findMetric(data, preset.xRe) || {}).key ?? xKey) : xKey,
    activeYKey: preset ? ((findMetric(data, preset.yRe) || {}).key ?? yKey) : yKey,
    activeYMode: preset ? preset.yMode : yMode,
    activeSizeKey: preset ? ((findMetric(data, preset.sizeRe) || {}).key ?? defaultSizeKey) : sizeKey,
  }), [data, preset, xKey, yKey, yMode, sizeKey, defaultSizeKey]);
  const sizeIsNone = activeSizeKey === NONE_SIZE;

  // Which companies to plot. Empty selections = no filter, matching the Dashboard.
  const doc = dashboard?.doc;
  const allFunds = data.dimensions?.funds || [];
  const [fund, setFund] = useState("ALL");
  const [selCompanies, setSelCompanies] = useState(() => new Set());
  const [selTags, setSelTags] = useState(() => new Set());
  const companies = useMemo(() => (data.companies || [])
    .filter((c) => fund === "ALL" || (c.funds || []).includes(fund))
    .filter((c) => selCompanies.size === 0 || selCompanies.has(c.id))
    .filter((c) => companyMatchesTags(c, selTags)),
    [data, fund, selCompanies, selTags, doc]);

  const xMetric = useMemo(() => metricOf(data, activeXKey), [data, activeXKey]);
  const yMetric = useMemo(() => metricOf(data, activeYKey), [data, activeYKey]);
  // Track WHY a company can't be plotted, not just that it can't — most of a
  // book can be missing from this chart and the footer has to say so honestly.
  const { points, missX, missY } = useMemo(() => {
    const out = []; let mx = 0, my = 0;
    for (const c of companies) {
      const x = qoqChange(c, activeXKey);                  // QoQ growth of X metric (calendar ~3mo)
      const yLatest = activeYMode === "growth" ? null : latest(c, activeYKey);
      const yv = activeYMode === "growth" ? qoqChange(c, activeYKey) : (yLatest || {}).v;
      const sz = sizeIsNone ? undefined : (latest(c, activeSizeKey) || {}).v;
      if (x == null) { mx++; continue; }
      if (yv == null) { my++; continue; }
      // carry the value's own currency so a Dollar Y-axis labels in it, not "$"
      out.push({ id: c.id, label: c.name, x, y: yv, size: sz, cur: yLatest ? yLatest.cur : undefined });
    }
    return { points: out, missX: mx, missY: my };
  }, [companies, activeXKey, activeYKey, activeYMode, activeSizeKey, sizeIsNone]);
  // A single currency for the value axis, or undefined when companies report the
  // Y metric in different currencies — never merge currencies onto one axis.
  const yCur = useMemo(() => {
    let cur;
    for (const p of points) {
      if (!p.cur) continue;
      if (cur === undefined) cur = p.cur;
      else if (cur !== p.cur) return undefined;
    }
    return cur;
  }, [points]);
  const excludedNote = [
    missX ? `${missX} lack ${xMetric ? xMetric.label : "X"} growth` : null,
    missY ? `${missY} lack ${yMetric ? yMetric.label : "Y"}${activeYMode === "growth" ? " growth" : ""}` : null,
  ].filter(Boolean).join(", ");
  const sizeMetric = useMemo(() => (sizeIsNone ? null : metricOf(data, activeSizeKey)), [data, activeSizeKey, sizeIsNone]);
  // Same rule as the Y axis: one shared currency for the size key, or none when
  // companies report the size metric in different currencies.
  const sizeCur = useMemo(() => {
    if (sizeIsNone) return undefined;
    let cur;
    for (const c of companies) {
      const p = latest(c, activeSizeKey);
      if (!p || !p.cur) continue;
      if (cur === undefined) cur = p.cur;
      else if (cur !== p.cur) return undefined;
    }
    return cur;
  }, [companies, activeSizeKey, sizeIsNone]);

  const opts = useMemo(() => metricOptions(metrics), [metrics]);
  const sizeOpts = useMemo(() => [{ id: NONE_SIZE, label: "None" }, ...opts], [opts]);
  const presetOpts = useMemo(() => [...PRESETS.map((p) => ({ id: p.id, label: p.label })),
    { id: "customize", label: "Customize", separatorBefore: true }], []);
  const fundOpts = useMemo(() => [{ id: "ALL", label: "All funds" },
    ...allFunds.map((f, i) => ({ id: f, label: f, separatorBefore: i === 0 }))], [allFunds]);
  // Companies grouped by fund (dimensions order), alphabetical within each fund;
  // listed once under the first fund so option ids stay unique.
  const companyOpts = useMemo(() => {
    const fundOrder = new Map(allFunds.map((f, i) => [f, i]));
    const firstFundOf = (c) => (c.funds || []).slice()
      .sort((a, b) => (fundOrder.get(a) ?? Infinity) - (fundOrder.get(b) ?? Infinity))[0];
    return (data.companies || [])
      .map((c) => ({ id: c.id, label: c.name, group: firstFundOf(c) || "No fund" }))
      .sort((a, b) => ((fundOrder.get(a.group) ?? Infinity) - (fundOrder.get(b.group) ?? Infinity)) || a.label.localeCompare(b.label));
  }, [data, allFunds]);
  // Tags grouped by category — MultiSelect draws a heading each time `group` changes.
  const tagOpts = useMemo(() => allTags(data).flatMap((g) => g.values.map((v) => ({ id: tagId(g.cat, v), label: v, group: g.cat }))), [data]);

  // X is always plotted as growth; Y follows its own value/growth toggle.
  const title = preset ? preset.label
    : `${xMetric ? xMetric.label : "X"} (growth) vs. ${yMetric ? yMetric.label : "Y"} (${activeYMode === "growth" ? "growth" : "value"})`;
  const subtitle = preset ? preset.blurb : undefined;
  // Switching to Customize from a preset seeds the toggles with that preset's
  // resolved metrics, so the chart doesn't jump when the toggles appear.
  const selectPreset = (id) => {
    trackClick("PortfolioAnalytics.Portfolio.SetChartPreset");
    if (id === "customize" && preset) {
      setXKey(activeXKey);
      setYKey(activeYKey);
      setYMode(activeYMode);
      setSizeKey(activeSizeKey);
    }
    setPresetId(id);
  };
  // Fold the currently-plotted book into the include-based Companies filter, minus
  // the clicked one — so the filter mirrors the chart and clearing it restores all.
  const removeCompany = (id) => {
    trackClick("PortfolioAnalytics.Portfolio.RemoveBubbleCompany");
    setSelCompanies(new Set(companies.map((c) => c.id).filter((cid) => cid !== id)));
  };
  const filtersRibbon = (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
      {allFunds.length > 0 && <Dropdown options={fundOpts} value={fund} onChange={setFund} triggerLabel="Fund" minWidth={170} />}
      <MultiSelect label="Companies" options={companyOpts} selected={selCompanies} onChange={setSelCompanies} minWidth={190} emptyLabel="All companies" />
      {tagOpts.length > 0 && <MultiSelect label="Tags" options={tagOpts} selected={selTags} onChange={setSelTags} minWidth={150} emptyLabel="All tags" />}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 36 }}>
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <Dropdown options={presetOpts} value={presetId} onChange={selectPreset} triggerLabel="Chart" minWidth={190} />
          {presetId === "customize" && (
            <>
              <Dropdown options={opts} value={xKey} onChange={setXKey} triggerLabel="X: growth of" minWidth={200} searchable />
              <Dropdown options={opts} value={yKey} onChange={setYKey} triggerLabel="Y" minWidth={200} searchable />
              <Segmented options={[{ id: "value", label: "Y = value" }, { id: "growth", label: "Y = growth" }]} value={yMode} onChange={setYMode} />
              <Dropdown options={sizeOpts} value={sizeKey} onChange={setSizeKey} triggerLabel="Bubble size" minWidth={160} />
            </>
          )}
        </div>
      </section>
      {/* Borderless by design — the chart's own grid is the frame, so a card
          border around it would read as a second one. */}
      <section style={{ display: "flex", flexDirection: "column" }}>
        <QuadrantScatter points={points} onSelect={openCompany} onRemove={removeCompany} totalCandidates={companies.length}
          excludedNote={excludedNote}
          title={title} subtitle={subtitle} filters={filtersRibbon}
          xLabel={xMetric ? xMetric.label : ""}
          yLabel={yMetric ? yMetric.label : ""}
          yMode={activeYMode}
          yUnit={activeYMode === "growth" ? "Percentage" : (yMetric ? yMetric.unit : "Number")}
          yCur={activeYMode === "growth" ? undefined : yCur}
          sizeLabel={sizeMetric ? sizeMetric.label : ""}
          sizeUnit={sizeMetric ? sizeMetric.unit || "Number" : "Number"} sizeCur={sizeCur} />
      </section>
    </div>
  );
}

/* ---------- Signals / watchlist ---------- */
function Signals({ data, dashboard }) {
  const doc = dashboard?.doc;
  const rules = doc?.rules || [];
  const useBuiltin = doc?.builtinSignals !== false; // default on

  const order = { negative: 0, warning: 1, info: 2 };
  const signals = useMemo(() => {
    const built = useBuiltin ? portfolioSignals(data) : [];
    const custom = customPortfolioSignals(data, rules);
    return [...built, ...custom].sort((a, b) => (order[a.tone] ?? 3) - (order[b.tone] ?? 3));
  }, [data, rules, useBuiltin]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 36 }}>
      <p style={{ ...sans, fontSize: FS.bodyLg, color: MICRO, margin: 0 }}>
        A watchlist of companies tripping a rule. The built-in rule flags a sustained revenue decline;
        add your own below (like conditional formatting in Excel). Click a company to open its 360.
      </p>

      <RulesEditor data={data} dashboard={dashboard} rules={rules} useBuiltin={useBuiltin} />

      {signals.length === 0 ? (
        <div className="card stat-bar" style={{ padding: 28, textAlign: "center", color: MICRO, ...sans }}>
          No signals firing{rules.length || useBuiltin ? "" : " — add a rule above to start flagging companies"}.
        </div>
      ) : (
        <div style={{ padding: 0, overflow: "hidden" }}>
          <table className="ledger sheet" style={{ width: "100%", borderCollapse: "collapse", ...sans }}>
            <thead>
              <tr style={{ textAlign: "left", color: MICRO, fontSize: FS.small }}>
                <th style={{ padding: "10px 14px" }}>Company</th>
                <th style={{ padding: "10px 14px" }}>Signal</th>
                <th style={{ padding: "10px 14px" }}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {signals.map((s) => (
                <tr key={s.id} style={{ borderBottom: `1px solid var(--ink-color-global-border-subtle)` }}>
                  <td style={{ padding: "10px 14px", fontWeight: 600, whiteSpace: "nowrap" }}>
                    <button onClick={() => openCompany(s.companyId)} style={nameBtn}>{s.company}</button>
                  </td>
                  <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                    <Badge tone={s.tone}>{s.tag}</Badge>
                    {s.custom && <Badge tone="muted" variant="text" style={{ marginLeft: 6 }}>custom</Badge>}
                  </td>
                  <td style={{ padding: "10px 14px", color: "var(--ink-color-global-text-subtle)", fontSize: FS.small }}>{s.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------- Custom-rule builder (conditional formatting for KPIs) ---------- */
const BLANK_RULE = { name: "", metricKey: "", measure: "latest", op: "lt", threshold: "", tone: "warning" };

function RulesEditor({ data, dashboard, rules, useBuiltin }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(BLANK_RULE);
  const [editId, setEditId] = useState(null);

  const metrics = (data.metrics || []).filter(isCharted);
  const metricOpts = metricOptions(metrics);
  const set = (fields) => setDraft((d) => ({ ...d, ...fields }));
  const reset = () => { setDraft(BLANK_RULE); setEditId(null); };

  const valid = draft.metricKey && draft.threshold !== "" && Number.isFinite(Number(draft.threshold));
  const save = () => {
    if (!valid) return;
    dashboard.update((doc) => {
      const list = [...(doc.rules || [])];
      if (editId) {
        const i = list.findIndex((r) => r.id === editId);
        if (i >= 0) list[i] = { ...list[i], ...draft };
      } else {
        list.push({ ...draft, id: newRuleId() });
      }
      doc.rules = list;
      return doc;
    });
    reset();
  };
  const edit = (r) => { setDraft({ name: r.name || "", metricKey: r.metricKey, measure: r.measure, op: r.op, threshold: String(r.threshold), tone: r.tone }); setEditId(r.id); setOpen(true); };
  const remove = (id) => dashboard.update((doc) => { doc.rules = (doc.rules || []).filter((r) => r.id !== id); return doc; });
  const setBuiltin = (on) => dashboard.update((doc) => { doc.builtinSignals = on; return doc; });

  return (
    <div className="card stat-bar" style={{ padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ ...sans, fontWeight: 600, fontSize: FS.bodyLg }}>Rules</span>
        <span style={{ ...sans, fontSize: FS.small, color: MICRO }}>{rules.length} custom · 1 built-in</span>
        <span style={{ flex: 1 }} />
        <Btn kind="primary" onClick={() => { trackClick("PortfolioAnalytics.Portfolio.AddRule"); reset(); setOpen((o) => !o); }}>{open ? "Close" : "+ Add rule"}</Btn>
      </div>

      {/* saved rules — built-in first, then custom */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          padding: "7px 10px", borderRadius: 6, background: "var(--ink-color-global-surface-lightgray-default)",
          opacity: useBuiltin ? 1 : 0.5 }}>
          <Badge tone="warning">Revenue declining</Badge>
          <span style={{ ...mono, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)" }}>Revenue QoQ growth &lt; 0% for 2 consecutive quarters</span>
          <Badge tone="muted" variant="text">built-in</Badge>
          <span style={{ flex: 1 }} />
          <Btn kind="link" style={{ fontSize: FS.small }} onClick={() => setBuiltin(!useBuiltin)}>{useBuiltin ? "Disable" : "Enable"}</Btn>
        </div>
        {rules.map((r) => (
          <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
            padding: "7px 10px", borderRadius: 6, background: "var(--ink-color-global-surface-lightgray-default)" }}>
            <Badge tone={r.tone}>{r.name || ruleCondition(data, r)}</Badge>
            <span style={{ ...mono, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)" }}>{ruleCondition(data, r)}</span>
            <span style={{ flex: 1 }} />
            <Btn kind="link" style={{ fontSize: FS.small }} onClick={() => edit(r)}>Edit</Btn>
            <Btn kind="link" style={{ fontSize: FS.small, color: "var(--ink-color-global-feedback-negative-strong)" }} onClick={() => remove(r.id)}>Delete</Btn>
          </div>
        ))}
      </div>

      {/* builder form */}
      {open && (
        <div style={{ marginTop: 14, borderTop: `1px solid var(--ink-color-global-border-subtle)`, paddingTop: 14,
          display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", lineHeight: 1.5 }}>
            Flag a company when <strong>{"{KPI}"}</strong>’s <strong>{"{measure}"}</strong> is <strong>{"{operator}"}</strong> your threshold —
            e.g. <em>Runway · Latest value · &lt; · 12</em> or <em>Revenue · QoQ growth % · &lt; · 10</em>.
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <FieldCol label="If KPI">
              <Dropdown options={metricOpts} value={draft.metricKey || null} nullLabel="Choose a KPI…" onChange={(id) => set({ metricKey: id })} minWidth={210} />
            </FieldCol>
            <FieldCol label="Measure">
              <Dropdown options={MEASURES.map((m) => ({ id: m.id, label: m.label }))} value={draft.measure} onChange={(id) => set({ measure: id })} minWidth={150} />
            </FieldCol>
            <FieldCol label="Is">
              <Dropdown options={OPS.map((o) => ({ id: o.id, label: o.sym }))} value={draft.op} onChange={(id) => set({ op: id })} minWidth={70} />
            </FieldCol>
            <FieldCol label={`Threshold${measureOf(draft.measure).pct ? " (%)" : ""}`}>
              <TextInput inputMode="decimal" placeholder="12" value={draft.threshold}
                onChange={(e) => set({ threshold: e.target.value.replace(/[^0-9.\-]/g, "") })} style={{ width: 110 }} />
            </FieldCol>
            <FieldCol label="Severity">
              <Segmented small options={TONES} value={draft.tone} onChange={(id) => set({ tone: id })} />
            </FieldCol>
          </div>
          <FieldCol label="Label (optional)">
            <TextInput placeholder={draft.metricKey ? ruleCondition(data, draft) : "e.g. Low runway"} value={draft.name}
              onChange={(e) => set({ name: e.target.value })} style={{ width: "min(360px, 100%)" }} />
          </FieldCol>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn kind="primary" onClick={save} disabled={!valid}>{editId ? "Save rule" : "Add rule"}</Btn>
            <Btn onClick={() => { reset(); setOpen(false); }}>Cancel</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

const FieldCol = ({ label, children }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
    <Eyebrow color={MICRO}>{label}</Eyebrow>
    {children}
  </div>
);

const nameBtn = { ...sans, border: "none", background: "transparent", padding: 0, cursor: "pointer", fontWeight: 600, fontSize: "inherit", color: "var(--ink-color-global-link-default)", textAlign: "left" };
