// ── Skill directory search: which skills a typed search finds ──
// Reads DIR_CATEGORIES (carta-home.config.js), APP_TAG and APP_TAG_LABEL, and dirPlain() from
// directory-views.js at call time. Nothing here touches the page or runs at load.
//
// The rules, in order:
//   1. Exact pass: every meaningful typed word (about half of a long search) is found, from the start of
//      a word, in the skill's own name or prompts.
//   2. Category pass, only when no skill's own words match: the same, counting the name of the skill's
//      category too, so "lp" finds the skills under "LP reporting".
//   3. Close pass, only when those found nothing: the category's tagline and a hand-kept list of related
//      words count too.
//   4. Still typing: a short last word (two or three letters) counts as the start of a longer word, in the
//      skill's text or its category's name, so "po" finds the Portfolio skills on the way to "portfolio".
//   5. Nothing close: no skill. If a misspelling explains it, the corrected search is offered instead.
// It is rules, not AI: every result can be explained, and nothing leaves the page.

// A search shorter than this shows the normal view.
const DIR_SEARCH_MIN_CHARS = 2;
// A search with more meaningful words than this is not spell-corrected.
const DIR_SPELL_MAX_WORDS = 4;

// Words people use for the same job; typing one finds skills that hold any other word in its group.
// Kept by hand: a person who knows the skills should approve additions.
const DIR_SYNONYMS = [
  ["report", "reports", "reporting", "tear sheet", "deck", "presentation", "slides", "statement", "summary"],
  ["investor", "investors", "lp", "lps", "limited partner", "limited partners"],
  ["performance", "returns", "irr", "tvpi", "dpi", "moic", "benchmark", "benchmarks"],
  ["holdings", "investments", "portfolio", "companies", "schedule of investments", "soi"],
  ["budget", "budgeting", "fees", "expenses", "spend", "actuals", "costs", "cost", "plan", "planning"],
  ["valuation", "valuations", "marks", "value", "nav"],
  ["compliance", "regulatory", "regulation", "adv", "form pf", "filing", "filings", "paperwork", "sec"],
  ["accounting", "balance sheet", "p&l", "financials", "financial", "trial balance", "ledger"],
  ["model", "modeling", "forecast", "forecasting", "projection", "projected", "scenario", "scenarios", "worth", "end", "future"],
  ["document", "documents", "upload", "download", "file", "files", "lpa"],
  ["request", "requests", "fund admin", "support", "ask", "help"],
  ["app", "apps", "microapp", "microapps", "dashboard"],
  ["payout", "waterfall", "exit", "exits", "distribution", "distributions", "sells", "sell", "sold", "sale", "proceeds", "carry", "carried"],
  ["collect", "collection", "chase", "remind", "update", "updates", "numbers", "sent"],
];

// Words that surround a request without saying what it is about. Numbers are ignored too.
const DIR_STOP_WORDS = new Set([
  "a", "an", "the", "my", "our", "your", "me", "i", "we", "us", "you", "it", "its", "they", "them", "their",
  "to", "for", "of", "and", "or", "in", "on", "at", "by", "from", "with", "into", "up", "out", "as", "than", "then", "so", "if",
  "is", "are", "was", "were", "be", "been", "am", "do", "does", "did", "doing", "have", "has", "had", "will", "would", "could", "should", "can", "may", "might",
  "how", "what", "which", "who", "whom", "whose", "when", "where", "why", "this", "that", "these", "those", "there", "here",
  "all", "any", "some", "each", "every", "just", "also", "please", "like", "look", "looking", "much", "many", "more", "most", "not", "no", "yes", "now",
  "show", "make", "build", "get", "got", "give", "find", "tell", "use", "want", "need", "about", "send", "see", "check", "something", "anything", "thing",
]);

// ── Words ──
// Typed words, lowercased: possessives ("fund's") and punctuation are dropped.
function dirQueryTokens(query) {
  const text = String(query || "").trim();
  if (text.length < DIR_SEARCH_MIN_CHARS) return [];
  return text.toLowerCase()
    .replace(/[’']s\b/g, "").replace(/[’']/g, "")
    .replace(/[^a-z0-9&\s-]/g, " ").split(/\s+/).filter(Boolean);
}

// Plural endings: "valuations" = "valuation", "companies" = "company".
function dirStem(w) {
  if (w.length <= 3) return w;
  if (/ies$/.test(w)) return w.replace(/ies$/, "y");
  if (/(ss|us|is)$/.test(w)) return w;
  const base = w.replace(/(sses|xes|ches|shes)$/, m => m.slice(0, -2)).replace(/s$/, "");
  return base.length > 5 ? base.replace(/ing$/, "") : base;
}

// What the search is about: the typed words minus filler and numbers. All the words when that leaves none.
function dirContentWords(tokens) {
  const words = tokens.filter(w => !DIR_STOP_WORDS.has(w) && !/^\d+$/.test(w));
  return words.length ? words : tokens;
}

// How many content words a skill must hold: all of one or two, about half of a longer ask.
const dirWordsNeeded = n => (n <= 2 ? n : Math.ceil(n / 2));

const dirEscapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Whether the text holds the word at the start of one of its words, so "form" finds "Form ADV" but not
// "performance". Words of three letters or fewer must be the whole word, so "lps" does not hit "LPA".
function dirHas(hay, w) {
  const stem = dirStem(w);
  const start = "(^|[^a-z0-9&])";
  if (stem.length < 4) return new RegExp(start + dirEscapeRegExp(stem) + "($|[^a-z0-9&])").test(hay);
  const plural = stem.endsWith("y") ? "|" + dirEscapeRegExp(stem.slice(0, -1)) + "ies" : "";
  return new RegExp(start + "(" + dirEscapeRegExp(stem) + plural + ")").test(hay);
}

// ── What a skill holds ──
// The plain, lowercased text of a skill's prompts: what every pass searches and the spell-fix learns from.
const dirPromptText = entry => entry.prompts.map(dirPlain).join(" ").toLowerCase();

// The skill's own words: its name and prompts, plus "microapp" for a microapp. `scope` widens it: DIR_OWN
// is the skill's own words, DIR_WITH_CATEGORY adds its category's name, DIR_WITH_TAGLINE the tagline too.
const DIR_OWN = 0;
const DIR_WITH_CATEGORY = 1;
const DIR_WITH_TAGLINE = 2;
function dirHaystack(entry, scope = DIR_OWN) {
  const category = scope >= DIR_WITH_CATEGORY ? (DIR_CATEGORIES.find(c => c.id === entry.category) || {}) : {};
  return [entry.name, category.name, scope >= DIR_WITH_TAGLINE ? category.tagline : "", entry.tag === APP_TAG ? APP_TAG_LABEL : ""]
    .concat(dirPromptText(entry)).join(" ").toLowerCase();
}

function dirHitCount(entry, tokens, scope) {
  const hay = dirHaystack(entry, scope);
  return dirContentWords(tokens).filter(w => dirHas(hay, w)).length;
}

function dirMatches(entry, tokens, scope) {
  return dirHitCount(entry, tokens, scope) >= dirWordsNeeded(dirContentWords(tokens).length);
}

// Close pass: a word the skill holds scores 2, a related word it holds scores 1. A skill that does not
// account for enough of the search scores 0.
function dirRelevance(entry, tokens) {
  const hay = dirHaystack(entry, DIR_WITH_TAGLINE);
  const words = dirContentWords(tokens);
  // A related phrase typed as consecutive words ("limited partners") selects its group for each word in it.
  const typed = " " + tokens.join(" ") + " ";
  const phrases = DIR_SYNONYMS.map(g => ({ g, hit: g.filter(x => x.includes(" ") && typed.includes(" " + x + " ")) })).filter(p => p.hit.length);
  let score = 0;
  let hits = 0;
  for (const w of words) {
    if (dirHas(hay, w)) { score += 2; hits++; continue; }
    const groups = DIR_SYNONYMS.filter(g => g.some(x => x === w || dirStem(x) === dirStem(w)))
      .concat(phrases.filter(p => p.hit.some(x => x.split(" ").includes(w))).map(p => p.g));
    if (groups.some(g => g.some(x => dirHas(hay, x)))) { score += 1; hits++; }
  }
  return hits >= dirWordsNeeded(words.length) ? score : 0;
}

// The best of the skills that passed: a typed word in the skill's name counts most, in its prompts less.
// When the top two are level, no skill is chosen rather than picking by list order.
function dirBestSkill(entries, tokens) {
  if (entries.length === 1) return entries[0];
  const words = dirContentWords(tokens);
  const rank = e => {
    const name = e.name.toLowerCase();
    const prompts = dirPromptText(e);
    return words.reduce((sum, w) => sum + (dirHas(name, w) ? 4 : dirHas(prompts, w) ? 2 : 0), 0);
  };
  const ranked = entries.map(e => [e, rank(e)]).sort((x, y) => y[1] - x[1]);
  return ranked[0][1] > ranked[1][1] ? ranked[0][0] : null;
}

// ── Typing ahead ──
// Whether the skill holds a word starting with the search's last word, when that word is short enough to
// have been cut off mid-typing (the category's name counts), and enough of the other words in the skill's
// own name and prompts to pass. Words of four letters or more
// already match from their start.
function dirTypingAhead(entry, tokens) {
  const words = dirContentWords(tokens);
  const last = words[words.length - 1];
  if (last !== tokens[tokens.length - 1] || last.length < DIR_SEARCH_MIN_CHARS || last.length > 3) return false;
  const starts = new RegExp("(^|[^a-z0-9&])" + dirEscapeRegExp(last)).test(dirHaystack(entry, DIR_WITH_TAGLINE));
  const own = dirHaystack(entry);
  const others = words.slice(0, -1).filter(w => dirHas(own, w)).length;
  return starts && others + 1 >= dirWordsNeeded(words.length);
}

// ── Spelling ──
// Edit distance with an adjacent swap counted as one slip ("valutaions" is 1 from "valuations").
function dirEditDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// Words of five letters or more the directory uses: skill names, prompts and the related-word groups.
function dirVocabulary(entries) {
  const words = new Set();
  const add = text => String(text).toLowerCase().split(/[^a-z0-9&-]+/).forEach(w => { if (w.length >= 5) words.add(w); });
  entries.forEach(e => { add(e.name); add(dirPromptText(e)); });
  DIR_SYNONYMS.forEach(g => g.forEach(add));
  return [...words];
}

// A search with every misspelled word replaced, or "" when nothing needed fixing or a word could not
// be fixed. Only words of five letters or more are touched, only in searches of four meaningful words or
// fewer (a long ask is mostly everyday words), and never a word the directory already uses or starts
// like one ("quarterly" is left alone).
function dirSpellFix(entries, tokens) {
  if (dirContentWords(tokens).length > DIR_SPELL_MAX_WORDS) return "";
  const vocab = dirVocabulary(entries);
  const stems = vocab.map(w => [w, dirStem(w)]);
  let changed = false;
  const fixed = tokens.map(t => {
    if (DIR_STOP_WORDS.has(t) || t.length < 5) return t;
    const stem = dirStem(t);
    if (stems.some(([w, st]) => w === t || st === stem || (w.length >= 5 && (t.startsWith(w) || w.startsWith(t))))) return t;
    const limit = t.length >= 9 ? 2 : 1;
    let best = null;
    for (const [w, st] of stems) {
      const dist = Math.min(dirEditDistance(stem, st), dirEditDistance(t, w));
      if (dist <= limit && (!best || dist < best.dist)) best = { w, dist };
    }
    if (!best) return t;
    changed = true;
    return best.w;
  });
  return changed ? fixed.join(" ") : "";
}

// ── Searching ──
// { skills, related, best, didYouMean }: `related` says the skills are close matches and not exact ones;
// `best` is the skill to tag as the best match (exact matches only), or null; `didYouMean` is a corrected
// search that does find skills, set only when `skills` is empty. `skills` is empty when nothing is close.
function dirSearch(entries, query) {
  const tokens = dirQueryTokens(query);
  if (!tokens.length) return { skills: entries, related: false, best: null, didYouMean: "" };
  // Several can pass: keep those holding the most typed words.
  const exact = scope => {
    const passed = entries.filter(e => dirMatches(e, tokens, scope));
    const top = Math.max(0, ...passed.map(e => dirHitCount(e, tokens, scope)));
    return passed.filter(e => dirHitCount(e, tokens, scope) === top);
  };
  let skills = exact(DIR_OWN);
  if (!skills.length) skills = exact(DIR_WITH_CATEGORY);
  if (skills.length) return { skills, related: false, best: dirBestSkill(skills, tokens), didYouMean: "" };
  const scored = entries.map(e => [e, dirRelevance(e, tokens)]).filter(p => p[1] > 0);
  const top = Math.max(0, ...scored.map(p => p[1]));
  skills = scored.filter(p => p[1] >= Math.max(1, top - 1)).sort((x, y) => y[1] - x[1]).map(p => p[0]);
  if (skills.length) return { skills, related: true, best: null, didYouMean: "" };
  skills = entries.filter(e => dirTypingAhead(e, tokens));
  if (skills.length) return { skills, related: false, best: null, didYouMean: "" };
  const fixed = dirSpellFix(entries, tokens);
  const check = fixed ? dirSearch(entries, fixed).skills.length : 0;
  return { skills: [], related: false, best: null, didYouMean: check ? fixed : "" };
}
