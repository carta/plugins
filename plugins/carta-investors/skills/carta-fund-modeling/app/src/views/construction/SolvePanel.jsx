import { useMemo } from "react";
import { FS, sans } from "../../ui/theme.js";
import { Btn, Badge, Segmented } from "../../ui/components.jsx";
import { NumInput } from "./fields.jsx";
import { fmtMIn, fmtOwn, fmtPct, fmtX } from "../../ui/format.js";
import { LEVERS, METRICS, lockKey, metricLabel, solveTarget } from "../../model/construction/goalSeek.js";
import { trackClick } from "../../analytics.js";

const subtle = { color: "var(--ink-color-global-text-subtle)" };
const fingerprint = (p) => JSON.stringify([p.sectors, p.allocations]);

function describe(c, ccy) {
  if (c.lever === "reserve") return { title: "Follow-on check sizes", detail: `${fmtPct(c.from, 0)} → ${fmtPct(c.to, 0)} of each company's capital held for follow-ons · ${c.scope}` };
  if (c.lever === "check") return { title: "Initial check size", detail: `${c.ownership ? `${fmtOwn(c.from)} → ${fmtOwn(c.to)} target ownership` : `${fmtMIn(c.from, ccy)} → ${fmtMIn(c.to, ccy)} a company`} · ${c.scope}` };
  const pct = c.factor >= 1 ? `+${Math.round((c.factor - 1) * 100)}%` : `−${Math.round((1 - c.factor) * 100)}%`;
  const detail = { exits: "every round's exit value", grad: "every round's odds of raising the next round", prices: "pre-money and round size, so the same check buys more of the company" }[c.lever];
  return { title: `${LEVERS[c.lever].label} ${pct}`, detail: `${detail} · ${c.scope}` };
}

/** Every input the solver may move, for the plan as it stands: market levers for each sector in use, reserves for each allocation. */
function fieldsOf(plan) {
  const used = new Set(plan.allocations.map((a) => a.sectorId));
  const sectors = plan.sectors.filter((s) => used.has(s.id));
  const many = sectors.length > 1;
  const out = [];
  for (const s of sectors) {
    for (const lever of Object.keys(LEVERS)) out.push({ key: lockKey(lever, s.id), label: LEVERS[lever].label, scope: many ? s.name || "Profile" : null });
  }
  for (const a of plan.allocations) {
    const scope = plan.allocations.length > 1 ? a.name : null;
    out.push({ key: lockKey("check", a.id), label: "Initial check sizes", scope }, { key: lockKey("reserve", a.id), label: "Follow-on check sizes", scope });
  }
  return out;
}

function Fixed({ fields, locks, setLocks }) {
  const flip = (key) => setLocks((cur) => { const next = { ...cur }; if (next[key]) delete next[key]; else next[key] = true; return next; });
  return (
    <fieldset data-testid="solve-locks" style={{ border: "1px solid var(--ink-color-global-border-subtle)", borderRadius: 6, padding: "10px 14px", margin: 0 }}>
      <legend style={{ ...sans, fontSize: FS.small, fontWeight: 600, padding: "0 6px" }}>Lock what should stay as it is</legend>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 250px), 1fr))", gap: "6px 16px" }}>
        {fields.map((f) => (
          <label key={f.key} style={{ ...sans, fontSize: FS.body, display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={!!locks[f.key]} onChange={() => flip(f.key)} data-testid={`solve-lock-${f.key}`}
              style={{ accentColor: "var(--ink-button-background-color-primary-base-default)" }} />
            <span>{f.label}{f.scope && <span style={subtle}> · {f.scope}</span>}</span>
          </label>
        ))}
      </div>
      <div style={{ ...sans, fontSize: FS.micro, ...subtle, marginTop: 8 }}>
        Initial check sizes only change the multiple when follow-ons are fixed amounts. With pro-rata follow-ons they only change how many companies you back, so the solver leaves them alone.
      </div>
    </fieldset>
  );
}

const panel = { padding: "14px 16px", border: "1px solid var(--ink-color-global-border-subtle)", borderRadius: 8 };

function gapStatus(target, actual) {
  const gap = target > 0 && actual != null ? actual - target : null;
  if (gap == null) return { text: "Set a target to see how far the plan is from it", tone: null };
  if (Math.abs(gap) < 0.05) return { text: "On target", tone: "good" };
  return gap < 0 ? { text: `${fmtX(-gap)} short of target`, tone: "bad" } : { text: `${fmtX(gap)} above target`, tone: "good" };
}

function Changes({ plan, metric, target, locks, onApply }) {
  const label = metricLabel(metric);
  const ccy = plan.general.currency;
  const result = useMemo(() => solveTarget(plan, { metric, value: target, locks }), [plan, metric, target, locks]);
  if (result.already) return <div data-testid="solve-already">The plan is already at {fmtX(result.start, 2)}, so there is nothing to change.</div>;
  return (
    <>
      <div data-testid="solve-outcome" style={{ marginBottom: 12 }}>
        {result.reached
          ? <>These changes take {label} from <strong>{fmtX(result.start, 2)}</strong> to <strong>{fmtX(result.achieved, 2)}</strong>.</>
          : <>Within the limits, the most it can reach is <strong>{fmtX(result.achieved, 2)}</strong>, short of {fmtX(target, 2)}.</>}
      </div>
      {result.changes.length > 0 ? (
        <ul data-testid="solve-changes" style={{ listStyle: "none", padding: 0, margin: "0 0 12px", display: "grid", gap: 8 }}>
          {result.changes.map((c, i) => {
            const d = describe(c, ccy);
            return (
              <li key={i} style={{ padding: "10px 12px", border: "1px solid var(--ink-color-global-border-subtle)", borderRadius: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>{d.title}{c.aggressive && <Badge tone="warning">Aggressive</Badge>}</div>
                <div style={{ fontSize: FS.small, ...subtle, marginTop: 2 }}>{d.detail}</div>
              </li>
            );
          })}
        </ul>
      ) : <div style={{ marginBottom: 12, ...subtle }}>Nothing can change: every input that could move is locked.</div>}
      {result.limits.length > 0 && (
        <ul data-testid="solve-limits" style={{ margin: "0 0 12px", paddingLeft: 18, fontSize: FS.small, ...subtle }}>{result.limits.map((l) => <li key={l}>{l}</li>)}</ul>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Btn size="comfortable" kind="primary" onClick={() => onApply(result)} disabled={result.changes.length === 0} data-testid="solve-apply">Apply changes</Btn>
        <span style={{ fontSize: FS.small, ...subtle, flex: "1 1 280px" }}>
          This moves assumptions to land on a number. It doesn't make that outcome any more likely, so check the changes are ones you believe. Locked inputs are never changed.
        </span>
      </div>
    </>
  );
}

// One shared empty set, so a plan with no locks doesn't hand Changes a new object (and a fresh solve) every render.
const NO_LOCKS = Object.freeze({});

/** `undo` lives with the caller, so Undo survives a trip to the simulator while the plan is as the solver left it. */
export default function SolveToTarget({ plan, update, actual, undo, setUndo }) {
  const target = plan.target ?? { metric: "grossMoic", value: null };
  const fields = useMemo(() => fieldsOf(plan), [plan]);
  const locks = plan.locks ?? NO_LOCKS;
  const setLocks = (fn) => update((p) => { p.locks = fn(p.locks ?? {}); });
  const status = gapStatus(target.value, actual);
  const canUndo = undo && fingerprint(plan) === undo.after;
  const apply = (result) => {
    trackClick("FundModeling.FundConstruction.SolveTarget.Apply");
    const before = structuredClone({ sectors: plan.sectors, allocations: plan.allocations });
    const solved = result.plan;
    update((p) => { p.sectors = structuredClone(solved.sectors); p.allocations = structuredClone(solved.allocations); });
    setUndo({ before, after: fingerprint(solved) });
  };
  const revert = () => {
    trackClick("FundModeling.FundConstruction.SolveTarget.Undo");
    update((p) => { p.sectors = structuredClone(undo.before.sectors); p.allocations = structuredClone(undo.before.allocations); });
    setUndo(null);
  };
  return (
    <div data-testid="solve-panel" style={{ ...sans, fontSize: FS.bodyLg, display: "grid", gap: 16 }}>
      <div style={{ ...panel, display: "flex", alignItems: "center", gap: "10px 14px", flexWrap: "wrap" }}>
        <span style={{ fontSize: FS.body, fontWeight: 600 }}>Target</span>
        <Segmented small value={target.metric} options={METRICS.map((m) => ({ id: m.id, label: m.label, testId: `target-metric-${m.id}` }))}
          onChange={(metric) => update((p) => { p.target = { ...(p.target ?? { value: null }), metric }; })} />
        <NumInput value={target.value} decimals={2} suffix="×" width={72} testId="target-input" ariaLabel={`Target ${metricLabel(target.metric)}`} placeholder="e.g. 3"
          onChange={(v) => update((p) => { p.target = { ...(p.target ?? { metric: "grossMoic" }), value: v }; })} />
        <span data-testid="target-status" style={{ fontSize: FS.body, fontWeight: status.tone ? 600 : 400,
          color: status.tone === "good" ? "var(--ink-color-global-feedback-positive-strong)" : status.tone === "bad" ? "var(--ink-color-global-feedback-negative-strong)" : "var(--ink-color-global-text-subtle)" }}>{status.text}</span>
        <span style={{ flex: 1 }} />
        {canUndo && <Btn kind="link" onClick={revert} data-testid="solve-undo">Undo the last solve</Btn>}
      </div>
      <Fixed fields={fields} locks={locks} setLocks={setLocks} />
      <div style={panel}>
        {target.value > 0
          ? <Changes plan={plan} metric={target.metric} target={target.value} locks={locks} onApply={apply} />
          : <div data-testid="solve-empty" style={subtle}>Enter a target above to see what the plan would need to change to reach it.</div>}
      </div>
    </div>
  );
}
