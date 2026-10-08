import { useState } from "react";
import { FS, sans, NOTICE_TINT } from "../../ui/theme.js";
import { Btn, Segmented, TextInput } from "../../ui/components.jsx";
import { fmtPct } from "../../ui/format.js";
import { defaultSector, defaultFollowOns, uid, validateSectors, exitTimeline, deriveGeneral } from "../../model/construction/plan.js";
import { NumInput, AmountInput, PctInput, ErrorLine, LiquidationTip, errStyle, fmtYm } from "./fields.jsx";

// Each name carries its unit and `tip` holds its explanation, so the table carries no paragraphs.
const columns = (ccy) => {
  const c = ccy ? ` (${ccy})` : "";
  return [
    { key: "name", label: "Round", align: "left",
      tip: "Keep later rounds even if the fund won't invest in them: a company's value keeps stepping up through them. The last round can only exit or fail." },
    { key: "roundSize", label: `Round size${c}` },
    { key: "preMoney", label: `Pre-money${c}` },
    { key: "gradRate", label: "Graduate (%)", tip: "Share of companies at this round that go on to raise the next one." },
    { key: "exitRate", label: "Exit (%)", tip: "Share that are acquired or go public at this round." },
    { key: "fail", label: "Fail", tip: "What's left: the companies that shut down at this round." },
    { key: "exitValuation", label: `Exit value${c}`, tip: "The company's valuation when it exits at this round." },
    { key: "monthsToGraduate", label: "Months to next round", tip: "Months from reaching this round to raising the next one." },
    { key: "monthsToExit", label: "Months to exit", tip: "Months from reaching this round to an exit." },
    { key: "lands", label: "Exits land (month)", tip: "The fund months in which exits at this round land, counted from the fund's start. Red means some land after the fund ends." },
    { key: "dilutionPct", label: "Additional dilution (%)",
      tip: "Optional. Extra dilution every shareholder takes at this round on top of the new money, such as an option pool top-up or warrants. Leave blank for none." },
    { key: "remove", label: "" },
  ];
};
const Amount = (props) => <AmountInput width="100%" {...props} />;
const ODDS = { grad: "var(--ink-color-global-data-viz-blue-3)", exit: "var(--ink-color-global-data-viz-positive-3)", fail: "var(--ink-color-global-data-viz-neutral-3)" };

function OddsBar({ grad, exit, fail }) {
  const seg = (v, color) => (v > 0 ? <span style={{ flex: v, background: color, minWidth: 2 }} /> : null);
  return (
    <span aria-hidden="true" style={{ display: "flex", gap: 1, height: 4, borderRadius: 2, overflow: "hidden", marginTop: 3 }}>
      {seg(grad, ODDS.grad)}{seg(exit, ODDS.exit)}{seg(Math.max(0, fail), ODDS.fail)}
    </span>
  );
}

function ExitMonth({ row, beforeEntry }) {
  if (!row) return <span style={{ color: "var(--ink-color-global-text-subtle)" }}>{beforeEntry ? "before entry" : "—"}</span>;
  const span = row.to > row.from ? `${row.from}–${row.to}` : `${row.from}`;
  if (!row.afterEnd) return span;
  return (
    <span style={{ color: "var(--ink-color-global-feedback-negative-strong)", fontWeight: 600 }}
      title={row.afterEnd === "all" ? "Every exit at this round lands after the fund ends" : "Some exits at this round land after the fund ends"}>
      ⚠ {span}
    </span>
  );
}

// Spreadsheet feel: a box shows only on hover or while typing. Full amounts need the room, so a narrow card scrolls.
const TABLE_CSS = `
.fc-st { width: 100%; border-collapse: separate; border-spacing: 0; table-layout: fixed; min-width: 1010px; font-variant-numeric: tabular-nums; }
.fc-st th, .fc-st td { padding: 0 4px; vertical-align: middle; }
.fc-st thead th { font-size: 12px; font-weight: 600; line-height: 15px; color: var(--ink-color-global-text-subtle); vertical-align: bottom; padding-bottom: 8px; }
.fc-st thead tr.fc-st-cols th { height: 46px; padding-top: 8px; border-bottom: 1px solid var(--ink-color-global-border-default); }
.fc-st .tip { cursor: help; text-decoration: underline dotted; text-decoration-color: var(--ink-color-global-border-default); text-underline-offset: 3px; }
.fc-st tbody tr { height: 44px; }
.fc-st tbody td { border-bottom: 1px solid var(--ink-color-global-border-subtle); }
.fc-st tbody tr:hover td { background: var(--ink-color-global-surface-lightgray-default); }
.fc-st input { width: 100%; min-width: 0 !important; height: 32px !important; padding: 0 6px !important; font-size: 13px !important; text-align: right;
  border: 1px solid transparent !important; background: transparent !important; box-shadow: none !important; border-radius: 4px; }
.fc-st tbody tr:hover input { border-color: var(--ink-color-global-border-default) !important; background: var(--ink-color-global-surface-background-default) !important; }
.fc-st input:focus { border-color: var(--ink-color-global-border-focus-default) !important; background: var(--ink-color-global-surface-background-default) !important; outline: none; }
.fc-st input::placeholder { color: var(--ink-color-global-text-subtle); }
.fc-st td.name input { text-align: left; font-weight: 600; padding-left: 4px !important; }
.fc-st input[type="number"] { -moz-appearance: textfield; appearance: textfield; }
.fc-st input::-webkit-inner-spin-button, .fc-st input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.fc-st td > span { gap: 0 !important; }
.fc-st .num { display: block; text-align: right; font-size: 13px; padding-right: 7px; }
.fc-st .lands { display: block; text-align: right; font-size: 12px; padding-right: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fc-st .rm { opacity: 0; transition: opacity .1s; }
.fc-st tbody tr:hover .rm, .fc-st .rm:focus-visible { opacity: 1; }
.fc-st tr.fc-st-err td { padding: 4px 8px 8px; }
@media (prefers-reduced-motion: reduce) { .fc-st .rm { transition: none; } }
`;
// Room for a full amount like 6,550,548,375; percentages and months need far less.
const WIDTHS = { name: 92, roundSize: 124, preMoney: 128, gradRate: 76, exitRate: 64, fail: 64, exitValuation: 136, monthsToGraduate: 80, monthsToExit: 68, lands: 88, dilutionPct: 88, remove: 20 };

/** `activeId`/`onActive` let the Market step own which profile shows. */
export default function SectorsStep({ plan, update, activeId: activeProp, onActive }) {
  const sectors = plan.sectors;
  const [ownId, setOwnId] = useState(sectors[0]?.id);
  const activeId = activeProp ?? ownId;
  const setActiveId = (id) => { setOwnId(id); onActive?.(id); };
  const sector = sectors.find((s) => s.id === activeId) ?? sectors[0];
  const errors = validateSectors(sectors);
  const ccy = plan.general.currency;
  const COLS = columns(ccy);
  const inUse = (id) => plan.allocations.some((a) => a.sectorId === id);

  const editSector = (fn) => update((p) => { fn(p.sectors.find((s) => s.id === sector.id), p); });
  const setStage = (i, key, v) => editSector((s) => { s.stages[i][key] = v; });
  // Stage count changes shift every allocation's follow-on list for this profile.
  const resyncFollowOns = (p, s) => {
    for (const a of p.allocations.filter((x) => x.sectorId === s.id)) {
      a.entryStage = Math.min(a.entryStage, s.stages.length - 1);
      const fresh = defaultFollowOns(s.stages.length, a.entryStage);
      a.followOns = fresh.map((f, i) => (f && a.followOns?.[i]) || f);
    }
  };
  const addStage = () => editSector((s, p) => {
    const last = s.stages.at(-1);
    s.stages.push({ ...last, name: "New round", gradRate: 0 });
    if (s.stages.length > 1) s.stages[s.stages.length - 2].gradRate ||= 0.3;
    resyncFollowOns(p, s);
  });
  const removeStage = (i) => editSector((s, p) => {
    s.stages.splice(i, 1);
    if (s.stages.length) s.stages.at(-1).gradRate = 0;
    resyncFollowOns(p, s);
  });
  const addProfile = () => {
    const copy = { ...structuredClone(sector ?? defaultSector()), id: uid("sector"), name: `${sector?.name ?? "Profile"} copy` };
    update((p) => { p.sectors.push(copy); });
    setActiveId(copy.id);
  };
  const deleteProfile = () => {
    update((p) => { p.sectors = p.sectors.filter((s) => s.id !== sector.id); });
    setActiveId(sectors.find((s) => s.id !== sector.id)?.id);
  };
  const e = errors[sector?.id] ?? { stages: {} };
  const timeline = sector ? exitTimeline(sector, plan.allocations, plan.general) : null;
  const late = timeline ? sector.stages.filter((_, i) => timeline.rows[i]?.afterEnd) : [];
  const endLabel = fmtYm(deriveGeneral(plan.general).endDate);

  return (
    <div data-testid="sectors-step" className="card" style={{ padding: 0 }}>
      <div style={{ padding: "16px 16px", borderBottom: "1px solid var(--ink-color-global-border-subtle)", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 260px", minWidth: 0 }}>
          <div style={{ ...sans, fontSize: FS.micro, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--ink-color-global-text-subtle)" }}>Sector profile</div>
          {sector && <TextInput value={sector.name} onChange={(ev) => editSector((s) => { s.name = ev.target.value; })} data-testid="sector-name" aria-label="Profile name"
            style={{ maxWidth: 360, width: "100%", marginTop: 4, fontWeight: 600 }} />}
          <ErrorLine>{e.sector}</ErrorLine>
        </div>
        {sectors.length > 1 && <Segmented small value={sector.id} options={sectors.map((s) => ({ id: s.id, label: s.name || "Untitled" }))} onChange={setActiveId} />}
        <Btn onClick={addProfile} data-testid="add-sector">+ Add profile</Btn>
        {sectors.length > 1 && (
          <Btn kind="danger" onClick={deleteProfile} disabled={inUse(sector.id)} title={inUse(sector.id) ? "An allocation uses this profile" : undefined}>Delete profile</Btn>
        )}
      </div>
      {sector && (
        <div style={{ padding: "16px 16px 20px" }}>
          {late.length > 0 && (
            <div role="alert" data-testid="timeline-warning" style={{ ...sans, fontSize: FS.small, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
              padding: "8px 12px", margin: "0 0 16px", borderRadius: 4, background: NOTICE_TINT, color: "var(--ink-color-global-text-default)" }}>
              <span>
                Exits at {late.map((st) => st.name).join(", ")} land after the fund ends ({endLabel}, month {timeline.termMonths}).
                Companies still held then are sold at their last-round value.
              </span>
              <LiquidationTip endLabel={endLabel} />
            </div>
          )}
          <div style={{ overflowX: "auto" }}>
            <style>{TABLE_CSS}</style>
            <table className="fc-st" style={sans}>
              <colgroup>{COLS.map((c) => <col key={c.key} style={{ width: WIDTHS[c.key] }} />)}</colgroup>
              <thead>
                <tr className="fc-st-cols">{COLS.map((c) => {
                  return (
                    <th key={c.key} style={{ textAlign: c.align ?? "right" }}>
                      {c.tip ? <span className="tip" title={c.tip}>{c.label}</span> : c.label}
                    </th>
                  );
                })}</tr>
              </thead>
              <tbody>
                {sector.stages.map((st, i) => {
                  const last = i === sector.stages.length - 1;
                  const grad = last ? 0 : st.gradRate || 0;
                  const fail = 1 - grad - (st.exitRate || 0);
                  return [
                    <tr key={i} data-testid={`stage-${i}`}>
                      <td className="name"><TextInput value={st.name} onChange={(ev) => setStage(i, "name", ev.target.value)} aria-label={`Round ${i + 1} name`} /></td>
                      <td><Amount value={st.roundSize} onChange={(v) => setStage(i, "roundSize", v)} ariaLabel={`${st.name} round size`} /></td>
                      <td><Amount value={st.preMoney} onChange={(v) => setStage(i, "preMoney", v)} ariaLabel={`${st.name} pre-money`} /></td>
                      <td>{last
                        ? <span className="num" style={{ color: "var(--ink-color-global-text-subtle)" }}>—</span>
                        : <PctInput width="100%" suffix={undefined} value={st.gradRate} onChange={(v) => setStage(i, "gradRate", v)} testId={`grad-${i}`} ariaLabel={`${st.name} graduation rate`} />}</td>
                      <td><PctInput width="100%" suffix={undefined} value={st.exitRate} onChange={(v) => setStage(i, "exitRate", v)} testId={`exit-${i}`} ariaLabel={`${st.name} exit rate`} /></td>
                      <td data-testid={`fail-${i}`}>
                        <span className="num" style={{ color: fail < -1e-9 ? "var(--ink-color-global-feedback-negative-strong)" : undefined }}>{fmtPct(fail, 0)}</span>
                        <OddsBar grad={grad} exit={st.exitRate || 0} fail={fail} />
                      </td>
                      <td><Amount value={st.exitValuation} onChange={(v) => setStage(i, "exitValuation", v)} ariaLabel={`${st.name} exit valuation`} /></td>
                      <td>{last
                        ? <span className="num" style={{ color: "var(--ink-color-global-text-subtle)" }}>—</span>
                        : <NumInput width="100%" decimals={0} value={st.monthsToGraduate} onChange={(v) => setStage(i, "monthsToGraduate", v)} ariaLabel={`${st.name} months to graduate`} />}</td>
                      <td><NumInput width="100%" decimals={0} value={st.monthsToExit} onChange={(v) => setStage(i, "monthsToExit", v)} ariaLabel={`${st.name} months to exit`} /></td>
                      <td><span className="lands" data-testid={`exit-month-${i}`}><ExitMonth row={timeline?.rows[i]} beforeEntry={i < (timeline?.entry ?? 0)} /></span></td>
                      <td><PctInput width="100%" suffix={undefined} placeholder="0" value={st.dilutionPct || null}
                        onChange={(v) => setStage(i, "dilutionPct", v ?? 0)} testId={`dilution-${i}`} ariaLabel={`${st.name} additional dilution`} /></td>
                      <td style={{ textAlign: "center" }}>{sector.stages.length > 1 && <span className="rm"><Btn kind="link" onClick={() => removeStage(i)} aria-label={`Remove ${st.name}`} title="Remove round">×</Btn></span>}</td>
                    </tr>,
                    e.stages[i] && <tr key={`${i}-err`} className="fc-st-err"><td colSpan={COLS.length} style={errStyle} role="alert">{st.name}: {e.stages[i]}</td></tr>,
                  ];
                })}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 12, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <Btn onClick={addStage} data-testid="add-stage">+ Add round</Btn>
            <span style={{ ...sans, fontSize: FS.micro, color: "var(--ink-color-global-text-subtle)", display: "inline-flex", gap: 12, alignItems: "center", marginLeft: "auto" }}>
              {[["Graduate", ODDS.grad], ["Exit", ODDS.exit], ["Fail", ODDS.fail]].map(([l, c]) => (
                <span key={l} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span aria-hidden="true" style={{ width: 10, height: 6, borderRadius: 2, background: c }} />{l}</span>
              ))}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
