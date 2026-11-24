// ── Widget view: Home drawn inside the chat ──
// Depends on core.js (carta-home.app.js): escHtml(), trackHome(), switchTab(), _tourIsOpen(), tourEnd();
// app/directory-views.js: dirEntitledSkills(); app/law-only-home.js: isLawOnly().
// A host that draws Home inline in the chat calls setHomeWidget(true). The widget keeps the title
// and Your dashboards, names what else Home holds, and opens the full Home at the section picked.
// Its styles key off body.home-widget (carta-home.css, "Widget view"); body.home-was-widget, set for
// the rest of the load once the widget has shown, keeps the tour from opening (tourStart).

// What the full Home holds, in page order. `peek` gets the live page and returns the line's
// preview text, or "" when the section has nothing to show, which leaves the line out.
const WIDGET_SECTIONS = [
  {
    id: "prompts", name: "Suggested for you", target: "prompts-section",
    peek: page => page.prompts ? `${page.prompts} ${page.prompts === 1 ? "prompt" : "prompts"} for your firm` : "",
  },
  { id: "whats-new", name: "What's new", target: "whats-new-section", peek: page => page.whatsNew },
  {
    id: "directory", name: "Skill directory", target: "directory",
    peek: page => page.skills === 1 ? "1 skill" : page.skills ? `${page.skills} skills and microapps` : "",
  },
  { id: "news", name: "News", target: "plugin-news-section", peek: page => page.news },
];

let _homeWidget = false;
let _widgetShownTracked = false;
// The list's markup as last written. The nav sits in the pane the widget watches, so writing the
// same markup again would queue a mutation that schedules another render, and rebuild the buttons
// under a click or keyboard focus.
let _widgetMoreHtml = null;

// The lines to list, from what the page holds now.
function widgetMoreItems(page) {
  return WIDGET_SECTIONS
    .map(section => ({ ...section, text: section.peek(page) || "" }))
    .filter(item => item.text);
}

function _widgetShown(id) {
  const el = document.getElementById(id);
  return !!el && !el.hidden && el.style.display !== "none";
}

function _widgetText(selector) {
  return (document.querySelector(selector)?.textContent || "").trim();
}

function widgetPageSummary() {
  return {
    prompts: document.querySelectorAll("#prompts-section .cap-card").length,
    whatsNew: _widgetShown("whats-new-section")
      ? _widgetText("#whats-new-section .wn-index-item.active .wn-index-text > :first-child") : "",
    // A Law-only Home has no Skill directory.
    skills: isLawOnly() ? 0 : dirEntitledSkills().length,
    news: _widgetText("#plugin-news-section .plugin-news-title"),
  };
}

function renderWidgetMore() {
  const nav = document.getElementById("widget-more");
  if (!nav || !_homeWidget) return;
  const items = widgetMoreItems(widgetPageSummary());
  const html = '<p class="widget-more-label">More in Carta Home</p><ul class="widget-more-list">'
    + items.map(item => `<li><button type="button" onclick="openFullHome('${item.id}')">`
      + `<span class="widget-more-name">${escHtml(item.name)}</span>`
      + `<span class="widget-more-peek">${escHtml(item.text)}</span>`
      + '<span class="widget-more-go" aria-hidden="true">›</span></button></li>').join("")
    + "</ul>";
  if (html === _widgetMoreHtml) return;
  _widgetMoreHtml = html;
  nav.hidden = !items.length;
  nav.innerHTML = html;
}

// Sections fill in as their data arrives, so the list follows the page while the widget is up.
let _widgetMoreTimer = null;
const _widgetObserver = typeof MutationObserver === "function"
  ? new MutationObserver(() => { clearTimeout(_widgetMoreTimer); _widgetMoreTimer = setTimeout(renderWidgetMore, 300); })
  : null;

function setHomeWidget(on) {
  _homeWidget = !!on;
  document.body.classList.toggle("home-widget", _homeWidget);
  // Stays for the rest of the page load: tourStart (carta-home.app.js) reads it and skips the tour.
  if (_homeWidget) document.body.classList.add("home-was-widget");
  const pane = document.getElementById("tab-recommended");
  if (_homeWidget) {
    // The widget hides the sections the tour points at, so a tour already open ends (and counts as seen).
    if (_tourIsOpen()) tourEnd();
    if (pane && _widgetObserver) _widgetObserver.observe(pane, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
    renderWidgetMore();
    if (!_widgetShownTracked) { _widgetShownTracked = true; trackHome("render", "CartaHome.Widget.Shown"); }
  } else {
    if (_widgetObserver) _widgetObserver.disconnect();
    _widgetMoreHtml = null;
  }
}

function scrollHomeTo(id) {
  const section = WIDGET_SECTIONS.find(s => s.id === id);
  if (!section) { window.scrollTo(0, 0); return; }
  if (section.target === "directory") { switchTab("directory"); window.scrollTo(0, 0); return; }
  document.getElementById(section.target)?.scrollIntoView({ block: "start" });
}

// The host gets first say, through a cancelable "carta-home:expand" event: one that can show Home
// full size cancels it, then calls setHomeWidget(false) and scrollHomeTo(section) once it has.
// Without such a host, the widget grows in place.
function openFullHome(id) {
  trackHome("click", "CartaHome.Widget.Open", { value: id });
  const expand = new CustomEvent("carta-home:expand", { cancelable: true, detail: { section: id } });
  if (!window.dispatchEvent(expand)) return;
  setHomeWidget(false);
  scrollHomeTo(id);
}
