// Ends the Worker session from inside the app. Inside Claude's embedded frame the user has no URL
// bar to open /auth/logout, and the logout redirect would load the signed-out home page inside
// this frame, so the app signs out with a fetch and then reloads the outermost window that is on
// this origin (the shell, or the tab itself when the app is not framed). That window comes back
// signed out and shows the sign-in page. Ported from carta-fund-modeling's own sign-out.js — this
// server only ever hosts one firm (App.jsx's own comment on why its URL firm segment is cosmetic),
// so there is no remembered firm in localStorage to clear here, unlike fund-modeling's version.
function outermostSameOriginWindow() {
  let w = window;
  while (w.parent !== w) {
    try {
      if (w.parent.location.origin !== window.location.origin) break;
    } catch {
      break; // a parent on another origin throws on location access
    }
    w = w.parent;
  }
  return w;
}

export async function signOut() {
  const res = await fetch("/auth/logout", { cache: "no-store" });
  if (!res.ok) throw new Error(`Sign out failed: ${res.status}`);
  outermostSameOriginWindow().location.replace("/");
}
