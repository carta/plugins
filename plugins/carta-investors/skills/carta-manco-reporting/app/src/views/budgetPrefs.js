// How a reader last set the Budget vs Actuals toolbar, kept across reloads.

import {
  COLUMN_TYPES, DEFAULT_FILTERS, FREQUENCIES, MAX_HIDDEN_COLUMNS, normalizeRange,
} from "./budgetPeriods.js";

const NAMESPACE = "manco:bva";

/** Where one ManCo's budget keeps its toolbar state.
 *
 *  Keyed on the ManCo rather than the origin: the server picks a new port
 *  after a cache reset, and a port-scoped memory would be lost with it.
 */
export function prefsKey(mancoUuid, budgetId) {
  return `${NAMESPACE}:${mancoUuid || "unknown"}:${budgetId || "primary"}`;
}

/** That key, or null until the data naming this ManCo has loaded. The view
 *  renders before it, and a key standing in for it belongs to no one. */
export function prefsKeyFor(accountsData, budget) {
  const uuid = accountsData?.manco_uuid;
  return uuid ? prefsKey(uuid, budget?.id) : null;
}

/** Whether the toolbar may be saved yet. Writing before the saved state has
 *  been read back would overwrite it with the defaults. */
export function canPersist(key, restoredKey) {
  return !!key && restoredKey === key;
}

/** The browser's store, or null where it is missing or refuses writes. */
export function localStore() {
  try {
    const store = globalThis.localStorage;
    // Private-mode Safari has the object and throws on write, so probe it.
    store.setItem(`${NAMESPACE}:probe`, "1");
    store.removeItem(`${NAMESPACE}:probe`);
    return store;
  } catch {
    return null;
  }
}

export function readPrefs(store, key) {
  try {
    const raw = store?.getItem(key);
    const saved = raw ? JSON.parse(raw) : null;
    return saved && typeof saved === "object" ? saved : null;
  } catch {
    // Anything unreadable is a preference, not data — open on the defaults.
    return null;
  }
}

export function writePrefs(store, key, prefs) {
  try {
    store?.setItem(key, JSON.stringify(prefs));
  } catch {
    // A full or blocked store costs the reader their preference, nothing more.
  }
}

/** Saved filters folded into the defaults, dropping what no longer applies. */
export function restoreFilters(saved) {
  const f = saved?.filters;
  if (!f) return { ...DEFAULT_FILTERS };
  const known = FREQUENCIES.some(x => x.key === f.frequency);
  return {
    frequency: known ? f.frequency : DEFAULT_FILTERS.frequency,
    hidden: (Array.isArray(f.hidden) ? f.hidden : [])
      .filter(t => COLUMN_TYPES.includes(t))
      .slice(0, MAX_HIDDEN_COLUMNS),
    showYtd: f.showYtd !== false,
  };
}

/** The saved window, re-derived from its preset where it had one.
 *
 *  A named preset is recomputed rather than restored literally: "year to
 *  date" saved in August means September in September, not Jan–Aug forever.
 */
export function restoreRange(saved, presets, fallback) {
  const r = saved?.range;
  if (!r) return fallback;
  if (r.preset && r.preset !== "custom") {
    const hit = (presets || []).find(p => p.id === r.preset);
    return hit && hit.first != null ? { first: hit.first, last: hit.last } : fallback;
  }
  const first = Number(r.first);
  const last = Number(r.last);
  if (!Number.isFinite(first) || !Number.isFinite(last)) return fallback;
  return normalizeRange({ first, last });
}

/** The saved breakout, if the firm's data still offers it. */
export function restoreBreakoutKey(saved, breakouts) {
  const key = saved?.breakoutKey;
  if (key === "none") return "none";
  if (key && (breakouts || []).some(b => b.key === key)) return key;
  return null;
}

/** What to write back after the reader changes something. */
export function toPrefs(filters, range, preset, breakoutKey) {
  return {
    filters: { frequency: filters.frequency, hidden: filters.hidden || [],
               showYtd: !!filters.showYtd },
    range: preset && preset !== "custom"
      ? { preset }
      : { preset: "custom", first: range.first, last: range.last },
    breakoutKey: breakoutKey ?? null,
  };
}
