// Covenants — the Formulas builder plus a threshold and a test. Each covenant is
// evaluated every quarter and reported as HEADROOM: how much room is left before
// it trips. See model/covenant.js for why the default basis is LTM.
import { useMemo, useState } from "react";
import { FS, sans, mono, MICRO } from "../ui/theme.js";
import { Dropdown, Segmented, TextInput, Btn, Badge, StatBar, Glossary, MultiSelect, HintIcon } from "../ui/components.jsx";
import Chart, { fmtVal } from "../ui/charts.jsx";
import { compile, resolveRefs } from "../model/formula.js";
import { metricOf, metricOptions, numericMetrics } from "../model/kpi.js";
import {
  availablePresets, covenantTable, portfolioBreaches, thresholdAt, headroomOf, statusOf,
  DIRECTIONS, BASES, DEFAULT_WATCH, STATUS_LABEL, STATUS_TONE, MIN_TTM_QUARTERS,
} from "../model/covenant.js";
import { openCompany } from "../state/focus.js";
import { trackClick } from "../analytics.js";
import { withCommas } from "../ui/format.js";

const UNITS = [{ id: "Ratio", label: "×" }, { id: "Dollar", label: "$" }, { id: "Percentage", label: "%" }, { id: "Number", label: "Number" }];
const OPS = ["+", "−", "×", "÷", "(", ")"];
let _seq = 0;
const newId = () => `cov-${++_seq}-${(_seq * 40503) % 100000}`;

const nameBtn = { ...sans, border: "none", background: "transparent", padding: 0, cursor: "pointer",
  fontWeight: 600, fontSize: "inherit", color: "var(--ink-color-global-link-default)", textAlign: "left" };
const code = { fontFamily: mono.fontFamily, fontSize: FS.small, background: "var(--ink-color-global-surface-lightgray-default)", padding: "2px 6px", borderRadius: 4, color: "var(--ink-color-global-text-default)" };
const opBtn = { ...mono, width: 34, height: 34, borderRadius: 4, border: `1px solid var(--ink-color-global-border-default)`, background: "var(--ink-color-global-surface-background-default)", color: "var(--ink-color-global-text-default)", cursor: "pointer", fontSize: FS.bodyLg, fontWeight: 600 };

function fmtOut(v, unit) {
  if (v == null || !Number.isFinite(v)) return "—";
  if (unit === "Ratio") return v.toFixed(2) + "×";
  if (unit === "Percentage") return withCommas((v * 100).toFixed(1)) + "%";
  return fmtVal(v, unit);
}
const pctTxt = (h) => (h == null ? "—" : Math.abs(h) > 9.99 ? (h >= 0 ? "> +999%" : "< −999%")
  : (h >= 0 ? "+" : "−") + withCommas(Math.abs(h * 100).toFixed(0)) + "%");
// Headroom is a share of the threshold, so a deeply breached company produces an
// unbounded swing (94x against a 4x limit is −2271%). Clamping the DISPLAY keeps
// "▲ 40040pt" out of the table; the underlying numbers are untouched.
const trendTxt = (t) => (t == null ? "—" : (t >= 0 ? "▲ " : "▼ ")
  + (Math.abs(t) > 9.99 ? ">999" : Math.abs(t * 100).toFixed(0)) + "pt");
const opSign = (d) => (d === "max" ? "≤" : "≥");

const GLOSSARY = [
  { term: "Headroom", short: "how much room is left before it trips",
    body: "The distance to the threshold, as a share of the threshold. On a 4.0× leverage covenant, a company at 3.2× has +20% headroom. Negative means it has breached. It reads the same way for a maximum and a minimum test, so one column works for both. Headroom is the number credit investors actually watch — knowing a company is 'compliant' at 3.95× against a 4.0× limit is not the same as knowing it's compliant at 2.0×." },
  { term: "Watch", short: "compliant, but close",
    body: "Headroom below the watch band (20% by default) but still positive. The point is early warning: headroom erodes gradually — a company can shed several points a quarter as earnings slip — so the useful alert comes well before the breach, not on it." },
  { term: "Trend", short: "change in headroom since last quarter",
    body: "Headroom this quarter minus headroom last quarter. A company at +35% and falling ten points a quarter is a more urgent problem than one sitting flat at +15%." },
  { term: "LTM basis", short: "the last four quarters, as credit agreements define it",
    body: "Flows (EBITDA, revenue, capex) are summed across the trailing four quarters; balances (debt, cash) take the closing value. This is not optional cosmetics: using a single quarter's EBITDA in a Debt/EBITDA ratio makes it read about four times too high and would show a healthy portfolio as breaching. Monthly reporters are rolled into quarters first, so twelve months means twelve months. A quarter is only tested when all four quarters are present — a partial year isn't a year." },
  { term: "Point-in-time basis", short: "for tests that aren't about a period",
    body: "Each quarter on its own reported figures. Right for a pure balance test like minimum cash or a current ratio; wrong for anything dividing by EBITDA." },
  { term: "Step-downs", short: "thresholds that tighten over time",
    body: "Credit agreements usually ratchet the limit down (leverage max 5.0× through 2025, then 4.5×). Add a dated step and each quarter is tested against whichever threshold was actually in force then — without it, historical periods get judged by today's tighter limit and show breaches that never happened." },
  { term: "Not meaningful", short: "the ratio can't be judged this quarter",
    body: "A ratio only means something when its denominator is positive. Debt \u00f7 NEGATIVE EBITDA produces a negative number, which trivially satisfies a \u2018at most 4.0\u00d7\u2019 test \u2014 so a company carrying debt with negative earnings, the most distressed case there is, would otherwise be reported as passing. On this portfolio that was 60 of 72 tested companies. Those quarters are flagged rather than passed, and the honest test for that situation is a minimum-EBITDA covenant, which is exactly why credit agreements pair the two." },
  { term: "What this is not", short: "it doesn't read your credit agreement",
    body: "This tests the KPI data companies reported against thresholds you type in. It has no knowledge of the actual loan documents — EBITDA add-backs and adjusted-EBITDA definitions, equity cure rights, springing covenants and incurrence-only tests all live there. Treat the output as a monitoring signal, not a compliance certificate." },
];

export default function Covenants({ data, dashboard }) {
  const metrics = numericMetrics(data.metrics);
  const covenants = dashboard.doc?.covenants || [];
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(null);

  const presets = useMemo(() => availablePresets(metrics), [metrics]);
  const breaches = useMemo(() => portfolioBreaches(data, covenants), [data, covenants]);

  const blank = () => ({ name: "", expr: "", direction: "max", basis: "ttm", unit: "Ratio",
    thresholds: [{ from: null, value: "" }], watchPct: DEFAULT_WATCH, companyIds: [], requirePositive: "" });
  const startNew = () => { setEditingId(null); setDraft(blank()); };
  const loadPreset = (p) => {
    setEditingId(null);
    setDraft({ name: p.name, expr: p.expr, direction: p.direction, basis: p.basis, unit: p.unit,
      thresholds: [{ from: null, value: p.threshold }], watchPct: DEFAULT_WATCH, companyIds: [],
      requirePositive: p.requirePositive || "" });
  };
  const edit = (c) => { setEditingId(c.id); setDraft({ ...c, thresholds: c.thresholds?.length ? c.thresholds : [{ from: null, value: "" }] }); };
  const cancel = () => { setEditingId(null); setDraft(null); };
  const save = (c) => {
    const rec = { ...c, id: editingId || newId(), name: (c.name || "").trim() };
    dashboard.update((d) => {
      const list = d.covenants || [];
      d.covenants = editingId ? list.map((x) => (x.id === editingId ? rec : x)) : [...list, rec];
      return d;
    });
    cancel();
  };
  const remove = (id) => dashboard.update((d) => { d.covenants = (d.covenants || []).filter((x) => x.id !== id); return d; });

  const tight = breaches.filter((b) => b.status === "breach" || b.status === "watch");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 36 }}>
      {/* The two intro paragraphs are ONE group — the page's 36px section gap must
          not get between an explanation and its second half. */}
      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <p style={{ ...sans, fontSize: FS.body, color: "var(--ink-color-global-text-subtle)", lineHeight: 1.55, margin: 0, maxWidth: 920 }}>
          A covenant is a formula with a <strong>threshold and a test</strong>. Build the ratio exactly as you would a
          custom formula, then set whether it must stay at most or at least some value — the app tests it every quarter
          and reports <strong>headroom</strong>: how much room is left before it trips.
        </p>
        <p style={{ ...sans, fontSize: FS.bodyLg, color: MICRO, lineHeight: 1.6, margin: 0, maxWidth: 920 }}>
          Tested on an <strong>LTM</strong> basis by default, the way credit agreements define maintenance tests — flows
          summed over four quarters, balances at closing. This checks <em>reported KPI data against thresholds you enter</em>;
          it does not read your credit agreements.
        </p>
      </section>

      <Glossary items={GLOSSARY} />

      {/* ---- portfolio breach table ---- */}
      {covenants.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <StatBar basis={150} stats={[
            { label: "Covenants", value: covenants.length, hint: "Covenant tests you've defined." },
            { label: "Breaching", value: breaches.filter((b) => b.status === "breach").length,
              hint: "Company/covenant pairs where the latest tested quarter is past the threshold." },
            { label: "On watch", value: breaches.filter((b) => b.status === "watch").length,
              hint: "Still compliant, but inside the watch band — the early warning." },
            { label: "Passing", value: breaches.filter((b) => b.status === "pass").length,
              hint: "Comfortably within the threshold at the latest tested quarter." },
          ]} />

          {/* The eyebrow label belongs to the table under it — one tight group. */}
          <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ ...sans, fontSize: FS.small, fontWeight: 600, color: MICRO, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Tightest headroom across the book
          </div>
          {tight.length === 0 ? (
            <div className="card" style={{ padding: 20, textAlign: "center", color: MICRO, ...sans }}>
              Nothing breaching or on watch — every tested company is comfortably inside its thresholds.
            </div>
          ) : (
            <div style={{ padding: 0, overflow: "hidden" }}>
              <table className="ledger sheet" style={{ width: "100%", borderCollapse: "collapse", ...sans }}>
                <thead>
                  <tr style={{ textAlign: "left", color: MICRO, fontSize: FS.small }}>
                    <th style={{ padding: "10px 14px" }}>Company</th>
                    <th style={{ padding: "10px 14px" }}>Covenant</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>Latest</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>Limit</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                        Headroom
                        <HintIcon hint="How much room is left before it trips, as a share of the threshold. Negative = breached." />
                      </span>
                    </th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                        Trend
                        <HintIcon hint="Change in headroom since the previous quarter. Falling headroom is the early warning." />
                      </span>
                    </th>
                    <th style={{ padding: "10px 14px" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {tight.slice(0, 40).map((b) => (
                    <tr key={b.covenantId + b.id} style={{ borderBottom: `1px solid var(--ink-color-global-border-subtle)` }}>
                      <td style={{ padding: "10px 14px" }}><button onClick={() => openCompany(b.id)} style={nameBtn}>{b.name}</button></td>
                      <td style={{ padding: "10px 14px", ...sans, fontSize: FS.small, color: MICRO }}>{b.covenant}</td>
                      <td data-tip={`Tested at ${b.d}`} style={{ padding: "10px 14px", textAlign: "right", ...mono, fontWeight: 600 }}>{fmtOut(b.value, b.unit)}</td>
                      <td style={{ padding: "10px 14px", textAlign: "right", ...mono, color: MICRO }}>{opSign(b.direction)} {fmtOut(b.threshold, b.unit)}</td>
                      <td style={{ padding: "10px 14px", textAlign: "right", ...mono, fontWeight: 700,
                        color: b.headroom < 0 ? "var(--ink-color-global-feedback-negative-strong)" : undefined }}>{pctTxt(b.headroom)}</td>
                      <td style={{ padding: "10px 14px", textAlign: "right", ...mono, fontSize: FS.small,
                        color: b.trend == null ? MICRO : b.trend < 0 ? "var(--ink-color-global-feedback-negative-strong)" : "var(--ink-color-global-feedback-positive-strong)" }}>
                        {trendTxt(b.trend)}
                      </td>
                      <td style={{ padding: "10px 14px" }}><Badge tone={STATUS_TONE[b.status]}>{STATUS_LABEL[b.status]}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          </section>
        </section>
      )}

      {/* ---- builder ---- */}
      {draft ? (
        <Builder data={data} draft={draft} setDraft={setDraft} onSave={save} onCancel={cancel} editing={!!editingId} />
      ) : (
        <div className="card" style={{ padding: 18 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <Btn kind="primary" onClick={() => { trackClick("PortfolioAnalytics.Covenants.New"); startNew(); }}>New covenant</Btn>
            {presets.length > 0 && <span style={{ ...sans, fontSize: FS.small, color: MICRO }}>or start from:</span>}
            {presets.map((p) => (
              <button key={p.name} onClick={() => loadPreset(p)} data-tip={`${p.note}\n\n${p.expr}\n${opSign(p.direction)} ${p.threshold} · ${p.basis === "ttm" ? "LTM" : "point-in-time"}`}
                style={{ ...sans, fontSize: FS.small, fontWeight: 500, padding: "5px 11px", borderRadius: 6, cursor: "pointer",
                  border: `1px solid var(--ink-color-global-border-default)`, background: "var(--ink-color-global-surface-background-default)",
                  color: "var(--ink-color-global-text-default)" }}>{p.name}</button>
            ))}
          </div>
          <p style={{ ...sans, fontSize: FS.bodyLg, color: MICRO, lineHeight: 1.6, margin: "10px 0 0", maxWidth: 900 }}>
            Presets appear only when this firm reports the KPIs they need. Interest coverage, fixed-charge coverage,
            debt-service coverage and capex limits are built in and will show up automatically for a firm that reports
            interest expense, capex or scheduled principal — and any covenant can be written by hand against whatever
            KPIs you do collect.
          </p>
        </div>
      )}

      {/* ---- saved covenants ---- */}
      {covenants.length === 0 ? (
        <div className="card" style={{ padding: 28, textAlign: "center", color: MICRO, ...sans }}>
          No covenants yet. Start from a preset above, or build one from any KPI you collect.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {covenants.map((c) => (
            <CovenantCard key={c.id} cov={c} data={data} onEdit={() => edit(c)} onDelete={() => remove(c.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- builder ---------- */
function Builder({ data, draft, setDraft, onSave, onCancel, editing }) {
  const metrics = numericMetrics(data.metrics);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const insert = (s) => set({ expr: draft.expr + (draft.expr && !/[\s(]$/.test(draft.expr) ? " " : "") + s });

  const compiled = useMemo(() => compile(draft.expr), [draft.expr]);
  const resolved = useMemo(() => resolveRefs(compiled.refs, metrics), [compiled, metrics]);
  const thresholds = draft.thresholds || [];
  const hasThreshold = thresholds.some((t) => t.value !== "" && t.value != null && Number.isFinite(Number(t.value)));
  const valid = !compiled.error && compiled.fn && resolved.unknown.length === 0 && draft.name.trim() && hasThreshold;

  // live preview against the real book
  const preview = useMemo(() => (valid ? covenantTable(data, { ...draft, thresholds }) : null), [valid, data, draft, thresholds]);

  const setThreshold = (i, patch) => set({ thresholds: thresholds.map((t, n) => (n === i ? { ...t, ...patch } : t)) });
  const addStep = () => set({ thresholds: [...thresholds, { from: "", value: "" }] });
  const dropStep = (i) => set({ thresholds: thresholds.filter((_, n) => n !== i) });

  const coOpts = (data.companies || []).map((c) => ({ id: c.id, label: c.name }));
  const selected = new Set(draft.companyIds || []);

  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <TextInput placeholder="Covenant name (e.g. Max total leverage)" value={draft.name}
          onChange={(e) => set({ name: e.target.value })} style={{ width: 260 }} />
        <span style={{ ...sans, fontSize: FS.small, color: MICRO }}>Format:</span>
        <Segmented small options={UNITS} value={draft.unit} onChange={(v) => set({ unit: v })} />
      </div>

      <TextInput placeholder="({Loans Payable, Current} + {Loans Payable, Less Current}) ÷ {EBITDA}"
        value={draft.expr} onChange={(e) => set({ expr: e.target.value })}
        style={{ width: "100%", fontFamily: mono.fontFamily, marginBottom: 10 }} />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <Dropdown options={metricOptions(metrics)} value={null} nullLabel="Insert KPI…" minWidth={190}
          onChange={(key) => insert(`{${(metricOf(data, key) || {}).label}}`)} />
        {OPS.map((op) => <button key={op} onClick={() => insert(op)} style={opBtn}>{op}</button>)}
        {["yoy(", "prior("].map((f) => (
          <button key={f} onClick={() => insert(f)} style={{ ...opBtn, width: "auto", padding: "0 10px", fontSize: FS.small }}>{f} )</button>
        ))}
        <button onClick={() => set({ expr: "" })} style={{ ...opBtn, width: "auto", padding: "0 10px", fontSize: FS.small }}>Clear</button>
      </div>

      {/* test definition */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <span style={{ ...sans, fontSize: FS.small, color: MICRO }}>Must be</span>
        <Segmented small options={DIRECTIONS.map((d) => ({ id: d.id, label: d.label }))} value={draft.direction} onChange={(v) => set({ direction: v })} />
        <span data-tip={BASES.find((b) => b.id === draft.basis)?.hint} style={{ ...sans, fontSize: FS.small, color: MICRO, cursor: "help" }}>Tested on</span>
        <Segmented small options={BASES.map((b) => ({ id: b.id, label: b.label }))} value={draft.basis} onChange={(v) => set({ basis: v })} />
        <span data-tip="Flag as Watch once headroom falls below this share of the threshold. 20% is the usual rule of thumb."
          style={{ ...sans, fontSize: FS.small, color: MICRO, cursor: "help" }}>Watch below</span>
        <TextInput value={Math.round((draft.watchPct ?? DEFAULT_WATCH) * 100)} onChange={(e) => set({ watchPct: (Number(e.target.value) || 0) / 100 })}
          style={{ width: 62, fontFamily: mono.fontFamily }} />
        <span style={{ ...sans, fontSize: FS.small, color: MICRO }}>%</span>
      </div>

      {/* thresholds + step-downs */}
      <div style={{ marginBottom: 14 }}>
        {thresholds.map((t, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
            <span style={{ ...sans, fontSize: FS.small, color: MICRO, width: 96 }}>{i === 0 ? "Threshold" : "then from"}</span>
            {i > 0 && (
              <TextInput placeholder="YYYY-MM-DD" value={t.from || ""} onChange={(e) => setThreshold(i, { from: e.target.value })}
                style={{ width: 130, fontFamily: mono.fontFamily }} />
            )}
            <span style={{ ...mono, fontSize: FS.body }}>{opSign(draft.direction)}</span>
            <TextInput placeholder="4.0" value={t.value} onChange={(e) => setThreshold(i, { value: e.target.value })}
              style={{ width: 110, fontFamily: mono.fontFamily }} />
            {i > 0 && <button onClick={() => dropStep(i)} style={{ ...opBtn, width: "auto", padding: "0 10px", fontSize: FS.small }}>Remove</button>}
          </div>
        ))}
        <button onClick={addStep} data-tip="Credit agreements usually tighten the limit over time. Each period is tested against whichever threshold was in force then."
          style={{ ...sans, fontSize: FS.small, fontWeight: 500, padding: "4px 10px", borderRadius: 6, cursor: "pointer", marginTop: 2,
            border: `1px solid var(--ink-color-global-border-default)`, background: "var(--ink-color-global-surface-background-default)",
            color: "var(--ink-color-global-text-default)" }}>+ Add step-down</button>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        <span style={{ ...sans, fontSize: FS.small, color: MICRO, display: "inline-flex", alignItems: "center", gap: 4 }}>
          Only meaningful when
          <HintIcon hint={"A ratio only means something when its denominator is positive. Debt \u00f7 NEGATIVE EBITDA comes out negative, which trivially satisfies \u2018at most 4.0x\u2019 \u2014 so a company with debt and negative earnings would be reported as passing. Name the expression that must be above zero (e.g. {EBITDA}); quarters where it isn\u2019t are flagged \u2018Not meaningful\u2019 instead of silently passed. Leave blank to test every quarter."} />
        </span>
        <TextInput placeholder="{EBITDA}" value={draft.requirePositive || ""}
          onChange={(e) => set({ requirePositive: e.target.value })}
          style={{ width: 260, fontFamily: mono.fontFamily }} />
        <span style={{ ...sans, fontSize: FS.small, color: MICRO }}>is above zero</span>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <MultiSelect label="Applies to" options={coOpts} selected={selected}
          onChange={(s) => set({ companyIds: [...s] })} minWidth={190} emptyLabel="All companies" />
        <span style={{ ...sans, fontSize: FS.small, color: MICRO }}>
          {selected.size === 0 ? "All companies" : `${selected.size} compan${selected.size === 1 ? "y" : "ies"}`}
        </span>
      </div>

      {/* validity + preview */}
      <div style={{ minHeight: 22, marginBottom: 10 }}>
        {compiled.error && <span style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-feedback-negative-strong)" }}>⚠ {compiled.error}</span>}
        {!compiled.error && resolved.unknown.length > 0 && (
          <span style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-feedback-negative-strong)" }}>⚠ Unknown KPI: {resolved.unknown.join(", ")}</span>
        )}
        {preview && (
          <span style={{ ...sans, fontSize: FS.small, color: MICRO }}>
            Tests <strong style={{ color: "var(--ink-color-global-text-default)" }}>{preview.tested}</strong> of {preview.scope} companies ·{" "}
            <strong style={{ color: "var(--ink-color-global-feedback-negative-strong)" }}>{preview.counts.breach || 0}</strong> breaching ·{" "}
            <strong>{preview.counts.watch || 0}</strong> on watch
            {preview.counts.notmeaningful ? <> · <strong>{preview.counts.notmeaningful}</strong> not meaningful</> : null}
            {preview.tested < preview.scope && ` · ${preview.scope - preview.tested} untestable (missing KPIs or under ${MIN_TTM_QUARTERS} quarters of history)`}
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Btn kind="primary" onClick={() => onSave(draft)} disabled={!valid}>{editing ? "Update covenant" : "Save covenant"}</Btn>
        <Btn onClick={onCancel}>Cancel</Btn>
      </div>
    </div>
  );
}

/* ---------- saved covenant card ---------- */
function CovenantCard({ cov, data, onEdit, onDelete }) {
  const { rows, error, counts, tested, scope } = useMemo(() => covenantTable(data, cov), [data, cov]);
  const [coId, setCoId] = useState(null);
  const unit = cov.unit || "Ratio";
  const steps = (cov.thresholds || []).filter((t) => t.value !== "" && t.value != null);
  const focus = rows.find((r) => r.id === coId) || rows[0];

  const series = useMemo(() => {
    if (!focus) return [];
    return [
      { key: "val", label: cov.name, points: focus.series.map((p) => ({ d: p.d, v: p.value })) },
      { key: "lim", label: `Limit (${opSign(cov.direction)})`, points: focus.series.filter((p) => p.threshold != null).map((p) => ({ d: p.d, v: p.threshold })), dashed: true },
    ];
  }, [focus, cov]);

  return (
    <>
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
        <div style={{ ...sans, fontSize: FS.h3, fontWeight: 600 }}>{cov.name}</div>
        <code style={code}>{cov.expr}</code>
        <Badge tone="strong">{opSign(cov.direction)} {steps.map((t) => fmtOut(Number(t.value), unit) + (t.from ? ` from ${t.from}` : "")).join(" → ")}</Badge>
        <Badge tone="muted" title={BASES.find((b) => b.id === (cov.basis || "ttm"))?.hint}>{(cov.basis || "ttm") === "ttm" ? "LTM" : "Point-in-time"}</Badge>
        <span style={{ flex: 1 }} />
        <Btn onClick={onEdit} style={{ height: "auto", padding: "5px 11px", fontSize: FS.small }}>Edit</Btn>
        <Btn kind="danger" onClick={onDelete} style={{ height: "auto", padding: "5px 11px", fontSize: FS.small }}>Delete</Btn>
      </div>

      {error ? (
        <div style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-feedback-negative-strong)", marginTop: 8 }}>⚠ {error}</div>
      ) : rows.length === 0 ? (
        <div style={{ ...sans, fontSize: FS.small, color: MICRO, marginTop: 8 }}>
          No company has the KPIs and history this covenant needs
          {(cov.basis || "ttm") === "ttm" ? ` (an LTM test needs ${MIN_TTM_QUARTERS} consecutive quarters)` : ""}.
        </div>
      ) : (
        <div style={{ ...sans, fontSize: FS.small, color: MICRO }}>
          <strong style={{ color: "var(--ink-color-global-feedback-negative-strong)" }}>{counts.breach || 0}</strong> breaching ·{" "}
          <strong>{counts.watch || 0}</strong> on watch · <strong>{counts.pass || 0}</strong> passing
          {counts.notmeaningful ? <> · <strong>{counts.notmeaningful}</strong> not meaningful</> : null} ·{" "}
          {tested} of {scope} companies testable
          {cov.requirePositive ? <> · guarded on <code style={{ ...code, fontSize: FS.micro }}>{cov.requirePositive}</code></> : null}
        </div>
      )}
    </div>
    {!error && rows.length > 0 && (
      <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 1fr) minmax(320px, 1.1fr)", gap: 20, alignItems: "start" }}>
        <div style={{ maxHeight: 330, overflowY: "auto", border: `1px solid var(--ink-color-global-border-subtle)`, borderRadius: 4 }}>
          <table className="ledger sheet" style={{ width: "100%", borderCollapse: "collapse", ...sans, fontSize: FS.small }}>
            <thead>
              <tr style={{ textAlign: "left", color: MICRO }}>
                <th style={{ padding: "8px 12px", position: "sticky", top: 0, background: "var(--ink-color-global-surface-lightgray-default)" }}>Company</th>
                <th style={{ padding: "8px 12px", textAlign: "right", position: "sticky", top: 0, background: "var(--ink-color-global-surface-lightgray-default)" }}>Value</th>
                <th style={{ padding: "8px 12px", textAlign: "right", position: "sticky", top: 0, background: "var(--ink-color-global-surface-lightgray-default)" }}>Headroom</th>
                <th style={{ padding: "8px 12px", position: "sticky", top: 0, background: "var(--ink-color-global-surface-lightgray-default)" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} onClick={() => setCoId(r.id)}
                  style={{ borderBottom: `1px solid var(--ink-color-global-border-subtle)`, cursor: "pointer",
                    background: focus && r.id === focus.id ? "var(--accent-soft)" : "transparent" }}>
                  <td style={{ padding: "7px 12px", fontWeight: 600 }}>{r.name}</td>
                  <td data-tip={`Tested at ${r.d} against ${fmtOut(r.threshold, unit)}`}
                    style={{ padding: "7px 12px", textAlign: "right", ...mono }}>{fmtOut(r.value, unit)}</td>
                  <td style={{ padding: "7px 12px", textAlign: "right", ...mono, fontWeight: 700,
                    color: r.headroom < 0 ? "var(--ink-color-global-feedback-negative-strong)" : undefined }}>
                    {pctTxt(r.headroom)}
                    {r.trend != null && <span style={{ color: MICRO, fontWeight: 400, fontSize: FS.micro }}>{r.trend < 0 ? " ▼" : " ▲"}</span>}
                  </td>
                  <td style={{ padding: "7px 12px" }}><Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <Chart chartId={`covenant-${cov.id}`} type="line" unit={unit === "Ratio" ? "Number" : unit} height={250} series={series}
            title={`${cov.name}${focus ? ` — ${focus.name}` : ""} vs limit`}
            subtitle={`${(cov.basis || "ttm") === "ttm" ? "LTM basis" : "Point-in-time"} · ${cov.direction === "min" ? "≥" : "≤"} limit${steps.length > 1 ? " (stepped)" : ""} · dashed line is the covenant threshold`} />
        </div>
      </div>
    )}
    </>
  );
}
