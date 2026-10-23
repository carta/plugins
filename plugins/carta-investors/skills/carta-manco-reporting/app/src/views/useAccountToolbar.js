import { useState } from "react";
import { DEFAULT_FILTERS, detectPreset, rangePresets } from "./budgetPeriods.js";
import { restoreBreakoutKey, restoreFilters, restoreRange, toPrefs } from "./budgetPrefs.js";
import usePersistedPrefs from "./usePersistedPrefs.js";

/** The Period / Filters / date-range state over a GL-account grid, kept
 *  across reloads under `prefsKey` and in the page's URL. Budget vs Actuals'
 *  account view and the actuals-only report share it, so the two toolbars
 *  remember a reader the same way. `defaultRange` must be stable between
 *  renders (memoize it). */
export default function useAccountToolbar({ prefsKey, year, asOfMonth, defaultRange, breakouts }) {
  const presets = rangePresets(year, asOfMonth);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [range, setRange] = useState(defaultRange);
  const [breakoutKey, setBreakoutKey] = useState(null);

  const restored = usePersistedPrefs({
    prefsKey,
    prefs: toPrefs(filters, range, detectPreset(range, presets), breakoutKey),
    defaults: toPrefs(DEFAULT_FILTERS, defaultRange, detectPreset(defaultRange, presets), null),
    onRestore: (saved) => {
      setFilters(restoreFilters(saved));
      setRange(restoreRange(saved, presets, defaultRange));
      setBreakoutKey(restoreBreakoutKey(saved, breakouts));
    },
  });

  return { filters, setFilters, range, setRange, breakoutKey, setBreakoutKey, restored };
}
