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
// The same guard for sessionStorage, which holds state that should end with the tab.
export function ssGet(key) {
  try { return sessionStorage.getItem(key); } catch { return null; }
}
export function ssSet(key, value) {
  try { sessionStorage.setItem(key, value); } catch { /* storage unavailable */ }
}
export function ssRemove(key) {
  try { sessionStorage.removeItem(key); } catch { /* storage unavailable */ }
}
