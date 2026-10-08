import { useEffect, useState } from "react";
import { FS, sans } from "../../ui/theme.js";
import { Btn, Segmented, InfoTip } from "../../ui/components.jsx";
import { fmtFullIn, fmtAmountIn, fmtPct, fmtX } from "../../ui/format.js";
import { waterfallExample, carryOwed } from "../../model/construction/engine.js";
import { AmountInput, NumInput, cellNum } from "./fields.jsx";
import { waterfallTerms } from "../../model/construction/plan.js";

const MULTIPLES = [0.8, 1, 1.5, 2, 3, 5];
const mult = (m) => `${+m.toFixed(2)}×`;
const subtle = { color: "var(--ink-color-global-text-subtle)" };

const pc = (x) => `${+(x * 100).toFixed(2)}%`;

/** Each tier's `math` is worked out once the amount available is known. */
function tierRows(w, r, { paidIn, years }, money, round) {
  const paidToLps = (owed, available, paid) => {
    if (available >= round(owed)) return `There's enough to pay this in full: ${money(paid)} to LPs.`;
    if (!(available > 0)) return "Nothing is left to pay this, so LPs get nothing here.";
    return `Only ${money(available)} is left, so LPs get all of it, ${money(round(owed) - available)} short of what they're owed.`;
  };
  const { european, prefOn, catchupOn } = waterfallTerms(w);
  const gain = Math.max(0, r.proceeds - paidIn);
  const rows = [];
  rows.push({
    key: "roc", tier: 1, name: european ? "Return of capital" : "Return of the deal's capital",
    why: european ? `LPs get back the ${money(paidIn)} they put in.` : `LPs get back the ${money(paidIn)} put into the deal.`,
    lp: r.parts.roc, gp: 0,
    math: ({ available, lp, left }) => european ? [
      `Owed to LPs: the ${money(paidIn)} they paid in.`,
      `Available: ${money(available)}.`,
      paidToLps(paidIn, available, lp),
      `Left: ${money(available)} − ${money(lp)} = ${money(left)}.`,
    ] : [
      `The deal cost ${money(paidIn)} and returned ${money(r.proceeds)}.`,
      r.proceeds > paidIn ? `Its gain: ${money(r.proceeds)} − ${money(paidIn)} = ${money(gain)}.` : "It returned no more than its cost, so there's no gain to carry.",
      `LPs get the cost back first: ${money(lp)}.`,
      `Left: ${money(available)} − ${money(lp)} = ${money(left)}.`,
    ],
  });
  if (prefOn) {
    const byMultiple = w.hurdleType === "multiple";
    const owed = byMultiple ? paidIn * Math.max(0, (w.hurdleMultiple ?? 1) - 1) : paidIn * (Math.pow(1 + (w.preferredReturn ?? 0), years) - 1);
    rows.push({
      key: "pref", tier: 2, name: "Preferred return",
      why: byMultiple
        ? `LPs get paid until they have ${mult(w.hurdleMultiple ?? 1)} their money in total.`
        : `${fmtPct(w.preferredReturn ?? 0, 1)} a year on their capital, compounding, for ${+years.toFixed(2)} years.`,
      lp: r.parts.pref, gp: 0,
      math: ({ available, lp, left }) => [
        byMultiple
          ? `Owed: ${money(paidIn)} × (${mult(w.hurdleMultiple ?? 1)} − 1) = ${money(owed)}, on top of the capital already returned.`
          : `Owed: ${money(paidIn)} × (1 + ${pc(w.preferredReturn ?? 0)})^${+years.toFixed(2)} − ${money(paidIn)} = ${money(owed)}.`,
        `Available: ${money(available)}.`,
        paidToLps(owed, available, lp),
        `Left: ${money(available)} − ${money(lp)} = ${money(left)}.`,
      ],
    });
  }
  if (catchupOn) {
    const cu = w.catchupRate ?? 0;
    const profitSoFar = r.parts.pref;
    const rate = r.bands.reduce((x, b) => (b.fromMultiple <= 1 + profitSoFar / paidIn + 1e-12 ? b.rate : x), r.bands[0].rate);
    const owedCarry = carryOwed(r.bands, profitSoFar, paidIn);
    const need = cu > rate ? owedCarry / (cu - rate) : 0;
    rows.push({
      key: "catchup", tier: 3, name: "GP catch-up",
      why: `The GP takes ${fmtPct(cu, 0)} of what comes next until it has its carry share of all the profit so far.`,
      lp: r.parts.catchupLp, gp: r.parts.catchupGp,
      math: ({ available, lp, gp, left }) => cu <= rate ? [
        `A catch-up of ${pc(cu)} is no more than the ${pc(rate)} carry rate, so it never catches up. Nothing is paid here.`,
      ] : [
        `Profit paid so far: ${money(profitSoFar)} (the preferred return). The GP should end with ${pc(rate)} of all profit.`,
        r.bands.length > 1
          ? `Catch-up needed: ${money(owedCarry)} of carry owed ÷ (${pc(cu)} − ${pc(rate)}) = ${money(need)}.`
          : `Catch-up needed: ${pc(rate)} × ${money(profitSoFar)} ÷ (${pc(cu)} − ${pc(rate)}) = ${money(need)}.`,
        `Available: ${money(available)}.`,
        available >= round(need)
          ? `There's enough for the full catch-up: ${money(lp + gp)}.`
          : available > 0
            ? `Only ${money(available)} is left, so all of it goes to the catch-up, ${money(round(need) - available)} short of a full catch-up.`
            : "Nothing is left for the catch-up.",
        cu < 1 ? `Split ${pc(cu)} to the GP = ${money(gp)}, ${pc(1 - cu)} to LPs = ${money(lp)}.` : `All of it goes to the GP: ${money(gp)}.`,
        ...(available >= need && profitSoFar + need > 0
          ? [`Check: the GP now has ${money(gp)} of ${money(profitSoFar + lp + gp)} profit = ${fmtPct(gp / (profitSoFar + lp + gp), 1)}.`] : []),
        `Left: ${money(available)} − ${money(lp + gp)} = ${money(left)}.`,
      ],
    });
  }
  const carryTier = european ? 4 : 2;
  r.bands.forEach((b, i) => {
    const next = i + 1 < r.bands.length ? r.bands[i + 1].fromMultiple : null;
    const upTo = next ? mult(next) : null;
    const lo = (b.fromMultiple - 1) * paidIn;
    const hi = next ? (next - 1) * paidIn : null;
    rows.push({
      key: `carry-${i}`, tier: carryTier,
      name: r.bands.length > 1 ? `Carried interest, ${mult(b.fromMultiple)}${upTo ? ` to ${upTo}` : " and up"}` : "Carried interest",
      why: `What's left is split ${fmtPct(1 - b.rate, 0)} to LPs and ${fmtPct(b.rate, 0)} to the GP${r.bands.length > 1 ? `, while the fund has paid back ${upTo ? `between ${mult(b.fromMultiple)} and ${upTo}` : `more than ${mult(b.fromMultiple)}`} of what went in` : ""}.`,
      lp: r.parts.carryLp[i], gp: r.parts.carryGp[i],
      math: ({ available, lp, gp, left }) => {
        const amount = lp + gp;
        if (!european) {
          return i === 0 ? [
            `Gain on the deal: ${money(gain)}.`,
            `GP: ${pc(b.rate)} × ${money(gain)} = ${money(gp)}.`,
            `LPs: the rest of the gain, ${money(gain)} − ${money(gp)} = ${money(lp)}.`,
          ] : [`A single deal's carry rate is set by the fund's multiple before it exits, so one deal on its own doesn't reach this tier.`];
        }
        const lines = [];
        if (r.bands.length > 1) {
          const counted = Math.max(0, r.proceeds - available - paidIn);
          lines.push(hi != null
            ? `This tier covers profit from ${money(lo)} to ${money(hi)} (the fund paying back ${mult(b.fromMultiple)} to ${upTo} of the ${money(paidIn)} invested).`
            : `This tier covers profit above ${money(lo)} (the fund paying back more than ${mult(b.fromMultiple)} of the ${money(paidIn)} invested).`);
          lines.push(`Profit already paid out before this tier: ${money(counted)}.`);
          lines.push(hi != null
            ? `Amount in this tier: the smaller of what's left (${money(available)}) and the room left in the range (${money(Math.max(0, hi - counted))}) = ${money(amount)}.`
            : `Amount in this tier: everything left, ${money(amount)}.`);
        } else {
          lines.push(`Everything left goes through this tier: ${money(amount)}.`);
        }
        lines.push(`GP: ${pc(b.rate)} × ${money(amount)} = ${money(gp)}.`);
        lines.push(`LPs: ${pc(1 - b.rate)} × ${money(amount)} = ${money(lp)}.`);
        lines.push(`Left: ${money(available)} − ${money(amount)} = ${money(left)}.`);
        return lines;
      },
    });
  });
  // Work in the amounts as shown, so each column adds up exactly as the reader sees it.
  let left = round(r.proceeds);
  return rows.map((row) => {
    const lp = round(row.lp), gp = round(row.gp);
    const available = left;
    left = round(left - lp - gp);
    const shown = { available, lp, gp, left: Math.max(0, left) };
    return { ...row, ...shown, math: row.math(shown) };
  });
}

export default function WaterfallExample({ waterfall: w, ccy, onClose }) {
  const [paidIn, setPaidIn] = useState(100);
  const [years, setYears] = useState(5);
  const [multiple, setMultiple] = useState(2.5);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ok = paidIn > 0 && years >= 0 && multiple >= 0;
  // Small examples show cents so a split like 3.07 doesn't round away; whole amounts stay whole.
  const cents = paidIn < 10000;
  const round = (v) => (cents ? Math.round(v * 100) / 100 : Math.round(v));
  const money = (v) => {
    const x = round(v);
    return cents && !Number.isInteger(x) ? fmtAmountIn(x, ccy, 2) : fmtFullIn(x, ccy);
  };
  const run = (m) => waterfallExample(w, { paidIn, years, proceeds: paidIn * m });
  const r = ok ? run(multiple) : null;
  const rows = r ? tierRows(w, r, { paidIn, years }, money, round) : [];
  const others = ok ? MULTIPLES.map((m) => {
    const o = run(m);
    return { m, r: o, rows: tierRows(w, o, { paidIn, years }, money, round) };
  }) : [];
  const shownLp = round(rows.reduce((sum, row) => sum + row.lp, 0));
  const shownGp = round(rows.reduce((sum, row) => sum + row.gp, 0));
  const label = { ...sans, fontSize: FS.small, display: "flex", flexDirection: "column", gap: 4 };

  return (
    <div role="dialog" aria-modal="true" aria-label="How the waterfall splits the money" data-testid="waterfall-example" onMouseDown={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(16,24,40,.34)", backdropFilter: "blur(2px)", display: "grid", placeItems: "center", padding: 20 }}>
      <div onMouseDown={(e) => e.stopPropagation()}
        style={{ width: "min(860px, 100%)", maxHeight: "90vh", overflow: "auto", background: "var(--ink-color-global-surface-background-default)",
          border: "1px solid var(--ink-color-global-border-subtle)", borderRadius: 12, boxShadow: "0 18px 50px rgba(16,24,40,.28)", padding: "22px 24px 20px" }}>
        <div style={{ ...sans, fontSize: FS.h3, fontWeight: 700 }}>How the waterfall splits the money</div>
        <div style={{ ...sans, fontSize: FS.small, ...subtle, margin: "6px 0 16px", lineHeight: 1.5 }}>
          A simple example using this plan's waterfall: LPs invest once, and the fund pays everything back in one go.
          {w.type === "european" ? "" : " American carry is worked out as if it were one deal."} It's a guide only; the plan's results use its own month-by-month cash flows.
        </div>

        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 18 }}>
          <label style={label}>
            <span style={{ fontWeight: 600 }}>LPs invest</span>
            <AmountInput ccy={ccy} value={paidIn} onChange={setPaidIn} width={120} testId="example-paid-in" />
          </label>
          <label style={label}>
            <span style={{ fontWeight: 600 }}>Held for</span>
            <NumInput value={years} onChange={setYears} width={70} suffix="years" testId="example-years" />
          </label>
          <label style={label}>
            <span style={{ fontWeight: 600 }}>Fund pays back</span>
            <AmountInput ccy={ccy} value={ok ? Math.round(paidIn * multiple * 100) / 100 : null} width={120} testId="example-proceeds"
              onChange={(v) => setMultiple(v != null && paidIn > 0 ? v / paidIn : null)} />
          </label>
          <Segmented small value={MULTIPLES.find((m) => Math.abs(m - multiple) < 1e-9)}
            options={MULTIPLES.map((m) => ({ id: m, label: mult(m), testId: `example-pick-${m}` }))} onChange={setMultiple} />
        </div>

        {!r ? (
          <div style={{ ...sans, fontSize: FS.small, ...subtle }}>Enter what LPs invest, how long it's held and what the fund pays back.</div>
        ) : (
          <>
            <div data-testid="example-start" style={{ ...sans, fontSize: FS.body, marginBottom: 6 }}>
              <strong>{money(r.proceeds)}</strong> to hand out <span style={subtle}>({mult(multiple)} what LPs invested)</span>, paid through the tiers in order:
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="ledger" data-testid="example-walkthrough" style={{ minWidth: 640 }}>
                <thead><tr><th style={{ textAlign: "left" }}>Step</th><th>To LPs</th><th>To GP</th><th>Left to hand out</th></tr></thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key} data-testid={`example-${row.key}`} style={row.lp + row.gp > 0 ? undefined : { opacity: 0.55 }}>
                      <td>
                        <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                          Tier {row.tier}: {row.name}
                          <InfoTip portal placement="top" width={380} label={`How Tier ${row.tier} is worked out`}>
                            <div data-testid={`example-math-${row.key}`} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                              {row.math.map((line, i) => <div key={i}>{line}</div>)}
                            </div>
                          </InfoTip>
                        </div>
                        <div style={{ fontSize: FS.micro, ...subtle, maxWidth: 380 }}>{row.why}</div>
                      </td>
                      <td style={cellNum}>{row.lp > 0 ? money(row.lp) : "—"}</td>
                      <td style={cellNum}>{row.gp > 0 ? money(row.gp) : "—"}</td>
                      <td style={cellNum}>{money(row.left)}</td>
                    </tr>
                  ))}
                  <tr data-testid="example-total" style={{ fontWeight: 700 }}>
                    <td>Total</td><td style={cellNum}>{money(shownLp)}</td><td style={cellNum}>{money(shownGp)}</td><td />
                  </tr>
                </tbody>
              </table>
            </div>
            <div data-testid="example-summary" style={{ ...sans, fontSize: FS.body, margin: "12px 0 0" }}>
              LPs get <strong>{money(shownLp)}</strong> ({fmtX(r.lpMultiple)} their money).{" "}
              {r.profit > 0
                ? <>The GP gets <strong>{money(shownGp)}</strong> of carry, {fmtPct(r.gpShareOfProfit, 1)} of the {money(r.profit)} profit.</>
                : <>There's no profit, so the GP gets no carry.</>}
              {r.clawback > 0 && ` That's after a ${money(r.clawback)} clawback.`}
            </div>

            <div style={{ ...sans, fontSize: FS.body, fontWeight: 600, margin: "22px 0 4px" }}>At other outcomes</div>
            <div style={{ ...sans, fontSize: FS.small, ...subtle, marginBottom: 6 }}>Click a row to walk through it above.</div>
            <table className="ledger" data-testid="example-outcomes" style={{ maxWidth: 640 }}>
              <thead><tr><th style={{ textAlign: "left" }}>Fund pays back</th><th>LPs get</th><th>GP carry</th><th>GP share of profit</th></tr></thead>
              <tbody>{others.map(({ m, r: o, rows: tiers }) => {
                const on = Math.abs(m - multiple) < 1e-9;
                const lpParts = tiers.filter((t) => t.lp > 0).map((t) => t.lp);
                const gpParts = tiers.filter((t) => t.gp > 0).map((t) => t.gp);
                const sum = (xs) => round(xs.reduce((a, b) => a + b, 0));
                const added = (xs) => (xs.length > 1 ? `${xs.map(money).join(" + ")} = ${money(sum(xs))}` : money(sum(xs)));
                const profit = round(o.proceeds - paidIn);
                return (
                  <tr key={m} data-testid={`example-outcome-${m}`} onClick={() => setMultiple(m)} aria-selected={on}
                    style={{ cursor: "pointer", fontWeight: on ? 700 : 400, background: on ? "var(--accent-soft)" : undefined }}>
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        {money(o.proceeds)} <span style={subtle}>({mult(m)})</span>
                        <InfoTip portal placement="top" width={380} label={`How ${money(o.proceeds)} is split`}>
                          <div data-testid={`example-outcome-math-${m}`} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            {tiers.map((t) => (
                              <div key={t.key}>
                                Tier {t.tier}, {t.name}: {t.lp + t.gp > 0
                                  ? [t.lp > 0 && `${money(t.lp)} to LPs`, t.gp > 0 && `${money(t.gp)} to the GP`].filter(Boolean).join(", ")
                                  : "nothing left to pay"}.
                              </div>
                            ))}
                            <div style={{ marginTop: 4 }}>LPs get: {added(lpParts)}.</div>
                            <div>GP carry: {gpParts.length ? added(gpParts) : money(0)}.</div>
                            <div>{profit > 0
                              ? `GP share of profit: ${money(sum(gpParts))} ÷ ${money(profit)} profit (${money(o.proceeds)} − ${money(paidIn)}) = ${fmtPct(sum(gpParts) / profit, 1)}.`
                              : `No profit (the fund paid back ${profit < 0 ? "less than" : "exactly"} the ${money(paidIn)} invested), so no carry.`}</div>
                          </div>
                        </InfoTip>
                      </span>
                    </td>
                    <td style={cellNum}>{money(sum(lpParts))}</td>
                    <td style={cellNum}>{money(sum(gpParts))}</td>
                    <td style={cellNum}>{o.gpShareOfProfit == null ? "—" : fmtPct(o.gpShareOfProfit, 1)}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
          <Btn size="comfortable" onClick={onClose} data-testid="example-close">Close</Btn>
        </div>
      </div>
    </div>
  );
}
