import { useMemo, useState } from "react";
import { DEFAULT_FILTERS, detectPreset, rangePresets } from "./budgetPeriods.js";
import { restoreBreakoutKey, restoreFilters, restoreRange, toPrefs } from "./budgetPrefs.js";
import usePersistedPrefs from "./usePersistedPrefs.js";

/** The Period / Filters / date-range state over a GL-account grid, kept
 *  across reloads under `prefsKey` and in the page's URL. Budget vs Actuals'
 *  account view and the actuals-only report share it, so the two toolbars
 *  remember a reader the same way. `defaultRange` must be stable between
 *  renders (memoize it). `sharedView` is the toolbar a shared report's sharer
 *  sent (`budget.view`), restored when the reader has saved none of their own. */
export default function useAccountToolbar({ prefsKey, year, asOfMonth, defaultRange, breakouts, sharedView = null }) {
  const presets = rangePresets(year, asOfMonth);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [range, setRange] = useState(defaultRange);
  const [breakoutKey, setBreakoutKey] = useState(null);

  const { restored, bySelf } = usePersistedPrefs({
    prefsKey,
    sharedView,
    prefs: toPrefs(filters, range, detectPreset(range, presets), breakoutKey),
    defaults: toPrefs(DEFAULT_FILTERS, defaultRange, detectPreset(defaultRange, presets), null),
    onRestore: (saved) => {
      setFilters(restoreFilters(saved));
      setRange(restoreRange(saved, presets, defaultRange));
      setBreakoutKey(restoreBreakoutKey(saved, breakouts));
    },
  });

  const setters = useMemo(() => ({
    setFilters: bySelf(setFilters), setRange: bySelf(setRange), setBreakoutKey: bySelf(setBreakoutKey),
  }), [bySelf]);
  return { filters, range, breakoutKey, ...setters, restored };
}
