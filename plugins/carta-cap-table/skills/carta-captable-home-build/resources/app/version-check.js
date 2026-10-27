// A built artifact is frozen and the sandbox sets connect-src 'none', so carta-mcp
// (plugin:get:version) is the only way it can learn a newer build exists.

const PLUGIN = "carta-cap-table";
// Keyed by skill, not plugin: carta-cap-table ships several times a day for changes
// this artifact never sees, which would raise the banner almost daily.
const SKILL = "carta-captable-home-build";
const ARTIFACT_VERSION = "{{ARTIFACT_VERSION}}";
const BUILT_AT = "{{BUILT_AT}}";
// A fresh build is already the newest the user can get. Matches carta-mcp's week-old
// release pick, so after this window the banner names only a release a rebuild reaches.
const QUIET_AFTER_BUILD_DAYS = 7;
// Names the cap table and the company: carta-investors publishes its own "Carta Home",
// and a prompt either page could have written would route to the wrong skill.
const UPDATE_PROMPT = "Rebuild my Carta Home cap table artifact for " + BAKED_COMPANY_NAME;
const UPDATE_INSTRUCTION =
  "To get the latest version, tell Claude to rebuild your Carta Home cap table artifact.";
const DISMISS_KEY = "captableHome.dismissedUpdateVersion";

// Patch is dropped on purpose: interrupting every user for a copy tweak trains them
// to dismiss the banner without reading it.
function parseMajorMinor(v) {
  const m = /^(\d+)\.(\d+)\.\d+$/.exec(String(v || ""));
  return m ? [Number(m[1]), Number(m[2])] : null;
}

// An unparseable stamp counts as fresh: better to miss a banner than to raise a wrong one.
function isFreshBuild(builtAt, now) {
  const built = Date.parse(builtAt);
  if (Number.isNaN(built)) return true;
  return now - built < QUIET_AFTER_BUILD_DAYS * DAY_MS;
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

// Icon + "Copy this prompt", swapping to "✓ Copied" for a beat so the click is
// acknowledged in place rather than by a toast.
const UPDATE_COPY_LABEL = copyIconSvg() + "Copy this prompt";

function copyUpdatePrompt(btn) {
  trackPrompt("CaptableHome.UpdateBanner.Copy", UPDATE_PROMPT, "other");
  copyText(UPDATE_PROMPT, () => {
    btn.textContent = "✓ Copied";
    setTimeout(() => { btn.innerHTML = UPDATE_COPY_LABEL; }, COPIED_TIP_MS);
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
        <p class="ink-banner__title">New version of Carta Home available!</p>
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
  if (isFreshBuild(BUILT_AT, Date.now())) return;
  if (!(await mcpAvailable())) return;
  try {
    const res = await _mcp("read_tool", {
      name: "plugin__get__version",
      arguments: { plugin: PLUGIN, skill: SKILL },
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
