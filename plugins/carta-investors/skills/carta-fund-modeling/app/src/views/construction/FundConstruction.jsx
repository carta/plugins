import { useMemo, useState, useRef } from "react";
import { FS, sans, MICRO } from "../../ui/theme.js";
import { H1, Eyebrow, Btn, Badge, EmptyState, CheckCircleIcon, POPOVER_SHADOW, useDismissable } from "../../ui/components.jsx";
import ConfirmDialog from "../../ui/ConfirmDialog.jsx";
import useConstruction from "../../state/useConstruction.js";
import { stepsFor, suggestedPlan, stepFlow, stepLabel, modeLabel, copyPlan } from "../../model/construction/plan.js";
import { convertLightToAdvanced, NOT_CARRIED } from "../../model/construction/convert.js";
import { simulate } from "../../model/construction/engine.js";
import { trackClick } from "../../analytics.js";
import MarketStep from "./MarketStep.jsx";
import AllocationsStep from "./AllocationsStep.jsx";
import GoalSeekStep from "./GoalSeekStep.jsx";
import ResultsStep from "./ResultsStep.jsx";
import { LightTermsStep, LightPortfolioStep, AdvancedTermsStep } from "./StepSections.jsx";
import SummaryBar from "./SummaryBar.jsx";
import Assumptions from "./AssumptionsPanel.jsx";
import ModeChooser from "./ModeChooser.jsx";
import PlanList from "./PlanList.jsx";
import ModelView from "./ModelView.jsx";
import WriteupStep from "./WriteupStep.jsx";
import { isComplete, firstUnfinished } from "../../model/construction/summary.js";

const VIEWS = {
  advanced: { terms: AdvancedTermsStep, market: MarketStep, strategy: AllocationsStep, montecarlo: GoalSeekStep, writeup: WriteupStep, results: ResultsStep },
  light: { terms: LightTermsStep, portfolio: LightPortfolioStep, writeup: WriteupStep, results: ResultsStep },
};

// Layout classes are scoped with an fc- prefix so nothing leaks into the other tabs. Colors come from Ink tokens only.
const FC_CSS = `
.fc-body { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: var(--ink-spacing-global-horizontal-xlarge); align-items: start; }
.fc-rail { position: static; }
.fc-steps { display: flex; flex-direction: column; }
.fc-step { position: relative; height: 36px; flex: none; }
.fc-step:not(:last-child)::after { content: ""; position: absolute; left: 19px; top: 28px; height: 16px; width: 2px;
  background: var(--ink-color-global-border-subtle); }
.fc-step[data-done="true"]:not(:last-child)::after { background: var(--ink-color-global-feedback-positive-strong); }
.fc-body table.ledger th { font-size: 12px; line-height: 20px; font-weight: 600; color: var(--ink-color-global-text-subtle); padding: 8px 12px; }
.fc-body table.ledger td { padding: 8px 12px; }
.fc-body > * { min-width: 0; }
.fc-sec-head:hover { background: var(--ink-color-global-surface-lightgray-default) !important; }
.fc-step:focus-visible, .fc-foot button:focus-visible, [data-testid="jump-bar"] button:focus-visible { outline: 2px solid var(--ink-color-global-border-focus-default); outline-offset: 2px; }
.fc-foot { position: sticky; bottom: 0; z-index: 14; display: flex; justify-content: space-between; align-items: center; gap: 12px;
  margin-top: var(--ink-spacing-global-vertical-normal); padding: var(--ink-spacing-global-vertical-small) 0;
  background: var(--ink-color-global-surface-background-default); border-top: 1px solid var(--ink-color-global-border-subtle); }
@media (max-width: 900px) {
  .fc-body { grid-template-columns: minmax(0, 1fr); gap: var(--ink-spacing-global-vertical-normal); }
  .fc-rail { position: static; }
  .fc-steps { flex-direction: row; overflow-x: auto; gap: 4px; padding-bottom: 4px; }
  .fc-step { width: auto !important; white-space: nowrap; }
  .fc-step::after { display: none !important; }
}
@media (prefers-reduced-motion: reduce) { .fc-step { transition: none; } }
`;

function Stepper({ steps, step, onStep, flow }) {
  return (
    <nav aria-label="Construction steps">
      <div className="fc-steps">
        {steps.map((s, i) => {
          const active = s.id === step;
          const { done, locked, blockedBy } = flow[s.id];
          return (
            <button key={s.id} onClick={() => !locked && onStep(s.id)} data-testid={`step-${s.id}`} aria-current={active ? "step" : undefined}
              data-done={done ? "true" : "false"} data-locked={locked ? "true" : "false"} aria-disabled={locked || undefined}
              title={locked ? `Confirm ${stepLabel(blockedBy)} first` : undefined}
              className={`navitem fc-step${active ? " active" : ""}`}
              style={{ ...sans, display: "flex", alignItems: "center", gap: 10, textAlign: "left", width: "100%",
                padding: "0 10px", border: "1px solid transparent", borderRadius: 4, cursor: locked ? "not-allowed" : "pointer",
                background: active ? "var(--accent-soft)" : "transparent",
                color: active ? "var(--ink-button-background-color-primary-base-default)" : locked ? "var(--ink-color-global-text-disabled, var(--ink-color-global-text-subtle))" : "var(--ink-color-global-text-subtle)",
                opacity: locked ? 0.5 : 1, fontSize: FS.body, fontWeight: active ? 600 : 500 }}>
              <span style={{ width: 20, height: 20, flex: "none", display: "grid", placeItems: "center", borderRadius: 10, zIndex: 1,
                fontSize: FS.micro, fontWeight: 700, background: locked ? "var(--ink-color-global-surface-lightgray-default)" : "var(--ink-color-global-surface-background-default)",
                border: done ? "none" : `1px solid ${active ? "var(--ink-color-global-border-active)" : "var(--ink-color-global-border-default)"}`,
                color: done ? "var(--ink-color-global-feedback-positive-strong)" : "inherit" }}>
                {done ? <CheckCircleIcon size={18} /> : i + 1}
              </span>
              <span style={{ flex: 1 }}>{s.label}</span>
              {s.optional && <Badge tone="neutral">optional</Badge>}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function CopiedNote({ plan, update }) {
  const c = plan.copiedFrom;
  if (!c || c.dismissed) return null;
  return (
    <div data-testid="copied-note" role="status" className="card" style={{ ...sans, fontSize: FS.small, padding: "12px 16px", margin: "0 0 var(--ink-spacing-global-vertical-normal)",
      display: "flex", gap: 16, alignItems: "center", justifyContent: "space-between" }}>
      <div>
        <span style={{ fontWeight: 600 }}>Copied from “{c.name}”.</span>{" "}
        <span style={{ color: "var(--ink-color-global-text-subtle)" }}>Every assumption came across. Rename it below, then change what's different; “{c.name}” stays as it is.</span>
      </div>
      <Btn onClick={() => update((p) => { p.copiedFrom = { ...p.copiedFrom, dismissed: true }; })} data-testid="dismiss-copied">Got it</Btn>
    </div>
  );
}

function ConvertedNote({ plan, result, update }) {
  const c = plan.convertedFrom;
  if (!c || c.dismissed) return null;
  const now = result?.ok ? result.metrics.initialDeals : null;
  return (
    <div data-testid="converted-note" role="status" className="card" style={{ ...sans, fontSize: FS.small, padding: "12px 16px", margin: "0 0 var(--ink-spacing-global-vertical-normal)",
      display: "flex", gap: 16, alignItems: "flex-start", justifyContent: "space-between" }}>
      <div>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Made from the Light plan “{c.name}”</div>
        <div style={{ color: "var(--ink-color-global-text-subtle)" }}>
          Carried over: fund terms, fees and expenses, waterfall, target gross MOIC, first check size and the share held for follow-ons.
          {c.companies > 0 && now != null && ` It backs ${Math.round(now)} companies here against ${c.companies} in Light.`}
        </div>
        <div style={{ color: "var(--ink-color-global-text-subtle)", marginTop: 6 }}>
          To review in Market and Strategy:
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{NOT_CARRIED.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      </div>
      <Btn onClick={() => update((p) => { p.convertedFrom = { ...p.convertedFrom, dismissed: true }; })} data-testid="dismiss-converted">Got it</Btn>
    </div>
  );
}

/** Less-used plan actions, in a menu so the toolbar stays one row. */
function PlanMenu({ plan, onNew, onConvert, onDelete }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useDismissable(open, setOpen, ref);
  const pick = (fn) => () => { setOpen(false); fn(); };
  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <Btn onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label="Plan actions" data-testid="plan-menu">⋯</Btn>
      {open && (
        <div role="menu" className="popin" style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 50, minWidth: 220, padding: "4px 0",
          background: "var(--ink-color-global-surface-background-default)", border: "1px solid var(--ink-color-global-border-subtle)", borderRadius: 6, boxShadow: POPOVER_SHADOW }}>
          {[["new-plan", "+ New plan", onNew, false], ...(plan.mode === "light" ? [["convert-plan", "Convert to Advanced", onConvert, false]] : []), ["delete-plan", "Delete plan", onDelete, true]].map(([id, label, fn, danger]) => (
            <button key={id} type="button" role="menuitem" className="menu-item" data-testid={id} onClick={pick(fn)}
              style={{ ...sans, display: "block", width: "100%", textAlign: "left", border: "none", borderRadius: 4, cursor: "pointer", background: "transparent", padding: "8px 12px", fontSize: 14, minHeight: 36,
                color: danger ? "var(--ink-color-global-feedback-negative-strong)" : "var(--ink-color-global-text-default)" }}>{label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FundConstruction({ snapshot, firm, companies }) {
  const { doc, plan: active, saveState, loadFailed, reload, addPlan, selectPlan, updatePlan, deletePlan } = useConstruction(firm);
  const [step, setStep] = useState("terms");
  // null shows the plan list.
  const [openId, setOpenId] = useState(null);
  const [view, setView] = useState("wizard");
  // A section to open and scroll to when a step is reached from the model view.
  const [focus, setFocus] = useState(null);
  const plan = openId && active?.id === openId ? active : null;
  const [confirm, setConfirm] = useState(null);
  const [choosing, setChoosing] = useState(false);
  const result = useMemo(() => (plan ? simulate(plan) : null), [plan]);
  const open = (id) => {
    trackClick("FundModeling.FundConstruction.OpenPlan");
    const p = doc.plans.find((x) => x.id === id);
    selectPlan(id);
    setOpenId(id);
    setFocus(null);
    if (p && isComplete(p)) setView("model");
    else { setView("wizard"); setStep(p ? firstUnfinished(p) : "terms"); }
  };
  const startPlan = (p) => { addPlan(p); setOpenId(p.id); setView("wizard"); setFocus(null); setStep("terms"); };
  // A copy saved from inside a step opens on that same step.
  const addAndOpen = (p) => { addPlan(p); setOpenId(p.id); };
  const editAt = (id, section = null) => { setView("wizard"); setStep(id); setFocus(section ? { section, at: Date.now() } : null); };
  const finalize = () => {
    trackClick("FundModeling.FundConstruction.Finalize");
    updatePlan((p) => { p.finalizedAt = new Date().toISOString(); });
    setView("model");
  };
  // Converting makes an Advanced copy; the Light plan stays as it is.
  const convert = (p) => { trackClick("FundModeling.FundConstruction.ConvertToAdvanced"); startPlan(convertLightToAdvanced(p)); };
  const askDelete = (p) => setConfirm({
    title: "Delete plan",
    message: `Delete “${p.name}”? This can't be undone.`,
    confirmLabel: "Delete plan",
    danger: true,
    onConfirm: () => { deletePlan(p.id); if (p.id === openId) setOpenId(null); setConfirm(null); },
  });

  if (!doc && loadFailed) {
    return (
      <EmptyState type="page" text="Couldn't load your plans">
        <div style={{ ...sans, fontSize: FS.body, color: "var(--ink-color-global-text-subtle)", maxWidth: 460, margin: "0 auto 16px" }}>
          Your saved plans are safe. Try again in a moment.
        </div>
        <Btn kind="primary" size="comfortable" onClick={reload} data-testid="retry-load">Try again</Btn>
      </EmptyState>
    );
  }
  if (!doc) return <div style={{ ...sans, color: "var(--ink-color-global-text-subtle)" }}>Loading plans…</div>;

  const goto = (id) => { trackClick(`FundModeling.FundConstruction.Step.${id}`); setFocus(null); setStep(id); };
  const confirmStep = (id, nextId) => {
    trackClick(`FundModeling.FundConstruction.ConfirmStep.${id}`);
    updatePlan((p) => { p.confirmed = { ...p.confirmed, [id]: true }; });
    if (nextId) goto(nextId);
  };
  const newPlan = () => {
    trackClick("FundModeling.FundConstruction.NewPlan");
    setChoosing(true);
  };
  const pickMode = (mode) => {
    trackClick(`FundModeling.FundConstruction.Mode.${mode}`);
    setChoosing(false);
    startPlan(suggestedPlan(snapshot, { name: "New fund", mode }));
  };
  // A copy opens on its first step, General, where its name (and anything else that differs) is changed first.
  const copy = (p) => {
    trackClick("FundModeling.FundConstruction.CopyPlan");
    setChoosing(false);
    startPlan(copyPlan(p, doc.plans.map((x) => x.name)));
  };
  const chooser = choosing && <ModeChooser onPick={pickMode} onCancel={() => setChoosing(false)} plans={doc.plans} onCopy={copy} />;
  const header = (
    <H1 actions={
      <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {doc.plans.length > 0 && !plan && <Btn onClick={newPlan} data-testid="new-plan">+ New plan</Btn>}
      </span>
    }>
      Fund Construction <Badge tone="info" style={{ marginLeft: 8, verticalAlign: "middle" }}>BETA</Badge>
    </H1>
  );

  if (!plan && doc.plans.length > 0) {
    return (
      <div data-testid="fund-construction-list">
        {header}
        <PlanList plans={doc.plans} onOpen={open} onDelete={askDelete} />
        {confirm && <ConfirmDialog {...confirm} onCancel={() => setConfirm(null)} />}
        {chooser}
      </div>
    );
  }

  if (!plan) {
    return (
      <div>
        {header}
        <EmptyState type="page" icon="pending" text="Model your next fund">
          <div style={{ ...sans, fontSize: FS.body, color: "var(--ink-color-global-text-subtle)", maxWidth: 460, margin: "0 auto 16px" }}>
            Choose how you'd like to build it, then see the projected returns. We'll start you off with values from your most recent fund.
          </div>
          <Btn kind="primary" size="comfortable" onClick={newPlan} data-testid="start-plan">Start a fund plan</Btn>
        </EmptyState>
        {chooser}
      </div>
    );
  }

  if (view === "model" && result?.ok) {
    return (
      <div data-testid="fund-construction">
        {header}
        <ModelView plan={plan} result={result} onBack={() => setOpenId(null)} onEdit={editAt} snapshot={snapshot} companies={companies} />
        {confirm && <ConfirmDialog {...confirm} onCancel={() => setConfirm(null)} />}
        {chooser}
      </div>
    );
  }

  const flow = stepFlow(plan);
  const steps = stepsFor(plan);
  // A locked step can't be shown; fall back to the step that unlocks it.
  const shown = flow[step]?.locked ? flow[step].blockedBy : step;
  const idx = Math.max(0, steps.findIndex((s) => s.id === shown));
  const current = steps[idx];
  const View = VIEWS[plan.mode === "light" ? "light" : "advanced"][current.id];
  const next = steps[idx + 1];
  const prev = steps[idx - 1];
  const needsConfirm = !current.optional && current.id !== "results" && !flow[current.id].confirmed;
  const saveNote = { saving: "Saving…", saved: "All changes saved", error: "Couldn't save. We'll retry with your next change." }[saveState];
  return (
    <div data-testid="fund-construction">
      <style>{FC_CSS}</style>
      <div data-testid="fc-toolbar" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "0 0 var(--ink-spacing-global-vertical-normal)" }}>
        <Btn onClick={() => setOpenId(null)} data-testid="all-plans">← All plans</Btn>
        {result?.ok && isComplete(plan) && <Btn onClick={() => setView("model")} data-testid="back-to-model">← Back to model</Btn>}
        <span style={{ ...sans, fontSize: FS.h3, fontWeight: 600 }} data-testid="plan-name">{plan.name}</span>
        <span data-testid="plan-mode" style={{ display: "flex" }}><Badge tone={plan.mode === "light" ? "neutral" : "info"}>{modeLabel(plan.mode)}</Badge></span>
        <Badge tone="info">BETA</Badge>
        <span style={{ flex: 1 }} />
        <span role="status" style={{ ...sans, display: "inline-flex", alignItems: "center", gap: 6, fontSize: FS.small, minHeight: 18,
          color: saveState === "error" ? "var(--ink-color-global-feedback-negative-strong)" : "var(--ink-color-global-text-subtle)" }}>
          <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 3, flex: "none",
            background: saveState === "error" ? "var(--ink-color-global-feedback-negative-strong)"
              : saveState === "saving" ? "var(--ink-color-global-feedback-warning-strong)" : "var(--ink-color-global-feedback-positive-strong)" }} />
          {saveNote}
        </span>
        <PlanMenu plan={plan} onNew={newPlan} onConvert={() => convert(plan)} onDelete={() => askDelete(plan)} />
      </div>
      <ConvertedNote plan={plan} result={result} update={updatePlan} />
      <CopiedNote plan={plan} update={updatePlan} />
      <SummaryBar plan={plan} result={result} />
      <div className="fc-body">
        <div className="fc-rail">
          <Eyebrow color={MICRO} style={{ padding: "0 10px 6px" }}>Steps</Eyebrow>
          <Stepper steps={steps} step={current.id} flow={flow} onStep={goto} />
          <div style={{ marginTop: 16 }}><Assumptions plan={plan} result={result} onEdit={editAt} /></div>
        </div>
        <div style={{ minWidth: 0 }}>
          {(() => {
            const body = <View plan={plan} update={updatePlan} addPlan={addAndOpen} result={result} onStep={goto} snapshot={snapshot} companies={companies} firm={firm}
              focus={focus?.section} focusKey={focus?.at} onFinalize={finalize} />;
            return View.flat ? body : <div className="card" style={{ padding: "24px 28px" }}>{body}</div>;
          })()}
          <div className="fc-foot">
            <span>{prev && <Btn onClick={() => goto(prev.id)} data-testid="prev-step">← {prev.label}</Btn>}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
              {needsConfirm && !flow[current.id].valid && <span data-testid="confirm-blocked" style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)" }}>Fix the fields marked in red to confirm this step.</span>}
              {next && (needsConfirm
                ? <Btn kind="primary" onClick={() => confirmStep(current.id, next.id)} disabled={!flow[current.id].valid} data-testid="next-step">Confirm and continue to {next.label} →</Btn>
                : <Btn kind="primary" onClick={() => goto(next.id)} data-testid="next-step">{next.label} →</Btn>)}
            </span>
          </div>
        </div>
      </div>
      {confirm && <ConfirmDialog {...confirm} onCancel={() => setConfirm(null)} />}
      {chooser}
    </div>
  );
}
