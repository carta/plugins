import { useEffect, useMemo, useRef, useState } from "react";
import { readViewParam, writeViewParam } from "../shell/route.js";
import { canPersist, decodeViewParam, encodeViewParam, localStore, readPrefs, writePrefs } from "./budgetPrefs.js";

/** A toolbar's state kept across reloads under `prefsKey`, and in the page's URL so a
 *  copied link opens the same view. `prefs` is the state as it would be saved; `defaults`
 *  the same for a toolbar nobody changed (it keeps the URL clean); `onRestore(saved)`
 *  applies what was saved, and runs with null when nothing is — so a toolbar that moves to
 *  another key never keeps the last key's state. A link's `view` wins over the reader's
 *  own saved prefs.
 *  Returns whether the restore has run. */
export default function usePersistedPrefs({ prefsKey, prefs, defaults, onRestore }) {
  const store = useMemo(() => localStore(), []);
  const restoreRef = useRef(onRestore);
  restoreRef.current = onRestore;

  // Restored on the render the ManCo's own data arrives, not at mount: the
  // view renders before it, when there is no reader to have a preference.
  const restoredFor = useRef(null);
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    if (!prefsKey || restoredFor.current === prefsKey) return;
    restoredFor.current = prefsKey;
    const saved = decodeViewParam(readViewParam()) ?? readPrefs(store, prefsKey);
    restoreRef.current(saved);
    setRestored(true);
  }, [store, prefsKey]);

  const json = JSON.stringify(prefs);
  const defaultsJson = JSON.stringify(defaults);
  useEffect(() => {
    if (!canPersist(prefsKey, restoredFor.current)) return;
    const current = JSON.parse(json);
    writePrefs(store, prefsKey, current);
    writeViewParam(encodeViewParam(current, JSON.parse(defaultsJson)));
  }, [store, prefsKey, json, defaultsJson]);

  return restored;
}
