// ── What's new: a carousel of the featured microapp and recently launched skills ──
// Depends on captable-home.app.js: _directorySkills, BAKED_SKILL_OPT_OUTS, escHtml(),
// copyText(), trackHome(), trackPrompt(), prefersReducedMotion(), resolvePrompt(),
// COPIED_TIP_MS, DAY_MS, APP_TAG_LABEL, APP_TAG_TIP, APP_COPIED_TIP; on app/capabilities.js:
// readProductFlag(), promptTag(), PROMPT_TAGS, PROMPT_COPIED_TIP; on captable-home.config.js:
// WHATS_NEW, WHATS_NEW_MICROAPPS, WHATS_NEW_SKILL_OUTPUTS.

// A skill prompt qualifies when its goLiveDate is within the last WHATS_NEW_WINDOW_DAYS
// (and not in the future). 60 days is about two release cycles: long enough that a skill
// launched just before a user's vacation is still new when they return, short enough that
// the row turns over instead of becoming a second skill directory. Raise it if the row is
// often empty, lower it if launches are frequent.
const WHATS_NEW_WINDOW_DAYS = 60;
// The carousel holds WHATS_NEW_SLOTS items. WHATS_NEW_MAX skills (selectWhatsNew) take
// slots; the featured microapps take the rest, so one slot is always left for the microapp.
const WHATS_NEW_SLOTS = 4;
const WHATS_NEW_MAX = WHATS_NEW_SLOTS - 1;
// renderWhatsNew hands both to captable-home.css as --wn-rotate and --wn-fade-out.
const WHATS_NEW_ROTATE_MS = 5000;
const WHATS_NEW_FADE_OUT_MS = 180;

// Which plugin labels (pluginPrompt.plugin) the user may see: "Cap Table Plugin" needs
// has_cap_table to be true. Strict by design: a flag that is false, null (unknown) or missing
// denies, because a "new skill" card for a product the user cannot use is a dead end, while
// a missing card costs nothing. An unrecognised plugin label is denied for the same reason.
function whatsNewPluginAccess(profile) {
  const p = profile || {};
  return { "cap table plugin": readProductFlag(p, "has_cap_table") === true };
}

// A Contentful entry names its skill ("carta-reporting", sometimes plugin-qualified); the
// Skill Directory entry for it, if any, carries its display name and category.
const whatsNewSkillId = entry => String((entry && entry.skill) || "").split(":").pop();
function directoryEntry(skillId) {
  return (Array.isArray(_directorySkills) ? _directorySkills : []).find(s => s.skill === skillId);
}

// A skill is featured only when the current Skill Directory lists it: a public install
// strips unpublished skills, and a card for a skill the user doesn't have is a dead end.
// It stays out when the directory file opts it out with `null`, when its entry says
// `"whatsNew": false`, or when it is a featured microapp's own skill: the product is
// already in the carousel.
const FEATURED_SKILLS = new Set(WHATS_NEW_MICROAPPS.map(m => m.skill));
function featuredInWhatsNew(entry) {
  const id = whatsNewSkillId(entry);
  const known = directoryEntry(id);
  return !!known && known.whatsNew !== false && !FEATURED_SKILLS.has(id) && !BAKED_SKILL_OPT_OUTS.includes(id);
}

// What a Contentful entry's skill hands back (see WHATS_NEW_SKILL_OUTPUTS).
function whatsNewOutput(entry) {
  const id = whatsNewSkillId(entry);
  const known = directoryEntry(id);
  return skillOutputKind(id, known && known.category);
}

function skillOutputKind(skillId, category) {
  return WHATS_NEW_SKILL_OUTPUTS.bySkill[skillId] || WHATS_NEW_SKILL_OUTPUTS.byCategory[category] || "rows";
}

// A skill that hands back something to look at makes the better showcase, so those lead.
const WHATS_NEW_VISUAL_OUTPUTS = ["document", "spreadsheet", "chart"];

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
  const windowStart = now - WHATS_NEW_WINDOW_DAYS * DAY_MS;
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

// Where a locked microapp's label leads, or null for a plain label: the product's carta.com
// demo page, tagged `utm_campaign=carta-home-whatsnew-<slug>` so Marketing can attribute the
// visit to Carta Home and the microapp.
function unlockHref(m) {
  if (!m.unlockUrl) return null;
  const sep = m.unlockUrl.includes("?") ? "&" : "?";
  return `${m.unlockUrl}${sep}utm_campaign=carta-home-whatsnew-${encodeURIComponent(m.slug)}`;
}

// A microapp is unlocked only when its product flag is true: a "Set up" button for a product
// the company doesn't have leads nowhere, while a locked item still says what the product
// would add. Unlocked items lead.
function showcaseMicroapps(profile) {
  const p = profile || {};
  const items = WHATS_NEW_MICROAPPS.map(m => {
    const locked = readProductFlag(p, m.unlockedBy) !== true;
    return {
      ...m, kind: "microapp", locked,
      href: locked ? unlockHref(m) : null,
      copyText: "/" + m.skill, copyLabel: "/" + m.skill, copiedTip: APP_COPIED_TIP,
    };
  });
  return [...items.filter(m => !m.locked), ...items.filter(m => m.locked)];
}

// The panel text for a featured skill, on every path that features one: its directory
// entry's `whatsNewCopy` when it has one, else its prompt, quoted, over `stockBody`. The
// prompt is what is copied either way.
function skillPanelCopy(known, prompt, stockBody) {
  const copy = known && known.whatsNewCopy;
  return copy ? { headline: copy.headline, description: copy.body }
              : { headline: "“" + prompt + "”", description: stockBody };
}

// A skill unknown to the Skill Directory is named by its prompt's category.
// `rank` is the entry's place among the skills picked; it keys an entry with no skill, and
// a second prompt for one skill, so a tracking id never carries prompt text or repeats.
function showcaseSkill(entry, rank) {
  const id = whatsNewSkillId(entry);
  const known = directoryEntry(id);
  return {
    kind: "skill",
    source: "contentful",
    skillId: id,
    slug: id ? "skill-" + id : "skill-rank-" + rank,
    title: known ? known.name : PROMPT_TAGS[promptTag(entry.text)].label + " skill",
    ...skillPanelCopy(known, entry.text, "A new skill for Claude. Copy the prompt, paste it into chat, and Claude runs it on your Carta data."),
    prompt: entry.text,
    copyText: entry.text, copyLabel: "the prompt", copiedTip: PROMPT_COPIED_TIP,
    output: whatsNewOutput(entry),
  };
}

// The WHATS_NEW config cards, shown as skill items when Carta supplies neither a microapp
// nor a new skill. Their prompts name the company, so they resolve here. A card passes the
// same test as a Contentful skill: one the Skill Directory doesn't list, opts out with
// `null`, or marks `"whatsNew": false` is dropped.
function fallbackItems() {
  const cards = (Array.isArray(WHATS_NEW) ? WHATS_NEW : [])
    .filter(card => featuredInWhatsNew({ skill: card.skill }));
  return cards.map((card, i) => {
    const prompt = resolvePrompt(card.prompt);
    return {
      kind: "skill",
      source: "static",
      kindLabel: card.tag,
      slug: "card-" + i,
      title: card.title,
      ...skillPanelCopy(directoryEntry(card.skill), prompt, card.body),
      prompt,
      copyText: prompt, copyLabel: "the prompt", copiedTip: PROMPT_COPIED_TIP,
      output: card.output || "rows",
    };
  });
}

// Open microapps lead, then the WHATS_NEW_MAX skills selectWhatsNew picks, then locked
// microapps, up to WHATS_NEW_SLOTS. A qualifying skill takes a slot, so the last item in
// that order waits.
function selectShowcaseItems(profile, entries, shownAbove, now = Date.now()) {
  const skills = selectWhatsNew(entries, whatsNewPluginAccess(profile), shownAbove, now).map((entry, rank) => showcaseSkill(entry, rank));
  const taken = new Set();
  skills.forEach((sk, rank) => {
    if (taken.has(sk.slug)) sk.slug += "-rank-" + rank;
    taken.add(sk.slug);
  });
  const apps = showcaseMicroapps(profile);
  const open = apps.filter(m => !m.locked).slice(0, WHATS_NEW_SLOTS - skills.length);
  return [...open, ...skills, ...apps.filter(m => m.locked)].slice(0, WHATS_NEW_SLOTS);
}

// ── Carousel ──
// Rotation pauses while the pointer is over the carousel or focus is inside it, and stops
// for good once the viewer picks an item themselves. `last` is the latest renderWhatsNew
// call, so the published Skill Directory can re-render with it (wnRefresh).
const _wn = { items: [], active: 0, rotateTimer: null, fadeTimer: null, hovered: false, focused: false, stopped: false, minHeight: 0, last: null,
  // Rotation waits until the carousel has been on screen, so a visitor arrives on item 01.
  seen: typeof IntersectionObserver === "undefined", observer: null };

function renderWhatsNew(profile, entries, shownAbove) {
  const section = document.getElementById("whats-new-section");
  if (!section) return;
  _wn.last = { profile, entries, shownAbove };
  // With no product flag known, show nothing from Carta rather than upsell a paying
  // customer: the config cards stand in.
  const real = profile || {};
  const known = WHATS_NEW_MICROAPPS.some(m => readProductFlag(real, m.unlockedBy) !== null);
  let items = known ? selectShowcaseItems(real, entries, shownAbove) : [];
  if (!items.length) items = fallbackItems();
  if (!items.length) {
    section.hidden = true;
    return;
  }
  // Keyed, so an item that arrives late never moves the viewer off the item they are
  // looking at.
  const activeSlug = _wn.items[_wn.active]?.slug;
  _wn.items = items;
  _wn.active = Math.max(0, items.findIndex(it => it.slug === activeSlug));
  section.hidden = false;
  const carousel = document.getElementById("wn-carousel");
  if (carousel) {
    carousel.style.setProperty("--wn-rotate", `${WHATS_NEW_ROTATE_MS}ms`);
    carousel.style.setProperty("--wn-fade-out", `${WHATS_NEW_FADE_OUT_MS}ms`);
  }
  _wnRenderIndex();
  _wnRenderPanel();
  _wnWatchForFirstView(carousel);
  _wnRestartTimer();
}

function _wnWatchForFirstView(carousel) {
  if (_wn.seen || _wn.observer || !carousel) return;
  _wn.observer = new IntersectionObserver(entries => {
    if (!entries.some(e => e.isIntersecting)) return;
    _wn.observer.disconnect();
    _wn.seen = true;
    _wnRestartTimer();
  }, { threshold: 0.3 });
  _wn.observer.observe(carousel);
}

// Re-render What's new from its latest inputs, if it has been asked to render: called when
// skill-directory.js swaps in the published Skill Directory.
function wnRefresh() {
  if (_wn.last) renderWhatsNew(_wn.last.profile, _wn.last.entries, _wn.last.shownAbove);
}

function _wnRenderIndex() {
  const list = document.getElementById("wn-index-items");
  if (!list) return;
  // Rewriting the list drops the focus inside it; hand it to the active item.
  const hadFocus = list.contains(document.activeElement);
  list.innerHTML = _wn.items.map((it, i) => `
    <button class="wn-index-item${i === _wn.active ? " active" : ""}" role="tab" id="wn-tab-${i}"
            aria-selected="${i === _wn.active}" aria-controls="wn-center" tabindex="${i === _wn.active ? 0 : -1}"
            onclick="wnSelect(${i})" onkeydown="wnTabKey(event, ${i})">
      ${i === _wn.active ? '<span class="wn-timer"></span>' : ""}
      <span class="wn-index-num">${String(i + 1).padStart(2, "0")}</span>
      <span class="wn-index-text">
        <span class="wn-index-title">${escHtml(it.title)}</span>
        <span class="wn-index-kind">${escHtml(it.kindLabel || (it.kind === "microapp" ? APP_TAG_LABEL : "Skill"))}</span>
      </span>
    </button>`).join("");
  if (hadFocus) list.children[_wn.active]?.focus();
}

function _wnPanelHtml(it) {
  const lockSvg = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" stroke-width="1.4"/></svg>';
  let cta;
  if (it.kind === "skill") {
    cta = `<button class="wn-cta" data-wn-key="${escHtml(it.slug)}" onclick="wnCopy(this)">Try it out <span class="cta-arrow" aria-hidden="true">→</span></button>`;
  } else if (it.locked && it.href) {
    cta = `<a class="wn-locked" href="${escHtml(it.href)}" target="_blank" rel="noopener"
             onclick="trackHome('click','CaptableHome.WhatsNew.Unlock.${escHtml(it.slug)}')">${lockSvg}${escHtml(it.lockedLabel)} <span class="cta-arrow" aria-hidden="true">→</span></a>`;
  } else if (it.locked) {
    // Nowhere to send the viewer: the label still says what unlocks it.
    cta = `<span class="wn-locked wn-locked--plain">${lockSvg}${escHtml(it.lockedLabel)}</span>`;
  } else {
    cta = `<button class="wn-cta" data-wn-key="${escHtml(it.slug)}" onclick="wnCopy(this)">Set up in Claude Code <span class="cta-arrow" aria-hidden="true">→</span></button>`;
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
  return it.locked ? body : `<button class="wn-preview-btn" aria-label="Copy ${escHtml(it.copyLabel)}" data-wn-key="${escHtml(it.slug)}" onclick="wnCopy(this)">${body}</button>
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
  center.setAttribute("aria-labelledby", "wn-tab-" + _wn.active);
  center.innerHTML = _wnPanelHtml(it);
  preview.innerHTML = _wnPreviewHtml(it);
  if (focusIn) (focusIn.querySelector("button, a") || center.querySelector("button, a"))?.focus();
  // Hold the tallest height seen so the box doesn't jump as items rotate.
  if (carousel && carousel.offsetHeight > _wn.minHeight) {
    _wn.minHeight = carousel.offsetHeight;
    carousel.style.minHeight = _wn.minHeight + "px";
  }
}

// Arrow keys, Home and End move the selection along the tabs and carry focus with it.
function wnTabKey(e, i) {
  const last = _wn.items.length - 1;
  const to = { ArrowLeft: i === 0 ? last : i - 1, ArrowRight: i === last ? 0 : i + 1, Home: 0, End: last }[e.key];
  if (to === undefined) return;
  e.preventDefault();
  wnSelect(to);
  document.getElementById("wn-index-items")?.children[to]?.focus();
}

// A viewer's own pick stops the rotation for good, so it never moves them along.
function wnSelect(i, fromUser = true) {
  if (fromUser && !_wn.stopped) {
    _wn.stopped = true;
    _wnRestartTimer();
  }
  if (i === _wn.active || !_wn.items[i]) return;
  if (fromUser) trackHome("click", "CaptableHome.WhatsNew.Select." + _wn.items[i].slug);
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
  const rotates = _wn.items.length > 1 && !prefersReducedMotion() && !_wn.stopped && _wn.seen;
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
// The button names its item by slug: during the fade to another item the old panel is still
// on screen, so the active item is not necessarily the one the viewer clicked.
function wnCopy(btn) {
  const rank = _wn.items.findIndex(x => x.slug === btn.dataset.wnKey);
  const it = _wn.items[rank];
  if (!it) return;
  // Each copy carries mcp_prompt: a Contentful skill's prompt is tagged with its place in
  // the carousel (`rank`, zero-based); a microapp's set-up command and the config cards are
  // fixed content.
  const id = "CaptableHome.WhatsNew.Copy." + it.slug;
  if (it.source === "contentful") trackPrompt(id, it.copyText, "contentful", { rank });
  else trackPrompt(id, it.copyText, "static");
  const tip = btn.parentElement.querySelector(".wn-copied-tip");
  copyText(it.copyText, () => {
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
  if (open) trackHome("click", "CaptableHome.WhatsNew.MicroappHelp");
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

// ── Previews: static, decorative mockups of the microapp and of each skill's output
// (styles: .wn-prev-* in captable-home.css). Sample names and figures are fictional, and
// carry no currency sign: they are pictures, not data. ──

// The frame every preview shares: a title and subtitle beside the PREVIEW chip, then the
// body. Microapp previews add the app's side rail.
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
  totalCompensation: frame("Compensation", "Bands and benchmarks", `<div class="wn-prev-tabs">
      <span class="wn-prev-tab wn-prev-tab--active">Benchmarks</span>
      <span class="wn-prev-tab">Scorecard</span>
      <span class="wn-prev-tab">Peer groups</span>
    </div>
    <div class="wn-prev-kpis">
      <div class="wn-prev-kpi"><span class="wn-prev-stat-label">Compa-ratio</span><div class="wn-prev-bar wn-prev-bar--6 wn-prev-bar--ink" style="width:60%"></div></div>
      <div class="wn-prev-kpi"><span class="wn-prev-stat-label">Below P50</span><div class="wn-prev-bar wn-prev-bar--6 wn-prev-bar--ink" style="width:40%"></div></div>
      <div class="wn-prev-kpi"><span class="wn-prev-stat-label">Employees</span><div class="wn-prev-bar wn-prev-bar--6 wn-prev-bar--ink" style="width:70%"></div></div>
    </div>
    <div class="wn-prev-columns">
      <div class="wn-prev-column" style="height:28%"></div>
      <div class="wn-prev-column" style="height:44%"></div>
      <div class="wn-prev-column" style="height:62%"></div>
      <div class="wn-prev-column" style="height:80%"></div>
      <div class="wn-prev-column wn-prev-column--accent" style="height:70%"></div>
      <div class="wn-prev-column" style="height:50%"></div>
      <div class="wn-prev-column" style="height:34%"></div>
      <div class="wn-prev-column" style="height:20%"></div>
    </div>
    <div class="wn-prev-list">
      <div class="wn-prev-list-row"><div class="wn-prev-bar wn-prev-bar--5" style="width:40%"></div><div class="wn-prev-bar wn-prev-bar--5" style="width:18%"></div></div>
      <div class="wn-prev-list-row"><div class="wn-prev-bar wn-prev-bar--5" style="width:40%"></div><div class="wn-prev-bar wn-prev-bar--5" style="width:18%"></div></div>
      <div class="wn-prev-list-row"><div class="wn-prev-bar wn-prev-bar--5" style="width:40%"></div><div class="wn-prev-bar wn-prev-bar--5" style="width:18%"></div></div>
    </div>`, { rail: true }),
};

// A skill's preview is a small picture of what it hands back, in the same frame as the
// microapp preview; the chat-answer kinds show the viewer's own prompt.
function skillPreviewHtml(it) {
  const ask = `<div class="wn-prev-ask">${escHtml(it.prompt)}</div>`;
  const rows = (head, list) => `<div class="wn-prev-rows">
      <div class="wn-prev-rows-head"><span>${head[0]}</span><span>${head[1]}</span></div>
      ${list.map(([a, b]) => `<div class="wn-prev-rows-row"><span>${a}</span><span>${b}</span></div>`).join("")}
    </div>`;
  switch (it.output) {
    case "document":
      return frame("Option grant", "Draft &middot; ready for review", `
    <div class="wn-prev-kpis">
      <div class="wn-prev-kpi"><span class="wn-prev-stat-label">Shares</span><b>10,000</b></div>
      <div class="wn-prev-kpi"><span class="wn-prev-stat-label">Type</span><b>NSO</b></div>
      <div class="wn-prev-kpi"><span class="wn-prev-stat-label">Status</span><b class="wn-prev-pos">Draft</b></div>
    </div>
    ${rows(["Grant detail", ""], [["Holder", "Employee name"], ["Vesting", "4 years, 1 year cliff"], ["Vesting start", "Jan 1, 2027"]])}`);
    case "register":
      return frame("Register of allotments", "Statutory register", rows(["Allotment", "Shares"],
        [["Ordinary &middot; Founder name", "5,000,000"], ["Series A &middot; Investor name", "1,500,000"], ["Ordinary &middot; Employee name", "10,000"]]));
    case "spreadsheet":
      return frame("Cap table", "Fully diluted &middot; Excel", `
    <div class="wn-prev-sheet">
      <span class="wn-prev-sheet-h"></span><span class="wn-prev-sheet-h">Outstanding</span><span class="wn-prev-sheet-h">Fully diluted</span><span class="wn-prev-sheet-h">Ownership</span>
      <span>Common</span><span>5,000,000</span><span>5,000,000</span><span>62.5%</span>
      <span>Series A</span><span>1,500,000</span><span>1,500,000</span><span>18.8%</span>
      <span>Options</span><span>&ndash;</span><span>1,500,000</span><span>18.7%</span>
      <span class="wn-prev-sheet-t">Total</span><span class="wn-prev-sheet-t">6,500,000</span><span class="wn-prev-sheet-t">8,000,000</span><span class="wn-prev-sheet-t">100%</span>
    </div>`);
    case "chart":
      return frame(escHtml(it.title), "Answer in chat", ask + `
    <div class="wn-prev-columns">
      <div class="wn-prev-column" style="height:30%"></div><div class="wn-prev-column" style="height:48%"></div>
      <div class="wn-prev-column" style="height:62%"></div><div class="wn-prev-column wn-prev-column--accent" style="height:84%"></div>
    </div>
    ${rows(["Round", "Shares issued"], [["Seed", "1,200,000"], ["Series A", "1,500,000"]])}`);
    default:
      return frame(escHtml(it.title), "Answer in chat", ask + rows(["Holder", "Shares"],
        [["Employee name", "10,000"], ["Advisor name", "25,000"], ["Investor name", "1,500,000"]]));
  }
}

// The config cards paint at load, like the prompt cards, so every path that never brings a
// profile (no connector, a failed call, one that never answers) still shows What's new.
// fetchUserEnrichment re-renders once the profile says what Carta can feature.
renderWhatsNew({}, [], []);
