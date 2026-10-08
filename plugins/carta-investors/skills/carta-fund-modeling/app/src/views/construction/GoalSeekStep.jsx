import { useState } from "react";
import { FS, sans } from "../../ui/theme.js";
import { Btn, Badge, Segmented } from "../../ui/components.jsx";
import { fmtX } from "../../ui/format.js";
import { stepLabel } from "../../model/construction/plan.js";
import { planFingerprint } from "../../model/construction/monteCarlo.js";
import { GOALS } from "../../model/construction/optimize.js";
import { trackClick } from "../../analytics.js";
import { StepHeader } from "./fields.jsx";
import MonteCarloDialog from "./MonteCarloDialog.jsx";
import { changeTags, rangeAxis, RangeBar } from "./MonteCarloResults.jsx";
import SolveToTarget from "./SolvePanel.jsx";
import { MonteCarloAbout, MonteCarloDisclaimer } from "./MonteCarloAbout.jsx";

const subtle = { color: "var(--ink-color-global-text-subtle)" };

function LastRun({ run, plan, onOpen }) {
  const best = run.strategies[0];
  const stale = run.fingerprint !== planFingerprint(plan);
  const goal = GOALS.find((g) => g.id === run.goal);
  return (
    <div className="card" data-testid="mc-last-run" style={{ padding: "14px 16px", marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ ...sans, fontSize: FS.body, fontWeight: 700 }}>Last run: {goal?.label}</span>
        <span style={{ ...sans, fontSize: FS.micro, ...subtle }}>{new Date(run.at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</span>
        {stale && <Badge tone="warning">Plan changed since</Badge>}
        <span style={{ flex: 1 }} />
        <Btn onClick={onOpen} data-testid="mc-open-last">Open results</Btn>
      </div>
      {best && (
        <div style={{ ...sans, fontSize: FS.small, marginTop: 8, lineHeight: 1.5 }}>
          Best: {best.isCurrent ? "your plan as it is" : changeTags(best.changes, plan.general.currency).join(" · ")} · median {fmtX(best.summary.net.p50)} vs {fmtX(run.base.summary.net.p50)} today
        </div>
      )}
      {best && (() => {
        const axis = rangeAxis([best.summary.net, run.base.summary.net], run.target);
        return (
          <div data-testid="mc-last-range" style={{ display: "grid", gridTemplateColumns: "84px minmax(0, 1fr)", gap: "6px 10px", alignItems: "center", marginTop: 10, maxWidth: 560 }}>
            <span style={{ ...sans, fontSize: FS.micro, ...subtle }}>Your plan</span><RangeBar net={run.base.summary.net} axis={axis} target={run.target} current />
            {!best.isCurrent && <><span style={{ ...sans, fontSize: FS.micro, ...subtle }}>Best option</span><RangeBar net={best.summary.net} axis={axis} target={run.target} /></>}
          </div>
        );
      })()}
    </div>
  );
}

const MODES = [
  { id: "solve", label: "Solve to target", testId: "gs-mode-solve" },
  { id: "simulate", label: "Monte Carlo simulator", testId: "gs-mode-simulate" },
];

function Simulator({ plan, update, addPlan, blocked }) {
  const [open, setOpen] = useState(null);
  const last = plan.monteCarlo?.lastRun;
  const openGoal = (id) => { trackClick(`FundModeling.FundConstruction.MonteCarlo.Open.${id}`); setOpen(id); };
  return (
    <div data-testid="monte-carlo-step">
      <MonteCarloAbout />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: 12 }}>
        {GOALS.map((g) => (
          <button key={g.id} type="button" disabled={blocked} onClick={() => openGoal(g.id)} data-testid={`mc-goal-${g.id}`}
            style={{ ...sans, textAlign: "left", padding: "14px 16px", borderRadius: 8, border: "1px solid var(--ink-color-global-border-subtle)",
              background: "var(--ink-color-global-surface-background-default)", cursor: blocked ? "not-allowed" : "pointer", opacity: blocked ? 0.55 : 1 }}>
            <div style={{ fontSize: FS.body, fontWeight: 700, color: "var(--ink-color-global-text-default)" }}>{g.label}</div>
            <div style={{ fontSize: FS.small, ...subtle, lineHeight: 1.45, marginTop: 4 }}>{g.question}</div>
          </button>
        ))}
      </div>
      {last && <LastRun run={last} plan={plan} onOpen={() => openGoal(last.goal)} />}
      <MonteCarloDisclaimer style={{ marginTop: 12 }} />
      {open && <MonteCarloDialog plan={plan} update={update} addPlan={addPlan} initialGoal={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

export default function GoalSeekStep({ plan, update, result, addPlan }) {
  const [mode, setMode] = useState(() => (plan.monteCarlo?.lastRun && !(plan.target?.value > 0) ? "simulate" : "solve"));
  const [undo, setUndo] = useState(null);
  const blocked = !result?.ok;
  const m = result?.ok ? result.metrics : null;
  const actual = m ? ((plan.target?.metric ?? "grossMoic") === "tvpi" ? m.tvpi : m.grossMoic) : null;
  return (
    <div data-testid="goal-seek-step">
      <StepHeader title="Goal seek & simulate (optional)">
        Set a return target and see what it would take to reach it, or play the fund out thousands of times to see the range of results.
      </StepHeader>
      {blocked && (
        <div data-testid="mc-blocked" style={{ ...sans, fontSize: FS.small, padding: "10px 12px", borderRadius: 6, marginBottom: 14,
          background: "var(--ink-color-global-feedback-neutral-subtle)" }}>
          Finish {(result?.blockedBy ?? []).map(stepLabel).join(", ") || "the earlier steps"} first, then come back to solve or simulate.
        </div>
      )}
      <div style={{ marginBottom: 16 }}>
        <Segmented value={mode} options={MODES} onChange={(id) => { trackClick(`FundModeling.FundConstruction.GoalSeek.Mode.${id}`); setMode(id); }} />
      </div>
      {mode === "solve"
        ? (blocked ? null : <SolveToTarget plan={plan} update={update} actual={actual} undo={undo} setUndo={setUndo} />)
        : <Simulator plan={plan} update={update} addPlan={addPlan} blocked={blocked} />}
    </div>
  );
}
