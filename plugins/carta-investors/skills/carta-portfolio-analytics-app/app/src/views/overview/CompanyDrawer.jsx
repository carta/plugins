// Inline expandable sub-row for one company: Position (left) + the shared Cap
// table card (right), styled as the same key-value tables (KVTable) as the
// Company page. The Cap table card is imported from CompanyPage so the drawer and
// the Company page can never disagree.
import { sans, FS, MICRO } from "../../ui/theme.js";
import { KVTableRow } from "../../ui/components.jsx";
import { fmtVal } from "../../ui/charts.jsx";
import { buildOverviewRow } from "../../model/overviewRow.js";
import { companyOf } from "../../model/kpi.js";
import { CapCard, Section } from "../CompanyPage.jsx";

const tableWrapStyle = { flex: "1 1 240px", minWidth: 220 };

/** data: the full kpi.json dataset, used to resolve this company's Position via
 *  buildOverviewRow and its cap table via the shared CapCard. id: the company id. */
export default function CompanyDrawer({ data, id }) {
  const h = data ? buildOverviewRow(data, id) : null;
  const company = data ? companyOf(data, id) : null;

  const positionStats = [
    { label: "Invested", value: h?.invested ? fmtVal(h.invested.value, "Dollar", null, h.invested.cur) : "—" },
    { label: "Current value", value: h?.value ? fmtVal(h.value.value, "Dollar", null, h.value.cur) : "—" },
    { label: "Price per share", value: h?.pps ? fmtVal(h.pps.value, "Dollar", null, h.pps.cur) : "—" },
    { label: "Multiple (MOIC)", value: h?.moic != null ? h.moic.toFixed(2) + "×" : "—" },
    { label: "Sector", value: h?.sector || "—" },
  ];

  // Position amounts come from Fund Admin holdings. A firm without them keeps the
  // labelled rows (so the client sees what's on offer) plus a pointer note below.
  const noFundAdmin = !data?.hasValuation;

  // Both columns wrap their table in the shared `Section` so the fixed-height
  // headers (and therefore the first rows) line up across the two cards.
  return (
    <div style={{ ...sans, padding: "16px 16px 20px 46px", background: "var(--ink-color-global-surface-lightgray-default)" }}>
      <div style={{ display: "flex", gap: "16px 32px", flexWrap: "wrap" }}>
        <div data-testid="drawer-position" style={tableWrapStyle}>
          <Section label="Position">
            <KVTableRow stats={positionStats} />
            {noFundAdmin && (
              <p style={{ ...sans, fontSize: FS.bodyLg, color: MICRO, margin: "8px 12px 0" }}>
                Available through Carta Fund Administration.
              </p>
            )}
          </Section>
        </div>
        <div data-testid="drawer-captable" style={tableWrapStyle}>
          {company && <CapCard data={data} company={company} drawer />}
        </div>
      </div>
    </div>
  );
}
