import { useMemo } from "react";
import { Num, MixedCurrencyText } from "../../ui/components.jsx";
import { fmtM } from "../../ui/format.js";
import { computeReserves, reserveOptsOf, hasCommittedCapital } from "../../model/reserves.js";
import { WidgetCard, WidgetStat, WidgetNote, BarRows, BarRow, ThinBar, SUBTLE, ACCENT, widgetFundName } from "./WidgetCard.jsx";

const FUND_ROWS = 3; // funds listed under the headline; every fund is on the Reserves tab

/** Dry powder — capital still to deploy (the Reserves tab's model): the firm's total
 *  left, as on the Reserves tab, as an unlabelled headline, then the three funds with the
 *  most left, largest first, each with its own deployed bar. Funds with nothing left, funds
 *  under the committed-capital floor (hasCommittedCapital) and SPVs aren't listed. Firm-wide
 *  sums, so a mixed-currency firm gets the notice instead. The note covers everything not
 *  listed that has dry powder left (SPVs included), so the headline is the listed funds
 *  plus the note. */
export function DryPowderWidget({ snapshot, portfolio, mixed, firmName, onNavigate, span }) {
  const a = portfolio.assumptions || {};
  const reserves = useMemo(() => computeReserves(snapshot, portfolio, reserveOptsOf(a)), [snapshot, portfolio]);
  const view = { tab: "reserves", name: "DryPowder" };
  if (mixed) return <WidgetCard title="Dry powder" view={view} onNavigate={onNavigate} testId="ov-widget-reserves" span={span}><MixedCurrencyText /></WidgetCard>;
  const ranked = reserves.funds
    .filter((f) => !f.isSpv && hasCommittedCapital(f) && f.reserves > 0)
    .sort((x, y) => y.reserves - x.reserves);
  const funds = ranked.slice(0, FUND_ROWS);
  const listed = new Set(funds);
  const rest = reserves.funds.filter((f) => f.reserves > 0 && !listed.has(f));
  const restLeft = rest.reduce((s, f) => s + f.reserves, 0);
  const restSpvs = rest.filter((f) => f.isSpv).length;
  const restFunds = rest.length - restSpvs;
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const restWords = restFunds > 0
    ? `${plural(restFunds, "more fund")}${restSpvs > 0 ? ` and ${plural(restSpvs, "SPV")}` : ""}`
    : plural(restSpvs, "more SPV");
  const deployedTitle = (f) => `${Math.round(f.deployedPct * 100)}% deployed · ${fmtM(f.deployed)} of ${fmtM(f.investable)} investable`;
  return (
    <WidgetCard title="Dry powder" view={view} onNavigate={onNavigate} testId="ov-widget-reserves" span={span}>
      <WidgetStat value={fmtM(reserves.totals.reserves)} />
      {funds.length > 0 && (
        <BarRows testId="ov-reserves-funds" style={{ marginTop: 14 }}>
          {funds.map((f) => (
            <BarRow key={f.id} data-datum-id={f.id} data-datum-type="fund"
              name={widgetFundName(f.name, firmName)} amount={f.deployed} max={f.investable} barTitle={deployedTitle(f)} value={`${fmtM(f.reserves)} left`} />
          ))}
        </BarRows>
      )}
      {rest.length > 0 && <WidgetNote testId="ov-reserves-note">{fmtM(restLeft)} dry powder in {restWords}</WidgetNote>}
    </WidgetCard>
  );
}

/** Carry accrued — the firm's GP carry at this scenario's marks (firm.gpCarry): Carta's
 *  accrued carry at Baseline, plus carry banked on modeled exits, which is why GP
 *  Economics calls the same figure "Modeled GP carry". Under it, a bar of how much of
 *  the carry earned so far (distributed plus accrued) has been distributed to the GP.
 *  Firm-wide sums, so a mixed-currency firm gets the notice instead. */
export function CarryWidget({ firm, snapshot, fundStates, onNavigate, span }) {
  const view = { tab: "gp-economics", name: "GpCarry" };
  if (firm.mixedCurrency) return <WidgetCard title="Carry accrued" view={view} onNavigate={onNavigate} testId="ov-widget-carry" span={span}><MixedCurrencyText /></WidgetCard>;
  const distributed = fundStates.reduce((s, f) => s + (snapshot.gpEconomics?.[f.id]?.carryDistributed || 0), 0);
  const earned = distributed + firm.gpCarry;
  return (
    <WidgetCard title="Carry accrued" view={view} onNavigate={onNavigate} testId="ov-widget-carry" span={span}>
      <WidgetStat value={<Num value={firm.gpCarry} fmt={fmtM} />} />
      {earned > 0.5 ? (
        <div style={{ marginTop: 14 }}>
          <div data-testid="ov-carry-bar" style={{ display: "flex" }}>
            <ThinBar parts={[{ value: distributed, color: ACCENT }]} max={earned} height={10}
              title={`Distributed ${fmtM(distributed)} · accrued ${fmtM(firm.gpCarry)}`} />
          </div>
          <div style={{ ...SUBTLE, marginTop: 8 }}>
            {distributed > 0.5 ? `${fmtM(distributed)} distributed` : "None distributed yet"}
          </div>
        </div>
      ) : (
        <div style={{ ...SUBTLE, marginTop: 16 }}>No fund has earned carry at these marks.</div>
      )}
    </WidgetCard>
  );
}
