// A built artifact is frozen and the sandbox sets connect-src 'none', so carta-mcp
// (plugin:get:version) is the only way it can learn a newer build exists.

const PLUGIN = "carta-cap-table";
// Keyed by skill, not plugin: carta-cap-table ships several times a day for changes
// this artifact never sees, which would raise the banner almost daily.
const SKILL = "carta-captable-home-build";
const ARTIFACT_VERSION = "{{ARTIFACT_VERSION}}";
const UPDATE_PROMPT = "Rebuild my Cap Table Home artifact";
const UPDATE_INSTRUCTION =
  "To get the latest version, tell Claude to update the Cap Table Home artifact.";
const DISMISS_KEY = "captableHome.dismissedUpdateVersion";

// Patch is dropped on purpose: interrupting every user for a copy tweak trains them
// to dismiss the banner without reading it.
function parseMajorMinor(v) {
  const m = /^(\d+)\.(\d+)\.\d+$/.exec(String(v || ""));
  return m ? [Number(m[1]), Number(m[2])] : null;
}

function isUpdateAvailable(current, latest) {
  const c = parseMajorMinor(current);
  const l = parseMajorMinor(latest);
  if (!c || !l) return false;                 // unparseable either side → say nothing
  if (l[0] !== c[0]) return l[0] > c[0];
  return l[1] > c[1];
}

// A share-link host may have no web storage — dismissal degrades to "banner returns
// next load", never to a broken render.
function readDismissedVersion() {
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch (e) {
    return null;
  }
}

function dismissUpdateBanner(version) {
  trackHome("click", "CaptableHome.UpdateBanner.Dismiss");
  try { localStorage.setItem(DISMISS_KEY, version); } catch (e) { /* best-effort */ }
  const slot = document.getElementById("update-banner-slot");
  if (slot) slot.innerHTML = "";
}

const UPDATE_COPY_ICON =
  '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" style="margin-right:5px;vertical-align:middle;"><rect x="5" y="5" width="9" height="9" rx="1" stroke="currentColor" stroke-width="1.4"/><path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
const UPDATE_COPY_LABEL = UPDATE_COPY_ICON + "Copy this prompt";

function copyUpdatePrompt(btn) {
  trackHome("click", "CaptableHome.UpdateBanner.Copy");
  copyText(UPDATE_PROMPT, () => {
    btn.textContent = "✓ Copied";
    setTimeout(() => { btn.innerHTML = UPDATE_COPY_LABEL; }, 2000);
  });
}

function renderUpdateBanner(latest, headline) {
  const slot = document.getElementById("update-banner-slot");
  if (!slot) return;
  // The instruction always follows the headline, so the banner never reports a change
  // without saying what to do about it.
  const message = headline ? escHtml(headline) + " " + UPDATE_INSTRUCTION : UPDATE_INSTRUCTION;
  slot.innerHTML = `
    <div class="ink-banner ink-banner--info" role="status" id="update-banner">
      <div class="ink-banner__body">
        <p class="ink-banner__title">New version of Cap Table Home available!</p>
        <p class="ink-banner__message">${message}</p>
        <button class="ink-banner__cta ink-banner__cta--icon" id="update-banner-copy">${UPDATE_COPY_LABEL}</button>
      </div>
      <button class="ink-banner__dismiss" id="update-banner-dismiss" aria-label="Dismiss">
        <svg viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M1.5 1.5L12.5 12.5M12.5 1.5L1.5 12.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
    </div>`;
  const copyBtn = document.getElementById("update-banner-copy");
  copyBtn.addEventListener("click", () => copyUpdatePrompt(copyBtn));
  document
    .getElementById("update-banner-dismiss")
    .addEventListener("click", () => dismissUpdateBanner(latest));
  trackHome("render", "CaptableHome.UpdateBanner.Shown");
}

// Matching one fixed response shape reads `undefined` and the banner silently never
// fires, so walk the same candidates every card fetch does.
function extractVersionPayload(res) {
  const candidates = typeof res === "string" ? [tryParse(res)] : _mcpResultCandidates(res);
  for (const c of candidates) {
    if (c && typeof c.version === "string") return c;
  }
  return null;
}

// Silent on every failure: no banner beats a banner the user cannot act on.
async function checkForUpdate() {
  if (!(await mcpAvailable())) return;
  try {
    const res = await _mcp("fetch", {
      command: "plugin:get:version",
      params: { plugin: PLUGIN, skill: SKILL },
    });
    const payload = extractVersionPayload(res);
    // The response also carries `plugin_version` — never compare against it.
    const latest = payload?.version;
    if (!latest || !isUpdateAvailable(ARTIFACT_VERSION, latest)) return;
    if (readDismissedVersion() === latest) return;  // per-version: a newer one re-raises
    renderUpdateBanner(latest, payload.headline);
  } catch (e) {
    console.log("[captable-home] update check unavailable:", e && e.message);
  }
}

// Deferred so the check never competes with the first data paint.
setTimeout(checkForUpdate, 0);
