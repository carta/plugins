import { useState } from "react";
import { FS, sans } from "../../ui/theme.js";
import { Btn, Segmented, Toggle } from "../../ui/components.jsx";
import { fmtMIn, fmtX } from "../../ui/format.js";
import { validateWaterfall, uid, waterfallTerms } from "../../model/construction/plan.js";
import WaterfallExample from "./WaterfallExample.jsx";
import { StepHeader, Field, NumInput, PctInput, sourceLabel, errStyle, cellNum } from "./fields.jsx";

/** Base carry plus optional higher tiers, each starting at a fund multiple. */
function CarryTiers({ w, errors, set, hint, update }) {
  const tiers = w.carryTiers ?? [];
  const edit = (id, patch) => update((p) => { Object.assign(p.waterfall.carryTiers.find((t) => t.id === id), patch); });
  const remove = (id) => update((p) => { p.waterfall.carryTiers = p.waterfall.carryTiers.filter((t) => t.id !== id); });
  const add = () => update((p) => {
    const list = (p.waterfall.carryTiers ??= []);
    const last = list.at(-1);
    list.push({ id: uid("carry"), fromMultiple: last ? (last.fromMultiple || 1) + 2 : 3, rate: Math.min(0.5, (last?.rate ?? p.waterfall.carryRate ?? 0.2) + 0.05) });
  });
  const upTo = (i) => (i < tiers.length && tiers[i].fromMultiple > 1 ? fmtX(tiers[i].fromMultiple) : "and up");
  return (
    <div data-testid="carry-tiers">
      <Field error={errors.carryRate}
        hint={tiers.length
          ? "Each rate applies to the profit earned while the fund is in that range. Fund multiple = everything distributed ÷ capital paid in."
          : hint("carryRate", "The GP's share of profits. Typically 20%. Add a tier to charge a higher rate once the fund passes a multiple.")}>
        <table className="ledger" style={{ maxWidth: 520 }}>
          <thead><tr><th style={{ textAlign: "left" }}>Fund multiple</th><th>Carry</th><th /></tr></thead>
          <tbody>
            <tr data-testid="carry-tier-base">
              <td>1.00× to {upTo(0)}</td>
              <td style={cellNum}><PctInput value={w.carryRate} onChange={(v) => set("carryRate", v)} width={80} testId="carry" ariaLabel="Base carry" /></td>
              <td />
            </tr>
            {tiers.map((t, i) => [
              <tr key={t.id} data-testid={`carry-tier-${i}`}>
                <td><span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <NumInput value={t.fromMultiple} decimals={2} width={70} suffix={`× to ${upTo(i + 1)}`} onChange={(v) => edit(t.id, { fromMultiple: v })} testId={`carry-from-${i}`} ariaLabel={`Tier ${i + 2} starts at`} />
                </span></td>
                <td style={cellNum}><PctInput value={t.rate} onChange={(v) => edit(t.id, { rate: v })} width={80} testId={`carry-rate-${i}`} ariaLabel={`Tier ${i + 2} carry`} /></td>
                <td><Btn kind="link" onClick={() => remove(t.id)} aria-label={`Remove tier ${i + 2}`}>Remove</Btn></td>
              </tr>,
              errors[t.id] && <tr key={`${t.id}-e`}><td colSpan={3} style={errStyle} role="alert">{errors[t.id]}</td></tr>,
            ])}
          </tbody>
        </table>
      </Field>
      <div style={{ marginTop: 8 }}><Btn onClick={add} data-testid="add-carry-tier">+ Add carry tier</Btn></div>
    </div>
  );
}

function Tier({ n, title, optional, on, onToggle, children, testId }) {
  return (
    <div data-testid={testId} style={{ display: "flex", gap: 14, padding: "14px 0", borderTop: "1px solid var(--ink-color-global-border-subtle)" }}>
      <span style={{ ...sans, flex: "none", width: 26, height: 26, borderRadius: 13, display: "grid", placeItems: "center", fontSize: FS.micro, fontWeight: 700,
        background: "var(--accent-soft)", color: "var(--ink-button-background-color-primary-base-default)" }}>{n}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: children ? 8 : 0 }}>
          <span data-testid={`${testId}-title`} style={{ ...sans, fontSize: FS.body, fontWeight: 600 }}>Tier {n}: {title}</span>
          {optional && <span data-testid={`${testId}-toggle`}><Toggle small checked={on} labels={["Included", "Not included"]} onChange={onToggle} /></span>}
        </div>
        {(!optional || on) && children}
      </div>
    </div>
  );
}

const note = { ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)" };

export default function WaterfallStep({ plan, update, result }) {
  const w = plan.waterfall;
  const errors = validateWaterfall(w);
  const sug = plan.suggestions || {};
  const set = (key, v) => update((p) => { p.waterfall[key] = v; if (p.suggestions) delete p.suggestions[key]; });
  const hint = (key, fallback) => (sug[key] ? `Suggested from ${sourceLabel(sug[key])}` : fallback);
  const ccy = plan.general.currency;
  const t = result?.ok ? result.totals : null;
  const { european, prefOn, catchupOn } = waterfallTerms(w);
  const byMultiple = w.hurdleType === "multiple";
  const [example, setExample] = useState(false);
  const carry = <CarryTiers w={w} errors={errors} set={set} hint={hint} update={update} />;
  return (
    <div data-testid="waterfall-step">
      <StepHeader title="Waterfall">
        How money coming back is split between LPs and the GP, tier by tier in the order it's paid. The GP's own commitment is treated like LP money: it gets its capital back and a share of profits in proportion to its commitment.
      </StepHeader>
      <div style={{ display: "flex", justifyContent: "flex-end", margin: "-6px 0 10px" }}>
        <Btn onClick={() => setExample(true)} data-testid="open-waterfall-example">See how the money flows</Btn>
      </div>
      {example && <WaterfallExample waterfall={w} ccy={ccy} onClose={() => setExample(false)} />}
      <Field label="Waterfall type" hint={european
        ? "European (whole fund): LPs get all their capital back, and the preferred return, before the GP earns carry."
        : "American (deal by deal): the GP earns carry on each exit's gain as it happens."}>
        <Segmented small value={w.type} options={[{ id: "european", label: "European (whole fund)" }, { id: "american", label: "American (deal by deal)" }]} onChange={(v) => set("type", v)} />
      </Field>

      <div data-testid="waterfall-tiers" style={{ marginTop: 20 }}>
        <div style={{ ...note, marginBottom: 8 }}><strong style={{ color: "var(--ink-color-global-text-default)" }}>Distributable proceeds:</strong> cash from exits, and from holdings sold when the fund ends, flows down these tiers in order.</div>
        <Tier n={1} title="Return of capital" testId="wf-tier-1">
          <div style={note}>100% to LPs until they have {european ? "all the capital they paid in back" : "the capital they put into that deal back"}. Fixed.</div>
        </Tier>
        {european ? (
          <>
            <Tier n={2} title="Preferred return" optional on={prefOn} onToggle={(v) => set("hasPref", v)} testId="wf-tier-2">
              <Field error={byMultiple ? errors.hurdleMultiple : errors.preferredReturn} testId="field-hurdle"
                hint={byMultiple
                  ? "LPs get this multiple of the capital they paid in before the GP earns carry."
                  : hint("preferredReturn", "A yearly return (IRR) to LPs on capital paid in, compounding, before carry.")}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <Segmented small value={byMultiple ? "multiple" : "irr"} options={[{ id: "irr", label: "IRR" }, { id: "multiple", label: "Multiple", testId: "hurdle-type-multiple" }]}
                    onChange={(v) => set("hurdleType", v)} />
                  {byMultiple
                    ? <NumInput value={w.hurdleMultiple} decimals={2} width={100} suffix="× paid-in capital" onChange={(v) => set("hurdleMultiple", v)} testId="hurdle-multiple" />
                    : <PctInput value={w.preferredReturn} onChange={(v) => set("preferredReturn", v)} width={100} testId="hurdle" />}
                </div>
              </Field>
            </Tier>
            <Tier n={3} title="GP catch-up" optional on={catchupOn} onToggle={(v) => set("hasCatchup", v)} testId="wf-tier-3">
              <Field error={errors.catchupRate} hint={hint("catchupRate", "Share of what's left that goes to the GP until it has caught up to its carry on all profit so far. 100% is a full catch-up.")}>
                <PctInput value={w.catchupRate} onChange={(v) => set("catchupRate", v)} width={100} testId="catchup" />
              </Field>
            </Tier>
            <Tier n={4} title="GP carried interest" testId="wf-tier-4">{carry}</Tier>
          </>
        ) : (
          <Tier n={2} title="GP carried interest" testId="wf-tier-2">
            <div style={{ ...note, marginBottom: 8 }}>Charged on each exit's gain as it's paid out.</div>
            {carry}
          </Tier>
        )}
        <div data-testid="wf-remaining" style={{ ...note, padding: "12px 0 0 40px", borderTop: "1px solid var(--ink-color-global-border-subtle)" }}>
          <strong style={{ color: "var(--ink-color-global-text-default)" }}>Remaining proceeds</strong> all flow to LPs.
        </div>
        {!european && (
          <div data-testid="wf-clawback" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "14px 0 0 40px" }}>
            <span style={{ ...sans, fontSize: FS.body, fontWeight: 600 }}>Optional: Clawback</span>
            <Toggle small checked={!!w.clawback} labels={["On", "Off"]} onChange={(v) => set("clawback", v)} />
            <span style={note}>At the end, the GP returns any carry above its share of the whole fund's profit.</span>
          </div>
        )}
      </div>
      {t && t.gpCarryUnrealized > 0 && (
        <div style={{ ...sans, fontSize: FS.micro, color: "var(--ink-color-global-text-subtle)", marginTop: 12 }}>
          Carry on remaining value is what the GP would earn if the holdings left at the end of the term were sold at their marks.
        </div>
      )}
    </div>
  );
}
