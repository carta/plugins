// ── Skill directory tab: expandable category cards and search ──
// Depends on core.js (carta-home.app.js): escHtml(), trackHome(), trackPrompt(), PROMPT_SOURCE,
// writeClipboard(), CAP_COPY_SVG, COPIED_TIP_MS, PROMPT_COPIED_TIP, APP_COPIED_TIP, APP_TAG, APP_TAG_LABEL,
// APP_TAG_TIP, APP_LAUNCH_NOTE, directoryCategories(), DIR_CATEGORIES, _directorySkills,
// _directorySource, _firmDisplayName, _enrichmentDone, _mcpLive, _userEntitlements.
// Nothing here runs at load: renderDirectory() is called when the tab opens or a list arrives.
// Open cards and the typed search live in memory only: the sandbox blocks localStorage.
// Matching lives in directory-search.js (dirSearch, dirQuery).

// A card shows this many skills, each with its first prompt, until it is expanded.
const DIR_CARD_PREVIEW_SKILLS = 2;

const _dirState = {
  expanded: new Set(),    // category ids whose card shows every skill and prompt
  query: "",              // what is typed in the search box
};
let _dirEntries = [];     // the entitled skills on screen
let _dirFirm = "";
let _dirViewKey = "";
let _dirSearchTimer = null;
let _dirSearchTracked = "";  // the settled search already sent, so the same one is not counted twice

const DIR_ASK_COPIED_TIP = "Copied. Paste into chat to ask Claude.";
const DIR_SEARCH_TRACK_DELAY_MS = 800;
// A long search is cut in the empty state's title.
const DIR_EMPTY_TITLE_MAX_CHARS = 40;

// The typed search once it has something to search for; a single character or only symbols show the normal view.
function dirQuery() {
  const q = _dirState.query.trim();
  return dirQueryTokens(q).length ? q : "";
}

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
// A search result card (`found`) holds only the skills the search found, each with every prompt, a
// "N of M skills" count and no View more.
function dirCardHtml(cat, index, found) {
  const open = found || _dirState.expanded.has(cat.id);
  const total = found ? found.total.get(cat.id) : cat.skills.length;
  const n = cat.skills.length;
  const ideas = (open ? cat.skills : cat.skills.slice(0, DIR_CARD_PREVIEW_SKILLS)).map(s => `
          <div class="dir-idea">
            <div class="dir-idea-name">${escHtml(s.name)}${dirAppTag(s, "-card")}${found && found.best === s ? '<span class="dir-best">Best match</span>' : ""}</div>
            ${(open ? s.prompts : s.prompts.slice(0, 1)).map((p, rank) => dirPromptRow(s, p, rank)).join("")}
            ${open ? dirAppNote(s) : ""}
          </div>`).join("");
  const footer = !found && dirCardExpands(cat)
    ? `<div class="dir-tile-ft"><button type="button" class="dir-link" data-dir-key="card-${escHtml(cat.id)}" data-category="${escHtml(cat.id)}" aria-expanded="${open}" onclick="dirToggleCard(this)">${open ? "View less" : "View more"}</button></div>`
    : "";
  const count = found ? `${n} of ${total}` : n;
  return `<section class="dir-tile" style="order:${index}">
        <div class="dir-tile-hd"><h3 class="dir-cat-name">${escHtml(cat.name)}</h3><span class="dir-tile-count">${count} ${total === 1 ? "skill" : "skills"}</span></div>
        <p class="dir-tile-tagline">${escHtml(cat.tagline)}</p>
        <div class="dir-tile-ideas">${ideas}</div>
        ${footer}
      </section>`;
}

// Two independent columns filled left to right, so a short card leaves no gap under it.
function dirCardsHtml(cats, found) {
  const cols = [[], []];
  cats.forEach((cat, i) => cols[i % 2].push(dirCardHtml(cat, i, found)));
  return `<div class="dir-tiles">${cols.map(col => `<div class="dir-mcol">${col.join("")}</div>`).join("")}</div>`;
}

// ── Search results ──
const DIR_EMPTY_ICON = '<svg class="dir-empty-ic" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/><path d="M8 10.5h5"/></svg>';

// Nothing matched. Both cases share one layout. A misspelling that a corrected search explains offers
// that search in place of the message, and has no other action. Otherwise the button copies a message
// Claude can act on; the page cannot send it, so the tip says to paste it into the chat.
function dirEmptyHtml(query, didYouMean) {
  const shown = query.length > DIR_EMPTY_TITLE_MAX_CHARS ? query.slice(0, DIR_EMPTY_TITLE_MAX_CHARS).trim() + "…" : query;
  if (didYouMean) {
    return `<div class="dir-empty-state">${DIR_EMPTY_ICON}
      <h3>Did you mean <button type="button" class="dir-link dir-dym" data-fix="${escHtml(didYouMean)}" onclick="dirApplyDidYouMean(this)">${escHtml(didYouMean)}</button>?</h3>
      <p>No skill matches “${escHtml(shown)}”.</p>
    </div>`;
  }
  return `<div class="dir-empty-state">${DIR_EMPTY_ICON}
      <h3>No skill matches “${escHtml(shown)}”</h3>
      <p>This search isn’t covered by a skill in the directory.</p>
      <button type="button" class="dir-ask" onclick="dirAskClaude(this)">Ask Claude about this<span class="cap-copied-tip" role="status">${DIR_ASK_COPIED_TIP}</span></button>
    </div>`;
}

// Matching skills grouped under their own category cards, in category order, under a line that says
// what was found.
function dirResultsHtml(query) {
  const found = dirSearch(_dirEntries, query);
  if (!found.skills.length) return { html: dirEmptyHtml(query, found.didYouMean), found };
  const total = new Map(directoryCategories(_dirEntries).map(c => [c.id, c.skills.length]));
  const cats = directoryCategories(found.skills);
  const n = found.skills.length;
  const note = found.related
    ? "No exact skill. These can help:"
    : `${n} ${n === 1 ? "skill" : "skills"} match “${escHtml(query)}”`;
  return {
    html: `<p class="dir-res-note" aria-live="polite">${note}</p>` + dirCardsHtml(cats, { total, best: found.best }),
    found,
  };
}

// ── Drawing ──
// Redraws the cards (or the search results) and gives focus back to the control the user just
// pressed, which a redraw would otherwise drop. The search box is outside the grid, so typing keeps focus.
function dirUpdate(focusKey) {
  const grid = document.getElementById("dir-grid");
  if (!grid) return;
  const query = dirQuery();
  grid.classList.toggle("dir-plain", !!query);
  grid.innerHTML = query ? dirResultsHtml(query).html : dirCardsHtml(directoryCategories(_dirEntries));
  const clear = document.getElementById("dir-search-clear");
  if (clear) clear.hidden = !_dirState.query;
  if (focusKey) {
    const target = Array.from(grid.querySelectorAll("[data-dir-key]")).find(el => el.dataset.dirKey === focusKey);
    if (target) target.focus();
  }
}

// The search box is in the page template, hidden until the personalized list is ready.
function dirShowSearchBox(show) {
  const box = document.getElementById("dir-search");
  if (box) box.hidden = !show;
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
    dirShowSearchBox(false);
    return;
  }
  dirShowSearchBox(true);
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

// Typing redraws at once; the search is counted once typing pauses.
function dirOnSearch(value) {
  _dirState.query = value;
  dirUpdate();
  clearTimeout(_dirSearchTimer);
  _dirSearchTimer = setTimeout(dirTrackSearchNow, DIR_SEARCH_TRACK_DELAY_MS);
}

function dirClearSearch() {
  dirTrack("Search.Clear");
  _dirState.query = "";
  _dirSearchTracked = "";
  const input = document.getElementById("dir-search-input");
  if (input) { input.value = ""; input.focus(); }
  dirUpdate();
}

// The settled search, once, as a fixed-label id: how many skills it found, or that it found none. The typed
// words are only the local key that keeps one search from being counted twice; they are never sent.
function dirTrackSearchNow() {
  clearTimeout(_dirSearchTimer);
  const q = dirQuery().toLowerCase().replace(/\s+/g, " ");
  if (!q) { _dirSearchTracked = ""; return; }
  if (q === _dirSearchTracked) return;
  _dirSearchTracked = q;
  const found = dirSearch(_dirEntries, q);
  const n = found.skills.length;
  const kind = n ? (found.related ? "Related" : "Results") + n : found.didYouMean ? "DidYouMean" : "ZeroResults";
  dirTrack(`Search.${kind}`);
}

// The corrected search the user clicked, run as if they had typed it.
function dirApplyDidYouMean(btn) {
  const fix = btn.dataset.fix || "";
  dirTrack("DidYouMean.Accept");
  const input = document.getElementById("dir-search-input");
  if (input) { input.value = fix; input.focus(); }
  dirOnSearch(fix);
}

// Copies a short message saying what was searched and that no skill matched, so a keyword or a
// badly worded search still reaches Claude with context.
function dirAskClaude(btn) {
  // not a prompt: a message about a search no skill matched, tracked as AskClaude without the typed words
  const message = `I searched the Carta Home skill directory for “${dirQuery()}” and found no matching skill. Can you help me with that using my Carta data?`;
  dirTrack("AskClaude");
  writeClipboard(message, () => dirShowCopied(btn));
}
