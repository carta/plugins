// What the app may show on the server it runs on. Hosted updates data by reloading the firm
// (reloadFirm), has no chat, and serves every firm the user can open, so it
// offers a way back to the chooser and a way to sign out (local has no sign-in).
// The Claude panel (PANEL_FEATURES) runs hosted without the user's Carta session, so it can't share.
export const FEATURES = {
  local: { updateData: true, reloadFirm: false, askClaude: true, share: true, switchFirm: false, firmsById: false, signOut: false },
  hosted: { updateData: true, reloadFirm: true, askClaude: false, share: true, switchFirm: true, firmsById: true, signOut: true },
};
export const PANEL_FEATURES = { ...FEATURES.hosted, share: false };

// A local server older than /api/app-config answers 404 and a hosted one always has the route,
// so anything unreadable is local.
export async function loadFeatures() {
  try {
    const res = await fetch("/api/app-config");
    const config = res.ok ? await res.json() : null;
    return FEATURES[config?.mode] ?? FEATURES.local;
  } catch {
    return FEATURES.local;
  }
}
