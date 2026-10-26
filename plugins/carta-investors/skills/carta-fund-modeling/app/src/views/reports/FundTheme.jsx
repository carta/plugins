import { H2 } from "../../ui/components.jsx";
import { useScenarioModel } from "../returns/useScenarioModel.js";
import { NoNavState } from "../returns/FundHeader.jsx";

/** A per-fund theme on the Reports page (see Reports.jsx's THEMES): its heading over
 *  its charts. With `needsNav`, a fund that has no month-end NAV close shows why in place of the
 *  charts, since they are all built from its LP cash flows. */
export default function FundTheme({ title, returnsProps, needsNav, children }) {
  const m = useScenarioModel(returnsProps);
  const header = <H2>{title}</H2>;
  if (needsNav && m.fs.hasNav === false) return <>{header}<NoNavState fs={m.fs} /></>;
  return <>{header}{children}</>;
}
