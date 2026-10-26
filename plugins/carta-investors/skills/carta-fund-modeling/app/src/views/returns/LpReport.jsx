import { useMemo } from "react";
import { FS, inkNum } from "../../ui/theme.js";
import { fmtM, fmtPct, fmtAsOf, fmt$ } from "../../ui/format.js";
import { H3, MethodNote, SourceNote, Badge } from "../../ui/components.jsx";
import { TableHead, useTableSort, TableScroll } from "../../ui/table.jsx";
import { useScenarioModel } from "./useScenarioModel.js";
import Glidepath from "./Glidepath.jsx";

/** Net to LPs across exit multiples — distributions, profit and net LP IRR vs the
 *  public-market benchmark, with the scenario's current marks highlighted. */
function LpSensitivity({ m, readOnly }) {
  const { sliceRows, spRate, exitDate } = m;
  // the benchmark column label carries the live rate. Net TVPI sorts on the exit
  // multiple (the value the row is keyed by).
  const EXIT_COLS = useMemo(() => [
    { label: "Net TVPI", align: "left", get: (r) => r.multiple },
    { label: "LP dist.", get: (r) => r.lpDistributions },
    { label: "LP profit", get: (r) => r.lpNetProfit },
    { label: "Net LP IRR", get: (r) => r.netLpIrr },
    { label: `Bench @${(spRate * 100).toFixed(1)}%`, get: (r) => r.spIrr },
    { label: "Edge", get: (r) => r.edge },
  ], [spRate]);
  const { sorted: exitRows, sort: exitSort, onSort: onExitSort } = useTableSort(sliceRows, EXIT_COLS);
  // full-row tint for the "current marks" row — Ink blue (distinct from --accent-soft,
  // which is reserved for nav/side-rail active state), not the "repriced" stripe pattern:
  // this row means "selected scenario," not "edited."
  const SLICE_BG = "var(--row-selected)";
  // fmt$(0), not "$0" — the zero must carry the fund's currency, not a hardcoded $
  const c$ = (n) => (n === 0 ? fmt$(0) : fmtM(n));
  const markLabel = readOnly ? "current marks" : "scenario mark";
  return (
    <div>
      <H3 as="div" style={{ marginBottom: 4 }}>LP return sensitivity</H3>
      <MethodNote>
        Net to LPs across exit multiples — distributions, profit and net LP IRR vs the benchmark; current marks highlighted.
        The public-market benchmark is set on the <strong>LP Returns</strong> tab and the exit horizon on <strong>Companies</strong>.
      </MethodNote>
      {/* scrolls in place via .table-scroll (theme.js) — no sticky here, this
          grid is only ~10-15 rows, too short to ever need a pinned header. */}
      <TableScroll style={{ marginBottom: 10 }}>
        <table className="ledger sheet">
          <TableHead cols={EXIT_COLS} sort={exitSort} onSort={onExitSort} />
          <tbody>
            {exitRows.map((r) => (
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
                <td style={{ ...inkNum, textAlign: "right", fontSize: FS.value }}>{c$(r.lpDistributions)}</td>
                <td style={{ ...inkNum, textAlign: "right", fontSize: FS.value }}>{c$(r.lpNetProfit)}</td>
                <td style={{ ...inkNum, textAlign: "right", fontSize: FS.value }}>{fmtPct(r.netLpIrr)}</td>
                <td style={{ ...inkNum, textAlign: "right", fontSize: FS.value, color: "var(--ink-color-global-text-subtle)" }}>{fmtPct(r.spIrr)}</td>
                <td style={{ ...inkNum, textAlign: "right", fontSize: FS.value, color: r.edge == null ? "var(--ink-color-global-text-subtle)" : r.edge >= 0 ? "var(--ink-color-global-feedback-positive-strong)" : "var(--ink-color-global-feedback-negative-strong)" }}>
                  {r.edge == null ? "n/m" : (r.edge >= 0 ? "+" : "−") + fmtPct(Math.abs(r.edge))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      <SourceNote>
        Source: Carta Fund Admin LP cash flows. The <span style={{ color: "var(--ink-color-global-link-default)", fontWeight: 600 }}>highlighted row</span> is current marks. IRR: XIRR on
        Carta LP flows with one terminal distribution on {fmtAsOf(exitDate)} (assumed exit horizon). <span style={{ color: "var(--ink-color-global-feedback-positive-strong)" }}>Green</span> edge beats indexing into the benchmark at {(spRate * 100).toFixed(1)}%/yr.
      </SourceNote>
    </div>
  );
}

/** LP Returns report — one of the fund's LP charts; the Reports page's fund picker,
 *  in the jump-link bar, picks the fund, and the LP returns theme stands in for both
 *  charts when the fund has no NAV close. `section` picks the chart: "sensitivity"
 *  (net-to-LP grid across exit multiples) or "glidepath" (LP multiples over the
 *  fund's life, chart + per-year table). */
export default function LpReport({ section, ...props }) {
  const { snapshot, portfolio, setAssumption, readOnly } = props;
  const m = useScenarioModel(props);
  return (
    <div>
      {section === "sensitivity" && <LpSensitivity m={m} readOnly={readOnly} />}
      {section === "glidepath" && (
        <Glidepath snapshot={snapshot} fundState={m.fs} portfolio={portfolio}
          setAssumption={setAssumption} readOnly={readOnly} />
      )}
    </div>
  );
}
