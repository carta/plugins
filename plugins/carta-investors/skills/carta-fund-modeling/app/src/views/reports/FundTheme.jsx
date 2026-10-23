import { H2 } from "../../ui/components.jsx";
import { useScenarioModel } from "../returns/useScenarioModel.js";
import FundHeader, { NoNavState } from "../returns/FundHeader.jsx";

/** A per-fund theme on the Reports page: one heading with the fund picker, driving
 *  the theme's per-fund charts (firm-wide charts under it ignore it). With `needsNav`,
 *  a fund that has no month-end NAV close shows why in place of the charts, since
 *  they are all built from its LP cash flows. */
export default function FundTheme({ title, returnsProps, needsNav, children }) {
  const m = useScenarioModel(returnsProps);
  const header = <FundHeader Heading={H2} title={title} funds={returnsProps.snapshot.funds} fundId={m.fundId} setFundScope={returnsProps.setFundScope} />;
  if (needsNav && m.fs.hasNav === false) return <>{header}<NoNavState fs={m.fs} /></>;
  return <>{header}{children}</>;
}
