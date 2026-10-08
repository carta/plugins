import { useState } from "react";
import { FS, sans } from "../../ui/theme.js";
import { Btn } from "../../ui/components.jsx";
import { fmtMIn } from "../../ui/format.js";
import { FEE_BASES, addMonthsYm } from "../../model/construction/plan.js";
import { nextFeeTier, termMonthsOf, tierCoverage, validateFeeTiers } from "../../model/construction/feeTiers.js";
import FeeBasisPicker from "./FeeBasisPicker.jsx";
import { MonthPicker, PctInput, fmtYm, errStyle, hintStyle } from "./fields.jsx";

const colLabel = { ...sans, fontSize: FS.micro, fontWeight: 600, color: "var(--ink-color-global-text-subtle)", display: "block", marginBottom: 4 };
const span = ([a, b]) => (a === b ? `month ${a}` : `months ${a}–${b}`);

/** `edit(fn)` takes a function that changes the tiers array in place; `feesByTier` is fee totals by tier id, once there are results. */
export default function FeeTiersEditor({ tiers, edit, general, feesByTier, ccy }) {
  const [picking, setPicking] = useState(null);
  const T = termMonthsOf(general);
  const errors = validateFeeTiers(tiers, T);
  const cover = tierCoverage(tiers, T);
  const set = (id, patch) => edit((list) => { Object.assign(list.find((t) => t.id === id), patch); });
  const remove = (id) => edit((list) => { list.splice(list.findIndex((t) => t.id === id), 1); });
  const add = () => edit((list) => {
    const { cut, tier } = nextFeeTier(list, general);
    if (cut != null) list.at(-1).endMonth = cut;
    list.push(tier);
  });
  const dateOf = (m) => (general.startDate ? fmtYm(addMonthsYm(general.startDate, m - 1)) : null);
  const tier = tiers.find((t) => t.id === picking);

  return (
    <div data-testid="fee-tiers">
      {tiers.map((t, i) => {
        const end = t.endMonth ?? T;
        const from = dateOf(t.startMonth), to = dateOf(Math.min(end, T));
        const total = feesByTier?.[t.id];
        return (
          <div key={t.id} data-testid={`fee-${i}`} style={{ padding: "12px 16px", marginBottom: 8, borderRadius: 6, background: "var(--ink-color-global-surface-lightgray-default)" }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
              <span style={{ ...sans, fontSize: FS.small, fontWeight: 700, minWidth: 48, paddingBottom: 8 }}>Tier {i + 1}</span>
              <div>
                <label style={colLabel}>Fee (% a year)</label>
                <PctInput value={t.rate} onChange={(v) => set(t.id, { rate: v })} width={90} testId={`fee-rate-${i}`} ariaLabel={`Tier ${i + 1} rate`} />
              </div>
              <div>
                <label style={colLabel}>Charged on</label>
                <Btn onClick={() => setPicking(t.id)} data-testid={`basis-${i}`} aria-label={`Tier ${i + 1} charged on`}>
                  {FEE_BASES.find((b) => b.id === t.basis)?.label ?? "Pick what it's charged on"} <span aria-hidden="true">▾</span>
                </Btn>
              </div>
              <MonthPicker label="Start" value={t.startMonth} onChange={(v) => set(t.id, { startMonth: v })} startDate={general.startDate} termMonths={T}
                testId={`fee-start-${i}`} ariaLabel={`Tier ${i + 1} start month`} />
              <MonthPicker label="End" value={t.endMonth} onChange={(v) => set(t.id, { endMonth: v })} startDate={general.startDate} termMonths={T}
                empty="fund end" emptyAt={T} testId={`fee-end-${i}`} ariaLabel={`Tier ${i + 1} end month`} />
              {t.endMonth != null && <Btn kind="link" onClick={() => set(t.id, { endMonth: null })} data-testid={`fee-end-clear-${i}`} style={{ paddingBottom: 8 }}>Run to fund end</Btn>}
              <span style={{ flex: 1 }} />
              <Btn kind="link" onClick={() => remove(t.id)} aria-label={`Remove tier ${i + 1}`}>Remove</Btn>
            </div>
            {errors[t.id]
              ? <div style={errStyle} role="alert">{errors[t.id]}</div>
              : <div data-testid={`fee-term-${i}`} style={hintStyle}>
                  {from && to ? `Fee term: ${from} – ${to}` : `Runs ${span([t.startMonth, Math.min(end, T)])}`}
                  {t.endMonth == null ? ", until the fund ends" : ""}
                  {total != null ? ` · ${fmtMIn(total, ccy)} in fees` : ""}
                </div>}
          </div>
        );
      })}
      {!tiers.length && <div style={{ ...hintStyle, marginBottom: 8 }}>No management fee. Add a tier to charge one.</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Btn onClick={add} data-testid="add-fee">+ Add fee tier</Btn>
        <span style={hintStyle}>Add a tier for each step-down or step-up. Leave the end blank to run until the fund ends.</span>
      </div>
      {Object.keys(errors).length === 0 && tiers.length > 0 && (cover.gaps.length > 0 || cover.overlaps.length > 0) && (
        <div data-testid="fee-coverage" style={{ ...hintStyle, marginTop: 8, color: "var(--ink-color-global-text-default)" }}>
          {cover.gaps.length > 0 && <div>No management fee in {cover.gaps.map(span).join(", ")}.</div>}
          {cover.overlaps.length > 0 && <div>More than one tier covers {cover.overlaps.map(span).join(", ")}, so each of those fees is charged.</div>}
        </div>
      )}
      {tier && (
        <FeeBasisPicker value={tier.basis} rate={tier.rate} onClose={() => setPicking(null)}
          onPick={(v) => { set(tier.id, { basis: v }); setPicking(null); }} />
      )}
    </div>
  );
}
