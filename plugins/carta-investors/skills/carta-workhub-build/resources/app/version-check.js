// ── Update banner: is this artifact behind the published build? ──
// Depends on carta-workhub.app.js: _mcp(), escHtml(), showToast(), trackWorkhub().
//
// A live artifact is a frozen copy of its source — once built into a user's workspace
// nothing can update it in place, and the sandbox sets connect-src 'none' so it cannot
// fetch its own release metadata. carta-mcp reads the published version for us
// (plugin:get:version) and this module compares it against the version stamped in at
// build time.

const PLUGIN = "carta-investors";
// The skill that builds this artifact — carta-mcp keys published versions by skill, not
// by plugin. The plugin's own version moves several times a day for reasons a Carta Workhub
// user never sees, so keying the banner to it would raise one almost daily, forever.
const SKILL = "carta-workhub-build";
const ARTIFACT_VERSION = "{{ARTIFACT_VERSION}}";
const UPDATE_PROMPT = "Rebuild my Carta Workhub artifact";
const UPDATE_INSTRUCTION =
  "To get the latest version, tell Claude to update the Carta Workhub artifact.";
// Keyed per artifact: a shared key would let dismissing one banner silence the other
// as soon as the two artifacts reach the same version number.
const DISMISS_KEY = "cartaWorkhub.dismissedUpdateVersion";

// Parse "1.2.3" into [major, minor]. Patch is deliberately dropped: a patch ships a
// copy tweak or a style nudge, and interrupting every user for that trains them to
// dismiss the banner without reading it.
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

// Web storage works in the Cowork sandbox, but this artifact can also be opened from a
// share link or a future host where it may not — a dismissal that cannot be persisted
// should degrade to "banner returns next load", never to a broken render.
function readDismissed() {
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch (e) {
    return null;
  }
}

function writeDismissed(version) {
  try {
    localStorage.setItem(DISMISS_KEY, version);
  } catch (e) {
    /* dismissal is best-effort */
  }
}

function dismissUpdateBanner(version) {
  trackWorkhub("click", "CartaWorkhub.UpdateBanner.Dismiss");
  writeDismissed(version);
  const slot = document.getElementById("update-banner-slot");
  if (slot) slot.innerHTML = "";
}

// Same affordance as the capabilities cards: icon + "Copy this prompt", swapping to
// "✓ Copied" for a beat so the click is acknowledged in place rather than by a toast.
const COPY_ICON =
  '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" style="margin-right:5px;vertical-align:middle;"><rect x="5" y="5" width="9" height="9" rx="1" stroke="currentColor" stroke-width="1.4"/><path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
const COPY_LABEL = COPY_ICON + "Copy this prompt";

function copyUpdatePrompt(btn) {
  trackWorkhub("click", "CartaWorkhub.UpdateBanner.Copy");
  const done = () => {
    btn.textContent = "✓ Copied";
    setTimeout(() => { btn.innerHTML = COPY_LABEL; }, 2000);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard
      .writeText(UPDATE_PROMPT)
      .then(done)
      .catch(() => showToast("Could not copy to clipboard"));
  } else {
    showToast("Could not copy to clipboard");
  }
}

function renderUpdateBanner(latest, headline) {
  const slot = document.getElementById("update-banner-slot");
  if (!slot) return;
  // The headline is the reason to act, so it leads when we have one — but the
  // instruction always follows it, so the banner never states a change without saying
  // what to do about it. The rebuild runs in a real chat session either way: the skill
  // that assembles this artifact isn't reachable from inside the sandbox.
  const message = headline ? escHtml(headline) + " " + UPDATE_INSTRUCTION : UPDATE_INSTRUCTION;
  slot.innerHTML = `
    <div class="ink-banner ink-banner--info" role="status" id="update-banner">
      <div class="ink-banner__body">
        <p class="ink-banner__title">New version of Carta Workhub available!</p>
        <p class="ink-banner__message">${message}</p>
        <button class="ink-banner__cta ink-banner__cta--icon" id="update-banner-copy">${COPY_LABEL}</button>
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
  trackWorkhub("render", "CartaWorkhub.UpdateBanner.Shown");
}

// Dig the version payload out of whatever shape callMcpTool returns, the same way
// extractUserProfile/extractContextsPayload do — the wrapper varies between a raw
// object, `content[].text`, and `{result:"<json>"}`, so matching on a fixed shape
// silently reads `undefined` and the banner never appears.
function extractVersionPayload(res) {
  // _mcpResultCandidates only walks objects; a transport that hands back the bare JSON
  // string still has to resolve, so parse that case before delegating.
  const candidates = typeof res === "string" ? [tryParse(res)] : _mcpResultCandidates(res);
  for (const c of candidates) {
    if (c && typeof c.version === "string") return c;
  }
  return null;
}

// Silent on every failure path — an artifact that can't reach the manifest shows no
// banner, which is strictly better than showing one the user can't act on.
async function checkForUpdate() {
  try {
    const res = await _mcp("fetch", {
      command: "plugin:get:version",
      params: { plugin: PLUGIN, skill: SKILL },
    });
    // `version` is this skill's. The response also carries `plugin_version`; do not
    // compare against it — it moves for changes that never touch this artifact.
    const payload = extractVersionPayload(res);
    const latest = payload?.version;
    if (!latest || !isUpdateAvailable(ARTIFACT_VERSION, latest)) return;
    // Dismissal is per-version: a newer release re-raises the banner.
    if (readDismissed() === latest) return;
    renderUpdateBanner(latest, payload.headline);
  } catch (e) {
    console.log("[carta-workhub] update check unavailable:", e && e.message);
  }
}

// Started here rather than from the Init block in core.js: the bundle is one script, so
// core.js's init runs before this file's `const`s are initialized and would hit the
// temporal dead zone. Deferred so the check never competes with the first data paint.
setTimeout(checkForUpdate, 0);
