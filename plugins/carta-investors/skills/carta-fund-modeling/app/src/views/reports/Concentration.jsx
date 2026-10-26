import { FS, inkNum, sans } from "../../ui/theme.js";
import { TableHead, TableScroll } from "../../ui/table.jsx";
import { fmtM, fmtPct, shortCompany } from "../../ui/format.js";
import { H3, Badge, MixedCurrencyNote } from "../../ui/components.jsx";
import { concentrationAcrossAll } from "../../model/concentration.js";

const COLS = [
  { label: "Company", align: "left" },
  { label: "Size", align: "left", help: "Fair value relative to the largest holding" },
  { label: "IRR", help: "Deal IRR" },
  { label: "Share", help: "Share of firm value" },
  { label: "FV", help: "Fair value" },
];

const BAR_COL_WIDTH = "35%";

/** Concentration — read-only power-law of who carries the firm's value at this
 *  scenario's marks. Firm-wide; no what-if interaction. */
export default function ConcentrationCard({ snapshot, portfolio, mixed }) {
  const c = concentrationAcrossAll(snapshot, portfolio);
  if (!c) return null;
  if (mixed) return <MixedCurrencyNote title="Concentration" />;
  const irrById = Object.fromEntries((portfolio.companies || []).map((cp) => [cp.id, cp.dealIrr]));
  const top = c.holdings.slice(0, 10);
  const maxFv = top[0].fv;
  const subtle = "var(--ink-color-global-text-subtle)";
  // IRR / Share / FV read as plain figures: regular weight, default text colour (no sign colouring).
  const valueText = { textAlign: "right", fontSize: FS.value, fontWeight: 400, color: "var(--ink-color-global-text-default)" };
  return (
    <div style={{ marginBottom: 16 }}>
      {/* Sub-head stacked under the title with no gap; its own 20px leading spaces them. */}
      <H3>Concentration</H3>
      <p style={{ ...sans, fontSize: FS.body, lineHeight: "20px", color: subtle, margin: "0 0 12px" }}>
        {(c.top5 * 100).toFixed(0)}% of value is in the top 5 holdings
      </p>
      <TableScroll>
        <table className="ledger sheet">
          <TableHead cols={COLS} />
          <tbody>
            {top.map((h, i) => {
              const irr = irrById[h.id];
              return (
                <tr key={h.id} data-datum-id={h.id} data-datum-type="company" data-datum-label={h.name}>
                  <td style={{ ...sans, fontSize: FS.value, fontWeight: 400, whiteSpace: "nowrap",
                    color: h.defunct ? subtle : "var(--ink-color-global-text-default)" }}>
                    {shortCompany(h.name)}
                    {h.exited && <Badge variant="text" tone="info" style={{ marginLeft: 5 }}>EXITED</Badge>}
                  </td>
                  {/* capped so the IRR / Share / FV columns keep room; the table is read-only, so their widths never shift */}
                  <td style={{ width: BAR_COL_WIDTH }}>
                    <div style={{ height: 10, background: "var(--ink-color-global-surface-lightgray-default)", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ width: `${Math.max(2, (h.fv / maxFv) * 100)}%`, height: "100%", borderRadius: 2,
                        background: i < 5 ? "var(--ink-button-background-color-primary-base-default)" : "var(--ink-color-global-surface-lightgray-active)" }} />
                    </div>
                  </td>
                  <td style={{ ...inkNum, ...valueText }}>
                    {irr == null ? "—" : fmtPct(irr)}
                  </td>
                  <td style={{ ...inkNum, ...valueText }}>{((h.fv / c.total) * 100).toFixed(1)}%</td>
                  <td style={{ ...inkNum, ...valueText }}>{fmtM(h.fv)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroll>
    </div>
  );
}
