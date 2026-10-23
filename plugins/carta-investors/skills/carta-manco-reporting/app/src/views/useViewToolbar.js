import { useState } from "react";
import { restoreViewPrefs, toViewPrefs } from "./budgetPrefs.js";
import usePersistedPrefs from "./usePersistedPrefs.js";

/** The crosstab and line-item layouts' toolbar — the breakout, and on a crosstab every
 *  department column, the rows the author hid and actuals through today — kept across
 *  reloads under `prefsKey` and in the page's URL, as useAccountToolbar keeps the account
 *  layout's. */
export default function useViewToolbar({ prefsKey, breakouts }) {
  const [state, setState] = useState(() => toViewPrefs());
  usePersistedPrefs({
    prefsKey,
    prefs: state,
    defaults: toViewPrefs(),
    onRestore: (saved) => setState(restoreViewPrefs(saved, breakouts)),
  });
  const set = (field) => (value) => setState((s) => ({ ...s, [field]: typeof value === "function" ? value(s[field]) : value }));
  return {
    ...state,
    setBreakoutKey: set("breakoutKey"),
    setShowAll: set("showAll"),
    setShowHidden: set("showHidden"),
    setThroughToday: set("throughToday"),
  };
}
