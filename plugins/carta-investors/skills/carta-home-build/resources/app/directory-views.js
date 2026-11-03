// ── Skill directory tab: expandable category cards ──
// Depends on core.js (carta-home.app.js): escHtml(), trackHome(), trackPrompt(), PROMPT_SOURCE,
// writeClipboard(), CAP_COPY_SVG, COPIED_TIP_MS, PROMPT_COPIED_TIP, APP_COPIED_TIP, APP_TAG, APP_TAG_LABEL,
// APP_TAG_TIP, APP_LAUNCH_NOTE, directoryCategories(), DIR_CATEGORIES, _directorySkills,
// _directorySource, _firmDisplayName, _enrichmentDone, _mcpLive, _userEntitlements.
// Nothing here runs at load: renderDirectory() is called when the tab opens or a list arrives.
// Open cards live in memory only: the sandbox blocks localStorage.

// A card shows this many skills, each with its first prompt, until it is expanded.
const DIR_CARD_PREVIEW_SKILLS = 2;

const _dirState = {
  expanded: new Set(),    // category ids whose card shows every skill and prompt
};
let _dirEntries = [];     // the entitled skills on screen
let _dirFirm = "";
let _dirViewKey = "";

// ── Naming ──
// "agm-deck-builder" and "lp-reporting" give "AgmDeckBuilder" and "LpReporting": letters and
// digits only, so the word is safe inside a tracking id. dirSkillSlug drops the plugin
// prefix of a skill id first.
function dirPascal(text) {
  const out = String(text || "").split(/[^A-Za-z0-9]+/).filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join("");
  return out || "Unknown";
}
const dirSkillSlug = skillId => dirPascal(String(skillId || "").split(":").pop());

// ── Key terms ──
// A prompt in skill-directory.json may wrap its key words in **double asterisks**. Copying
// and tracking use the plain text.
const dirPlain = p => String(p).replace(/\*\*/g, "");
const dirFillFirm = (text, firm) => text.replace(/\{\{FIRM\}\}/g, () => firm);

// The prompt as HTML, key terms in <strong>. The firm is filled in after the split, so a
// firm name cannot open or close a bold span, and every piece is escaped.
function dirPromptHtml(prompt, firm) {
  return String(prompt).split(/\*\*(.+?)\*\*/g).map((part, i) => {
    const text = escHtml(dirFillFirm(part, firm));
    return i % 2 ? `<strong class="dir-term">${text}</strong>` : text;
  }).join("");
}

// ── Tracking ──
const dirTrack = suffix => trackHome("click", "CartaHome.Directory." + suffix);

// One render event per distinct set of counts, so a redraw (enrichment arriving, the
// published list replacing the baked one with the same counts) is not counted twice. The
// source is in the id that is sent; the list arriving is tracked as CartaHome.Directory.Published.
function dirTrackView() {
  const source = _directorySource === "published" ? "Published" : "Baked";
  const counts = `Skills${_dirEntries.length}.Categories${directoryCategories(_dirEntries).length}`;
  if (counts === _dirViewKey) return;
  _dirViewKey = counts;
  trackHome("render", `CartaHome.Directory.View.${source}.${counts}`);
}

// ── Copying ──
// The confirmation tip is inside the control that was used, styled like the prompt cards'.
function dirShowCopied(control) {
  control.classList.add("copied");
  clearTimeout(control._copiedTimer);
  control._copiedTimer = setTimeout(() => control.classList.remove("copied"), COPIED_TIP_MS);
}

// `row` carries the prompt filled for the firm (data-prompt) and as written, {{FIRM}}
// unfilled (data-template), so the tracked text names no firm.
function dirCopyPrompt(row) {
  const d = row.dataset;
  trackPrompt("CartaHome.Directory.Copy." + dirSkillSlug(d.skill), d.template, PROMPT_SOURCE.STATIC,
    { skill: d.skill, rank: Number(d.rank) });
  writeClipboard(d.prompt, () => dirShowCopied(row.querySelector(".dir-copy")));
}

function dirRowKey(event, row) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  dirCopyPrompt(row);
}

// ── Markup ──
function dirAppTag(s, idSuffix) {
  if (s.tag !== APP_TAG) return "";
  const tipId = `dir-tip-${escHtml(dirSkillSlug(s.skill))}${idSuffix}`;
  return ` <span class="dir-skill-tag" tabindex="0" aria-describedby="${tipId}">${APP_TAG_LABEL}<span class="dir-skill-tip" role="tooltip" id="${tipId}">${escHtml(APP_TAG_TIP)}</span></span>`;
}

// A whole row copies its prompt; the icon only draws the affordance.
function dirPromptRow(s, prompt, rank) {
  const template = dirPlain(prompt);
  const text = dirFillFirm(template, _dirFirm);
  const tip = s.tag === APP_TAG ? APP_COPIED_TIP : PROMPT_COPIED_TIP;
  return `<div class="dir-skill-prompt" role="button" tabindex="0" aria-label="Copy prompt: ${escHtml(text)}"
              data-skill="${escHtml(s.skill)}" data-rank="${rank}" data-prompt="${escHtml(text)}" data-template="${escHtml(template)}"
              onclick="dirCopyPrompt(this)" onkeydown="dirRowKey(event, this)">
              <span class="dir-skill-prompt-text">“${dirPromptHtml(prompt, _dirFirm)}”</span>
              <span class="dir-copy" aria-hidden="true">${CAP_COPY_SVG}<span class="cap-copied-tip" role="status">${tip}</span></span>
            </div>`;
}

const dirAppNote = s => (s.tag === APP_TAG ? `<div class="dir-skill-note">${APP_LAUNCH_NOTE}</div>` : "");

// A card with more to show than its preview: a third skill, a second prompt or a microapp note.
const dirCardExpands = cat => cat.skills.length > DIR_CARD_PREVIEW_SKILLS
  || cat.skills.some(s => s.prompts.length > 1 || s.tag === APP_TAG);

// `index` is the card's place in category order, which a narrow layout restores with CSS `order`.
function dirCardHtml(cat, index) {
  const open = _dirState.expanded.has(cat.id);
  const n = cat.skills.length;
  const ideas = (open ? cat.skills : cat.skills.slice(0, DIR_CARD_PREVIEW_SKILLS)).map(s => `
          <div class="dir-idea">
            <div class="dir-idea-name">${escHtml(s.name)}${dirAppTag(s, "-card")}</div>
            ${(open ? s.prompts : s.prompts.slice(0, 1)).map((p, rank) => dirPromptRow(s, p, rank)).join("")}
            ${open ? dirAppNote(s) : ""}
          </div>`).join("");
  const footer = dirCardExpands(cat)
    ? `<div class="dir-tile-ft"><button type="button" class="dir-link" data-dir-key="card-${escHtml(cat.id)}" data-category="${escHtml(cat.id)}" aria-expanded="${open}" onclick="dirToggleCard(this)">${open ? "View less" : "View more"}</button></div>`
    : "";
  return `<section class="dir-tile" style="order:${index}">
        <div class="dir-tile-hd"><h3 class="dir-cat-name">${escHtml(cat.name)}</h3><span class="dir-tile-count">${n} ${n === 1 ? "skill" : "skills"}</span></div>
        <p class="dir-tile-tagline">${escHtml(cat.tagline)}</p>
        <div class="dir-tile-ideas">${ideas}</div>
        ${footer}
      </section>`;
}

// Two independent columns filled left to right, so a short card leaves no gap under it.
function dirCardsHtml(cats) {
  const cols = [[], []];
  cats.forEach((cat, i) => cols[i % 2].push(dirCardHtml(cat, i)));
  return `<div class="dir-tiles">${cols.map(col => `<div class="dir-mcol">${col.join("")}</div>`).join("")}</div>`;
}

// ── Drawing ──
// Redraws the cards and gives focus back to the control the user just pressed, which a
// redraw would otherwise drop.
function dirUpdate(focusKey) {
  const grid = document.getElementById("dir-grid");
  if (!grid) return;
  grid.innerHTML = dirCardsHtml(directoryCategories(_dirEntries));
  if (focusKey) {
    const target = Array.from(grid.querySelectorAll("[data-dir-key]")).find(el => el.dataset.dirKey === focusKey);
    if (target) target.focus();
  }
}

function renderDirectory() {
  const grid = document.getElementById("dir-grid");
  if (!grid) return;
  // First-render guard: while get_current_user is still in flight, show a brief
  // personalizing state instead of the unfiltered full list — markEnrichmentDone()
  // re-renders this with the entitlement filter applied. (Skipped with no MCP, e.g. local
  // preview, where enrichment can't run and we just show everything.)
  if (!_enrichmentDone && _mcpLive !== false) {
    grid.innerHTML = '<div style="padding:24px 0;color:var(--ink-color-global-text-subtle);font-size:13px;">Personalizing your directory…</div>';
    return;
  }
  // Gates categories and skills alike: drop either only on an explicit false, so an
  // unknown flag still shows it. A category left with no skills drops out too.
  const entitled = x => !x.requires || _userEntitlements[x.requires] !== false;
  const openCategories = new Set(DIR_CATEGORIES.filter(entitled).map(c => c.id));
  _dirEntries = _directorySkills.filter(s => entitled(s) && openCategories.has(s.category));
  _dirFirm = _firmDisplayName;
  dirUpdate();
  dirTrackView();
}

// ── Actions (inline handlers) ──
function dirToggleCard(btn) {
  const id = btn.dataset.category;
  const opening = !_dirState.expanded.has(id);
  if (opening) _dirState.expanded.add(id); else _dirState.expanded.delete(id);
  dirTrack((opening ? "OpenCategory." : "CloseCategory.") + dirPascal(id));
  dirUpdate("card-" + id);
}
