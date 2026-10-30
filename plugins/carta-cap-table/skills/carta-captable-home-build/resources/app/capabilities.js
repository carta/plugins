// "Suggested for you" — four editable prompt cards, personalized when Carta has
// recommendations for this user and padded from CAP_PROMPTS otherwise. Also holds the
// one get_current_user call the page makes: its profile feeds these prompts and What's new.
// Depends on captable-home.app.js: _mcp(), mcpAvailable(), _mcpResultCandidates(), escHtml(),
// copyText(), copyIconSvg(), trackPrompt(), prefersReducedMotion(), companyNoun(),
// COPIED_TIP_MS; on app/whats-new.js: renderWhatsNew(); on app/live-content.js:
// _listWhatsNewPrompts(); on captable-home.config.js: CAP_PROMPTS.

const CAP_GRID_SIZE = 4;

// A name in PROMPT_VARS fills in at render; any other `[[…]]` blank is kept as written.
const PROMPT_VARS = {
  COMPANY: companyNoun,
};

// A prompt as [{text}] runs and [{token, name?}] editable parts. A CAP_PROMPTS entry marks
// its own parts; a personalized prompt gets the company name, quarters, dates and relative
// periods marked, so it fills in the same way.
const MONTHS_RE = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*";
function promptParts(prompt) {
  const parts = [];
  const push = (text, token, name) => {
    if (token != null) parts.push({ token, name });
    else if (text) parts.push({ text });
  };
  if (typeof prompt !== "string") {
    let last = 0;
    prompt.text.replace(/\[\[([^\]]+)\]\]/g, (m, word, at) => {
      push(prompt.text.slice(last, at));
      if (PROMPT_VARS[word]) push(null, PROMPT_VARS[word](), word);
      else push(null, word);
      last = at + m.length;
      return m;
    });
    push(prompt.text.slice(last));
    return parts;
  }
  const alts = [
    `\\bQ[1-4](?:\\s?(?:'|’)?\\d{2,4})?\\b`,
    `\\b${MONTHS_RE} \\d{1,2}, \\d{4}\\b`,
    `\\b(?:this|last) (?:quarter|month|year)\\b`,
    `\\bYTD\\b`,
  ];
  if (_selectedCompanyName) alts.unshift(_selectedCompanyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(alts.join("|"), "g");
  let last = 0, m;
  while ((m = re.exec(prompt))) {
    push(prompt.slice(last, m.index));
    push(null, m[0], m[0] === _selectedCompanyName ? "COMPANY" : undefined);
    last = m.index + m[0].length;
  }
  push(prompt.slice(last));
  return parts;
}
const promptText = prompt => promptParts(prompt).map(p => p.text ?? p.token).join("");
// A prompt as written, its [[…]] blanks unresolved: what a copy button holds, so the click's
// tag can resolve it when pressed and never carries the viewer's edits.
const rawPrompt = prompt => (typeof prompt === "string" ? prompt : prompt.text);

// Category chip over each prompt. No prompt carries a category; promptTag() reads one off
// its words, first match wins, so a prompt that touches two subjects takes the first.
const PROMPT_TAGS = {
  compensation: { label: "Compensation", words: ["compensation", "salary", "pay ", "benchmark", "p50", "compa-ratio", "job title", "role"] },
  governance:   { label: "Governance",   words: ["409a", "fmv", "valuation", "financing", "round history", "voting", "approval", "charter", "expir", "typical", "market"] },
  equity:       { label: "Equity",       words: ["vest", "option", "grant", "safe", "note", "convert", "issue", "exercise", "rsu", "certificate", "signature"] },
  ownership:    { label: "Ownership",    words: ["ownership", "cap table", "stakeholder", "share class", "fully diluted", "securities", "holder", "allotment"] },
};
const PROMPT_TAG_FALLBACK = "ownership";

function promptTag(text) {
  const t = String(text || "").toLowerCase();
  const hit = Object.keys(PROMPT_TAGS).find(k => PROMPT_TAGS[k].words.some(w => t.includes(w)));
  return hit || PROMPT_TAG_FALLBACK;
}

// What a copied prompt's confirmation says, on the prompt cards and in What's new.
const PROMPT_COPIED_TIP = "Copied. Paste into chat.";

// One editable prompt card. `prompt` is a CAP_PROMPTS entry or a bare prompt string.
// meta: { source, skill, rank }, carried to capCopy's tag. data-prompt holds the prompt as
// written, blanks unresolved, so capCopy fills them as they stand when pressed.
function capCardHtml(prompt, meta = {}) {
  const tag = promptTag(promptText(prompt));
  const attrs = ` data-prompt="${escHtml(rawPrompt(prompt))}"`
    + (meta.source ? ` data-source="${escHtml(meta.source)}"` : "")
    + (meta.skill ? ` data-skill="${escHtml(meta.skill)}"` : "")
    + (Number.isInteger(meta.rank) ? ` data-rank="${meta.rank}"` : "");
  const body = promptParts(prompt).map(p => p.text != null ? escHtml(p.text)
    : `<span class="cap-token" data-token="${escHtml(p.token)}"${p.name ? ` data-var="${p.name}"` : ""}>${escHtml(p.token)}</span>`).join("");
  return `<div class="cap-card">
      <span class="cap-tag cap-tag--${tag}">${PROMPT_TAGS[tag].label}</span>
      <div class="cap-box">
        <div class="cap-card-text" contenteditable="true" spellcheck="false" role="textbox" aria-label="Prompt">${body}</div>
        <div class="cap-actions">
          <button class="cap-copy" data-track="CaptableHome.Capabilities.CopyPrompt"${attrs} onclick="capCopy(this)"><span class="cap-copy-label">Copy</span>${copyIconSvg(14)}</button>
          <span class="cap-copied-tip" role="status">${PROMPT_COPIED_TIP}</span>
        </div>
      </div>
    </div>`;
}

// The first 4 non-gap personalized prompts, open slots padded from CAP_PROMPTS (all of them
// when there are no personalized ones). Returns the prompts now on screen so What's new
// never repeats one.
function renderCapabilities(recs) {
  const grid = document.getElementById("cap-grid");
  const live = Array.isArray(recs)
    ? recs.filter(r => r && !r.is_skill_gap && typeof r.recommended_prompt === "string" && r.recommended_prompt.trim())
    : [];
  const cards = live.slice(0, CAP_GRID_SIZE).map(r => ({
    prompt: r.recommended_prompt.trim(), source: "recommendation", skill: r.recommended_skill,
  }));

  // Pad to a full grid, preferring prompts on subjects the personalized set doesn't cover;
  // the second pass backfills from what was skipped so the grid is always full.
  const haystack = cards.map(c => c.prompt).join(" ").toLowerCase();
  const covered = pad => pad.topics.some(t => haystack.includes(t));
  const has = pad => cards.some(c => c.prompt === pad);
  for (const pad of CAP_PROMPTS) {
    if (cards.length >= CAP_GRID_SIZE) break;
    if (!covered(pad) && !has(pad)) cards.push({ prompt: pad, source: "static" });
  }
  for (const pad of CAP_PROMPTS) {
    if (cards.length >= CAP_GRID_SIZE) break;
    if (!has(pad)) cards.push({ prompt: pad, source: "static" });
  }

  // The row paints at load and again once get_current_user answers. The grid is left alone
  // when its prompts are unchanged, or once the viewer has pressed or focused into it
  // (typeTokensWhenSeen marks it touched): rebuilding would drop their edits and type the
  // blanks in again. Either way the prompts on screen are what's returned.
  const shown = cards.map(c => promptText(c.prompt));
  if (!grid) return shown;
  if ("touched" in grid.dataset) return JSON.parse(grid.dataset.shown);
  grid.dataset.shown = JSON.stringify(shown);
  const key = JSON.stringify(cards.map(c => rawPrompt(c.prompt)));
  if (grid.dataset.prompts !== key) {
    grid.dataset.prompts = key;
    grid.innerHTML = cards.map((c, i) => capCardHtml(c.prompt,
      { source: c.source, skill: c.skill, rank: i })).join("");
    typeTokensWhenSeen(grid);
  }
  return shown;
}

// The editable parts type themselves in, one after another left to right, the first time
// the row is 40% on screen, so each card reads as a sentence with a blank that fills in.
// Skipped under reduced motion and where there's no observer.
const CAP_TYPE_DELAY_MS = 300, CAP_TYPE_CHAR_MS = 55, CAP_TYPE_GAP_MS = 420;
// Once the viewer touches the row (a press anywhere in it, or focus), every blank holds its
// full word and no timer writes to it again, so Copy never takes a half-typed prompt and
// typing never lands on top of the viewer's edits.
function typeTokensWhenSeen(grid) {
  // One pair of listeners per grid records the touch and stops whichever paint's typing is
  // current, so a row repainted before it was touched is still stopped by the touch.
  grid._stopTyping = () => {};
  if (!grid._touchWired) {
    grid._touchWired = true;
    const touch = () => {
      if ("touched" in grid.dataset) return;
      grid.dataset.touched = "";
      grid._stopTyping();
    };
    grid.addEventListener("pointerdown", touch, { capture: true });
    grid.addEventListener("focusin", touch, { capture: true });
  }
  if (typeof IntersectionObserver === "undefined") return;
  if (prefersReducedMotion()) return;
  const tokens = Array.from(grid.querySelectorAll(".cap-token"));
  if (!tokens.length) return;
  tokens.forEach(t => { t.textContent = ""; t.dataset.typing = ""; });
  let timer = null;
  const later = (fn, ms) => { timer = setTimeout(fn, ms); };
  const io = new IntersectionObserver(entries => {
    if (!entries.some(e => e.isIntersecting)) return;
    io.disconnect();
    later(() => typeToken(tokens, 0, later), CAP_TYPE_DELAY_MS);
  }, { threshold: 0.4 });
  grid._stopTyping = () => {
    clearTimeout(timer);
    io.disconnect();
    tokens.forEach(t => { t.textContent = t.dataset.token; delete t.dataset.typing; });
  };
  io.observe(grid);
}

// `later` schedules the next tick where typeTokensWhenSeen can cancel it.
function typeToken(tokens, i, later) {
  const t = tokens[i];
  if (!t || !t.isConnected) return;
  const word = t.dataset.token;
  let n = 0;
  const step = () => {
    t.textContent = word.slice(0, ++n);
    if (n < word.length) { later(step, CAP_TYPE_CHAR_MS); return; }
    delete t.dataset.typing;
    later(() => typeToken(tokens, i + 1, later), CAP_TYPE_GAP_MS);
  };
  step();
}

function capCopy(btn) {
  // The tag carries the suggested prompt, its blanks filled as they stand now, never the
  // viewer's edits.
  const d = btn.dataset;
  trackPrompt(d.track, d.prompt ? promptText({ text: d.prompt }) : "", d.source || "static",
    { skill: d.skill, rank: d.rank === undefined ? undefined : Number(d.rank) });
  const box = btn.closest(".cap-box");
  // A copy can arrive before the row was seen or touched (a programmatic click, a script),
  // so blanks still waiting to be typed in are filled first; typed or edited ones are kept.
  box.querySelectorAll(".cap-token[data-typing]").forEach(t => {
    t.textContent = t.dataset.token;
    delete t.dataset.typing;
  });
  // innerText, so whatever the viewer typed into the prompt is what gets copied.
  const text = box.querySelector(".cap-card-text").innerText.trim();
  copyText(text, () => {
    btn.querySelector(".cap-copy-label").textContent = "Copied";
    box.classList.add("copied");
    clearTimeout(btn._copiedTimer);
    btn._copiedTimer = setTimeout(() => {
      btn.querySelector(".cap-copy-label").textContent = "Copy";
      box.classList.remove("copied");
    }, COPIED_TIP_MS);
  });
}

// ── The page's one get_current_user call ──
// Dig the user-profile object out of the result, whichever shape it came in: the profile
// itself, a {user} or {profile} wrapper, or an MCP envelope holding either as JSON text.
function extractUserProfile(res) {
  const norm = c => (c && (c.user || c.profile)) || c;
  const isProfile = p => p && typeof p === "object"
    && ("pk" in p || "recommendations" in p || "has_cap_table" in p || "has_ctc" in p);
  for (const c of _mcpResultCandidates(res)) {
    const p = norm(c);
    if (isProfile(p)) return p;
  }
  return {};
}

// One boolean product flag off the profile. Anything that is not a real boolean (key
// absent, null, a staff account whose enrichment was stripped) reads as null: unknown.
function readProductFlag(profile, key) {
  const v = profile[key] !== undefined ? profile[key] : profile[key.toUpperCase()];
  return typeof v === "boolean" ? v : null;
}

// Fills "Suggested for you" and What's new from one profile. Both stay as they were
// painted at load (static prompts, the config cards in What's new) when the profile never
// arrives.
async function fetchUserEnrichment() {
  // The first-visit tour waits for this to settle (see _tourReady in tour.js).
  if (!(await mcpAvailable())) { _tourReady(); return; }
  try {
    // The Contentful fetch needs nothing from the profile, so it runs alongside it; the
    // skills join the carousel when they arrive.
    const whatsNewP = _listWhatsNewPrompts();
    const res = await _mcp("get_current_user", {});
    // A failed profile reads as no flags known, which keeps the config cards in What's new.
    const profile = res && res.isError ? {} : extractUserProfile(res);
    const shownAbove = renderCapabilities(profile.recommendations);
    // The microapps paint as soon as the profile says which ones the company has.
    renderWhatsNew(profile, [], shownAbove);
    whatsNewP
      .then(items => renderWhatsNew(profile, items, shownAbove))
      .catch(err => console.error("[captable-home] what's new skills failed — showing the microapps only", err));
  } catch (e) {
    console.log("[captable-home] get_current_user unavailable:", e && e.message);
  } finally {
    _tourReady();
  }
}

// An async function runs up to its first await at once, and that await settles only after
// the whole bundle has evaluated, so What's new's consts are initialized by the time it
// uses them.
renderCapabilities([]);
fetchUserEnrichment();
