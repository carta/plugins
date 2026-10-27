import { MixedCurrencyText } from "../../ui/components.jsx";
import { fmtM, shortCompany } from "../../ui/format.js";
import { WidgetCard, WidgetNote, BarRows, BarRow, SUBTLE } from "./WidgetCard.jsx";
import { reportChartId } from "../reports/sections.js";

const TOP = 5;

/** Concentration — who carries the firm's value at this scenario's marks: one bar
 *  for each of the top five companies in rank order, as Reports' Concentration
 *  chart draws them (bar length against the largest holding, the share of firm
 *  value beside it). Its View → opens Reports on that chart. `concentration` is
 *  concentrationAcrossAll's output, null when no live holding has value at this
 *  scenario's marks; the card then says why: no companies recorded at all
 *  (`hasCompanies` false), or none with remaining value (exited, written off,
 *  archived or marked to zero). */
export default function TopHoldings({ concentration: c, hasCompanies, mixed, onNavigate, span }) {
  const frame = (body) => (
    <WidgetCard title="Concentration" view={{ tab: "reports", name: "Concentration", section: reportChartId("concentration") }} onNavigate={onNavigate} testId="ov-widget-holdings" span={span}>{body}</WidgetCard>
  );
  if (mixed) return frame(<MixedCurrencyText />);
  if (!c) {
    return frame(<div data-testid="ov-holdings-empty" style={SUBTLE}>{hasCompanies ? "No holdings with remaining value." : "No investments recorded on Carta."}</div>);
  }
  const top = c.holdings.slice(0, TOP);
  const maxFv = top[0].fv;
  return frame(
    <>
      <BarRows testId="ov-holdings-bars" role="img" aria-label="Share of firm value by holding">
        {top.map((h) => {
          const name = shortCompany(h.name), share = `${((h.fv / c.total) * 100).toFixed(1)}%`;
          return <BarRow key={h.id} data-datum-id={h.id} data-datum-type="company" data-datum-label={h.name}
            name={name} nameTitle={`${name} · ${share} · ${fmtM(h.fv)}`} amount={h.fv} max={maxFv} value={share} />;
        })}
      </BarRows>
      <WidgetNote>{c.count} companies · {fmtM(c.total)}</WidgetNote>
    </>
  );
}
