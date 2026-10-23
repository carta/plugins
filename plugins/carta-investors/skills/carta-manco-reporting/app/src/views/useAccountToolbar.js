import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_FILTERS, detectPreset, rangePresets } from "./budgetPeriods.js";
import {
  canPersist, localStore, readPrefs, restoreBreakoutKey,
  restoreFilters, restoreRange, toPrefs, writePrefs,
} from "./budgetPrefs.js";

/** The Period / Filters / date-range state over a GL-account grid, kept
 *  across reloads under `prefsKey`. Budget vs Actuals' account view and the
 *  actuals-only report share it, so the two toolbars remember a reader the
 *  same way. `defaultRange` must be stable between renders (memoize it). */
export default function useAccountToolbar({ prefsKey, year, asOfMonth, defaultRange, breakouts }) {
  const store = useMemo(() => localStore(), []);
  const presets = useMemo(() => rangePresets(year, asOfMonth), [year, asOfMonth]);

  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [range, setRange] = useState(defaultRange);
  const [breakoutKey, setBreakoutKey] = useState(null);

  // Restored on the render the ManCo's own data arrives, not at mount: the
  // view renders before it, when there is no reader to have a preference.
  const restoredFor = useRef(null);
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (!prefsKey || restoredFor.current === prefsKey) return;
    restoredFor.current = prefsKey;
    const saved = readPrefs(store, prefsKey);
    if (saved) {
      setFilters(restoreFilters(saved));
      setRange(restoreRange(saved, presets, defaultRange));
      setBreakoutKey(restoreBreakoutKey(saved, breakouts));
    }
    setRestored(true);
  }, [store, prefsKey, presets, defaultRange, breakouts]);

  useEffect(() => {
    if (!canPersist(prefsKey, restoredFor.current)) return;
    writePrefs(store, prefsKey, toPrefs(filters, range, detectPreset(range, presets), breakoutKey));
  }, [store, prefsKey, filters, range, presets, breakoutKey]);

  return { filters, setFilters, range, setRange, breakoutKey, setBreakoutKey, restored };
}
