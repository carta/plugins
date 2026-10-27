import { useMemo } from "react";
import { H1, H2, JumpLinks, FundPicker, EmptyState, MixedCurrencyNote, ALL_FUNDS } from "../../ui/components.jsx";
import { concentrationAcrossAll } from "../../model/concentration.js";
import { recentActivity } from "../../model/activity.js";
import { useFirmData } from "../../state/FirmData.jsx";
import { trackClick } from "../../analytics.js";
import PowerLaw from "../returns/PowerLaw.jsx";
import LpReport from "../returns/LpReport.jsx";
import { POWER_LAW_TITLE, EXIT_IMPACT_TITLE, LP_SENSITIVITY_TITLE } from "../returns/chartTitles.js";
import CohortStanding from "../CohortStanding.jsx";
import FundTheme from "./FundTheme.jsx";
import PacingCard, { hasPacingChart } from "./Pacing.jsx";
import ConcentrationCard from "./Concentration.jsx";
import RecentActivityCard from "./Activity.jsx";

// The page's themes, in order. A theme has its jump link and heading, its analytics
// name (FundModeling.Reports.Jump.<viewName>), and its charts. A per-fund theme
// (`perFund`) has charts that follow the page's fund picker in the jump-link bar. A chart that
// models one fund carries `allFunds`, what it draws while the picker is on All funds, given
// the entry's own `render` as its second argument; a firm-wide chart, or one that draws its
// own all-funds state (Return the fund, LP glidepath), has none and draws its `render` either way. A chart whose data this firm
// lacks is left out, and so is a theme left with no charts.
const SELECT_FUND = "Select a fund to see this chart.";
const selectFund = (text) => () => <EmptyState icon="pending" text={text} />;
// An all-funds chart that adds funds' amounts together; funds in more than one currency can't be added.
// Without a `render` of its own it draws the entry's `render`, which then pools every fund.
const combined = (title, render) => (p, own) => (p.mixedCurrency ? <MixedCurrencyNote title={title} /> : (render ?? own)(p));

const THEMES = [
  {
    // pacing, concentration and recent activity are firm-wide; the power-law charts follow the fund scope
    id: "portfolio-analysis", label: "Portfolio analysis", viewName: "PortfolioAnalysis", perFund: true,
    reports: [
      { id: "power-law-curve", available: () => true, render: (p) => <PowerLaw section="curve" {...p.returnsProps} />,
        allFunds: combined(POWER_LAW_TITLE) },
      { id: "return-the-fund", available: () => true, render: (p) => <PowerLaw section="return-the-fund" {...p.returnsProps} /> },
      { id: "net-tvpi-sensitivity", available: () => true, render: (p) => <PowerLaw section="sensitivity" {...p.returnsProps} />,
        allFunds: combined(EXIT_IMPACT_TITLE) },
      { id: "pacing", available: (p) => hasPacingChart(p.pacing), render: (p) => <PacingCard funds={p.snapshot.funds} /> },
      { id: "concentration", available: (p) => !!concentrationAcrossAll(p.snapshot, p.portfolio),
        render: (p) => <ConcentrationCard snapshot={p.snapshot} portfolio={p.portfolio} mixed={p.mixedCurrency} /> },
      { id: "activity", available: (p) => p.activity.length > 0, render: (p) => <RecentActivityCard rows={p.activity} mixed={p.mixedCurrency} onShowMore={p.onShowActivity} /> },
    ],
  },
  {
    id: "lp-returns", label: "LP returns", viewName: "LpReturns", perFund: true, needsNav: true,
    reports: [
      { id: "lp-return-sensitivity", available: () => true, render: (p) => <LpReport section="sensitivity" {...p.returnsProps} />,
        allFunds: combined(LP_SENSITIVITY_TITLE) },
      { id: "lp-glidepath", available: () => true, render: (p) => <LpReport section="glidepath" {...p.returnsProps} /> },
    ],
  },
  {
    id: "benchmarks", label: "Benchmarks", viewName: "Benchmarks",
    reports: [
      // CohortStanding draws its own empty state
      { id: "benchmarks", available: () => true, render: (p) => <CohortStanding snapshot={p.snapshot} fundStates={p.fundStates} portfolio={p.portfolio} /> },
    ],
  },
];

const sectionId = (theme) => `reports-${theme.id}`;

/** Reports tab — the less-used firm and fund charts on one long page, grouped into
 *  themes, with sticky jump links to each theme. `returnsProps` is what the
 *  Returns-family views take (the Power Law and LP charts read their fund scope and
 *  scenario settings from it). `onShowActivity` opens the full activity page. */
export default function Reports({ returnsProps, snapshot, portfolio, fundStates, mixedCurrency, onShowActivity }) {
  const { pacing } = useFirmData();
  const activity = useMemo(
    () => recentActivity(portfolio.companies, snapshot.funds, snapshot.source?.navAsOf),
    [portfolio, snapshot]
  );
  const props = { returnsProps, snapshot, portfolio, fundStates, mixedCurrency, pacing, activity, onShowActivity };
  const themes = THEMES
    .map((t) => ({ ...t, reports: t.reports.filter((r) => r.available(props)) }))
    .filter((t) => t.reports.length);
  const allFunds = returnsProps.fundScope === ALL_FUNDS;
  const jump = (id) => trackClick(`FundModeling.Reports.Jump.${themes.find((t) => sectionId(t) === id).viewName}`);
  return (
    <div>
      <H1>Reports</H1>
      <JumpLinks sections={themes.map((t) => [sectionId(t), t.label])} onJump={jump}
        actions={themes.some((t) => t.perFund) && snapshot.funds.length > 0 && (
          <FundPicker funds={snapshot.funds} value={returnsProps.fundScope}
            onChange={returnsProps.setFundScope} triggerLabel="Fund" />
        )} />
      {themes.map((t) => {
        const charts = t.reports.map((r) => <div key={r.id} data-testid={`report-${r.id}`} style={{ marginBottom: 32 }}>{allFunds && r.allFunds ? r.allFunds(props, r.render) : r.render(props)}</div>);
        return (
          <section key={t.id} id={sectionId(t)} style={{ marginBottom: 24 }}>
            {t.perFund
              ? <FundTheme title={t.label} returnsProps={returnsProps} needsNav={t.needsNav}>{charts}</FundTheme>
              : <><H2>{t.label}</H2>{charts}</>}
          </section>
        );
      })}
    </div>
  );
}
