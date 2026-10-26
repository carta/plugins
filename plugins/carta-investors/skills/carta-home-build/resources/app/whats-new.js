// ── What's new: a carousel of featured microapps and recently launched skills ──
// Depends on core.js (carta-home.app.js): _mcp(), _mcpResultCandidates(), readProductFlag(),
// escHtml(), writeClipboard(), trackHome(), trackPrompt(), PROMPT_SOURCE, promptTag(), prefersReducedMotion(),
// PROMPT_TAGS, _directorySkills, APP_TAG_TIP, COPIED_TIP_MS, PROMPT_COPIED_TIP; on carta-home.config.js:
// WHATS_NEW_MICROAPPS, WHATS_NEW_SKILL_OUTPUTS.

// A skill prompt qualifies when its goLiveDate is within the last WHATS_NEW_WINDOW_DAYS
// (and not in the future). 60 days is about two release cycles: long enough that a
// skill launched just before a user's vacation is still new when they return, short
// enough that the row turns over instead of becoming a second skill directory.
// Raise it if the row is often empty, lower it if launches are frequent.
const WHATS_NEW_WINDOW_DAYS = 60;
// The carousel holds WHATS_NEW_SLOTS items. WHATS_NEW_MAX skills (selectWhatsNew) take
// slots; the featured microapps take the rest.
const WHATS_NEW_SLOTS = 4;
const WHATS_NEW_MAX = 1;
// renderWhatsNew hands both to carta-home.css as --wn-rotate and --wn-fade-out.
const WHATS_NEW_ROTATE_MS = 5000;
const WHATS_NEW_FADE_OUT_MS = 180;

// Which plugin labels (pluginPrompt.plugin) the user may see. Mirrors carta-mcp's
// product_visibility RULES — the same gate that decides which tools a user is shown:
//   "Investors Plugin" -> any fund-admin-family flag is true
//                         (has_fund_admin, has_investment_firm, has_tactyc, has_active_manco)
//   "Cap Table Plugin" -> has_cap_table is true
// Strict by design: a flag that is false, null (unknown) or missing denies, unlike
// the Skill Directory's "unknown shows" rule, because a "new skill" card for a
// product the user cannot use is a dead end, while a missing card costs nothing.
// An unrecognised plugin label is denied for the same reason.
function whatsNewPluginAccess(profile) {
  const p = profile || {};
  const anyTrue = keys => keys.some(k => readProductFlag(p, k) === true);
  return {
    "investors plugin": anyTrue(["has_fund_admin", "has_investment_firm", "has_tactyc", "has_active_manco"]),
    "cap table plugin": anyTrue(["has_cap_table"]),
  };
}

// A Contentful entry names its skill ("carta-tear-sheets", sometimes plugin-qualified);
// the Skill Directory entry for it, if any, carries its display name and category.
const whatsNewSkillId = entry => String((entry && entry.skill) || "").split(":").pop();
function directoryEntry(skillId) {
  return (Array.isArray(_directorySkills) ? _directorySkills : []).find(s => s.skill === skillId);
}

// The Skill Directory's `"whatsNew": false` keeps a skill out of the carousel, however new
// its Contentful entry, and so does being a featured microapp's own skill: the product is
// already in the carousel. Any other skill the directory doesn't list, or lists without the
// field, stays eligible.
const FEATURED_SKILLS = new Set(WHATS_NEW_MICROAPPS.map(m => m.skill));
function featuredInWhatsNew(entry) {
  const id = whatsNewSkillId(entry);
  const known = directoryEntry(id);
  return !FEATURED_SKILLS.has(id) && !(known && known.whatsNew === false);
}

// What a Contentful entry's skill hands back (see WHATS_NEW_SKILL_OUTPUTS).
function whatsNewOutput(entry) {
  const id = whatsNewSkillId(entry);
  const known = directoryEntry(id);
  return skillOutputKind(id, known && known.category);
}

// A skill that hands back something to look at makes the better showcase, so those lead.
const WHATS_NEW_VISUAL_OUTPUTS = ["deck", "document", "spreadsheet"];

// Pure ordering: skills with a visual result first, then the rest; newest first within
// each group. `outputOf(item)` names an item's output kind.
function rankWhatsNew(items, outputOf) {
  const group = it => (WHATS_NEW_VISUAL_OUTPUTS.includes(outputOf(it)) ? 0 : 1);
  return [...items].sort((a, b) => group(a) - group(b) || Date.parse(b.goLiveDate) - Date.parse(a.goLiveDate));
}

// Pure selection over the Skill Directory: window -> access -> not marked off -> visual
// first, newest first -> not already shown above -> cap.
//   items:   [{text, plugin, goLiveDate, skill}] from _listWhatsNewPrompts
//   access:  whatsNewPluginAccess() result
//   exclude: prompts already on screen in "Suggested for you"
function selectWhatsNew(items, access, exclude, now = Date.now(), max = WHATS_NEW_MAX) {
  const norm = t => String(t || "").trim().toLowerCase().replace(/\s+/g, " ");
  const windowStart = now - WHATS_NEW_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const seen = new Set((Array.isArray(exclude) ? exclude : []).map(norm));
  const out = [];
  const eligible = (Array.isArray(items) ? items : []).filter(it => {
    const ts = Date.parse(it && it.goLiveDate);
    return it && it.text && Number.isFinite(ts) && ts >= windowStart && ts <= now
      && !!(access || {})[norm(it.plugin)] && featuredInWhatsNew(it);
  });
  for (const it of rankWhatsNew(eligible, whatsNewOutput)) {
    if (out.length >= max) break;
    const key = norm(it.text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

// Product facts get_current_user doesn't carry, which Home looks up itself once the firm
// is known (see resolveDataCollection). Until one is known, a microapp it unlocks stays out
// of the carousel: shown locked it would upsell a firm that may already have the product,
// shown open it would flash a set-up that may lead nowhere.
const WHATS_NEW_DERIVED_FLAGS = ["has_data_collection"];
const isDerivedFlag = key => WHATS_NEW_DERIVED_FLAGS.includes(key);

// The web app host for each Carta environment, matched by prefix so `preproduction` takes
// the `preprod` row. Source: carta-valuations-workflow/references/deep-link.md, which takes
// them from `carta config list-envs`. Never get_current_user's `base_url`: that is the API
// host (`https://test.carta.rocks` on test, the API gateway, with no web app behind it).
// `local` is left out because it can be either the test web app or localhost.
const CARTA_APP_HOSTS = [
  ["production", "https://app.carta.com"],
  ["preprod", "https://app.preprod.carta.rocks"],
  ["sandbox", "https://app.sandbox.carta.team"],
  ["demo", "https://app.demo.carta.team"],
  ["test", "https://app.test.carta.rocks"],
];

// The web app host for get_current_user's `environment`, or null when no row matches.
function cartaAppHost(environment) {
  const env = typeof environment === "string" ? environment.trim().toLowerCase() : "";
  const row = env ? CARTA_APP_HOSTS.find(([name]) => env.startsWith(name)) : null;
  return row ? row[1] : null;
}

// Where a locked microapp's label leads, or null for a plain label. `unlockPath` is a page
// in the viewer's own Carta, used once the app host (cartaAppHost of get_current_user's
// `environment`) and the firm's organization pk (resolveDataCollection) are both known;
// until then, `unlockUrl`, the carta.com demo page, tagged
// `utm_campaign=carta-home-whatsnew-<key>` so Marketing can attribute the visit to Carta
// Home and the microapp.
function unlockHref(m, appHost, organizationPk) {
  if (m.unlockPath && appHost && organizationPk) {
    return appHost + m.unlockPath.replace("{organization_pk}", encodeURIComponent(organizationPk));
  }
  if (!m.unlockUrl) return null;
  const sep = m.unlockUrl.includes("?") ? "&" : "?";
  return `${m.unlockUrl}${sep}utm_campaign=carta-home-whatsnew-${encodeURIComponent(m.key)}`;
}

// A microapp is unlocked only when its product flag is true: a "Set up" button for a
// product the firm doesn't have leads nowhere, while a locked item still says what
// the product would add. Unlocked items lead.
function showcaseMicroapps(profile, organizationPk = _wn.organizationPk) {
  const p = profile || {};
  const known = m => !isDerivedFlag(m.unlockedBy) || readProductFlag(p, m.unlockedBy) !== null;
  const items = WHATS_NEW_MICROAPPS.filter(known).map(m => {
    const locked = readProductFlag(p, m.unlockedBy) !== true;
    return {
      ...m, kind: "microapp", locked,
      href: locked ? unlockHref(m, cartaAppHost(p.environment), organizationPk) : null,
      copyText: "/" + m.skill, copyLabel: "/" + m.skill, copiedTip: "Copied. Paste into the chat in the Claude Code tab.",
    };
  });
  return [...items.filter(m => !m.locked), ...items.filter(m => m.locked)];
}

// A skill unknown to the Skill Directory is named by its prompt's category. A skill with
// `whatsNewCopy` in the directory leads with that outcome headline and body; otherwise the
// headline is its prompt, quoted, over a stock line.
function showcaseSkill(entry) {
  const id = whatsNewSkillId(entry);
  const known = directoryEntry(id);
  const copy = known && known.whatsNewCopy;
  return {
    kind: "skill",
    key: "skill-" + (id || entry.text),
    title: known ? known.name : PROMPT_TAGS[promptTag(entry.text)].label + " skill",
    headline: copy ? copy.headline : "“" + entry.text + "”",
    description: copy ? copy.body : "A new skill for Claude. Copy the prompt, paste it into chat, and Claude runs it on your Carta data.",
    prompt: entry.text,
    copyText: entry.text, copyLabel: "the prompt", copiedTip: PROMPT_COPIED_TIP,
    output: whatsNewOutput(entry),
  };
}

function skillOutputKind(skillId, category) {
  return WHATS_NEW_SKILL_OUTPUTS.bySkill[skillId] || WHATS_NEW_SKILL_OUTPUTS.byCategory[category] || "funds";
}

// Open microapps lead, then the WHATS_NEW_MAX skills selectWhatsNew picks, then locked microapps, up to
// WHATS_NEW_SLOTS. A qualifying skill takes a slot, so the last item in that order waits.
function selectShowcaseItems(profile, entries, shownAbove, now = Date.now()) {
  const skills = selectWhatsNew(entries, whatsNewPluginAccess(profile), shownAbove, now).map(showcaseSkill);
  const apps = showcaseMicroapps(profile);
  const open = apps.filter(m => !m.locked).slice(0, WHATS_NEW_SLOTS - skills.length);
  return [...open, ...skills, ...apps.filter(m => m.locked)].slice(0, WHATS_NEW_SLOTS);
}

// ── Carousel ──
// Rotation pauses while the pointer is over the carousel or focus is inside it, and stops
// for good once the viewer picks an item themselves.
// `last` is the latest renderWhatsNew call, so a derived flag that resolves later, or the
// published Skill Directory, can re-render with it (wnRefresh); `derived` holds those flags (true/false, null when the lookup failed).
// `organizationPk` is the firm's organization account, once resolveDataCollection settles on one.
const _wn = { items: [], active: 0, rotateTimer: null, fadeTimer: null, hovered: false, focused: false, stopped: false, minHeight: 0, last: null, derived: {}, organizationPk: null };

function renderWhatsNew(profile, entries, shownAbove) {
  const section = document.getElementById("whats-new-section");
  if (!section) return;
  _wn.last = { profile, entries, shownAbove };
  // With no product flag known, show nothing rather than upsell a paying customer. Only
  // get_current_user's own flags count: a derived flag alone doesn't say what the firm has.
  const real = profile || {};
  if (!WHATS_NEW_MICROAPPS.some(m => !isDerivedFlag(m.unlockedBy) && readProductFlag(real, m.unlockedBy) !== null)) return;
  const items = selectShowcaseItems({ ...real, ..._wn.derived }, entries, shownAbove);
  // Keyed, so an item that arrives late (a skill, a derived flag's microapp) never moves
  // the viewer off the item they are looking at.
  const activeKey = _wn.items[_wn.active]?.key;
  _wn.items = items;
  _wn.active = Math.max(0, items.findIndex(it => it.key === activeKey));
  section.hidden = false;
  const carousel = document.getElementById("wn-carousel");
  if (carousel) {
    carousel.style.setProperty("--wn-rotate", `${WHATS_NEW_ROTATE_MS}ms`);
    carousel.style.setProperty("--wn-fade-out", `${WHATS_NEW_FADE_OUT_MS}ms`);
  }
  _wnRenderIndex();
  _wnRenderPanel();
  _wnRestartTimer();
}

// ── Data Collection: unlocks Portfolio Analytics ──
// get_current_user has no Data Collection flag, so ask Carta: list_accounts finds the
// firm's organization account ("organization_pk:<n>"), and that one organization's Data
// Collection settings say whether the product is on. The organization is the account named
// exactly like the firm, or else the only candidate; `onOrganization` hears its pk, or null
// when the matches leave it ambiguous. Resolves true or false once Carta answers (false too
// when the firm has no organization account), or null when it couldn't be asked or settled:
// the connector is down, a call threw or errored, the reply was unreadable, or the
// organization is ambiguous. Unknown, never deny.
const ORG_PK_PREFIX = "organization_pk:";
const orgPk = a => a.id.slice(ORG_PK_PREFIX.length);

// The first object in an MCP result, or in its `result` wrapper, that passes `test`.
// _mcpResultCandidates is shared and reads only `structuredContent`, so the snake-case
// `structured_content` that carta-mcp sends is read here.
function _wnPayload(res, test) {
  if (!res || res.isError) return null;
  const cands = [..._mcpResultCandidates(res), ..._mcpResultCandidates({ payload: res.structured_content })];
  for (const c of cands) {
    for (const o of [c, c && c.result]) if (o && typeof o === "object" && test(o)) return o;
  }
  return null;
}

// An error reply that says the settings were not found.
const _wnIs404 = res => (Array.isArray(res.content) ? res.content : [])
  .some(c => c && typeof c.text === "string" && /\b404\b/.test(c.text));

async function resolveDataCollection(firmName, onOrganization = () => {}) {
  try {
    const found = _wnPayload(await _mcp("list_accounts", { search: firmName }), o => Array.isArray(o.accounts));
    if (!found) return null;
    // The search is fuzzy, so an account named exactly like the firm wins; corporations
    // (portfolio companies) are never the firm.
    const name = String(firmName || "").trim().toLowerCase();
    const orgs = found.accounts.filter(a => a && typeof a.id === "string" && a.id.startsWith(ORG_PK_PREFIX));
    const exact = orgs.filter(a => String(a.name || "").trim().toLowerCase() === name);
    const candidates = exact.length ? exact : orgs;
    const org = candidates.length === 1 ? candidates[0] : null;
    onOrganization(org ? orgPk(org) : null);
    if (!orgs.length) return false;
    if (!org) return null;
    const res = await _mcp("call_tool", {
      name: "data_collection__get__firm_settings",
      arguments: { organization_pk: orgPk(org) },
    });
    // Only a 404 counts as off; any other error (a refusal, an outage, re-auth) is unknown,
    // and so is a reply that carries no Data Collection setting.
    if (res && res.isError) return _wnIs404(res) ? false : null;
    const settings = _wnPayload(res, o => "data_collection_enabled" in o);
    return settings ? settings.data_collection_enabled === true : null;
  } catch (e) {
    console.error("[carta-home] Data Collection check failed — Portfolio Analytics stays out of What's new", e);
    return null;
  }
}

// Re-render What's new from its latest inputs, if it has been asked to render: called when
// a derived flag settles or skill-directory.js swaps in the published Skill Directory.
function wnRefresh() {
  if (_wn.last) renderWhatsNew(_wn.last.profile, _wn.last.entries, _wn.last.shownAbove);
}

// Record the firm's Data Collection setting and re-render so Portfolio Analytics takes its slot.
function wnSetDataCollection(value) {
  _wn.derived.has_data_collection = typeof value === "boolean" ? value : null;
  wnRefresh();
}

// Called by fetchLiveData once the firm is resolved and set as the context. The org pk is
// only kept here: wnSetDataCollection's re-render follows and picks it up for ManCo's link.
function wnCheckDataCollection(firmName) {
  return resolveDataCollection(firmName, pk => { _wn.organizationPk = pk || null; }).then(wnSetDataCollection);
}

function _wnRenderIndex() {
  const list = document.getElementById("wn-index-items");
  if (!list) return;
  // Rewriting the list drops the focus inside it; hand it to the active item.
  const hadFocus = list.contains(document.activeElement);
  list.innerHTML = _wn.items.map((it, i) => `
    <button class="wn-index-item${i === _wn.active ? " active" : ""}" role="tab"
            aria-selected="${i === _wn.active}" onclick="wnSelect(${i})">
      ${i === _wn.active ? '<span class="wn-timer"></span>' : ""}
      <span class="wn-index-num">${String(i + 1).padStart(2, "0")}</span>
      <span class="wn-index-text">
        <span class="wn-index-title">${escHtml(it.title)}</span>
        <span class="wn-index-kind">${it.kind === "microapp" ? "Microapp" : "Skill"}</span>
      </span>
    </button>`).join("");
  if (hadFocus) list.children[_wn.active]?.focus();
}

function _wnPanelHtml(it) {
  const lockSvg = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" stroke-width="1.4"/></svg>';
  let cta;
  if (it.kind === "skill") {
    cta = `<button class="wn-cta" onclick="wnCopy(this)">Try it out <span class="cta-arrow" aria-hidden="true">→</span></button>`;
  } else if (it.locked && it.href) {
    cta = `<a class="wn-locked" href="${escHtml(it.href)}" target="_blank" rel="noopener"
             onclick="trackHome('click','CartaHome.WhatsNew.Unlock.${escHtml(it.key)}')">${lockSvg}${escHtml(it.lockedLabel)} <span class="cta-arrow" aria-hidden="true">→</span></a>`;
  } else if (it.locked) {
    // Nowhere to send the viewer: the label still says what unlocks it.
    cta = `<span class="wn-locked wn-locked--plain">${lockSvg}${escHtml(it.lockedLabel)}</span>`;
  } else {
    cta = `<button class="wn-cta" onclick="wnCopy(this)">Set up in Claude Code <span class="cta-arrow" aria-hidden="true">→</span></button>`;
  }
  const help = it.kind === "microapp" ? `
      <span class="wn-help">
        <button class="wn-help-btn" aria-expanded="false" onclick="wnToggleHelp(this, event)">What's a microapp?</button>
        <span class="wn-popover" role="dialog" aria-label="What's a microapp?" hidden>
          <span class="wn-popover-head">What's a microapp?<button class="wn-popover-close" aria-label="Close" onclick="wnToggleHelp(this.closest('.wn-help').querySelector('.wn-help-btn'), event)">×</button></span>
          <span class="wn-popover-body">${escHtml(APP_TAG_TIP)}</span>
        </span>
      </span>` : "";
  return `
    <span class="wn-chip">${escHtml(it.title)}</span>
    <p class="wn-headline">${escHtml(it.headline)}</p>
    <p class="wn-desc">${escHtml(it.description)}</p>
    <div class="wn-ctas">${cta}${help}
      <span class="wn-copied-tip" role="status">${escHtml(it.copiedTip)}</span>
    </div>`;
}

function _wnPreviewHtml(it) {
  const body = it.kind === "skill" ? skillPreviewHtml(it) : WHATS_NEW_PREVIEWS[it.preview];
  // A locked preview is only a picture: nothing to copy.
  return it.locked ? body : `<button class="wn-preview-btn" aria-label="Copy ${escHtml(it.copyLabel)}" onclick="wnCopy(this)">${body}</button>
    <span class="wn-copied-tip wn-copied-tip--preview" role="status">${escHtml(it.copiedTip)}</span>`;
}

function _wnRenderPanel() {
  const center = document.getElementById("wn-center");
  const preview = document.getElementById("wn-preview");
  const carousel = document.getElementById("wn-carousel");
  const it = _wn.items[_wn.active];
  if (!center || !preview || !it) return;
  // Rewriting a panel drops the focus inside it; hand it to the new item's first control.
  const focusIn = [center, preview].find(el => el.contains(document.activeElement));
  center.innerHTML = _wnPanelHtml(it);
  preview.innerHTML = _wnPreviewHtml(it);
  if (focusIn) (focusIn.querySelector("button, a") || center.querySelector("button, a"))?.focus();
  // Hold the tallest height seen so the box doesn't jump as items rotate.
  if (carousel && carousel.offsetHeight > _wn.minHeight) {
    _wn.minHeight = carousel.offsetHeight;
    carousel.style.minHeight = _wn.minHeight + "px";
  }
}

// A viewer's own pick stops the rotation for good, so it never moves them along.
function wnSelect(i, fromUser = true) {
  if (fromUser && !_wn.stopped) {
    _wn.stopped = true;
    _wnRestartTimer();
  }
  if (i === _wn.active || !_wn.items[i]) return;
  if (fromUser) trackHome("click", "CartaHome.WhatsNew.Select." + _wn.items[i].key);
  _wn.active = i;
  _wnRenderIndex();
  const carousel = document.getElementById("wn-carousel");
  clearTimeout(_wn.fadeTimer);
  if (!carousel || prefersReducedMotion()) {
    _wnRenderPanel();
  } else {
    carousel.classList.add("wn-fading");
    _wn.fadeTimer = setTimeout(() => {
      _wnRenderPanel();
      carousel.classList.remove("wn-fading");
    }, WHATS_NEW_FADE_OUT_MS);
  }
}

function _wnRestartTimer() {
  clearInterval(_wn.rotateTimer);
  _wn.rotateTimer = null;
  const carousel = document.getElementById("wn-carousel");
  const rotates = _wn.items.length > 1 && !prefersReducedMotion() && !_wn.stopped;
  if (carousel) carousel.classList.toggle("wn-rotating", rotates);
  if (!rotates || _wn.hovered || _wn.focused) return;
  _wnRenderIndex(); // a fresh timer bar starts its fill from the top
  _wn.rotateTimer = setInterval(() => wnSelect((_wn.active + 1) % _wn.items.length, false), WHATS_NEW_ROTATE_MS);
}

// `why` is "hovered" (pointer over the carousel) or "focused" (keyboard focus inside it).
function wnPause(why, paused) {
  if (_wn[why] === paused) return;
  _wn[why] = paused;
  const carousel = document.getElementById("wn-carousel");
  const held = _wn.hovered || _wn.focused;
  if (carousel) carousel.classList.toggle("wn-paused", held);
  if (held) clearInterval(_wn.rotateTimer);
  else _wnRestartTimer();
}

// One handler for every copy affordance in the panel: a microapp copies its set-up
// command, a skill its prompt. The confirmation is the tip beside whatever was clicked.
function wnCopy(btn) {
  const it = _wn.items[_wn.active];
  if (!it) return;
  // Each copy carries mcp_prompt: a skill's prompt comes from Contentful, a microapp's
  // set-up command is fixed config. `rank` is the item's zero-based place in the carousel.
  const id = "CartaHome.WhatsNew.Copy." + it.key;
  if (it.kind === "skill") trackPrompt(id, it.copyText, PROMPT_SOURCE.CONTENTFUL, { rank: _wn.active });
  else trackPrompt(id, it.copyText, PROMPT_SOURCE.STATIC);
  const tip = btn.parentElement.querySelector(".wn-copied-tip");
  writeClipboard(it.copyText, () => {
    if (!tip) return;
    tip.classList.add("show");
    clearTimeout(tip._timer);
    tip._timer = setTimeout(() => tip.classList.remove("show"), COPIED_TIP_MS);
  });
}

function wnToggleHelp(btn, event) {
  event.stopPropagation();
  const pop = btn.closest(".wn-help").querySelector(".wn-popover");
  const open = pop.hidden;
  pop.hidden = !open;
  btn.setAttribute("aria-expanded", String(open));
}

document.addEventListener("click", e => {
  document.querySelectorAll(".wn-popover:not([hidden])").forEach(pop => {
    if (!pop.contains(e.target)) wnToggleHelp(pop.closest(".wn-help").querySelector(".wn-help-btn"), e);
  });
});
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  document.querySelectorAll(".wn-popover:not([hidden])").forEach(pop =>
    wnToggleHelp(pop.closest(".wn-help").querySelector(".wn-help-btn"), e));
});

// ── Previews: static, decorative mockups of each microapp and new skill (styles: .wn-prev-* in carta-home.css) ──

// The frame every preview shares: a title and subtitle beside the PREVIEW chip, then
// the body. Microapp previews add the app's side rail.
function frame(title, sub, body, { rail = false } = {}) {
  return `<div class="wn-prev${rail ? "" : " wn-prev--out"}" aria-hidden="true">${rail ? `
  <div class="wn-prev-rail">
    <div class="wn-prev-rail-logo"></div>
    <div class="wn-prev-rail-item wn-prev-rail-item--active"></div>
    <div class="wn-prev-rail-item"></div>
    <div class="wn-prev-rail-item wn-prev-rail-item--dim"></div>
  </div>` : ""}
  <div class="wn-prev-body">
    <div class="wn-prev-head">
      <div class="wn-prev-titles">
        <span class="wn-prev-title">${title}</span>
        <span class="wn-prev-sub">${sub}</span>
      </div>
      <span class="wn-prev-chip">PREVIEW</span>
    </div>
    ${body}
  </div>
</div>`;
}

const WHATS_NEW_PREVIEWS = {
  fundModeling: frame("Beaver Financial Corp.", "Scenario: Upside", `<div class="wn-prev-tabs">
      <span class="wn-prev-tab wn-prev-tab--active">Scenario inputs</span>
      <span class="wn-prev-tab">Positions</span>
      <span class="wn-prev-tab">Cap table</span>
    </div>
    <div class="wn-prev-fm-grid">
      <div class="wn-prev-fm-inputs">
        <span class="wn-prev-label wn-prev-label--link">MOIC &#8964;</span>
        <span class="wn-prev-metric">23.40&times;</span>
        <div class="wn-prev-slider">
          <div class="wn-prev-slider-fill" style="width:22%"></div>
          <div class="wn-prev-slider-thumb" style="left:calc(22% - 3px)"></div>
        </div>
        <span class="wn-prev-label wn-prev-label--spaced">Expected future dilution</span>
        <span class="wn-prev-metric wn-prev-metric--sm">0%</span>
        <div class="wn-prev-slider">
          <div class="wn-prev-slider-fill" style="width:2%"></div>
          <div class="wn-prev-slider-thumb" style="left:calc(2% - 3px)"></div>
        </div>
      </div>
      <div class="wn-prev-impact">
        <span class="wn-prev-panel-title">Company impact</span>
        <div class="wn-prev-impact-row"><div class="wn-prev-bar" style="width:38%"></div><div class="wn-prev-spacer"></div><div class="wn-prev-bar wn-prev-bar--ink" style="width:16%"></div><span class="wn-prev-arrow">&#9650;</span><div class="wn-prev-bar wn-prev-bar--mint" style="width:16%"></div></div>
        <div class="wn-prev-impact-row"><div class="wn-prev-bar" style="width:38%"></div><div class="wn-prev-spacer"></div><div class="wn-prev-bar wn-prev-bar--ink" style="width:16%"></div><span class="wn-prev-arrow">&#9650;</span><div class="wn-prev-bar wn-prev-bar--mint" style="width:16%"></div></div>
        <div class="wn-prev-impact-row"><div class="wn-prev-bar" style="width:38%"></div><div class="wn-prev-spacer"></div><div class="wn-prev-bar wn-prev-bar--ink" style="width:16%"></div><span class="wn-prev-arrow">&#9650;</span><div class="wn-prev-bar wn-prev-bar--mint" style="width:16%"></div></div>
        <div class="wn-prev-impact-row"><div class="wn-prev-bar" style="width:38%"></div><div class="wn-prev-spacer"></div><div class="wn-prev-bar wn-prev-bar--ink" style="width:16%"></div><span class="wn-prev-arrow wn-prev-arrow--muted">&#9650;</span><div class="wn-prev-bar" style="width:16%"></div></div>
        <div class="wn-prev-impact-row"><div class="wn-prev-bar" style="width:38%"></div><div class="wn-prev-spacer"></div><div class="wn-prev-bar wn-prev-bar--ink" style="width:16%"></div><span class="wn-prev-arrow">&#9650;</span><div class="wn-prev-bar wn-prev-bar--mint" style="width:16%"></div></div>
      </div>
    </div>`, { rail: true }),

  portfolioAnalytics: frame("Portfolio overview", "53 holdings &middot; 3 funds", `<div class="wn-prev-kpis">
      <div class="wn-prev-kpi"><span class="wn-prev-label">Fair value</span><div class="wn-prev-bar wn-prev-bar--6 wn-prev-bar--ink" style="width:60%"></div></div>
      <div class="wn-prev-kpi"><span class="wn-prev-label">MOIC</span><div class="wn-prev-bar wn-prev-bar--6 wn-prev-bar--ink" style="width:60%"></div></div>
      <div class="wn-prev-kpi"><span class="wn-prev-label">Revenue</span><div class="wn-prev-bar wn-prev-bar--6 wn-prev-bar--ink" style="width:60%"></div></div>
    </div>
    <div class="wn-prev-columns">
      <div class="wn-prev-column" style="height:30%"></div>
      <div class="wn-prev-column" style="height:46%"></div>
      <div class="wn-prev-column" style="height:38%"></div>
      <div class="wn-prev-column" style="height:60%"></div>
      <div class="wn-prev-column" style="height:52%"></div>
      <div class="wn-prev-column" style="height:72%"></div>
      <div class="wn-prev-column" style="height:64%"></div>
      <div class="wn-prev-column wn-prev-column--accent" style="height:80%"></div>
    </div>
    <div class="wn-prev-list">
      <div class="wn-prev-list-row"><div class="wn-prev-bar wn-prev-bar--5" style="width:40%"></div><div class="wn-prev-bar wn-prev-bar--5" style="width:18%"></div></div>
      <div class="wn-prev-list-row"><div class="wn-prev-bar wn-prev-bar--5" style="width:40%"></div><div class="wn-prev-bar wn-prev-bar--5" style="width:18%"></div></div>
      <div class="wn-prev-list-row"><div class="wn-prev-bar wn-prev-bar--5" style="width:40%"></div><div class="wn-prev-bar wn-prev-bar--5" style="width:18%"></div></div>
    </div>`, { rail: true }),

  mancoBudgeting: frame("Dashboard", "Great Basin Capital Partners, LLC", `<div class="wn-prev-stats">
      <div class="wn-prev-stat"><span class="wn-prev-stat-label">Total Income</span><div class="wn-prev-bar wn-prev-bar--7 wn-prev-bar--ink" style="width:70%"></div></div>
      <div class="wn-prev-stat"><span class="wn-prev-stat-label">Total Expenses</span><div class="wn-prev-bar wn-prev-bar--7 wn-prev-bar--red" style="width:70%"></div></div>
      <div class="wn-prev-stat"><span class="wn-prev-stat-label">Net Income</span><div class="wn-prev-bar wn-prev-bar--7 wn-prev-bar--green" style="width:70%"></div></div>
      <div class="wn-prev-stat"><span class="wn-prev-stat-label">Cash Balance</span><div class="wn-prev-bar wn-prev-bar--7 wn-prev-bar--ink" style="width:70%"></div></div>
    </div>
    <div class="wn-prev-panel">
      <span class="wn-prev-panel-title">Monthly P&amp;L</span>
      <div class="wn-prev-pl">
        <div class="wn-prev-pl-axis"></div>
        <div class="wn-prev-pl-cols">
          <div class="wn-prev-pl-col"><div class="wn-prev-pl-pos" style="height:42.32px"></div><div class="wn-prev-pl-neg" style="height:12px"></div></div>
          <div class="wn-prev-pl-col"><div class="wn-prev-pl-pos" style="height:0"></div><div class="wn-prev-pl-neg" style="height:11.4px"></div></div>
          <div class="wn-prev-pl-col"><div class="wn-prev-pl-pos" style="height:0"></div><div class="wn-prev-pl-neg" style="height:11.4px"></div></div>
          <div class="wn-prev-pl-col"><div class="wn-prev-pl-pos" style="height:42.32px"></div><div class="wn-prev-pl-neg" style="height:11.4px"></div></div>
          <div class="wn-prev-pl-col"><div class="wn-prev-pl-pos" style="height:0"></div><div class="wn-prev-pl-neg" style="height:11.4px"></div></div>
          <div class="wn-prev-pl-col"><div class="wn-prev-pl-pos" style="height:0"></div><div class="wn-prev-pl-neg" style="height:10.8px"></div></div>
          <div class="wn-prev-pl-col"><div class="wn-prev-pl-pos" style="height:17.02px"></div><div class="wn-prev-pl-neg" style="height:11.4px"></div></div>
          <div class="wn-prev-pl-col"><div class="wn-prev-pl-pos" style="height:0"></div><div class="wn-prev-pl-neg wn-prev-pl-neg--forecast" style="height:11.4px"></div></div>
        </div>
        <svg class="wn-prev-pl-line" viewBox="0 0 100 62" preserveAspectRatio="none" focusable="false"><polyline points="6,13 19,58 31,58 44,13 56,58 69,58 81,40" fill="none" stroke="#1A1A1A" stroke-width="1" vector-effect="non-scaling-stroke"></polyline><polyline points="81,40 94,58" fill="none" stroke="#1A1A1A" stroke-width="1" stroke-dasharray="3 2" vector-effect="non-scaling-stroke"></polyline></svg>
      </div>
    </div>`, { rail: true })
};

// A skill's preview is a small picture of what it hands back, in the same frame as the
// microapp previews. Sample figures belong to the fictional Great Basin firm the
// microapp previews use; the answer kinds show the viewer's own prompt.
function skillPreviewHtml(it) {
  const ask = `<div class="wn-prev-ask">${escHtml(it.prompt)}</div>`;
  const rows = (head, list) => `<div class="wn-prev-rows">
      <div class="wn-prev-rows-head"><span>${head[0]}</span><span>${head[1]}</span></div>
      ${list.map(([a, b]) => `<div class="wn-prev-rows-row"><span>${a}</span><span>${b}</span></div>`).join("")}
    </div>`;
  switch (it.output) {
    case "deck":
      return frame("Annual General Meeting 2026", "Great Basin Capital Partners &middot; 14 slides", `
    <div class="wn-prev-slide">
      <div class="wn-prev-slide-text">
        <span class="wn-prev-slide-title">Fund I performance</span>
        <span class="wn-prev-slide-kpi"><b>22.6%</b> Net IRR</span>
        <span class="wn-prev-slide-kpi"><b>2.76&times;</b> TVPI</span>
        <span class="wn-prev-slide-kpi"><b>1.38&times;</b> DPI</span>
      </div>
      <div class="wn-prev-columns wn-prev-columns--slide">
        <div class="wn-prev-column" style="height:30%"></div><div class="wn-prev-column" style="height:45%"></div>
        <div class="wn-prev-column" style="height:58%"></div><div class="wn-prev-column wn-prev-column--accent" style="height:84%"></div>
      </div>
    </div>
    <div class="wn-prev-thumbs"><span class="wn-prev-thumb wn-prev-thumb--active"></span><span class="wn-prev-thumb"></span><span class="wn-prev-thumb"></span><span class="wn-prev-thumb"></span><span class="wn-prev-thumb"></span></div>`);
    case "document":
      return frame("Beaver Financial Corp.", "Q3 2026 tear sheet &middot; 1 of 14 PDFs", `
    <div class="wn-prev-kpis">
      <div class="wn-prev-kpi"><span class="wn-prev-stat-label">Revenue</span><b>$48.2M</b></div>
      <div class="wn-prev-kpi"><span class="wn-prev-stat-label">Growth</span><b class="wn-prev-pos">+31%</b></div>
      <div class="wn-prev-kpi"><span class="wn-prev-stat-label">Gross margin</span><b>72%</b></div>
    </div>
    <div class="wn-prev-columns">
      <div class="wn-prev-column" style="height:40%"></div><div class="wn-prev-column" style="height:52%"></div>
      <div class="wn-prev-column" style="height:61%"></div><div class="wn-prev-column wn-prev-column--accent" style="height:80%"></div>
    </div>
    ${rows(["Fund II position", ""], [["Invested", "$12.0M"], ["Fair value", "$28.8M"], ["MOIC", "2.40&times;"]])}`);
    case "spreadsheet":
      return frame("Consolidated balance sheet", "As of Sep 30, 2026 &middot; Excel", `
    <div class="wn-prev-sheet">
      <span class="wn-prev-sheet-h"></span><span class="wn-prev-sheet-h">Fund I</span><span class="wn-prev-sheet-h">Fund II</span><span class="wn-prev-sheet-h">Total</span>
      <span>Investments</span><span>$385.7M</span><span>$308.6M</span><span>$694.3M</span>
      <span>Cash</span><span>$12.4M</span><span>$8.1M</span><span>$20.5M</span>
      <span>Liabilities</span><span>($3.2M)</span><span>($2.6M)</span><span>($5.8M)</span>
      <span class="wn-prev-sheet-t">Net assets</span><span class="wn-prev-sheet-t">$394.9M</span><span class="wn-prev-sheet-t">$314.1M</span><span class="wn-prev-sheet-t">$709.0M</span>
    </div>`);
    case "companies":
      return frame(escHtml(it.title), "Answer in chat", ask + rows(["Company", "Fund"],
        [["Beaver Financial Corp.", "Fund II"], ["Meetly", "Fund I"], ["Northwind Labs", "Cayman Feeder"]]));
    case "checklist":
      return frame(escHtml(it.title), "Answer in chat", ask + `<div class="wn-prev-rows">
      <div class="wn-prev-rows-row"><span>Beaver Financial Corp.</span><span class="wn-prev-status">Complete</span></div>
      <div class="wn-prev-rows-row"><span>Meetly</span><span class="wn-prev-status wn-prev-status--warn">Missing</span></div>
      <div class="wn-prev-rows-row"><span>Northwind Labs</span><span class="wn-prev-status">Complete</span></div>
    </div>`);
    default:
      return frame(escHtml(it.title), "Answer in chat", ask + rows(["Fund", "Q3 '26"],
        [["Fund I", "$385.7M"], ["Fund II", "$308.6M"], ["Cayman Feeder", "$80.6M"]]));
  }
}
