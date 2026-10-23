// Whether a tab coming back into view is due the work it does then (the snapshot refetch
// in App.jsx, the automatic pull in useAutoPull.js), given when that work last ran: only
// while the tab is visible, and at most once per RESURFACE_REFRESH_MIN_MS, so a flurry of
// tab switches skips the work instead of repeating it.
export const RESURFACE_REFRESH_MIN_MS = 60_000;

export const resurfaceDue = (lastAt) =>
  document.visibilityState === "visible" && Date.now() - lastAt >= RESURFACE_REFRESH_MIN_MS;
