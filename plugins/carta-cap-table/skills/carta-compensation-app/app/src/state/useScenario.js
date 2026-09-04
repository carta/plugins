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

/** Write a cart into a document, returning a new document. */
export function docWithCart(doc, corporationId, cart) {
  const base = doc && doc.kind === "ctc-refresh-scenarios" ? doc : emptyDoc(corporationId);
  const activeId = base.activeScenarioId || "default";
  const scenarios = (base.scenarios || []).map((s) =>
    s.id === activeId
      ? { ...s, cart: [...cart].sort(), updatedAt: new Date().toISOString() }
      : s);
  return { ...base, corporationId: corporationId ?? base.corporationId ?? null, scenarios };
}

/** Load the saved cart once, and hand back a debounced save.
 *
 *  `saved` is what is on disk — the baseline the "N added · N removed" chip is
 *  measured against. It updates only when a save lands, so the chip describes
 *  unsaved work rather than resetting as the user clicks.
 */
export function useScenario(corporationId) {
  const [saved, setSaved] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [conflict, setConflict] = useState(false);
  const etagRef = useRef(null);
  const docRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { doc, etag } = await fetchScenarios();
        if (cancelled) return;
        docRef.current = doc;
        etagRef.current = etag;
        setSaved(cartFromDoc(doc, corporationId));
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [corporationId]);

  // Cancel a pending save on unmount so a debounce cannot fire into a dead tree.
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const save = useCallback((cart) => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        const doc = docWithCart(docRef.current, corporationId, cart);
        const etag = await putScenarios(doc, etagRef.current);
        docRef.current = doc;
        etagRef.current = etag;
        setSaved(new Set(cart));
        setConflict(false);
        setError(null);
      } catch (e) {
        // A 409 means another tab saved first. Do NOT merge silently: two carts
        // that diverged are two intentions, and picking one without saying so is
        // how someone ships a plan they did not make.
        if (e.conflict) setConflict(true);
        else setError(e.message || String(e));
      }
    }, 600);
  }, [corporationId]);

  return { saved, loading, error, conflict, save };
}
