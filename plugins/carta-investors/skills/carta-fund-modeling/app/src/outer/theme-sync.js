// Syncs the outer shell's light/dark appearance to the app's own theme
// toggle. The app (inside the iframe) is the source of truth: it writes
// `localStorage.theme` ("dark" | "light") on toggle. Same-origin
// localStorage is shared between the outer document and the iframe, and a
// write from the iframe fires a `storage` event in the outer document — so
// the outer shell can follow along without any postMessage plumbing.
export function applyTheme(doc = document) {
  const dark = (() => {
    try {
      return localStorage.getItem("theme") === "dark";
    } catch {
      return false;
    }
  })();
  // Resolves any `light-dark()` token values in the outer shell's CSS.
  doc.documentElement.style.colorScheme = dark ? "dark" : "light";
  // Parity with the app, which toggles this same class.
  doc.documentElement.classList.toggle("dark", dark);
}

export function installThemeSync() {
  if (typeof window === "undefined") return () => {};
  applyTheme();
  const onStorage = (e) => {
    if (!e || e.key === "theme" || e.key == null) applyTheme();
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}
