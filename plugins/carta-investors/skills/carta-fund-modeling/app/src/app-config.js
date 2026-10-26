// What the app may show on the server it runs on. Hosted updates data by reloading the firm
// (reloadFirm), has no chat or shared scenarios, and serves every firm the user can open, so it
// offers a way back to the chooser.
export const FEATURES = {
  local: { updateData: true, reloadFirm: false, askClaude: true, share: true, switchFirm: false, firmsById: false },
  hosted: { updateData: true, reloadFirm: true, askClaude: false, share: false, switchFirm: true, firmsById: true },
};

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
