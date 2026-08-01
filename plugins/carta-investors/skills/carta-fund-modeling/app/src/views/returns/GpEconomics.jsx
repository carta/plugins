import { useState, useMemo } from "react";
import { FS, sans, mono, MICRO } from "../../ui/theme.js";
import { fmtM, fmtX, fmtPct, fmt$ } from "../../ui/format.js";
import { H1, H2, Btn, Eyebrow, MethodNote, SourceNote, FundPicker, Slider, StatTile, StatBar, Badge, fundLabel, SectionChips } from "../../ui/components.jsx";
import { TableHead, useTableSort, TableScroll } from "../../ui/table.jsx";
import { useFirmData } from "../../state/FirmData.jsx";
import { useScenarioModel } from "./useScenarioModel.js";

// GP returns per exit multiple. Net TVPI sorts on the exit multiple (the row key).
const GP_RET_COLS = [
  { label: "Net TVPI", align: "left", get: (r) => r.multiple },
  { label: "GP commit", get: (r) => r.gpCommit },
  { label: "GP capital", get: (r) => r.gpCapital },
  { label: "GP carry", get: (r) => r.gpCarry },
  { label: "GP total", get: (r) => r.gpTotal },
];

/** GP partner-level carry — each partner's share of this fund's carry, taken from
 *  Carta's REAL booked "carried interest accrued" allocations inside the GP entity
 *  (gp-base.json ← §7b gp_carry stem). "Accrued" is the actual booked figure; the
 *  "scenario" column applies each partner's booked share to the fund's modeled GP
 *  carry at the active scenario's marks, so it reacts deterministically to reprices.
 *  Falls back to a GP-commitment split when a firm exposes only commitments. Hidden
 *  when a firm books no GP-entity carry / no GP partners. */
function GpPartnerCarry({ gpEntry, todayGpCarry, fsName }) {
  const partners = gpEntry?.partners || [];
  const totalCommit = gpEntry?.totalGpCommit || 0;
  // deterministic split: real booked carry share when present, else GP-commitment share
  const shareOf = (p) =>
    p.carryShare != null ? p.carryShare
      : (totalCommit > 0 && p.commitment != null ? p.commitment / totalCommit : null);
  const scenarioOf = (p) => {
    const s = shareOf(p);
    return todayGpCarry != null && s != null ? todayGpCarry * s : null;
  };
  // cols close over shareOf/scenarioOf (pure in totalCommit + todayGpCarry), so
  // they're built here rather than module-level and memoized on those primitives
  // — a fresh array each render would defeat useTableSort's [rows, cols, sort]
  // memo and re-sort on every render. The hook runs before the empty-guard
  // return below (rules of hooks).
  const PARTNER_COLS = useMemo(() => [
    { label: "GP partner", align: "left", get: (p) => p.name },
    { label: "Accrued carry · booked", get: (p) => p.accruedCarry },
    { label: "Carry share", get: (p) => shareOf(p) },
    { label: "Carry · scenario", get: (p) => scenarioOf(p) },
  ], [totalCommit, todayGpCarry]); // eslint-disable-line react-hooks/exhaustive-deps -- shareOf/scenarioOf are pure in these
  const { sorted: sortedPartners, sort: partnerSort, onSort: onPartnerSort } = useTableSort(partners, PARTNER_COLS);
  if (!gpEntry || !partners.length) return null;
  const shareBasis = partners.some((p) => p.carryShare != null) || totalCommit > 0;
  const c$ = (n) => (n == null ? "—" : n === 0 ? "$0" : fmtM(n));
  const money = (n) => ({ ...mono, textAlign: "right", fontSize: FS.value, color: n != null && n < 0 ? "var(--ink-color-global-feedback-negative-strong)" : "var(--ink-color-global-text-default)" });
  return (
    <>
      <H2>GP partner carry</H2>
      <MethodNote>
        Each partner's share of the GP entity's carry is Carta's booked “carried interest accrued” allocation.
        <strong> Accrued</strong> is the real booked figure; <strong>scenario carry</strong> applies that share to
        this fund's modeled GP carry at the current marks — so it moves as you reprice.
      </MethodNote>
      <TableScroll style={{ marginBottom: 10 }}>
        <table className="ledger sheet">
          <TableHead cols={PARTNER_COLS} sort={partnerSort} onSort={onPartnerSort} sticky />
          <tbody>
            {sortedPartners.map((p, i) => {
              const share = shareOf(p);
              return (
                <tr key={i}>
                  <td style={{ ...sans, fontSize: FS.value, fontWeight: 400, color: "var(--ink-color-global-text-default)", whiteSpace: "nowrap", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }} title={p.name}>
                    {p.name}
                    {p.partnerType === "managing_member" && (
                      <Badge variant="text" tone="muted" style={{ marginLeft: 7 }}>MANAGING</Badge>
                    )}
                  </td>
                  <td style={money(p.accruedCarry)}>{c$(p.accruedCarry)}</td>
                  <td style={{ ...mono, textAlign: "right", fontSize: FS.value, color: "var(--ink-color-global-text-subtle)" }}>{share != null ? fmtPct(share, 1) : "—"}</td>
                  <td style={{ ...money(scenarioOf(p)), fontWeight: 700 }}>{c$(scenarioOf(p))}</td>
                </tr>
              );
            })}
            <tr className="totrow">
              <td style={{ ...sans, color: "var(--ink-color-global-text-default)" }}>Count: {sortedPartners.length}</td>
              <td style={{ ...mono, textAlign: "right" }}>{c$(gpEntry.totalAccruedCarry)}</td>
              <td style={{ ...mono, textAlign: "right", color: "var(--ink-color-global-text-subtle)" }}>{shareBasis ? "100.0%" : "—"}</td>
              <td style={{ ...mono, textAlign: "right" }}>{c$(todayGpCarry)}</td>
            </tr>
          </tbody>
        </table>
      </TableScroll>
      <SourceNote>
        Source: Carta Fund Admin ALLOCATIONS (“Carried interest accrued”, {gpEntry.gpEntity || "GP entity"}). Shares are
        actual booked allocations; scenario carry = this fund's GP carry × each partner's share for {fsName}. GP names confidential.
      </SourceNote>
    </>
  );
}

/** GP Economics tab — waterfall config, GP returns across exit scenarios, and
 *  (when available) GP partner-level carry. */
export default function GpEconomics(props) {
  const { snapshot, fundScope, setFundScope, readOnly } = props;
  const { gpBase } = useFirmData();
  const m = useScenarioModel(props);
  const { fund, fs, fundId, wf, carryRate, sliceRows } = m;
  const { sorted: gpRetRows, sort: gpRetSort, onSort: onGpRetSort } = useTableSort(sliceRows, GP_RET_COLS);
  const [editWaterfall, setEditWaterfall] = useState(false);
  // full-row tint for the "current marks" row — Ink blue (distinct from --accent-soft,
  // reserved for nav/side-rail active state), not the "repriced" stripe pattern: this
  // row means "selected scenario," not "edited."
  const SLICE_BG = "var(--row-selected)";
  // fmt$(0), not "$0" — the zero must carry the fund's currency, not a hardcoded $
  const c$ = (n) => (n === 0 ? fmt$(0) : fmtM(n));
  const markLabel = readOnly ? "current marks" : "scenario mark";
  const sections = [
    ["gp-waterfall", "Waterfall"],
    ["gp-ret", "GP returns"],
    ...(gpBase?.[fundId]?.partners?.length ? [["gp-partners", "GP partner carry"]] : []),
  ];

  return (
    <div>
      <H1 actions={<FundPicker funds={snapshot.funds} value={fundId} onChange={setFundScope} includeAll={false} />}>GP Economics</H1>
      <p style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", margin: "0 0 16px" }}>
        At Carta marks: {fmtX(m.cartaNet)} Net TVPI on total incl. future calls
      </p>

      <SectionChips sections={sections} />
      {/* ── waterfall config ── */}
      <section id="gp-waterfall" style={{ marginBottom: 26, scrollMarginTop: 64 }}>
        <div className="card" style={{ padding: "16px 18px" }}>
          <Eyebrow>Waterfall · {wf.configName || "Carta configuration"}{readOnly ? " · locked" : ""}</Eyebrow>
          {/* read-only pre-set summary: carry / preferred return / GP catch-up */}
          <StatBar bare gap={26} itemStyle={{ padding: 0, flex: "0 0 auto", minWidth: 0 }} style={{ marginTop: 10 }} stats={[
            { label: "Carry", value: `${(carryRate * 100).toFixed(1)}%` },
            { label: "Preferred return", color: wf.preferredReturn ? undefined : MICRO,
              value: wf.preferredReturn ? (wf.preferredReturn * 100).toFixed(1) + "%" : "—" },
            { label: `GP catch-up${wf.catchupRate && wf.catchupLimit != null ? ` · to ${(wf.catchupLimit * 100).toFixed(0)}%` : ""}`,
              color: wf.catchupRate ? undefined : MICRO,
              value: wf.catchupRate ? (wf.catchupRate * 100).toFixed(0) + "%" : "—" },
          ]} />
          <p style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", margin: "10px 0 0" }}>
            Pre-set based on Carta configuration.
            {!readOnly && !editWaterfall && (
              <>{" "}
                <Btn kind="link" onClick={() => setEditWaterfall(true)} style={{ fontSize: FS.small }}>
                  Edit Waterfall
                </Btn>
              </>
            )}
            {readOnly && " Locked on the Baseline scenario — duplicate it to model different terms."}
          </p>
          {editWaterfall && !readOnly && (
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 13 }}>
              <Slider label="Gross carry" value={carryRate * 100} min={0} max={30} step={0.5} labelKind="strong" valueSize={FS.body}
                fill={carryRate / 0.30} fmt={(v) => v.toFixed(1) + "%"} onChange={(v) => m.setFundCarry(v / 100)} />
              <Slider label="Preferred return (hurdle)" value={(wf.preferredReturn || 0) * 100} min={0} max={15} step={0.5} labelKind="strong" valueSize={FS.body}
                fill={(wf.preferredReturn || 0) / 0.15} fmt={(v) => v.toFixed(1) + "%"} onChange={(v) => m.setFundPref(v / 100)} />
              <Slider label="GP catch-up rate" value={(wf.catchupRate || 0) * 100} min={0} max={100} step={5} labelKind="strong" valueSize={FS.body}
                fill={(wf.catchupRate || 0)} fmt={(v) => v.toFixed(0) + "%"} onChange={(v) => m.setFundCatchupRate(v / 100)} />
              <Slider label="Catch-up limit · GP share of profit" value={(wf.catchupLimit ?? carryRate) * 100} min={0} max={30} step={1} labelKind="strong" valueSize={FS.body}
                fill={(wf.catchupLimit ?? carryRate) / 0.30} fmt={(v) => v.toFixed(0) + "%"} onChange={(v) => m.setFundCatchupLimit(v / 100)} />
              <p style={{ ...sans, fontSize: FS.micro, color: MICRO, margin: 0 }}>
                Overrides this fund's terms for the active scenario. Preferred return is a hurdle on paid-in (LPs recover capital + this return before catch-up/carry); set catch-up to 0 to disable.
              </p>
              <div style={{ display: "flex", gap: 16, alignItems: "center", marginTop: 2 }}>
                <Btn kind="link" onClick={() => setEditWaterfall(false)} style={{ fontSize: FS.small }}>
                  Close
                </Btn>
                <Btn kind="link" onClick={m.revertWaterfall} style={{ fontSize: FS.small, color: "var(--ink-color-global-text-subtle)" }}>
                  Revert to Carta configuration
                </Btn>
              </div>
            </div>
          )}
        </div>
      </section>

      <section id="gp-ret" style={{ scrollMarginTop: 64 }}>
      <H2 id="gp-returns">GP returns</H2>
      <MethodNote>
        GP economics across exit multiples — carry plus GP capital; current marks highlighted.
      </MethodNote>
      {/* Accrued carry today — booked on Carta's books, distinct from the modeled rows below */}
      <div className="card" style={{ padding: "14px 20px", marginBottom: 10, display: "flex", alignItems: "baseline", gap: 18, flexWrap: "wrap" }}>
        <StatTile label="Accrued carry · Carta books" value={fmtM(m.accruedCarryToday)} style={{ flex: "none" }} />
        <span style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", flex: 1, minWidth: 240 }}>
          Booked accrued carry to the GP for {fundLabel(fs.name)}{m.accruedCarryAsOf ? ` (as of ${m.accruedCarryAsOf})` : ""}. The table below models carry at exit levels — an estimate, not booked.
        </span>
      </div>
      <TableScroll style={{ marginBottom: 10 }}>
        <table className="ledger sheet">
          <TableHead cols={GP_RET_COLS} sort={gpRetSort} onSort={onGpRetSort} sticky />
          <tbody>
            {gpRetRows.map((r) => (
              <tr key={r.isSlice ? "slice" : r.multiple} style={r.isSlice ? { background: SLICE_BG } : undefined}>
                <td style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
                  {r.isSlice ? (
                    <span style={{ color: "var(--ink-color-global-link-default)" }}>
                      {r.multiple.toFixed(2)}×
                      <Badge tone="info" style={{ marginLeft: 7 }}>{markLabel}</Badge>
                    </span>
                  ) : (
                    `${r.multiple}×`
                  )}
                </td>
                <td style={{ ...mono, textAlign: "right", fontSize: FS.value, color: "var(--ink-color-global-text-subtle)" }}>{r.gpCommit == null ? "—" : c$(r.gpCommit)}</td>
                <td style={{ ...mono, textAlign: "right", fontSize: FS.value }}>{r.gpCapital == null ? "—" : c$(r.gpCapital)}</td>
                <td style={{ ...mono, textAlign: "right", fontSize: FS.value, fontWeight: 700 }}>{c$(r.gpCarry)}</td>
                <td style={{ ...mono, textAlign: "right", fontSize: FS.value, fontWeight: 700 }}>{c$(r.gpTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      {/* Carry distributed — booked REALIZED carry paid to the GP (Carried interest earned) */}
      <div className="card" style={{ padding: "14px 20px", marginBottom: 10, display: "flex", alignItems: "baseline", gap: 18, flexWrap: "wrap" }}>
        <StatTile label="Carry distributed · Carta books"
          value={m.carryDistributed != null && m.carryDistributed > 0 ? fmtM(m.carryDistributed) : "—"} style={{ flex: "none" }} />
        <span style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", flex: 1, minWidth: 240 }}>
          Realized carry paid to the GP for {fundLabel(fs.name)}{m.carryDistributedAsOf ? ` (as of ${m.carryDistributedAsOf})` : ""}. Reads “—” when none has been distributed yet.
        </span>
      </div>
      <SourceNote style={{ marginBottom: 28 }}>
        Source: Carta Fund Admin. Accrued and distributed carry are the booked “carried interest accrued” / “earned” allocations (“—” when none). Modeled GP carry =
        {" "}{(carryRate / (1 - carryRate) * 100).toFixed(0)}% of LP net profit; GP commit is the GP's co-investment (fund config where recorded, else GP paid-in), and GP capital is it grown to the marks (“—” when neither is recorded).
        {" "}<span style={{ color: "var(--ink-color-global-link-default)", fontWeight: 600 }}>Highlighted row</span> = current marks.
      </SourceNote>
      </section>

      <section id="gp-partners" style={{ scrollMarginTop: 64 }}>
      <GpPartnerCarry gpEntry={gpBase?.[fundId]} todayGpCarry={m.todayGpCarry} fsName={fundLabel(fs.name)} />
      </section>
    </div>
  );
}
