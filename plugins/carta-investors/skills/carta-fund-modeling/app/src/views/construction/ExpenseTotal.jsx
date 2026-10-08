// The plan keeps one whole-life total; a past fund's line items are reference only.
import { FS, sans } from "../../ui/theme.js";
import { fmtFullIn, fmtPct } from "../../ui/format.js";
import { expenseTotalOf, expenseError, termYearsOf } from "../../model/construction/feeTiers.js";
import { Field, AmountInput, PctInput, UnitToggle, hintStyle } from "./fields.jsx";
import { feesOf } from "./FeeReference.jsx";

export default function ExpenseTotal({ plan, update }) {
  const f = feesOf(plan);
  const g = plan.general;
  const ccy = g.currency;
  const byPct = f.expenseMode === "pct";
  const error = expenseError(f);
  const years = termYearsOf(g, 0);
  const total = expenseTotalOf(f, g);
  const set = (key, value) => update((p) => { const q = feesOf(p); q[key] = value; delete q.expenseBasis; });
  // Switching entry mode carries the current value across, so expenses don't jump.
  const setMode = (mode) => update((p) => {
    const q = feesOf(p);
    const c = p.general.committed;
    if (mode === "pct" && q.expenseMode !== "pct" && c > 0) q.expenseTotalPct = Math.round(((q.expenseTotal || 0) / c) * 1e5) / 1e5;
    if (mode === "amount" && q.expenseMode === "pct" && c > 0) q.expenseTotal = Math.round((q.expenseTotalPct || 0) * c);
    q.expenseMode = mode;
  });
  const hint = !(g.committed > 0)
    ? "Over the fund's life. Enter total committed capital to see the other figure."
    : `${byPct ? fmtFullIn(total, ccy) : `${fmtPct(total / g.committed, 2)} of commitments`} over the fund's life · about ${fmtFullIn(years > 0 ? total / years : 0, ccy)} a year`;
  const basis = f.expenseBasis;
  return (
    <div data-testid="fund-expenses">
      <Field label="Fund expenses over the fund's life" error={error} hint={hint} testId="field-expense">
        <span style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {byPct
            ? <PctInput value={f.expenseTotalPct} onChange={(v) => set("expenseTotalPct", v)} width={100} testId="input-expenseTotalPct" invalid={!!error} />
            : <AmountInput ccy={ccy} value={f.expenseTotal} onChange={(v) => set("expenseTotal", v)} testId="input-expenseTotal" invalid={!!error} width={180} />}
          <UnitToggle label="Fund expenses as" value={byPct ? "pct" : "amount"} onChange={setMode}
            options={[{ id: "pct", label: "% of fund", testId: "expense-mode-pct" }, { id: "amount", label: "amount", testId: "expense-mode-amount" }]} />
        </span>
      </Field>
      {basis?.lines?.length > 0 && (
        <div data-testid="expense-basis" style={{ marginTop: 12, maxWidth: 520 }}>
          <div style={{ ...hintStyle, marginTop: 0, marginBottom: 4 }}>Based on {basis.source}. Its breakdown is for reference; the plan keeps only the total, and editing it clears this list.</div>
          <ul style={{ ...sans, fontSize: FS.small, margin: 0, paddingLeft: 18 }}>
            {basis.lines.map((l) => <li key={l.name}>{l.name}: {fmtFullIn(l.amount, ccy)}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
