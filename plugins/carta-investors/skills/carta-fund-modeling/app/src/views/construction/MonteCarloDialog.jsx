import { useEffect, useMemo, useRef, useState } from "react";
import { FS, sans } from "../../ui/theme.js";
import { Btn, Segmented, InfoTip, Checkbox, CloseIcon } from "../../ui/components.jsx";
import ConfirmDialog from "../../ui/ConfirmDialog.jsx";
import { fmtCheckIn, fmtMIn, fmtPct } from "../../ui/format.js";
import { trackClick } from "../../analytics.js";
import { copyPlan, defaultMonteCarloSettings } from "../../model/construction/plan.js";
import { OBJECTIVES, MARKET_SWINGS, EXIT_SPREADS, SELECTION, SURVIVAL, RUN_COUNTS, planFingerprint, simTarget } from "../../model/construction/monteCarlo.js";
import { GOALS, SCREEN_RUNS, TARGET_SCREEN_RUNS, RESERVE_LEVELS, checkCandidates, optimize, applyVariant, strategyFacts, fewestCompanies, companiesReachable, oversizedChecks } from "../../model/construction/optimize.js";
import { NumInput, PctInput, fmtCount } from "./fields.jsx";
import Results, { changeLines } from "./MonteCarloResults.jsx";
import { MonteCarloAbout, MonteCarloDisclaimer } from "./MonteCarloAbout.jsx";

export { changeLines, changeTags, changeText, fmtScore } from "./MonteCarloResults.jsx";

const subtle = { color: "var(--ink-color-global-text-subtle)" };
const panel = { border: "1px solid var(--ink-color-global-border-subtle)", borderRadius: 8, padding: "14px 16px" };

function Tip({ label, children }) {
  return <InfoTip label={label} width={300} portal>{children}</InfoTip>;
}

function Choice({ on, onClick, title, blurb, testId }) {
  return (
    <button type="button" onClick={onClick} data-testid={testId} aria-pressed={on}
      style={{ ...sans, display: "block", width: "100%", height: "100%", textAlign: "left", padding: "12px 14px", borderRadius: 8, cursor: "pointer",
        border: `${on ? 2 : 1}px solid ${on ? "var(--ink-button-background-color-primary-base-default)" : "var(--ink-color-global-border-subtle)"}`,
        background: on ? "var(--accent-soft)" : "var(--ink-color-global-surface-background-default)" }}>
      <div style={{ fontSize: FS.body, fontWeight: 700, color: "var(--ink-color-global-text-default)" }}>{title}</div>
      {blurb && <div style={{ fontSize: FS.small, ...subtle, lineHeight: 1.45, marginTop: 3 }}>{blurb}</div>}
    </button>
  );
}

const RUN_LABEL = { split: "Find the best split", checks: "Find the best checks and reserves", companies: "Find the best way to get there" };

function Step({ n, title, hint, children, tip }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <div style={{ ...sans, fontSize: FS.bodyLg, fontWeight: 700, margin: "0 0 10px", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 24, height: 24, borderRadius: 12, display: "inline-grid", placeItems: "center", fontSize: FS.small,
          background: "var(--ink-color-global-surface-lightgray-default)", color: "var(--ink-color-global-text-default)" }}>{n}</span>
        {title}{hint && <span style={{ fontWeight: 400, ...subtle, fontSize: FS.small }}>{hint}</span>}{tip}
      </div>
      {children}
    </section>
  );
}

function SplitLimits({ cfg, set, plan }) {
  if (plan.allocations.length < 2) {
    return <div data-testid="mc-split-controls" style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-feedback-negative-strong)" }}>Add a second allocation in Strategy to compare splits.</div>;
  }
  return (
    <div data-testid="mc-split-controls" style={{ ...sans, fontSize: FS.small }}>
      <div style={{ ...subtle, marginBottom: 10 }}>Every split is tried in steps of 5–25%. Keep an allocation as it is, or set the least and most it may get.</div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(110px, 1fr) 70px auto minmax(200px, 1.4fr)", gap: "8px 14px", alignItems: "center" }}>
        {["Allocation", "Today", "", "Allowed range"].map((h) => <span key={h} style={{ fontSize: FS.micro, ...subtle }}>{h}</span>)}
        {plan.allocations.map((a) => {
          const locked = cfg.locks?.[a.id] != null;
          const b = cfg.bounds?.[a.id] ?? {};
          const setBound = (k, v) => set({ bounds: { ...cfg.bounds, [a.id]: { ...b, [k]: v ?? undefined } } });
          return [
            <span key={`n${a.id}`} style={{ fontWeight: 600 }}>{a.name}</span>,
            <span key={`t${a.id}`}>{fmtPct(a.capitalPct, 0)}</span>,
            <span key={`l${a.id}`} data-testid={`mc-lock-${a.id}`}>
              <Checkbox checked={locked} label="Keep as is" onChange={(v) => {
                const locks = { ...cfg.locks };
                if (v) locks[a.id] = a.capitalPct; else delete locks[a.id];
                set({ locks });
              }} />
            </span>,
            locked ? <span key={`r${a.id}`} style={subtle}>Stays at {fmtPct(a.capitalPct, 0)}</span> : (
              <span key={`r${a.id}`} style={{ display: "inline-flex", gap: 6, alignItems: "center", ...subtle }}>
                <PctInput value={b.min ?? null} onChange={(v) => setBound("min", v)} width={78} placeholder="0" testId={`mc-min-${a.id}`} ariaLabel={`${a.name} least share`} />
                to <PctInput value={b.max ?? null} onChange={(v) => setBound("max", v)} width={78} placeholder="100" testId={`mc-max-${a.id}`} ariaLabel={`${a.name} most share`} />
              </span>
            ),
          ];
        })}
      </div>
    </div>
  );
}

/** Why a company count is out of reach, and the closest one that isn't. */
function CompaniesFloor({ few, cfg, set, ccy }) {
  if (!few) return null;
  const floor = Math.ceil(few.companies);
  const caps = few.rounds.map((r) => `${few.rounds.length > 1 ? `${r.allocation}: ` : ""}the ${r.round} round's ${fmtMIn(r.roundSize, ccy)}`).join(", ");
  if (!companiesReachable(few, cfg.targetCompanies, cfg.tolerance)) {
    return (
      <div data-testid="mc-companies-floor" role="alert" style={{ ...sans, fontSize: FS.small, lineHeight: 1.5, padding: "10px 12px", borderRadius: 6, flexBasis: "100%",
        background: "var(--ink-color-global-feedback-negative-subtle)", color: "var(--ink-color-global-text-default)" }}>
        <b>{fmtCount(cfg.targetCompanies)} companies is out of reach.</b> This plan can back no fewer than about {floor}: a first check can't be bigger than {caps}, even with {fmtPct(few.held, 0)} held for follow-ons.
        <span style={{ display: "block", marginTop: 6 }}>
          <Btn kind="link" onClick={() => set({ targetCompanies: floor })} data-testid="mc-use-floor">Use {floor} companies</Btn>
          <span style={subtle}> or change the plan's fund size or entry round in Strategy.</span>
        </span>
      </div>
    );
  }
  if (cfg.targetCompanies < few.companies * 1.3) {
    return <div data-testid="mc-companies-near" style={{ ...sans, fontSize: FS.micro, ...subtle, flexBasis: "100%" }}>Close to the fewest this plan can back (about {floor}), so only the largest first checks with the most held for follow-ons get there: expect few options.</div>;
  }
  return null;
}

function GoalControls({ cfg, set, plan, facts, ccy, few }) {
  if (cfg.goal === "split") return <SplitLimits cfg={cfg} set={set} plan={plan} />;
  if (cfg.goal === "checks") {
    return (
      <div data-testid="mc-checks-controls" style={{ ...sans, fontSize: FS.small, lineHeight: 1.5 }}>
        <div style={{ ...subtle, marginBottom: 10 }}>Nothing to set. For each allocation it tries every first check below against every share held for follow-ons, and keeps the rest of the plan as it is.</div>
        {facts?.allocations.map((a) => (
          <div key={a.id} style={{ display: "grid", gridTemplateColumns: "minmax(100px, 140px) 1fr", gap: "4px 12px", marginBottom: 8 }}>
            <span style={{ fontWeight: 600 }}>{a.name}</span>
            <span>
              <span style={subtle}>First checks </span>
              {checkCandidates(a).map((c, i, all) => <span key={c} style={{ fontWeight: c === a.check ? 700 : 400 }}>{fmtCheckIn(c, ccy)}{i === all.length - 1 ? "" : " · "}</span>)}
            </span>
            <span />
            <span><span style={subtle}>Held for follow-ons </span>{RESERVE_LEVELS.map((r) => fmtPct(r, 0)).join(" · ")} <span style={subtle}>(today {fmtPct(a.reserve, 0)}, {fmtCount(a.companies)} companies)</span></span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div data-testid="mc-companies-controls" style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
      <label style={{ ...sans, fontSize: FS.small, display: "grid", gap: 4 }}>
        <span style={{ fontWeight: 600 }}>Companies to back</span>
        <NumInput value={cfg.targetCompanies} onChange={(v) => set({ targetCompanies: v })} width={110} decimals={0} testId="mc-target-companies" ariaLabel="Companies to back" />
        <span style={{ fontSize: FS.micro, ...subtle }}>Your plan backs about {fmtCount(facts?.companies)} today.</span>
      </label>
      <div style={{ ...sans, fontSize: FS.small, display: "grid", gap: 4 }}>
        <span style={{ fontWeight: 600 }}>How close</span>
        <Segmented small value={cfg.tolerance} onChange={(v) => set({ tolerance: v })}
          options={[0.05, 0.1, 0.2].map((t) => ({ id: t, label: `±${t * 100}%`, testId: `mc-tolerance-${t * 100}` }))} />
      </div>
      {plan.allocations.length > 1 && (
        <span data-testid="mc-allow-split">
          <Checkbox checked={!!cfg.allowSplit} onChange={(v) => set({ allowSplit: v })} label="Let the split between allocations change too" />
        </span>
      )}
      <div style={{ ...sans, fontSize: FS.micro, ...subtle, lineHeight: 1.45, flexBasis: "100%" }}>
        Checks are sized to land on this count, with 0% to 60% held for follow-ons{few ? `. This plan can back as few as about ${Math.ceil(few.companies)}.` : "."}
      </div>
      <CompaniesFloor few={few} cfg={cfg} set={set} ccy={ccy} />
    </div>
  );
}

const STAT = { median: "median", downside: "P10", target: "chance", mean: "average" };

function Ranking({ cfg, set, shared, setTarget }) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 190px), 1fr))", gap: 10 }}>
        {OBJECTIVES.map((o) => (
          <Choice key={o.id} on={cfg.objective === o.id} onClick={() => set({ objective: o.id })} testId={`mc-objective-${o.id}`}
            title={<>{o.label} <span style={{ fontWeight: 400, ...subtle, fontSize: FS.small }}>· {STAT[o.id]}</span></>} blurb={o.blurb} />
        ))}
      </div>
      <label data-testid="mc-target-row" style={{ ...sans, fontSize: FS.small, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 600 }}>{shared ? "Your plan's target" : "Target net TVPI"}</span>
        <NumInput value={cfg.target} onChange={setTarget} width={90} suffix="× net TVPI" testId="mc-target" ariaLabel="Net TVPI to reach" />
        <span style={subtle}>{shared ? "Set in Solve to target; changing it here changes it there." : "Every result shows the chance of reaching it."}</span>
      </label>
    </div>
  );
}

/** A Series A-style round from the plan, to show what each setting does with real numbers. */
function exampleRound(plan) {
  const a = plan.allocations[0];
  const sector = a && plan.sectors.find((s) => s.id === a.sectorId);
  const st = sector?.stages[Math.min(sector.stages.length - 1, a.entryStage + 1)];
  return st ? { name: st.name, grad: st.gradRate || 0, exit: st.exitRate || 0, value: st.exitValuation || 0 } : null;
}

function Knob({ id, title, value, options, onChange, blurb, example, tip }) {
  return (
    <div data-testid={`mc-knob-${id}`} style={{ display: "grid", gridTemplateColumns: "minmax(170px, 220px) auto minmax(0, 1fr)", gap: "6px 16px", alignItems: "center",
      padding: "12px 0", borderTop: "1px solid var(--ink-color-global-border-subtle)" }}>
      <span style={{ ...sans, fontSize: FS.body, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6 }}>{title}{tip}</span>
      <Segmented small value={value} onChange={onChange} options={options} />
      <span style={{ ...sans, fontSize: FS.small, lineHeight: 1.45 }}>
        {blurb}
        {example && <span data-testid={`mc-example-${id}`} style={{ display: "block", ...subtle, fontSize: FS.micro, marginTop: 2 }}>{example}</span>}
      </span>
    </div>
  );
}

/** Each setting is shown applied to one of the plan's own rounds. */
function Realism({ cfg, set, plan, ccy }) {
  const s = cfg.settings;
  const setS = (patch) => set({ settings: { ...s, ...patch } });
  const ex = exampleRound(plan);
  const d = defaultMonteCarloSettings();
  const changed = ["runs", "market", "spread", "selection", "survival"].some((k) => (s[k] ?? d[k]) !== d[k]);
  const swing = MARKET_SWINGS.find((m) => m.id === s.market);
  const sigma = EXIT_SPREADS.find((m) => m.id === s.spread)?.sigma ?? 0;
  const boost = SURVIVAL.find((m) => m.id === (s.survival ?? "off"))?.boost ?? 0;
  const lognormal = (z) => Math.exp(sigma * z - (sigma * sigma) / 2);
  const examples = ex ? {
    market: swing?.grad ? `${ex.name}: odds of raising ${fmtPct(ex.grad, 0)} become ${fmtPct(ex.grad * swing.grad[0], 0)} in a tough market and ${fmtPct(Math.min(ex.grad * swing.grad[2], 1 - ex.exit), 0)} in a hot one; exit values ×${swing.exits[0]} to ×${swing.exits[2]}.` : `${ex.name}: odds of raising stay at ${fmtPct(ex.grad, 0)} in every fund.`,
    spread: ex.value > 0 && sigma > 0 ? `A ${ex.name} exit valued at ${fmtMIn(ex.value, ccy)} lands between ${fmtMIn(ex.value * lognormal(-1.2816), ccy)} and ${fmtMIn(ex.value * lognormal(1.2816), ccy)} for 8 exits in 10.` : ex.value > 0 ? `Every ${ex.name} exit is worth ${fmtMIn(ex.value, ccy)}.` : null,
    survival: boost > 0 ? `${ex.name}: the chance of failing drops from ${fmtPct(Math.max(0, 1 - ex.grad - ex.exit), 0)} to ${fmtPct(Math.max(0, 1 - ex.grad - ex.exit - boost), 0)} for companies you follow on into. This raises the average result.` : null,
  } : {};
  const opts = (list, prefix) => list.map((m) => ({ id: m.id, label: m.label, testId: `mc-${prefix}-${m.id}` }));
  return (
    <div data-testid="mc-settings" style={{ ...panel, padding: "4px 16px" }}>
      <Knob id="runs" title="Simulated funds" value={s.runs} onChange={(v) => setS({ runs: v })}
        options={RUN_COUNTS.map((r) => ({ id: r.runs, label: r.label, title: r.blurb, testId: `mc-runs-${r.runs}` }))}
        blurb={`${s.runs.toLocaleString("en-US")} funds, each playing out every company's fate. More gives steadier answers but takes longer.`}
        tip={<Tip label="About simulated funds">Candidate strategies are first screened on {SCREEN_RUNS} simulated funds ({TARGET_SCREEN_RUNS} when ranking by the chance of the target). The best five and your plan are then re-run on this many fresh ones.</Tip>} />
      <Knob id="market" title="Market cycles" value={s.market} onChange={(v) => setS({ market: v })} options={opts(MARKET_SWINGS, "market")}
        blurb={MARKET_SWINGS.find((m) => m.id === s.market)?.blurb} example={examples.market}
        tip={<Tip label="About market cycles">Exit values are balanced so the average result stays where the plan has it; cycles only widen the range.</Tip>} />
      <Knob id="spread" title="Exit size spread" value={s.spread} onChange={(v) => setS({ spread: v })} options={opts(EXIT_SPREADS, "spread")}
        blurb={EXIT_SPREADS.find((m) => m.id === s.spread)?.blurb} example={examples.spread}
        tip={<Tip label="About exit size spread">The average exit stays at the round's exit value in the Market step.</Tip>} />
      <Knob id="selection" title="Follow-on picking skill" value={s.selection ?? "some"} onChange={(v) => setS({ selection: v })} options={opts(SELECTION, "selection")}
        blurb={SELECTION.find((m) => m.id === (s.selection ?? "some"))?.blurb}
        tip={<Tip label="About follow-on picking skill">You still back the same share of companies as your participation rates; this sets how well you pick them. It matters most when you back only some of the companies that raise.</Tip>} />
      <Knob id="survival" title="Survival boost" value={s.survival ?? "off"} onChange={(v) => setS({ survival: v })} options={opts(SURVIVAL, "survival")}
        blurb={SURVIVAL.find((m) => m.id === (s.survival ?? "off"))?.blurb} example={examples.survival}
        tip={<Tip label="About survival boost">Models the idea that a fund's support helps a company survive. Unlike the other settings it changes the average, so results can sit above the plan's expected case.</Tip>} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 0", borderTop: "1px solid var(--ink-color-global-border-subtle)", ...sans, fontSize: FS.micro, ...subtle }}>
        Luck: draw #{s.seed}
        <Btn kind="link" style={{ fontSize: FS.micro }} data-testid="mc-new-draw" onClick={() => setS({ seed: s.seed + 1 })}>Re-roll</Btn>
        <Tip label="About luck">The same draw always gives the same results, so runs can be compared. Re-rolling checks that an answer isn't down to luck.</Tip>
        <span style={{ flex: 1 }} />
        {changed && <Btn kind="link" style={{ fontSize: FS.micro }} data-testid="mc-settings-reset" onClick={() => set({ settings: { ...d, seed: s.seed } })}>Reset to defaults</Btn>}
      </div>
    </div>
  );
}

export default function MonteCarloDialog({ plan, update, addPlan, initialGoal, onClose }) {
  const [cfg, setCfg] = useState(() => {
    const mc = plan.monteCarlo;
    const facts = strategyFacts(plan);
    return { ...mc, target: simTarget(plan).value, goal: initialGoal ?? mc.goal, targetCompanies: mc.targetCompanies ?? (facts ? Math.round(facts.companies) : 30) };
  });
  const [progress, setProgress] = useState(null);
  const [selected, setSelected] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [metric, setMetric] = useState("net");
  const [runError, setRunError] = useState(null);
  const last = plan.monteCarlo.lastRun;
  const [view, setView] = useState(() => (last && last.goal === (initialGoal ?? plan.monteCarlo.goal) ? "results" : "setup"));
  const abort = useRef(null);
  const ccy = plan.general.currency;
  const facts = useMemo(() => strategyFacts(plan), [plan]);
  const out = last && last.goal === cfg.goal ? last : null;
  const stale = out && out.fingerprint !== planFingerprint(plan);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !confirm) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, confirm]);
  useEffect(() => () => abort.current?.abort(), []);

  const set = (patch) => setCfg((c) => ({ ...c, ...patch }));
  // A net TVPI target is the plan's own, so changing it here changes it for Solve to target too.
  const shared = simTarget(plan).shared;
  const setTarget = (v) => {
    set({ target: v });
    if (shared && v > 0) update((p) => { p.target = { ...p.target, value: v }; });
  };
  const few = useMemo(() => (cfg.goal === "companies" ? fewestCompanies(plan) : null), [plan, cfg.goal]);
  const oversized = facts ? oversizedChecks(facts) : [];
  const canRun = !!facts && oversized.length === 0 && (cfg.goal !== "split" || plan.allocations.length > 1)
    && (cfg.goal !== "companies" || (cfg.targetCompanies >= 1 && companiesReachable(few, cfg.targetCompanies, cfg.tolerance))) && cfg.target > 0;

  const run = async () => {
    trackClick(`FundModeling.FundConstruction.MonteCarlo.Run.${cfg.goal}`);
    abort.current = new AbortController();
    setProgress(0);
    setRunError(null);
    const { lastRun, ...settings } = cfg;
    let result;
    try {
      result = await optimize(plan, settings, { onProgress: setProgress, signal: abort.current.signal });
    } catch (e) {
      setRunError(e.message);
      setView("setup");
      return;
    } finally {
      setProgress(null);
    }
    if (!result) return;
    const saved = { ...result, at: new Date().toISOString(), fingerprint: planFingerprint(plan) };
    update((p) => { p.monteCarlo = { ...settings, lastRun: saved }; });
    setSelected(null);
    setView("results");
  };

  const apply = (r) => setConfirm({
    title: `Apply ${r.rank === 1 ? "the best option" : `option ${r.rank}`} to this plan?`,
    message: (
      <div>
        <div style={{ marginBottom: 8 }}>These Strategy settings change:</div>
        <ul style={{ margin: 0, paddingLeft: 18 }}>{changeLines(r.changes, ccy).map((t) => <li key={t}>{t}</li>)}</ul>
        {r.changes.some((c) => c.field === "reserve") && <div style={{ marginTop: 8 }}>Follow-on participation in every round is scaled together to hold the new reserve.</div>}
      </div>
    ),
    confirmLabel: "Apply",
    onConfirm: () => {
      trackClick("FundModeling.FundConstruction.MonteCarlo.Apply");
      update((p) => applyVariant(p, r.variant));
      setConfirm(null);
    },
  });
  const saveCopy = (r) => {
    trackClick("FundModeling.FundConstruction.MonteCarlo.SaveCopy");
    const copy = copyPlan(applyVariant(structuredClone(plan), r.variant), [], new Date(), `${plan.name} · Option ${r.rank}`);
    copy.monteCarlo = { ...copy.monteCarlo, lastRun: null };
    addPlan(copy);
    onClose();
  };

  const runButton = progress == null ? (
    <Btn kind="primary" size="comfortable" onClick={run} disabled={!canRun} data-testid="mc-run">{RUN_LABEL[cfg.goal]}</Btn>
  ) : (
    <div data-testid="mc-progress" style={{ minWidth: 260 }}>
      <div style={{ height: 6, borderRadius: 3, background: "var(--ink-color-global-surface-lightgray-default)", overflow: "hidden" }}>
        <div style={{ width: `${Math.round(progress * 100)}%`, height: "100%", background: "var(--ink-button-background-color-primary-base-default)" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6, ...sans, fontSize: FS.micro, ...subtle }}>
        Simulating strategies… {Math.round(progress * 100)}%
        <Btn kind="link" onClick={() => abort.current?.abort()} data-testid="mc-cancel">Cancel</Btn>
      </div>
    </div>
  );

  const setup = (
    <div data-testid="mc-setup" style={{ maxWidth: 980, margin: "0 auto", padding: "20px 24px 28px" }}>
      <Step n={1} title="What do you want to figure out?">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 230px), 1fr))", gap: 10 }}>
          {GOALS.map((g) => <Choice key={g.id} on={cfg.goal === g.id} onClick={() => set({ goal: g.id })} title={g.label} blurb={g.question} testId={`mc-tab-${g.id}`} />)}
        </div>
      </Step>
      <Step n={2} title={{ split: "Any limits on the split?", checks: "What it tries", companies: "How many companies?" }[cfg.goal]} hint={cfg.goal === "split" ? "optional" : null}>
        <div style={panel}><GoalControls cfg={cfg} set={set} plan={plan} facts={facts} ccy={ccy} few={few} /></div>
      </Step>
      <Step n={3} title="How should options be ranked?"
        tip={<Tip label="About ranking">Venture returns are driven by a few big winners. The average is pulled up by rare huge outcomes, so the typical outcome or the chance of hitting a target is usually a better guide.</Tip>}>
        <Ranking cfg={cfg} set={set} shared={shared} setTarget={setTarget} />
      </Step>
      <Step n={4} title="How realistic should it be?" hint="every simulated fund uses these">
        <Realism cfg={cfg} set={set} plan={plan} ccy={ccy} />
      </Step>
      <div style={{ borderTop: "1px solid var(--ink-color-global-border-subtle)", paddingTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span data-testid="mc-estimate" style={{ ...sans, fontSize: FS.small, ...subtle }}>
            Screens candidates on {(cfg.objective === "target" ? TARGET_SCREEN_RUNS : SCREEN_RUNS).toLocaleString("en-US")} funds each, then re-runs the best five and your plan on {cfg.settings.runs.toLocaleString("en-US")}.
          </span>
          {out && progress == null && <Btn onClick={() => setView("results")} data-testid="mc-back-results">Back to results</Btn>}
          {runButton}
        </div>
        {!facts && <div style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-feedback-negative-strong)", marginTop: 8 }}>Finish Fund terms, Market and Strategy first.</div>}
        {oversized.map((a) => (
          <div key={a.id} data-testid="mc-oversized" style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-feedback-negative-strong)", marginTop: 8 }}>
            {a.name}: the first check of {fmtCheckIn(a.check, ccy)} is bigger than the whole {fmtCheckIn(a.roundSize, ccy)} round it goes into. Lower the check or pick a later entry round in Strategy to run Monte Carlo.
          </div>
        ))}
        {runError && <div data-testid="mc-error" style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-feedback-negative-strong)", marginTop: 8 }}>{runError}</div>}
        {plan.recycling?.enabled && <div style={{ ...sans, fontSize: FS.micro, ...subtle, marginTop: 8 }}>Recycling isn't simulated here yet, so these results leave it out.</div>}
      </div>
    </div>
  );

  const results = out && (
    <Results plan={plan} out={out} stale={stale} metric={metric} setMetric={setMetric} selected={selected} setSelected={setSelected}
      onEditSetup={() => setView("setup")} onApply={apply} onSaveCopy={saveCopy}
      runAgain={progress == null ? <Btn onClick={run} disabled={!canRun} data-testid="mc-run-again">Run again</Btn> : runButton} />
  );

  return (
    <div role="dialog" aria-modal="true" aria-label="Monte Carlo" data-testid="monte-carlo"
      style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(16,24,40,.34)", backdropFilter: "blur(2px)", padding: 16, display: "flex" }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: "var(--ink-color-global-surface-background-default)",
        border: "1px solid var(--ink-color-global-border-subtle)", borderRadius: 12, boxShadow: "0 18px 50px rgba(16,24,40,.28)", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "16px 24px", borderBottom: "1px solid var(--ink-color-global-border-subtle)" }}>
          <div style={{ flex: 1 }}>
            <div style={{ ...sans, fontSize: FS.h3, fontWeight: 700 }}>Monte Carlo · {plan.name}</div>
            <div style={{ ...sans, fontSize: FS.small, ...subtle, marginTop: 2 }}>
              Test strategies on thousands of simulated funds, then look inside any of them.
            </div>
            <MonteCarloAbout style={{ margin: "10px 0 0", padding: "8px 12px" }} />
          </div>
          <button type="button" onClick={onClose} aria-label="Close" data-testid="mc-close"
            style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "var(--ink-color-global-text-subtle)" }}><CloseIcon size={18} /></button>
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>
          {view === "results" && out ? results : setup}
          <MonteCarloDisclaimer style={{ margin: "0 auto", padding: "0 24px 20px", maxWidth: 980, boxSizing: "border-box" }} />
        </div>
      </div>
      {confirm && <ConfirmDialog {...confirm} onCancel={() => setConfirm(null)} />}
    </div>
  );
}
