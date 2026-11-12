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

async function endSession() {
  const res = await fetch("/auth/logout", { cache: "no-store" });
  if (!res.ok) throw new Error(`Sign out failed: ${res.status}`);
}

export async function signOut() {
  await endSession();
  try {
    // The logout page clears the remembered firm with a script; a fetch does not run it, and
    // without this the next sign-in reopens that firm.
    localStorage.removeItem("firm");
  } catch {
    // no localStorage (private mode, blocked in a frame)
  }
  outermostSameOriginWindow().location.replace("/");
}

// The `action` of the Worker's 401 that asks the user to sign in again.
export const REAUTHENTICATE = "reauthenticate";

/** Whether an /api answer asks the user to sign in again: their session expired, or Fund Modeling couldn't tell who they are. */
export const asksToSignInAgain = (status, body) => status === 401 && body?.action === REAUTHENTICATE;

// Ends the session and reloads the outermost same-origin window where it is, so it comes back to the sign-in page, whose
// link returns to this page and which handles signing in inside Claude's frame. Keeps the remembered firm.
export async function signInAgain() {
  await endSession();
  outermostSameOriginWindow().location.reload();
}
