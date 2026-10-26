import { FS, sans } from "../../ui/theme.js";
import { fmtX } from "../../ui/format.js";
import { FundPicker, EmptyState, fundLabel } from "../../ui/components.jsx";

/** Heading of a per-fund Returns tab: the title with its single-fund picker, then
 *  the fund's Net TVPI at Carta marks. `Heading` is the tab's H1; omit `cartaNet` to
 *  leave the marks line off (the no-NAV state does). */
export default function FundHeader({ Heading, title, funds, fundId, setFundScope, cartaNet }) {
  return (
    <>
      <Heading actions={<FundPicker funds={funds} value={fundId} onChange={setFundScope} includeAll={false} />}>{title}</Heading>
      {cartaNet != null && (
        <p style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", margin: "0 0 16px" }}>
          At Carta marks: {fmtX(cartaNet)} Net TVPI on total incl. future calls
        </p>
      )}
    </>
  );
}

/** A fund with no month-end NAV close has no LP cash flows: say why rather than
 *  render a $0 / n/m view. */
export const NoNavState = ({ fs }) => (
  <EmptyState type="page" icon="pending"
    text={`${fundLabel(fs.name)} has no month-end NAV close booked in Carta yet, so its LP cash flows and returns aren't available. Its holdings are on the Companies tab.`} />
);
