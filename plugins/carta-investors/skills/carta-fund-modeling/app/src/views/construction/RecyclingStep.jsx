import { Toggle } from "../../ui/components.jsx";
import { fmtMIn } from "../../ui/format.js";
import { validateRecycling } from "../../model/construction/plan.js";
import { StepHeader, Field, NumInput, PctInput, grid } from "./fields.jsx";

export default function RecyclingStep({ plan, update, result }) {
  const r = plan.recycling;
  const errors = validateRecycling(r);
  const set = (key, v) => update((p) => { p.recycling[key] = v; });
  const ccy = plan.general.currency;
  return (
    <div data-testid="recycling-step">
      <StepHeader title="Exit recycling (optional)">
        Reinvest part of the money from exits instead of returning it straight away. Recycled money adds to investable capital, so the fund makes more investments. It is capped as a share of commitments.
      </StepHeader>
      <Toggle checked={!!r.enabled} labels={["Recycling on", "Recycling off"]} onChange={(v) => set("enabled", v)} />
      {r.enabled && (
        <div style={{ ...grid, marginTop: 20 }}>
          <Field label="Share of exit proceeds recycled" error={errors.pctOfProceeds} hint="Typically 100% until the cap is reached.">
            <PctInput value={r.pctOfProceeds} onChange={(v) => set("pctOfProceeds", v)} width={100} testId="rec-pct" />
          </Field>
          <Field label="Cap" error={errors.capPct} hint={plan.general.committed > 0 ? `Up to ${fmtMIn(plan.general.committed * (r.capPct || 0), ccy)}` : "Share of committed capital."}>
            <PctInput value={r.capPct} onChange={(v) => set("capPct", v)} width={100} testId="rec-cap" />
          </Field>
          <Field label="Recycling period" error={errors.termYears} hint="Years from the start during which proceeds can be recycled.">
            <NumInput value={r.termYears} suffix="years" width={100} onChange={(v) => set("termYears", v)} />
          </Field>
          <Field label="Recycle ahead of time" hint={r.ahead ? "The fund invests the expected recycled money from the start, and exits pay it back." : "Recycled money is invested only as exits come in."}>
            <Toggle small checked={!!r.ahead} labels={["On", "Off"]} onChange={(v) => set("ahead", v)} />
          </Field>
        </div>
      )}
    </div>
  );
}
