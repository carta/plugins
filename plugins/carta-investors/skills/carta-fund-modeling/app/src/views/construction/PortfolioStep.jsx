import { FS, sans, inkNum, NOTICE_TINT } from "../../ui/theme.js";
import { Btn, InfoTip } from "../../ui/components.jsx";
import { fmtMIn, fmtFullIn, fmtPct } from "../../ui/format.js";
import { lightPortfolio, validatePortfolio, setCompanies, fitToCapital, resolveOutcomes, FIT_LEVERS } from "../../model/construction/light.js";
import { StepHeader, Field, NumInput, AmountInput, PctInput, fmtCount } from "./fields.jsx";

const investableOf = (result) => (result?.ok ? result.totals.investable : result?.partial?.totals.investable ?? null);

// Two even columns, every box the same width, so labels, boxes, units and hints line up.
const WIDTH = 620;
const BOX = 170;
const inputs = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "18px 32px", maxWidth: WIDTH };
const NBSP = "\u00a0"; // keeps a hint line in every field so rows stay level
const subtle = "var(--ink-color-global-text-subtle)";

function Label({ children, tip }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      {children}
      {tip && <InfoTip portal placement="top" width={280} label={`About ${children}`}>{tip}</InfoTip>}
    </span>
  );
}

/** What the portfolio puts to work against what the fund can invest after fees and expenses. */
function CapitalCheck({ plan, result, book, onFit, update }) {
  const ccy = plan.general.currency;
  const investable = investableOf(result);
  const gap = investable != null ? book.deployed - investable : null;
  const fits = gap != null && Math.abs(gap) <= investable * 0.02;
  const warn = gap != null && !fits;
  const levers = plan.light.fitLevers ?? [];
  const cell = (label, value, op) => (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
      {op && <span aria-hidden style={{ color: subtle, fontSize: FS.body, paddingBottom: 1 }}>{op}</span>}
      <div>
        <div style={{ fontSize: FS.micro, color: subtle, marginBottom: 2 }}>{label}</div>
        <div style={{ ...inkNum, fontSize: FS.body, fontWeight: 600 }}>{value}</div>
      </div>
    </div>
  );
  return (
    <div data-testid="capital-check" style={{ ...sans, marginTop: 24, maxWidth: WIDTH, padding: "14px 16px", borderRadius: 8,
      border: "1px solid var(--ink-color-global-border-subtle)", background: warn ? NOTICE_TINT : "var(--ink-color-global-surface-background-underlay)" }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        {cell("First checks", fmtMIn(book.initialCapital, ccy))}
        {cell("Reserves", fmtMIn(book.reserves, ccy), "+")}
        {cell("To invest", fmtMIn(book.deployed, ccy), "=")}
        {cell("Investable capital", fmtMIn(investable, ccy), "of")}
      </div>
      <div data-testid="capital-status" role={warn ? "alert" : undefined}
        style={{ fontSize: FS.small, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 10, paddingTop: 10,
          borderTop: "1px solid var(--ink-color-global-border-subtle)",
          color: gap == null ? subtle : fits ? "var(--ink-color-global-feedback-positive-strong)" : "var(--ink-color-global-text-default)" }}>
        {gap == null && <span>Finish General and Fees & Expenses to compare this with the fund's investable capital.</span>}
        {fits && <span>Fits the fund's investable capital after fees and expenses.</span>}
        {warn && (
          <>
            <span>
              {gap > 0
                ? `This needs ${fmtFullIn(gap, ccy)} (${fmtPct(gap / investable, 0)}) more than the fund can invest after fees and expenses.`
                : `This leaves ${fmtFullIn(-gap, ccy)} (${fmtPct(-gap / investable, 0)}) of investable capital unused.`}
            </span>
            <Btn onClick={() => onFit(investable)} data-testid="fit-capital" disabled={!levers.length}
              title={levers.length ? undefined : "Choose at least one input to adjust"}>Fit to capital</Btn>
          </>
        )}
      </div>
      {warn && <FitLevers levers={levers} update={update} />}
    </div>
  );
}

/** Which inputs "Fit to capital" may change. Any mix; the others stay exactly as typed. */
function FitLevers({ levers, update }) {
  const toggle = (id) => update((p) => {
    const cur = new Set(p.light.fitLevers ?? []);
    if (cur.has(id)) cur.delete(id); else cur.add(id);
    p.light.fitLevers = FIT_LEVERS.map((x) => x.id).filter((x) => cur.has(x));
  });
  return (
    <div data-testid="fit-levers" role="group" aria-label="Inputs Fit to capital may change"
      style={{ ...sans, fontSize: FS.small, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
      <span style={{ color: subtle }}>Fit by adjusting</span>
      {FIT_LEVERS.map((x) => {
        const on = levers.includes(x.id);
        return (
          <button key={x.id} type="button" aria-pressed={on} data-testid={`fit-lever-${x.id}`} onClick={() => toggle(x.id)}
            style={{ ...sans, fontSize: FS.small, cursor: "pointer", padding: "4px 10px", borderRadius: 999,
              border: `1px solid ${on ? "var(--ink-color-global-text-default)" : "var(--ink-color-global-border-default)"}`,
              background: on ? "var(--ink-color-global-text-default)" : "var(--ink-color-global-surface-background-default)",
              color: on ? "var(--ink-color-global-surface-background-default)" : "var(--ink-color-global-text-default)" }}>
            {on ? "✓ " : ""}{x.label}
          </button>
        );
      })}
      <span style={{ color: subtle }}>{levers.length ? "· Everything else stays as you typed it." : "· Choose at least one."}</span>
    </div>
  );
}

export default function PortfolioStep({ plan, update, result }) {
  const l = plan.light;
  const ccy = plan.general.currency;
  const errors = validatePortfolio(l);
  const book = lightPortfolio(l);
  const investable = investableOf(result);
  const set = (key, value) => update((p) => { p.light[key] = value; });
  // An input re-solves the outcome table (unless hand-edited) but never changes another input; only Fit to capital does.
  const setSolved = (fn) => update((p) => { fn(p.light); resolveOutcomes(p.light); });
  const fit = (cap) => setSolved((q) => { fitToCapital(q, cap); });
  return (
    <div data-testid="portfolio-step">
      <StepHeader title="Portfolio">Set the portfolio and a target. The outcomes below are solved from them; nothing here changes the other boxes unless you click Fit to capital.</StepHeader>
      <div style={inputs}>
        <Field label={<Label tip="Companies that get a first check.">Number of companies</Label>} error={errors.companies} hint={NBSP} testId="field-companies">
          <NumInput value={l.companies} step={1} suffix="companies" onChange={(v) => setSolved((q) => setCompanies(q, v))} width={BOX} testId="input-companies" invalid={!!errors.companies} />
        </Field>
        <Field label={<Label tip="The average first check. It stays as you typed it; use Fit to capital below to size it to the fund.">Initial check size</Label>}
          error={errors.initialCheck} testId="field-initialCheck"
          hint={NBSP}>
          <AmountInput ccy={ccy} value={l.initialCheck} width={BOX} onChange={(v) => set("initialCheck", v)} testId="input-initialCheck" invalid={!!errors.initialCheck} />
        </Field>
        <Field label={<Label tip="Share of all invested capital held back for follow-ons. Only companies that survive get them.">Reserves</Label>}
          error={errors.reservePct} testId="field-reservePct"
          hint={book.survivors > 0 && book.reserves > 0 ? `≈ ${fmtFullIn(book.followOn, ccy)} per survivor (${fmtCount(book.survivors)})` : NBSP}>
          <PctInput value={l.reservePct} onChange={(v) => setSolved((q) => { q.reservePct = v; })} width={BOX} testId="input-reservePct" invalid={!!errors.reservePct} />
        </Field>
        <Field label={<Label tip="Gross multiple on everything invested, first checks plus follow-ons. The outcomes below are solved to hit it.">Target gross MOIC</Label>}
          error={errors.targetMoic} hint={NBSP} testId="field-targetMoic">
          <NumInput value={l.targetMoic} decimals={2} step={0.1} suffix="× gross" onChange={(v) => setSolved((q) => { q.targetMoic = v; })} width={BOX} testId="input-targetMoic" invalid={!!errors.targetMoic} />
        </Field>
        <Field label={<Label tip="When survivors get their follow-on, or the month before they exit if that's sooner.">Follow-on timing</Label>}
          error={errors.followOnMonths} hint={NBSP} testId="field-followOnMonths">
          <NumInput value={l.followOnMonths} onChange={(v) => set("followOnMonths", v)} width={BOX} suffix="months after first check" testId="input-followOnMonths" ariaLabel="Follow-on timing in months" invalid={!!errors.followOnMonths} />
        </Field>
      </div>
      <CapitalCheck plan={plan} result={result} book={book} onFit={fit} update={update} />
    </div>
  );
}
