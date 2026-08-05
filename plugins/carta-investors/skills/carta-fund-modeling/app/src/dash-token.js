// The /api token arrives once in the launch URL (?t=). Move it to localStorage
// and strip it from the URL so it never reaches the referrer header or analytics;
// localStorage (not sessionStorage) lets other tabs reuse it.
const KEY = "fm_dash_token";

function scrubToken(params) {
  params.delete("t");
  const qs = params.toString();
  const clean = window.location.pathname + (qs ? "?" + qs : "") + window.location.hash;
  window.history.replaceState(null, "", clean);
}

// A network error means offline, not a wrong token — treat it as usable.
async function accepted(token) {
  try {
    const res = await fetch("/api/heartbeat", { headers: { "X-Dash-Token": token } });
    return res.status !== 401;
  } catch {
    return true;
  }
}

export async function resolveDashToken() {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get("t");
  let stored = "";
  try {
    stored = localStorage.getItem(KEY) || "";
  } catch {
    // no localStorage (private mode)
  }

  // fall back from the URL token to the stored one, so a wrong ?t= can't evict it
  for (const token of [fromUrl, stored]) {
    if (!token || !(await accepted(token))) continue;
    try {
      localStorage.setItem(KEY, token);
      if (fromUrl) scrubToken(params); // strip ?t= once a token is trusted
    } catch {
      if (token === fromUrl) return fromUrl; // no localStorage — keep it in the URL
    }
    return token;
  }

  try {
    localStorage.removeItem(KEY); // no valid token — drop any stale stored one
  } catch {
    // ignore
  }
  return ""; // any wrong ?t= stays in the URL, visible
}

// Patch fetch so the existing bare /api calls carry the token, unchanged.
export function installApiAuth(token) {
  if (!token) return;
  const orig = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    if (url.startsWith("/api")) {
      init = { ...init, headers: { ...(init.headers || {}), "X-Dash-Token": token } };
    }
    return orig(input, init);
  };
}
