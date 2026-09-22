// Tiny localStorage wrapper that never throws. Raw getItem/setItem throw in
// Safari private-browsing and storage-disabled contexts; this centralizes the
// guard so call sites (firm, theme, focusCo) don't each hand-roll try/catch —
// and don't crash on mount when they forget to.
export function lsGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function lsSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}
export function lsRemove(key) {
  try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
}
