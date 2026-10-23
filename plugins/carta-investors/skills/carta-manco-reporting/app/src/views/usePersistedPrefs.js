import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readViewParam, writeViewParam } from "../shell/route.js";
import { canPersist, decodeViewParam, encodeViewParam, localStore, readPrefs, writePrefs } from "./budgetPrefs.js";

const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** A toolbar's state kept across reloads under `prefsKey`, and in the page's URL so a
 *  copied link opens the same view. `prefs` is the state as it would be saved; `defaults`
 *  the same for a toolbar nobody changed (it keeps the URL clean); `onRestore(saved)`
 *  applies what was saved, and runs with null when nothing is — so a toolbar that moves to
 *  another key never keeps the last key's state.
 *
 *  What a new key restores from, first found wins: a link's `view`, the reader's own saved
 *  prefs, then `sharedView` — the toolbar a shared report's sharer sent (`budget.view`).
 *
 *  The reader's key is written only once they change the toolbar themselves, through a
 *  setter wrapped by the returned `bySelf`. A restore never writes it: a sharer's view
 *  saved under the reader's key would read as the reader's own and hide every view the
 *  sharer sends later. The URL keeps following the state either way.
 *  Returns { restored, bySelf }. */
export default function usePersistedPrefs({ prefsKey, prefs, defaults, onRestore, sharedView = null }) {
  const store = useMemo(() => localStore(), []);
  const restoreRef = useRef(onRestore);
  restoreRef.current = onRestore;
  const sharedRef = useRef(sharedView);
  sharedRef.current = sharedView;
  const touched = useRef(false);

  // Restored on the render the ManCo's own data arrives, not at mount: the
  // view renders before it, when there is no reader to have a preference.
  const restoredFor = useRef(null);
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (!prefsKey || restoredFor.current === prefsKey) return;
    restoredFor.current = prefsKey;
    touched.current = false;
    const shared = isObject(sharedRef.current) ? sharedRef.current : null;
    const saved = decodeViewParam(readViewParam()) ?? readPrefs(store, prefsKey) ?? shared;
    restoreRef.current(saved);
    setRestored(true);
  }, [store, prefsKey]);

  const json = JSON.stringify(prefs);
  const defaultsJson = JSON.stringify(defaults);
  useEffect(() => {
    if (!canPersist(prefsKey, restoredFor.current)) return;
    const current = JSON.parse(json);
    writeViewParam(encodeViewParam(current, JSON.parse(defaultsJson)));
    if (touched.current) writePrefs(store, prefsKey, current);
  }, [store, prefsKey, json, defaultsJson]);

  // A setter the reader's own change goes through: it marks the toolbar theirs to save.
  const bySelf = useCallback((setter) => (...args) => {
    touched.current = true;
    return setter(...args);
  }, []);

  return { restored, bySelf };
}
