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

/** What this app writes. 2 adds per-scenario `settings` and `filters`.
 *
 *  Both are OPTIONAL and both have a correct absent-meaning, which is why there is
 *  no migration: a scenario with no `settings` falls back to the corporation's own
 *  policy — exactly what the planner did before any of this existed — and one with
 *  no `filters` has none applied. A v1 document is therefore read correctly by this
 *  code as written, and is rewritten only when the user next edits something.
 */
export const SCHEMA_VERSION = 2;

/** The modelling settings a scenario stores, matching policyToSettings' output.
 *
 *  Listed rather than spread so an unrelated key on the settings object cannot
 *  reach the file, and so a reader of the raw JSON sees a fixed shape.
 */
export const SETTINGS_KEYS = Object.freeze([
  "targetPct", "cadenceMonths", "rangeBelowPct", "rangeAbovePct", "tenureMinMonths",
]);

/** The highest version this build understands.
 *
 *  Read in one direction only. A document from an OLDER build is fine — see above.
 *  A document from a NEWER one is not, because a key this build thinks it knows may
 *  have been redefined, and the failure would be silent. So a newer document is
 *  reported and, more importantly, NEVER written over: clobbering a scenario file
 *  written by a build we do not understand is the one unrecoverable outcome here.
 */
export const MAX_READABLE_VERSION = 2;

/** True when this document was written by a build newer than this one. */
export function isFutureDoc(doc) {
  return !!doc && Number(doc.schemaVersion) > MAX_READABLE_VERSION;
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
    schemaVersion: SCHEMA_VERSION,
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
  const active = activeScenario(doc, corporationId);
  return active ? new Set(active.cart || []) : null;
}

/** The active scenario entry, or null when this document must not be applied.
 *
 *  One place for the three checks every reader needs, rather than a fourth copy:
 *  is this our file, is it from a build we understand, and does it belong to this
 *  corporation. The corporation test needs BOTH sides non-null on purpose — an
 *  unrecorded id means "we do not know", and refusing to load someone's only saved
 *  plan over an unknown would be worse than the mix-up it guards against.
 */
function activeScenario(doc, corporationId) {
  if (!doc || doc.kind !== "ctc-refresh-scenarios") return null;
  if (isFutureDoc(doc)) return null;
  if (corporationId != null && doc.corporationId != null && doc.corporationId !== corporationId) {
    return null;
  }
  return (doc.scenarios || []).find((s) => s.id === (doc.activeScenarioId || "default")) || null;
}

/** The active scenario's modelling settings, or null when it has none.
 *
 *  NULL IS MEANINGFUL and is not the same as an empty object: it says "this
 *  scenario never recorded settings", which the planner answers by falling back to
 *  the corporation's own policy. Returning defaults here would hard-code Carta's
 *  policy into every v1 scenario and make that fallback impossible to distinguish
 *  from a deliberate choice to match it.
 *
 *  Percent NUMBERS, not fractions — 30 means 30%. `policyToSettings` is the single
 *  place the conversion happens and this stores its output, so nothing downstream
 *  has to know which form it is holding.
 */
export function settingsFromDoc(doc, corporationId) {
  const active = activeScenario(doc, corporationId);
  const raw = active && active.settings;
  if (!raw || typeof raw !== "object") return null;
  const out = {};
  for (const key of SETTINGS_KEYS) {
    const v = Number(raw[key]);
    if (Number.isFinite(v)) out[key] = v;
  }
  // A settings object missing every key is no settings at all. Half a policy would
  // silently mix the scenario's target with Carta's cadence.
  return Object.keys(out).length ? out : null;
}

/** The active scenario's cohort filters, or null when it has none. */
export function filtersFromDoc(doc, corporationId) {
  const active = activeScenario(doc, corporationId);
  const raw = active && active.filters;
  if (!raw || typeof raw !== "object") return null;
  const levelMin = Number(raw.levelMin);
  const levelMax = Number(raw.levelMax);
  const within = Number(raw.excludeVestingWithinMonths);
  return {
    hasPriorGrants: raw.hasPriorGrants === true,
    // Coerced to an array of strings: job areas arrive as a Set in the view, and a
    // stray number here would never match a row's job_area.
    jobAreas: Array.isArray(raw.jobAreas) ? raw.jobAreas.filter((a) => typeof a === "string") : [],
    levelMin: Number.isFinite(levelMin) ? levelMin : null,
    levelMax: Number.isFinite(levelMax) ? levelMax : null,
    excludeVestingWithinMonths: Number.isFinite(within) ? within : 0,
  };
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
  return docWithPlan(doc, corporationId, { cart, overrides }, scenarioId);
}

/** True when a filter set leaves the cohort untouched. */
function noFilters(f) {
  return !f || (!f.hasPriorGrants
    && !(f.jobAreas && f.jobAreas.length)
    && f.levelMin == null && f.levelMax == null
    && !f.excludeVestingWithinMonths);
}

/** Write one scenario's whole plan, returning a new document.
 *
 *  `plan` carries any of `cart`, `overrides`, `settings` and `filters`. A key that
 *  is absent from `plan` is LEFT ALONE on the stored scenario rather than cleared,
 *  so a caller saving a filter change cannot wipe the cart it did not pass.
 *
 *  Refuses to write over a document from a newer build — see MAX_READABLE_VERSION.
 *  Returning the base unchanged means the PUT carries what is already on disk, so
 *  the ETag still matches and the user sees no spurious conflict; they simply
 *  cannot save until they are on a build that understands the file.
 */
export function docWithPlan(doc, corporationId, plan, scenarioId) {
  if (isFutureDoc(doc)) return doc;
  const base = doc && doc.kind === "ctc-refresh-scenarios" ? doc : emptyDoc(corporationId);
  const activeId = scenarioId || base.activeScenarioId || "default";
  const has = (k) => Object.prototype.hasOwnProperty.call(plan || {}, k);
  const scenarios = (base.scenarios || []).map((s) => {
    if (s.id !== activeId) return s;
    const next = { ...s, updatedAt: new Date().toISOString() };
    if (has("cart")) next.cart = [...(plan.cart || [])].sort();
    if (has("overrides")) {
      // Written as a plain object because JSON has no Map. Deleted entirely when
      // empty, so a scenario nobody edited carries no key rather than an empty one
      // that reads as "overrides were cleared".
      if (plan.overrides && plan.overrides.size) {
        next.grantOverrides = Object.fromEntries([...plan.overrides].sort());
      } else delete next.grantOverrides;
    }
    if (has("settings")) {
      // Written unconditionally once known, unlike filters: a scenario whose whole
      // point is "the same cohort at a lower multiple" IS its settings, and leaving
      // the key off would make it fall back to policy and read as unchanged.
      if (plan.settings) {
        next.settings = Object.fromEntries(
          SETTINGS_KEYS
            .filter((k) => Number.isFinite(Number(plan.settings[k])))
            .map((k) => [k, Number(plan.settings[k])]),
        );
      } else delete next.settings;
    }
    if (has("filters")) {
      // Omitted when neutral, matching grantOverrides: an all-defaults object reads
      // as "filters were deliberately cleared" rather than "never set one".
      if (noFilters(plan.filters)) delete next.filters;
      else {
        next.filters = {
          hasPriorGrants: plan.filters.hasPriorGrants === true,
          jobAreas: [...(plan.filters.jobAreas || [])].sort(),
          levelMin: plan.filters.levelMin ?? null,
          levelMax: plan.filters.levelMax ?? null,
          excludeVestingWithinMonths: plan.filters.excludeVestingWithinMonths || 0,
        };
      }
    }
    return next;
  });
  return {
    ...base,
    // Stamped on write, not on read: a document is only v2 once it actually holds
    // something a v1 build would misread.
    schemaVersion: SCHEMA_VERSION,
    corporationId: corporationId ?? base.corporationId ?? null,
    scenarios,
  };
}

/** A new scenario id.
 *
 *  Not derived from the name: renaming must not orphan a scenario, and two drafts
 *  called "Engineering" is a thing people do. randomUUID needs a secure context,
 *  which localhost is — the fallback exists because this id outlives the session in
 *  a file, so "probably unique" is not good enough to rely on silently.
 */
function newScenarioId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The scenarios in a document, always an array. */
export function scenariosOf(doc) {
  if (!doc || doc.kind !== "ctc-refresh-scenarios" || isFutureDoc(doc)) return [];
  return doc.scenarios || [];
}

/** The id of the active scenario. */
export function activeIdOf(doc) {
  return (doc && doc.activeScenarioId) || "default";
}

/** A name no existing scenario is using, derived from `base`.
 *
 *  `suffix` lets a numbered variant land INSIDE a trailing bracket — "X (copy 2)",
 *  not "X (copy) 2", which is what reads as a mistake in a dropdown.
 */
function uniqueName(scenarios, base, suffix) {
  const taken = new Set(scenarios.map((s) => s.name));
  const nth = suffix
    ? (n) => `${base} (${suffix} ${n})`
    : (n) => `${base} ${n}`;
  const first = suffix ? `${base} (${suffix})` : base;
  if (!taken.has(first)) return first;
  for (let n = 2; n < 500; n += 1) {
    if (!taken.has(nth(n))) return nth(n);
  }
  return `${first} ${newScenarioId().slice(0, 6)}`;
}

/** Add an empty scenario and make it active.
 *
 *  Deliberately carries NO `settings` key: a new draft starts at the corporation's
 *  own policy, and omitting the key is how the document says so rather than
 *  freezing today's policy into it.
 */
export function docWithNewScenario(doc, corporationId, name) {
  if (isFutureDoc(doc)) return doc;
  const base = doc && doc.kind === "ctc-refresh-scenarios" ? doc : emptyDoc(corporationId);
  const id = newScenarioId();
  return {
    ...base,
    schemaVersion: SCHEMA_VERSION,
    corporationId: corporationId ?? base.corporationId ?? null,
    activeScenarioId: id,
    scenarios: [...(base.scenarios || []), {
      id,
      name: uniqueName(base.scenarios || [], name || "New scenario"),
      updatedAt: new Date().toISOString(),
      cart: [],
    }],
  };
}

/** Copy a scenario whole, and make the copy active.
 *
 *  Copies EVERYTHING — cart, overrides, settings, filters. The headline use is
 *  "the same cohort at a lower multiple", so the cart has to come across; and it is
 *  far easier to narrow a copied cohort than to rebuild a 134-person one. Hand-set
 *  grants come too, because dropping them silently would make the copy's totals
 *  differ from the original's for a reason nothing on screen explains.
 *
 *  The copy is inserted directly after its source rather than appended, so a list
 *  read top to bottom keeps a draft next to the thing it was derived from.
 */
export function docWithDuplicatedScenario(doc, corporationId, sourceId) {
  if (isFutureDoc(doc)) return doc;
  const base = doc && doc.kind === "ctc-refresh-scenarios" ? doc : emptyDoc(corporationId);
  const scenarios = base.scenarios || [];
  const at = scenarios.findIndex((s) => s.id === (sourceId || activeIdOf(base)));
  if (at < 0) return base;
  const src = scenarios[at];
  const copy = {
    ...src,
    id: newScenarioId(),
    name: uniqueName(scenarios, src.name, "copy"),
    updatedAt: new Date().toISOString(),
    cart: [...(src.cart || [])],
    ...(src.grantOverrides ? { grantOverrides: { ...src.grantOverrides } } : {}),
    ...(src.settings ? { settings: { ...src.settings } } : {}),
    ...(src.filters
      ? { filters: { ...src.filters, jobAreas: [...(src.filters.jobAreas || [])] } }
      : {}),
  };
  return {
    ...base,
    schemaVersion: SCHEMA_VERSION,
    corporationId: corporationId ?? base.corporationId ?? null,
    activeScenarioId: copy.id,
    scenarios: [...scenarios.slice(0, at + 1), copy, ...scenarios.slice(at + 1)],
  };
}

/** Rename a scenario.
 *
 *  Does NOT touch `updatedAt`: labelling a draft is not editing it, and bumping the
 *  timestamp would make "last edited" stop answering the question it appears to.
 */
export function docWithRenamedScenario(doc, id, name) {
  if (isFutureDoc(doc)) return doc;
  const trimmed = String(name || "").trim();
  if (!doc || !trimmed) return doc;
  return {
    ...doc,
    scenarios: (doc.scenarios || []).map((s) => (s.id === id ? { ...s, name: trimmed } : s)),
  };
}

/** Remove a scenario, refusing the last one.
 *
 *  An empty `scenarios` array makes every reader return null, which the user sees
 *  as "nothing saved" rather than as an error — so the document always keeps one.
 *  Deleting the active scenario activates its neighbour by position, which is the
 *  one the user was just looking at.
 */
export function docWithoutScenario(doc, id) {
  if (isFutureDoc(doc)) return doc;
  const scenarios = (doc && doc.scenarios) || [];
  if (scenarios.length <= 1) return doc;
  const at = scenarios.findIndex((s) => s.id === id);
  if (at < 0) return doc;
  const rest = scenarios.filter((s) => s.id !== id);
  const active = activeIdOf(doc) === id
    ? rest[Math.min(at, rest.length - 1)].id
    : activeIdOf(doc);
  return { ...doc, activeScenarioId: active, scenarios: rest };
}

/** Switch the active scenario. */
export function docWithActiveScenario(doc, id) {
  if (isFutureDoc(doc) || !doc) return doc;
  if (!(doc.scenarios || []).some((s) => s.id === id)) return doc;
  return { ...doc, activeScenarioId: id };
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
  // Null means "this scenario recorded none", which the planner answers by falling
  // back to the corporation's policy — NOT the same as an empty object.
  const [savedSettings, setSavedSettings] = useState(null);
  const [savedFilters, setSavedFilters] = useState(null);
  // A document from a newer build. Readable state is left empty and saving is
  // refused, because a key this build thinks it knows may have been redefined.
  const [futureDoc, setFutureDoc] = useState(false);
  // The switcher's own view of the document. Mirrored into state because docRef is
  // a ref — a change to it would not re-render the list that displays it.
  const [scenarios, setScenarios] = useState([]);
  const [activeId, setActiveId] = useState("default");
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
        setFutureDoc(isFutureDoc(doc));
        setScenarios(scenariosOf(doc));
        setActiveId(activeIdOf(doc));
        setSaved(cartFromDoc(doc, corporationId));
        setSavedOverrides(overridesFromDoc(doc, corporationId));
        setSavedSettings(settingsFromDoc(doc, corporationId));
        setSavedFilters(filtersFromDoc(doc, corporationId));
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
      const doc = docWithPlan(
        docRef.current, corporationId, payload.plan, payload.scenarioId);
      const etag = await putScenarios(doc, etagRef.current);
      docRef.current = doc;
      etagRef.current = etag;
      // Cleared only on success. A failed write stays queued, so a retry — or the
      // next edit — carries it rather than the edit dying with the error.
      pendingRef.current = null;
      setScenarios(scenariosOf(doc));
      setActiveId(activeIdOf(doc));
      const { plan } = payload;
      const wrote = (k) => Object.prototype.hasOwnProperty.call(plan, k);
      if (wrote("cart")) setSaved(new Set(plan.cart));
      if (wrote("overrides")) setSavedOverrides(new Map(plan.overrides || []));
      if (wrote("settings")) setSavedSettings(plan.settings || null);
      if (wrote("filters")) setSavedFilters(plan.filters || null);
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

  /** Queue a save. `plan` may carry any of cart, overrides, settings, filters.
   *
   *  Also accepts the older `save(cart, overrides)` positional form, because the
   *  cart is edited from two places and rewriting both to build a plan object added
   *  nothing. Anything not passed is left alone on the stored scenario.
   */
  const save = useCallback((planOrCart, overrides, scenarioId) => {
    if (conflictRef.current || futureDoc) return;
    const plan = planOrCart instanceof Set || Array.isArray(planOrCart)
      ? { cart: planOrCart, overrides }
      : (planOrCart || {});
    // Merge onto anything already queued rather than replacing it: a filter change
    // 100ms after a cart click must not drop the cart click, and each mutation path
    // only knows about its own slice of the plan.
    const merged = { ...(pendingRef.current ? pendingRef.current.plan : null), ...plan };
    // The target scenario is captured HERE, not read when the timer fires: by then
    // the user may have switched, and the write would land in the wrong draft.
    pendingRef.current = {
      plan: merged,
      scenarioId: scenarioId
        || (pendingRef.current && pendingRef.current.scenarioId)
        || (docRef.current && docRef.current.activeScenarioId)
        || "default",
    };
    setSaving(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(writePending, 600);
  }, [writePending, futureDoc]);

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
      setFutureDoc(isFutureDoc(doc));
      setScenarios(scenariosOf(doc));
      setActiveId(activeIdOf(doc));
      setSaved(cartFromDoc(doc, corporationId));
      setSavedOverrides(overridesFromDoc(doc, corporationId));
      setSavedSettings(settingsFromDoc(doc, corporationId));
      setSavedFilters(filtersFromDoc(doc, corporationId));
      setConflict(false);
      setError(null);
      setSaving(false);
      return true;
    } catch (e) {
      setError(e.message || String(e));
      return false;
    }
  }, [corporationId]);


  /** Write a document straight through, bypassing the debounce.
   *
   *  Lifecycle changes are structural — creating, renaming, deleting or switching a
   *  draft — and must land before the UI reflects them. Debouncing them would let a
   *  user switch twice in 600ms and have only the second write, leaving the file
   *  pointing at a scenario the first switch had already left.
   */
  const commit = useCallback(async (next) => {
    if (conflictRef.current || futureDoc || !next) return false;
    try {
      const etag = await putScenarios(next, etagRef.current);
      docRef.current = next;
      etagRef.current = etag;
      setScenarios(scenariosOf(next));
      setActiveId(activeIdOf(next));
      setSaved(cartFromDoc(next, corporationId));
      setSavedOverrides(overridesFromDoc(next, corporationId));
      setSavedSettings(settingsFromDoc(next, corporationId));
      setSavedFilters(filtersFromDoc(next, corporationId));
      setError(null);
      return true;
    } catch (e) {
      if (e.conflict) {
        conflictRef.current = true;
        setConflict(true);
      } else setError(e.message || String(e));
      return false;
    }
  }, [corporationId, futureDoc]);

  /** Switch drafts, flushing whatever is queued for the one being left.
   *
   *  The flush is the whole point. A queued write belongs to the OUTGOING scenario,
   *  and switching without it would either lose that edit or — before the target id
   *  was captured at queue time — land it in the incoming draft.
   *
   *  A flush that fails aborts the switch: the user stays where they are with their
   *  edits intact, rather than being moved away from work that was not saved.
   */
  const switchScenario = useCallback(async (id) => {
    if (id === activeIdOf(docRef.current)) return true;
    if (!(await flush())) return false;
    return commit(docWithActiveScenario(docRef.current, id));
  }, [flush, commit]);

  const createScenario = useCallback(async (name) => {
    if (!(await flush())) return false;
    return commit(docWithNewScenario(docRef.current, corporationId, name));
  }, [flush, commit, corporationId]);

  const duplicateScenario = useCallback(async (sourceId) => {
    // Flush first for the same reason as a switch: the copy is taken from the
    // DOCUMENT, so an unsaved edit would be missing from it.
    if (!(await flush())) return false;
    return commit(docWithDuplicatedScenario(
      docRef.current, corporationId, sourceId || activeIdOf(docRef.current)));
  }, [flush, commit, corporationId]);

  const renameScenario = useCallback(
    (id, name) => commit(docWithRenamedScenario(docRef.current, id, name)),
    [commit],
  );

  const deleteScenario = useCallback(async (id) => {
    // Anything queued belongs to a scenario that may be the one being deleted, so
    // drop it rather than flushing a write to a draft about to disappear.
    clearTimeout(timerRef.current);
    pendingRef.current = null;
    setSaving(false);
    return commit(docWithoutScenario(docRef.current, id));
  }, [commit]);

  return {
    saved, savedOverrides, savedSettings, savedFilters,
    scenarios, activeId,
    loading, error, conflict, saving, futureDoc,
    save, flush, reload,
    switchScenario, createScenario, duplicateScenario, renameScenario, deleteScenario,
  };
}
