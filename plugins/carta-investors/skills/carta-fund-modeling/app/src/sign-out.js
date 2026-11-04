// Ends the Worker session from inside the app. Inside Claude's embedded frame the user has no URL
// bar to open /auth/logout, and the logout page's own redirect would load the home page inside
// this frame, so the app signs out with a fetch and then reloads the outermost window that is on
// this origin (the shell, or the tab itself when the app is not framed). That window comes back
// signed out and shows the sign-in page.
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
  try {
    // The logout page clears the remembered firm with a script; a fetch does not run it, and
    // without this the next sign-in reopens that firm.
    localStorage.removeItem("firm");
  } catch {
    // no localStorage (private mode, blocked in a frame)
  }
  outermostSameOriginWindow().location.replace("/");
}
