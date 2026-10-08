// The settings bar (market, outlook, prices) drives the sector profile table, which stays editable by hand.
import { useMemo, useState } from "react";
import { FS, sans } from "../../ui/theme.js";
import { Dropdown, InfoTip } from "../../ui/components.jsx";
import ConfirmDialog from "../../ui/ConfirmDialog.jsx";
import { fmtMIn, fmtPct } from "../../ui/format.js";
import { combineFunds, fundBenchmark } from "../../model/construction/benchmark.js";
import { MARKETS, DIALS, defaultMarket, historyRates, marketStages, marketFunnel, autoProfileName, keepDilution, ladderKey } from "../../model/construction/market.js";
import { defaultFollowOns } from "../../model/construction/plan.js";
import { VALUATION_BENCHMARKS, benchmarkLabel, findValuationBenchmark } from "../../model/construction/valuationBenchmarks.js";
import { useInvestmentHistory } from "./BenchmarkPanel.jsx";
import { C_TVPI } from "./charts.jsx";
import SectorsStep from "./SectorsStep.jsx";
import PricePicker from "./PricePicker.jsx";
import DialSlider from "./DialSlider.jsx";
import { StepHeader, hintStyle, UsdDefaultsNotice } from "./fields.jsx";

const subtle = { color: "var(--ink-color-global-text-subtle)" };
const card = { padding: "16px 18px", borderRadius: 8, border: "1px solid var(--ink-color-global-border-subtle)", background: "var(--ink-color-global-surface-background-default)" };

const Tip = ({ label, children, width = 320 }) => (
  <InfoTip portal placement="top" width={width} label={label}><div style={{ display: "grid", gap: 6 }}>{children}</div></InfoTip>
);

function Ctl({ label, tip, children, testId, hint }) {
  return (
    <div data-testid={testId} style={{ minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <span style={{ ...sans, fontSize: FS.small, fontWeight: 600 }}>{label}</span>
        {tip && <Tip label={`About: ${label}`}>{tip}</Tip>}
      </div>
      {children}
      {hint && <div style={{ ...sans, fontSize: FS.micro, ...subtle, marginTop: 6, lineHeight: 1.45 }}>{hint}</div>}
    </div>
  );
}

/** What the settings mean for 100 companies taking a first check at the entry round. */
function WhatItMeans({ sector, ccy }) {
  const f = marketFunnel(sector.stages);
  const entry = sector.stages.find((s) => s.name === f.entry);
  const later = f.rows.slice(1);
  const n = (v) => Math.round(v);
  return (
    <section data-testid="market-funnel" style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ ...sans, fontSize: FS.bodyLg, fontWeight: 600 }}>What this means</span>
        <Tip label="About: What this means">
          <div>Averages for 100 companies that take their first check at {f.entry}, using the settings above.</div>
          <div>Real portfolios vary a lot around these numbers. They're the expected path, not a prediction.</div>
        </Tip>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: "16px 32px", alignItems: "start" }}>
      <div data-testid="market-funnel-text" style={{ ...sans, fontSize: FS.body, lineHeight: 1.55 }}>
        Out of <strong>100 {f.entry} companies</strong>:{" "}
        {later.map((r, i) => `~${n(r.reach)}${i === 0 ? " raise" : ""} ${/^[AEIOU]/i.test(r.name) ? "an" : "a"} ${r.name}`).join(" → ")}.
        <br />
        About <strong>{n(f.exited)} exit</strong> along the way
        {f.exitRange ? `, typically at ${fmtMIn(f.exitRange[0], ccy)}–${fmtMIn(f.exitRange[1], ccy)}` : ""}. The rest fail.
        {f.yearsToExit != null && ` The typical path from ${f.entry} to an exit is ~${f.yearsToExit.toFixed(0)} years.`}
        {entry && <><br />{entry.name} rounds raise {fmtMIn(entry.roundSize, ccy)} at {fmtMIn(entry.preMoney, ccy)} pre-money.</>}
      </div>
      <div aria-hidden="true" style={{ display: "grid", gap: 5, marginTop: 14 }}>
        {f.rows.map((r) => (
          <div key={r.name} style={{ display: "grid", gridTemplateColumns: "76px 1fr 30px", alignItems: "center", gap: 8, fontSize: FS.micro }}>
            <span style={subtle}>{r.name}</span>
            <span style={{ height: 10, borderRadius: "0 4px 4px 0", width: `${Math.max(1, r.reach)}%`, background: C_TVPI }} />
            <span style={{ textAlign: "right" }}>{n(r.reach)}</span>
          </div>
        ))}
      </div>
      </div>
    </section>
  );
}

const DIAL_TIPS = {
  grad: ["Changes every round's chance of raising its next round: Less is about 20% lower, More about 20% higher.",
    "More companies reaching later rounds means more follow-on checks, and more chances at a large exit."],
  exits: ["Changes the exit value at every round: Smaller is about 30% lower, Bigger about 40% higher.",
    "It doesn't change how many companies exit, only what each exit is worth."],
  pace: ["Changes the months between rounds and to an exit: Slower is about 30% longer, Faster about 25% shorter.",
    "Slower paths push exits later, sometimes past the fund's end, where holdings are sold at their value on that date."],
};

/** The live effect of a dial on the entry round, e.g. "Seed → Series A: 55% of companies". */
function dialEffect(id, stages, ccy) {
  const i = Math.max(0, stages.findIndex((s) => s.name === "Seed"));
  const s = stages[i], next = stages[i + 1];
  if (!s) return "";
  if (id === "grad") return next ? `${s.name} → ${next.name}: ${fmtPct(s.gradRate, 0)} of companies` : "";
  if (id === "exits") {
    const first = stages.find((x) => x.exitRate > 0) ?? stages.at(-1);
    return `${first.name} exit: ${fmtMIn(first.exitValuation, ccy)} · ${stages.at(-1).name} exit: ${fmtMIn(stages.at(-1).exitValuation, ccy)}`;
  }
  return next ? `${s.name} → ${next.name}: about ${s.monthsToGraduate} months` : "";
}

export default function MarketStep({ plan, update, firm }) {
  const sectors = plan.sectors;
  const [activeId, setActiveId] = useState(sectors[0]?.id);
  const [pending, setPending] = useState(null);
  const sector = sectors.find((s) => s.id === activeId) ?? sectors[0];
  const market = sector.market ?? defaultMarket();
  const ccy = plan.general.currency;
  const usd = ccy === "USD";
  const paused = !!sector.customized;
  const history = useInvestmentHistory(firm);
  const rates = useMemo(() => {
    if (!history) return null;
    const b = fundBenchmark(combineFunds(history, Object.keys(history)), null);
    const r = historyRates(b);
    return Object.keys(r).length ? { rates: r, companies: b?.companies ?? 0 } : null;
  }, [history]);
  const bench = findValuationBenchmark(market.prices);

  // Rebuild the sector's rounds from its market; allocations keep their follow-on settings.
  const rebuild = (patch) => update((p) => {
    const s = p.sectors.find((x) => x.id === sector.id);
    s.market = { ...(s.market ?? defaultMarket()), ...patch };
    const name = autoProfileName(s, s.market);
    if (name) { s.name = name; s.autoName = name; }
    if (s.market.preset === "history" && rates) s.market.historyRates = rates.rates;
    s.stages = keepDilution(marketStages(s.market), s.stages);
    s.customized = false;
    for (const a of p.allocations.filter((x) => x.sectorId === s.id)) {
      if (a.followOns?.length !== s.stages.length) a.followOns = defaultFollowOns(s.stages.length, Math.min(a.entryStage, s.stages.length - 1));
    }
  });
  // Changing a setting rebuilds every round, so hand edits are only discarded after a yes.
  const setMarket = (patch) => (paused ? setPending(patch) : rebuild(patch));
  // Any edit in the table marks the sector as edited by hand.
  const updateFromTable = (fn) => update((p) => {
    const before = p.sectors.map((s) => ladderKey(s.stages));
    fn(p);
    p.sectors.forEach((s, i) => { if (before[i] !== undefined && before[i] !== ladderKey(s.stages)) s.customized = true; });
    for (const s of p.sectors) if (!s.market) { s.market = defaultMarket(); s.customized = true; }
  });
  const currentMarket = MARKETS.find((m) => m.id === market.preset) ?? MARKETS[0];
  // The sliders show where each dial really sits: the chosen market's own position plus any nudge on top of it.
  const clampLevel = (n) => Math.max(-2, Math.min(2, n));
  const tilt = (id) => currentMarket.tilt[id] ?? 0;
  const levelOf = (id) => clampLevel(tilt(id) + (market[id] ?? 0));
  const adjusted = DIALS.some((d) => (market[d.id] ?? 0) !== 0);
  const marketOptions = [
    ...MARKETS.filter((m) => m.id !== "history" || rates || market.preset === "history").map((m) => ({ id: m.id, label: m.label })),
    ...(adjusted ? [{ id: "custom", label: "Custom" }] : []),
  ];
  const priceOptions = [{ id: "default", label: "App defaults" }, ...VALUATION_BENCHMARKS.map((b) => ({ id: b.id, label: `Carta benchmarks \u00b7 ${b.sector}` }))];

  return (
    <div data-testid="market-step">
      <StepHeader title="Market">
        Pick a market, nudge the outlook and choose price benchmarks. The sector profile below updates to match, and you can edit any number in it to override.
      </StepHeader>
      <UsdDefaultsNotice ccy={ccy} amounts="round sizes, valuations and checks" />

      <section data-testid="market-controls" className="card" style={{ padding: "16px 20px", marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 230px), 1fr))", gap: "16px 24px", alignItems: "start" }}>
          <Ctl label="Market" testId="market-q1" hint={adjusted ? `Set from ${currentMarket.label.toLowerCase()} with the sliders. Pick a market to start over.` : currentMarket.blurb}
            tip={<>
              <div>A starting point for the three sliders: how many companies raise their next round, how big exits are, and how long it all takes.</div>
              <div>Picking a market moves the sliders to its position. Moving a slider yourself makes it Custom.</div>
              <div>It doesn't set round sizes or prices. Those come from "Round sizes and valuations".</div>
            </>}>
            <Dropdown testId="market-pick" minWidth={230} value={adjusted ? "custom" : market.preset} options={marketOptions}
              onChange={(v) => { if (v !== "custom" && (adjusted || v !== market.preset)) setMarket({ preset: v, grad: 0, exits: 0, pace: 0 }); }} />
            {market.preset === "history" && (
              <div style={{ ...hintStyle, marginTop: 6 }}>
                {rates ? `From ${rates.companies} companies across your funds. ` : ""}Estimated from how often your companies got another check from you, so it runs cautious.
              </div>
            )}
          </Ctl>

          {DIALS.map((d) => (
            <Ctl key={d.id} label={d.label} testId={`dial-row-${d.id}`} tip={DIAL_TIPS[d.id].map((t) => <div key={t}>{t}</div>)}>
              <DialSlider id={d.id} label={d.label} options={d.options} value={levelOf(d.id)} base={clampLevel(tilt(d.id))} baseLabel={currentMarket.label.replace(/ market$/i, "").toLowerCase()}
                onChange={(v) => setMarket({ [d.id]: v - tilt(d.id) })} />
              <div data-testid={`dial-effect-${d.id}`} style={{ ...sans, fontSize: FS.micro, ...subtle, marginTop: 4 }}>{dialEffect(d.id, sector.stages, ccy)}</div>
            </Ctl>
          ))}

          <Ctl label="Round sizes and valuations" testId="market-prices"
            tip={<>
              <div>How much companies raise in each round, and at what price.</div>
              <div>This sets your pro-rata follow-on checks and how much each round dilutes you. It also sets the value of companies you still hold when the fund ends.</div>
              <div>Hover a choice to preview every round. Carta's benchmarks are medians of US rounds, Q2 2021 – Q2 2026, by sector. They change prices only, and exit values are rescaled to match each round's new price.</div>
            </>}
            hint={bench ? `${bench.source}, ${benchmarkLabel(bench)}. Pre-Seed isn't in the benchmark, so it keeps the app's defaults. Exit values are rescaled to the new prices.` : "The app's starting assumptions. Hover a Carta benchmark to preview it."}>
            <PricePicker testId="market-prices-pick" ccy={ccy} options={priceOptions} value={bench ? bench.id : "default"}
              canApply={(id) => id === "default" || usd} onChange={(v) => setMarket({ prices: v })} />
            {!usd && (
              <div style={{ ...hintStyle, marginTop: 6 }}>
                The market benchmarks are in USD and this plan is in {ccy || "another currency"}, so they can't be applied.
              </div>
            )}
          </Ctl>
        </div>
      </section>

      <div style={{ marginBottom: 16 }}>
        <SectorsStep plan={plan} update={updateFromTable} activeId={sector.id} onActive={setActiveId} />
      </div>

      <WhatItMeans sector={sector} ccy={ccy} />

      {pending && (
        <ConfirmDialog title="Replace your edits?" confirmLabel="Replace edits" danger
          message={"Changing this rebuilds every round from the market settings and discards the numbers you edited by hand."}
          onCancel={() => setPending(null)} onConfirm={() => { rebuild(pending); setPending(null); }} />
      )}
    </div>
  );
}
