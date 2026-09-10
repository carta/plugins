// Scenario persistence — the refresh cart, saved locally.
//
// The console is read-only with respect to Carta. This writes to the LOCAL data
// dir through serve.py's PUT /api/scenarios and never leaves the machine; see
// serve.py's header, which names it as the one write path in the app.
//
// TWO SERVER BEHAVIOURS THIS IS BUILT AROUND, both verified in serve.py:
//
//   * A missing scenarios.json answers `200 {"error":"not_ready"}` with NO ETag
//     header — not a 404. So "nothing saved yet" is a normal empty state.
//   * PUT only checks If-Match `if if_match and p.exists()`. Omitting the header
//     is therefore the correct create semantics. Sending `If-Match: *` would be
//     compared literally against the etag string and 409 forever.

import { useCallback, useEffect, useRef, useState } from "react";
import { apiToken } from "./useData.js";

const SCENARIOS = "/api/scenarios";

/** GET the scenario document plus its ETag. Null body when nothing is saved. */
export async function fetchScenarios() {
  const res = await fetch(SCENARIOS, { headers: { "X-Dash-Token": apiToken() } });
  if (res.status === 401) throw new Error("Unauthorized — relaunch the dashboard for a fresh link.");
  if (!res.ok) throw new Error(`${SCENARIOS} failed (${res.status})`);
  const body = await res.json();
  if (body && body.error === "not_ready") return { doc: null, etag: null };
  return { doc: body, etag: res.headers.get("ETag") };
}

/** PUT the document. Returns the new ETag, or throws `conflict` on a 409. */
export async function putScenarios(doc, etag) {
  const headers = { "X-Dash-Token": apiToken(), "Content-Type": "application/json" };
  // Only when we have one: the server treats an absent If-Match as "create".
  if (etag) headers["If-Match"] = etag;
  const res = await fetch(SCENARIOS, { method: "PUT", headers, body: JSON.stringify(doc) });
  if (res.status === 409) {
    const err = new Error("conflict");
    err.conflict = true;
    throw err;
  }
  if (!res.ok) throw new Error(`save failed (${res.status})`);
  return res.headers.get("ETag");
}

/** The document shape this app writes. Kept in one place so a reader of the raw
 *  file can tell what wrote it and which corporation it belongs to.
 *
 *  `scenarios` is an array even though the cart uses one: the endpoint is plural,
 *  the issuance handoff design already assumes a slot id, and adding the array
 *  now is a line of JSON where adding it later is a migration.
 */
export function emptyDoc(corporationId) {
  return {
    schemaVersion: 1,
    kind: "ctc-refresh-scenarios",
    corporationId: corporationId ?? null,
    activeScenarioId: "default",
    scenarios: [{ id: "default", name: "Refresh cycle", updatedAt: null, cart: [] }],
  };
}

/** Read the active scenario's cart out of a document, as a Set.
 *
 *  Guards the corporation: scenarios.json lives in the data dir, and a copied
 *  directory is a real thing people do. Applying another corporation's cart
 *  silently would put strangers in a grant cycle, so a mismatch reads as empty.
 */
export function cartFromDoc(doc, corporationId) {
  if (!doc || doc.kind !== "ctc-refresh-scenarios") return null;
  if (corporationId != null && doc.corporationId != null && doc.corporationId !== corporationId) {
    return null;
  }
  const active = (doc.scenarios || []).find((s) => s.id === (doc.activeScenarioId || "default"));
  return active ? new Set(active.cart || []) : null;
}

/** Write a cart into a document, returning a new document.
 *
 *  `scenarioId` names the slot to write. It defaults to the document's active
 *  scenario, but a caller that queued this write MUST pass the id it queued
 *  against: a debounced save resolved at fire time would land in whichever
 *  scenario is active by then, silently overwriting one draft with another's
 *  contents. See the pendingRef comment in useScenario.
 */
export function docWithCart(doc, corporationId, cart, overrides, scenarioId) {
  const base = doc && doc.kind === "ctc-refresh-scenarios" ? doc : emptyDoc(corporationId);
  const activeId = scenarioId || base.activeScenarioId || "default";
  const scenarios = (base.scenarios || []).map((s) =>
    s.id === activeId
      ? {
        ...s,
        cart: [...cart].sort(),
        // Written as a plain object because JSON has no Map. Omitted entirely
        // when empty, so a scenario nobody edited carries no key rather than an
        // empty one that reads as "overrides were cleared".
        ...(overrides && overrides.size
          ? { grantOverrides: Object.fromEntries([...overrides].sort()) }
          : {}),
        updatedAt: new Date().toISOString(),
      }
      : s);
  return { ...base, corporationId: corporationId ?? base.corporationId ?? null, scenarios };
}

/** The active scenario's hand-set grants, as a Map. Empty when there are none. */
export function overridesFromDoc(doc, corporationId) {
  const cartDoc = doc && doc.kind === "ctc-refresh-scenarios" ? doc : null;
  if (!cartDoc) return new Map();
  if (cartDoc.corporationId != null && corporationId != null
      && cartDoc.corporationId !== corporationId) {
    return new Map();
  }
  const activeId = cartDoc.activeScenarioId || "default";
  const active = (cartDoc.scenarios || []).find((s) => s.id === activeId);
  const raw = active && active.grantOverrides;
  if (!raw || typeof raw !== "object") return new Map();
  // Coerce and drop anything unusable rather than letting a bad value reach the
  // arithmetic. Null and "" are rejected BEFORE Number(), which turns both into 0
  // — a silent zero-share grant is exactly the kind of number nobody would query.
  return new Map(
    Object.entries(raw)
      .filter(([, v]) => typeof v === "number" || (typeof v === "string" && v.trim() !== ""))
      .map(([k, v]) => [k, Number(v)])
      .filter(([, v]) => Number.isFinite(v) && v >= 0),
  );
}

/** Load the saved cart once, and hand back a debounced save.
 *
 *  `saved` is what is on disk — the baseline the "N added · N removed" chip is
 *  measured against. It updates only when a save lands, so the chip describes
 *  unsaved work rather than resetting as the user clicks.
 */
export function useScenario(corporationId) {
  const [saved, setSaved] = useState(null);
  const [savedOverrides, setSavedOverrides] = useState(() => new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [conflict, setConflict] = useState(false);
  // True from the moment an edit is queued until it lands. Drives the "Saving…"
  // indicator, which is the only way a user can tell a draft is not yet on disk.
  const [saving, setSaving] = useState(false);
  const etagRef = useRef(null);
  const docRef = useRef(null);
  const timerRef = useRef(null);
  // The queued write, reachable OUTSIDE the timer's closure so it can be flushed
  // on demand (before a scenario switch) or attempted on unmount. Holding it only
  // in the setTimeout closure is what made a pending edit unrecoverable.
  const pendingRef = useRef(null);
  // Set once a 409 has been seen. Every later save would resend the same stale
  // ETag and conflict again, so saving STOPS until it is resolved — otherwise the
  // user goes on editing a draft that is no longer being written anywhere.
  const conflictRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { doc, etag } = await fetchScenarios();
        if (cancelled) return;
        docRef.current = doc;
        etagRef.current = etag;
        setSaved(cartFromDoc(doc, corporationId));
        setSavedOverrides(overridesFromDoc(doc, corporationId));
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [corporationId]);

  /** Write the queued payload now. Resolves true when nothing is left pending.
   *
   *  Shared by the debounce timer, `flush()` and unmount, so there is exactly one
   *  path that writes — a second copy of this logic is how the three drift apart.
   */
  const writePending = useCallback(async () => {
    const payload = pendingRef.current;
    if (!payload) return true;
    if (conflictRef.current) return false;
    try {
      const doc = docWithCart(
        docRef.current, corporationId, payload.cart, payload.overrides, payload.scenarioId);
      const etag = await putScenarios(doc, etagRef.current);
      docRef.current = doc;
      etagRef.current = etag;
      // Cleared only on success. A failed write stays queued, so a retry — or the
      // next edit — carries it rather than the edit dying with the error.
      pendingRef.current = null;
      setSaved(new Set(payload.cart));
      setSavedOverrides(new Map(payload.overrides || []));
      setConflict(false);
      setError(null);
      setSaving(false);
      return true;
    } catch (e) {
      // A 409 means another tab saved first. Do NOT merge silently: two carts
      // that diverged are two intentions, and picking one without saying so is
      // how someone ships a plan they did not make.
      if (e.conflict) {
        conflictRef.current = true;
        setConflict(true);
      } else {
        setError(e.message || String(e));
      }
      setSaving(false);
      return false;
    }
  }, [corporationId]);

  // On unmount, ATTEMPT the queued write rather than only cancelling the timer.
  // Cancelling alone is correct about React — a debounce must not fire into a dead
  // tree — but on its own it silently discarded up to 600ms of the last edit.
  useEffect(() => () => {
    clearTimeout(timerRef.current);
    if (pendingRef.current) writePending();
  }, [writePending]);

  const save = useCallback((cart, overrides, scenarioId) => {
    if (conflictRef.current) return;
    // The target scenario is captured HERE, not read when the timer fires: by then
    // the user may have switched, and the write would land in the wrong draft.
    pendingRef.current = {
      cart,
      overrides,
      scenarioId: scenarioId
        || (docRef.current && docRef.current.activeScenarioId)
        || "default",
    };
    setSaving(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(writePending, 600);
  }, [writePending]);

  /** Write any queued edit immediately. Resolves false when it did not land.
   *
   *  A caller switching scenarios must await this first: a queued write belongs to
   *  the scenario being left, and switching without it loses that edit.
   */
  const flush = useCallback(async () => {
    clearTimeout(timerRef.current);
    return writePending();
  }, [writePending]);

  /** Re-read the document, adopting what is on disk. The way out of a conflict. */
  const reload = useCallback(async () => {
    try {
      const { doc, etag } = await fetchScenarios();
      docRef.current = doc;
      etagRef.current = etag;
      pendingRef.current = null;
      conflictRef.current = false;
      setSaved(cartFromDoc(doc, corporationId));
      setSavedOverrides(overridesFromDoc(doc, corporationId));
      setConflict(false);
      setError(null);
      setSaving(false);
      return true;
    } catch (e) {
      setError(e.message || String(e));
      return false;
    }
  }, [corporationId]);

  return { saved, savedOverrides, loading, error, conflict, saving, save, flush, reload };
}
