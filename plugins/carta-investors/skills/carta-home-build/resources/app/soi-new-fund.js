// ── SOI card: funds the published Schedule of Investments does not list yet ──
// Depends on core.js (carta-home.app.js): escHtml(), writeClipboard(), custCopyFeedback(),
// CUST_COPY_LABEL, PROMPT_COPIED_TIP, trackHome(), trackPrompt(), PROMPT_SOURCE; on directory-views.js:
// dirShowCopied(), the shared "Copied" popover, which writes the wrapper's data-tip into its
// empty tip only once a copy succeeds; config: SOI_FUND_UUIDS, DASHBOARD_URLS.
//
// The SOI page bakes its fund list in when it is built, and a Home rebuild can keep a
// current SOI page as it is. SOI_FUND_UUIDS is that page's list, stamped in by
// build_artifact.py --soi-page; `null` means unknown, and then no banner shows.

const SOI_NEW_FUND_DISMISS_KEY = "carta-home-soi-new-fund-dismissed-v1";
// Analytics gets this fixed text, never the copied prompt: that names the firm's funds.
const SOI_NEW_FUND_TRACKED_PROMPT = "Update my Schedule of Investments to add new funds";
// Sets dismissed this page load, so dismissal sticks even where localStorage throws.
const soiNewFundDismissedKeys = new Set();
// Key of the set last reported as shown, so a re-render of the same set is not reported again.
let soiNewFundShownKey = null;

// Rows (FUND_UUID, FUND_NAME) the SOI page does not know about, or [] when there is no SOI page
// link or its fund list is unknown.
function soiMissingFunds(rows, soiUuids, soiUrl) {
  if (!Array.isArray(soiUuids) || typeof soiUrl !== "string" || !/^https?:\/\//.test(soiUrl)) return [];
  const listed = new Set(soiUuids);
  const seen = new Set();
  return (rows || []).filter(r => {
    const id = r && r.FUND_UUID;
    if (!id || listed.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function soiNewFundKey(missing) {
  return JSON.stringify(missing.map(r => r.FUND_UUID).sort());
}

function soiNewFundNames(missing) {
  const names = missing.map(r => r.FUND_NAME || "Fund");
  return names.length < 2 ? names.join("") : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
}

// [headline, prompt] for the banner.
function soiNewFundCopy(missing) {
  const names = soiNewFundNames(missing);
  const headline = missing.length === 1 ? "Add " + names + " to this schedule" : "Add " + missing.length + " new funds to this schedule";
  return [headline, "Update my Schedule of Investments to add " + names];
}

function soiNewFundDismissed(key) {
  if (soiNewFundDismissedKeys.has(key)) return true;
  try { return localStorage.getItem(SOI_NEW_FUND_DISMISS_KEY) === key; } catch (e) { return false; }
}

function renderSoiNewFund(rows) {
  const slot = document.getElementById("soi-new-fund-slot");
  if (!slot) return;
  const missing = soiMissingFunds(rows, SOI_FUND_UUIDS, DASHBOARD_URLS.soi);
  const key = soiNewFundKey(missing);
  if (!missing.length || soiNewFundDismissed(key)) { slot.innerHTML = ""; return; }
  const [headline, prompt] = soiNewFundCopy(missing);
  slot.innerHTML =
    `<div class="soi-new-fund" data-key="${escHtml(key)}">` +
      `<span class="soi-new-fund-text">${escHtml(headline)}</span>` +
      `<span class="soi-new-fund-copy" data-tip="${escHtml(PROMPT_COPIED_TIP)}">` +
        `<button class="cust-copy-btn" data-prompt="${escHtml(prompt)}" onclick="copySoiNewFund(this)">${CUST_COPY_LABEL}</button>` +
        `<span class="cap-copied-tip" role="status"></span>` +
      `</span>` +
      `<button class="soi-new-fund-dismiss" aria-label="Dismiss new fund notice" onclick="dismissSoiNewFund(this)"><span aria-hidden="true">✕</span></button>` +
    `</div>`;
  if (key === soiNewFundShownKey) return;
  soiNewFundShownKey = key;
  trackHome("render", "CartaHome.SOI.NewFund.Shown");
}

function copySoiNewFund(btn) {
  const text = btn.dataset.prompt || "";
  trackPrompt("CartaHome.SOI.NewFund.Copy", SOI_NEW_FUND_TRACKED_PROMPT, PROMPT_SOURCE.DASHBOARD, { skill: "carta-soi" });
  // Copying is acting on the banner, so it stays hidden for this set like a dismissal.
  soiNewFundForget(btn);
  writeClipboard(text, () => {
    custCopyFeedback(btn);
    dirShowCopied(btn.parentElement);
  });
}

// Remember the banner's missing-fund set so it stays hidden until a different set is
// missing; returns the banner.
function soiNewFundForget(btn) {
  const banner = btn.closest(".soi-new-fund");
  soiNewFundDismissedKeys.add(banner.dataset.key);
  try { localStorage.setItem(SOI_NEW_FUND_DISMISS_KEY, banner.dataset.key); } catch (e) { /* sandboxed storage */ }
  return banner;
}

function dismissSoiNewFund(btn) {
  trackHome("click", "CartaHome.SOI.NewFund.Dismiss");
  soiNewFundForget(btn).remove();
}
