// ── Carta Law firms: a Home with nothing that needs Fund Admin ──
// Depends on core.js (carta-home.app.js): trackHome(), renderCapabilities(), showPane(),
// tourSectionHidden(), _tourIsOpen(), _tourPaint(), TOUR_CARD_WAIT_MS; app/segment-dashboards.js:
// _segment, _cardState; app/whats-new.js: wnRefresh().
// A firm with NDAs Carta Law has read and no Fund Admin gets NDA prompts, no What's new
// carousel (its items are Fund Admin upsells), no Skill directory (its one legal skill is the
// NDA dashboard, already on the card) and a tour of what is left. Plugin news stays.
const LAW_PROMPTS = [
  { text: "Which of our NDAs expire in the next [[6 months]]?", topics: ["expire"] },
  { text: "Who can't we solicit or contact right now?", topics: ["solicit"] },
  { text: "What law governs most of our NDAs?", topics: ["governing law"] },
  { text: "Show every NDA we've signed with [[counterparty]]", topics: ["counterpart"] },
];
const LAW_SUBTITLE = "Your home base for NDA insights, plugin updates and news.";

// Only a firm Carta says has no Fund Admin: one whose profile doesn't say gets the standard Home.
function isLawOnly() {
  return _segment.profileDone && _segment.fundAdmin === false && _cardState.nda === "data";
}

// Until the profile answers, and then until the NDA card settles for a firm without Fund Admin,
// the firm might be a Carta Law firm, so What's new waits rather than showing a carousel that
// would then disappear.
function lawOnlyUnknown() {
  return !_segment.profileDone || (_segment.fundAdmin === false && _cardState.nda === "loading");
}

// `var`, not `let`: the first "Suggested for you" paint reads it while the page script is
// still loading, before this file's declarations have run.
var _lawOnlyApplied = false;

// The prompts "Suggested for you" pads with.
function capStaticPads() {
  return _lawOnlyApplied ? LAW_PROMPTS : CAP_STATIC_PAD;
}

// The tour leaves out capital activity for a firm without Fund Admin, and the Skill directory
// for a Carta Law firm, whose tab is hidden.
function tourSkipsStep(step) {
  if (step.id === "ca-section-v2") return _segment.fundAdmin === false;
  if (step.id === "tab-btn-directory") return isLawOnly();
  return false;
}

// The subtitle, tab bar and prompts wait, invisible, until Home knows which version to show
// (carta-home.css, body.home-pending), or LAW_WAIT_MS at most.
const LAW_WAIT_MS = TOUR_CARD_WAIT_MS;
const _revealTimer = setTimeout(revealHome, LAW_WAIT_MS);
function revealHome() {
  clearTimeout(_revealTimer);
  document.body.classList.remove("home-pending");
}

// From layoutDashboards, which runs after every change to the profile or a card, before
// anything that can open the tour measures the page. It acts only when the answer changes:
// What's new and the hidden parts are drawn once Home knows which version to show.
var _lawOnlyDecided = null;
function lawOnlySettled() {
  if (lawOnlyUnknown()) return;
  const lawOnly = isLawOnly();
  if (lawOnly === _lawOnlyDecided) return;
  _lawOnlyDecided = lawOnly;
  wnRefresh();
  if (!lawOnly) { revealHome(); return; }
  _lawOnlyApplied = true;
  renderCapabilities(_capRecs);
  const subtitle = document.querySelector(".page-subtitle");
  if (subtitle) subtitle.textContent = LAW_SUBTITLE;
  // The Home pane is the only one left, even if the viewer had opened the Skill directory.
  showPane("recommended");
  // The CSS gives the tab bar display:flex, which the hidden attribute doesn't override.
  const tabs = document.querySelector(".tab-bar");
  if (tabs) tabs.style.display = "none";
  revealHome();
  // Only after a backstop opened the tour early: it drops the steps a Law firm doesn't get, and
  // measures its step again now the tab bar is gone.
  tourSectionHidden("tab-btn-directory");
  tourSectionHidden("whats-new-section");
  if (_tourIsOpen()) _tourPaint();
  trackHome("render", "CartaHome.View.LawOnly");
}
