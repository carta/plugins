import { FS, sans } from "../../ui/theme.js";
import FeeTiersEditor from "./FeeTiersEditor.jsx";
import ExpenseTotal from "./ExpenseTotal.jsx";
import FeeSource, { feesOf } from "./FeeReference.jsx";
import { StepHeader, hintStyle, UsdDefaultsNotice } from "./fields.jsx";

function Section({ title, blurb, children, testId }) {
  return (
    <section className="card" data-testid={testId} style={{ padding: "16px 20px 18px", marginBottom: 16 }}>
      <div style={{ ...sans, fontSize: FS.bodyLg, fontWeight: 600 }}>{title}</div>
      <div style={{ ...hintStyle, marginTop: 2, marginBottom: 14, maxWidth: "72ch" }}>{blurb}</div>
      {children}
    </section>
  );
}

export default function FeesStep({ plan, update, result, snapshot }) {
  const ccy = plan.general.currency;
  const light = plan.mode === "light";
  const { tiers } = feesOf(plan);
  const t = result?.ok ? result.totals : result?.partial?.totals ?? null;

  return (
    <div data-testid={light ? "lightFees-step" : "fees-step"}>
      <StepHeader title="Fees & expenses">
        Management fees and fund running costs. They come out of commitments, so every unit spent here is one less to invest: more fees mean fewer deals.
      </StepHeader>

      <Section testId="fees-section" title="Management fees" blurb="What LPs pay the manager. Add a tier for each step-down or step-up, for example a lower rate on invested capital after the investment period.">
        <FeeSource kind="fees" plan={plan} update={update} result={result} snapshot={snapshot} />
        <FeeTiersEditor tiers={tiers} general={plan.general} ccy={ccy} feesByTier={t?.feesByTier}
          edit={(fn) => update((p) => { fn((feesOf(p).tiers ??= [])); })} />
      </Section>

      <Section testId="expenses-section" title="Fund expenses" blurb="Legal, audit, administration and other costs the fund pays outside the management fee, as one total over the fund's life spread evenly across the term.">
        <UsdDefaultsNotice ccy={ccy} amounts="fund expenses" />
        <FeeSource kind="expenses" plan={plan} update={update} result={result} snapshot={snapshot} />
        <ExpenseTotal plan={plan} update={update} />
      </Section>

      <div style={{ ...hintStyle, marginBottom: 16 }}>
        Fee months count from the fund's start: month 1 to 60 is the first five years. Fees on committed capital are charged on LP commitments from each close.
      </div>
    </div>
  );
}
