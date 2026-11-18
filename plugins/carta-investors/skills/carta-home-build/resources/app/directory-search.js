// ── Skill directory search: which skills a typed search finds ──
// Reads DIR_CATEGORIES (carta-home.config.js), APP_TAG and APP_TAG_LABEL, and dirPlain() from
// directory-views.js at call time. Nothing here touches the page or runs at load.
//
// The rules, in order:
//   1. Exact pass: every meaningful typed word (about half of a long search) is found, from the start of
//      a word, in the skill's own words: its name, its category's name and its prompts. The last word
//      typed may still be cut off, so it matches the start of any word ("fun" finds "fund", "up" finds
//      "upload"). The words searched never change with the search's length, so results only narrow as
//      you type. Filler words in a skill's text are not searched, so "up" is not found in "spin up".
//   2. Close pass, only when the exact pass found nothing: the category's tagline and a hand-kept list of
//      related words count too.
//   3. Nothing close: no skill. If a misspelling explains it, the corrected search is offered instead.
// A typed word also matches the other forms of a word (plurals, -ing, -ed, a doubled last letter, a final
// "e"), so "valuations", "modelling" and "compare" match "valuation", "modeling" and "comparing". Every
// typed letter still counts: "fees" does not find "feedback".
// It is rules, not AI: every result can be explained, and nothing leaves the page.

// A search shorter than this shows the normal view, and a last word shorter than this is not read as the
// start of a longer one.
const DIR_SEARCH_MIN_CHARS = 2;
// A search with more meaningful words than this is not spell-corrected.
const DIR_SPELL_MAX_WORDS = 4;
// Past this many close matches, only the best-scoring stay.
const DIR_CLOSE_MAX = 6;

// Words people use for the same job; typing one finds skills that hold any other word in its group.
// Kept by hand: a person who knows the skills should approve additions.
const DIR_SYNONYMS = [
  ["report", "reports", "reporting", "tear sheet", "deck", "presentation", "slides", "statement", "summary", "quarterly", "one pager", "letter"],
  ["investor", "investors", "lp", "lps", "limited partner", "limited partners"],
  ["performance", "returns", "irr", "tvpi", "dpi", "moic", "benchmark", "benchmarks"],
  ["holdings", "investments", "portfolio", "companies", "schedule of investments", "soi", "portco", "portcos", "portfolio company"],
  ["budget", "budgeting", "fees", "expenses", "spend", "actuals", "costs", "cost", "plan", "planning"],
  ["valuation", "valuations", "marks", "value", "nav"],
  ["compliance", "regulatory", "regulation", "adv", "form pf", "filing", "filings", "paperwork", "sec"],
  ["accounting", "balance sheet", "p&l", "financials", "financial", "trial balance", "ledger"],
  ["model", "modeling", "forecast", "forecasting", "projection", "projected", "scenario", "scenarios", "worth", "end", "future"],
  ["document", "documents", "docs", "upload", "download", "file", "files", "lpa"],
  ["request", "requests", "fund admin", "support", "ask", "help"],
  ["app", "apps", "microapp", "microapps", "dashboard"],
  ["payout", "waterfall", "exit", "exits", "distribution", "distributions", "sells", "sell", "sold", "sale", "proceeds", "carry", "carried"],
  ["collect", "collection", "chase", "remind", "update", "updates", "numbers", "sent"],
  ["manco", "man co", "mgmt co", "management company"],
  ["brand", "branding", "logo", "logos", "colors", "colours", "fonts"],
  ["co-investor", "coinvest", "syndicate", "who else invested", "other investors"],
  ["reconciliation", "reconcile", "bank", "cash"],
  ["ownership", "stake", "stakes", "cap table"],
];

// Words that surround a request without saying what it is about. Numbers are ignored too.
const DIR_STOP_WORDS = new Set([
  "a", "an", "the", "my", "our", "your", "me", "i", "we", "us", "you", "it", "its", "they", "them", "their",
  "to", "for", "of", "and", "or", "in", "on", "at", "by", "from", "with", "into", "up", "out", "as", "than", "then", "so", "if",
  "is", "are", "was", "were", "be", "been", "am", "do", "does", "did", "doing", "have", "has", "had", "will", "would", "could", "should", "can", "may", "might",
  "how", "what", "which", "who", "whom", "whose", "when", "where", "why", "this", "that", "these", "those", "there", "here",
  "all", "any", "some", "each", "every", "just", "also", "please", "like", "look", "looking", "much", "many", "more", "most", "not", "no", "yes", "now",
  "show", "make", "build", "get", "got", "give", "find", "tell", "use", "want", "need", "about", "send", "see", "check", "something", "anything", "thing",
  "vs", "versus",
]);

// ── Words ──
// Typed text and a skill's text, lowercased, with possessives ("fund's"), apostrophes and dots dropped, so
// "A.G.M." is "agm" wherever it is written.
const dirNormalize = text => String(text || "").toLowerCase().replace(/[’']s\b/g, "").replace(/[’'.]/g, "");

// Typed words: other punctuation splits words; a hyphenated word ("tear-sheet") stays one word.
function dirQueryTokens(query) {
  const text = String(query || "").trim();
  if (text.length < DIR_SEARCH_MIN_CHARS) return [];
  return dirNormalize(text)
    .replace(/[^a-z0-9&\s-]/g, " ").split(/\s+/)
    .map(w => w.replace(/^-+|-+$/g, "")).filter(Boolean);
}

// A plural made singular: "valuations" is "valuation", "companies" is "company", "taxes" is "tax".
function dirSingular(w) {
  if (w.length <= 3) return w;
  if (/ies$/.test(w)) return w.slice(0, -3) + "y";
  if (/(sses|xes|ches|shes)$/.test(w)) return w.slice(0, -2);
  if (/s$/.test(w) && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

// A word with its ending set aside, so forms of one word compare equal: "valuations" and "valuation",
// "modelling" and "modeling", "budgeting" and "budget", "invested" and "investing", "compare" and "comparing".
function dirStem(w) {
  if (w.length <= 3) return w;
  let s = dirSingular(w);
  if (s.length > 5 && /ing$/.test(s)) s = s.slice(0, -3);
  else if (s.length > 5 && /ed$/.test(s)) s = s.slice(0, -2);
  if (s.length > 4 && /([bdglmnprt])\1$/.test(s)) s = s.slice(0, -1);
  if (s.length > 4 && /e$/.test(s)) s = s.slice(0, -1);
  return s;
}

// What the search is about: the typed words minus filler and numbers. All the words when that leaves none.
function dirContentWords(tokens) {
  const words = tokens.filter(w => !DIR_STOP_WORDS.has(w) && !/^\d+$/.test(w));
  return words.length ? words : tokens;
}

// How many content words a skill must hold: all of one or two, about half of a longer ask.
const dirWordsNeeded = n => (n <= 2 ? n : Math.ceil(n / 2));

// A text's searchable words, without filler unless `keepFiller`. A hyphenated word gives itself, its
// parts and its parts joined: "co-investor" gives "co-investor", "co", "investor" and "coinvestor".
function dirTextWords(text, keepFiller) {
  const words = new Set();
  dirNormalize(text)
    .split(/[^a-z0-9&-]+/).forEach(chunk => {
      const parts = chunk.split("-").filter(Boolean);
      if (parts.length > 1) { words.add(parts.join("-")); words.add(parts.join("")); }
      parts.forEach(p => words.add(p));
    });
  return [...words].filter(w => (keepFiller || !DIR_STOP_WORDS.has(w)) && !/^\d+$/.test(w));
}

// Whether a typed word is in a list of words. It matches another form of the same word ("valuations"
// finds "valuation", "modelling" finds "modeling"). A typed word of four letters or more also matches the
// start of a word, as typed or made singular ("invest" finds "investors", "builds" finds "builder"), but
// every typed letter counts: "fees" does not find "feedback", nor "state" "status". A finished shorter
// word must be a form of the whole word, so "lps" does not hit "LPA"; an `unfinished` word, the last one
// typed, matches the start of a word at any length. A hyphenated word matches as itself, joined up, or
// part by part.
function dirHas(words, w, unfinished) {
  if (w.includes("-")) {
    const parts = w.split("-").filter(Boolean);
    return dirHas(words, parts.join(""), unfinished)
      || parts.every((p, i) => dirHas(words, p, unfinished && i === parts.length - 1));
  }
  const stem = dirStem(w);
  const singular = dirSingular(w);
  const isForm = h => dirStem(h) === stem;
  if (!unfinished && w.length <= 3) return words.some(isForm);
  return words.some(h => h.startsWith(w) || (singular.length >= 4 && h.startsWith(singular)) || isForm(h));
}

// ── What a skill holds ──
// The plain text of a skill's prompts.
const dirPromptText = entry => entry.prompts.map(dirPlain).join(" ");

// A skill's words, worked out once per skill: `name`, `category` (its category's name) and `prompts`
// (plus "microapp" for a microapp) are its own words; `wide` adds the category's tagline, for close
// matches; `all` keeps filler, for a search typed only in filler; `text` is the plain text, for phrases.
const _dirSkillWords = new WeakMap();
function dirSkillWords(entry) {
  if (_dirSkillWords.has(entry)) return _dirSkillWords.get(entry);
  const category = DIR_CATEGORIES.find(c => c.id === entry.category) || {};
  const prompts = dirPromptText(entry);
  const name = dirTextWords(entry.name);
  const categoryName = dirTextWords(category.name);
  const promptWords = dirTextWords(prompts).concat(entry.tag === APP_TAG ? dirTextWords(APP_TAG_LABEL) : []);
  const own = [...new Set(name.concat(categoryName, promptWords))];
  const words = {
    name,
    category: categoryName,
    prompts: promptWords,
    own,
    wide: [...new Set(own.concat(dirTextWords(category.tagline)))],
    all: dirTextWords([entry.name, category.name, prompts].join(" "), true),
    text: " " + dirNormalize([entry.name, category.name, category.tagline, prompts].join(" ")).replace(/[^a-z0-9&]+/g, " ") + " ",
  };
  _dirSkillWords.set(entry, words);
  return words;
}

// ── The typed search ──
// Its tokens, its content words, whether its last word may be cut off mid-word, and whether it is only filler.
function dirParse(query) {
  const tokens = dirQueryTokens(query);
  const words = dirContentWords(tokens);
  const last = words[words.length - 1];
  return {
    tokens,
    words,
    openLast: !!last && last === tokens[tokens.length - 1] && last.length >= DIR_SEARCH_MIN_CHARS,
    fillerOnly: tokens.every(t => DIR_STOP_WORDS.has(t)),
  };
}
const dirIsOpen = (q, i) => q.openLast && i === q.words.length - 1;

function dirHitCount(entry, q, scope = "own") {
  const words = dirSkillWords(entry)[scope];
  return q.words.filter((w, i) => dirHas(words, w, dirIsOpen(q, i))).length;
}

// ── Close pass ──
// A related word in the skill's name or category scores 1; one only in its prompts or tagline, 0.5.
function dirGroupScore(entry, group) {
  const sw = dirSkillWords(entry);
  const head = sw.name.concat(sw.category);
  const headText = " " + head.join(" ") + " ";
  const holds = (words, text) => group.some(x => (x.includes(" ") ? text.includes(" " + x + " ") : dirHas(words, x, false)));
  if (holds(head, headText)) return 1;
  return holds(sw.wide, sw.text) ? 0.5 : 0;
}

// A word the skill holds (its tagline counts) scores 2; a word from the same related-word group scores up
// to 1. A related phrase typed as words ("tear sheets") is one idea: its words score only through the
// phrase's group, unless the skill holds the phrase itself, so "sheet" alone does not pick "balance sheet".
// A phrase typed as one word ("tear-sheet", "tearsheet") brings in its group the same way.
// A skill that does not account for enough of the search scores 0.
function dirRelevance(entry, q) {
  const stemmed = text => " " + text.split(" ").map(dirStem).join(" ") + " ";
  const joined = text => dirStem(text.replace(/[\s-]+/g, ""));
  const typed = stemmed(q.tokens.join(" "));
  // Each group with the related phrases (its entries with a space) that pass match, leaving out groups with none.
  const phraseGroups = match => DIR_SYNONYMS.map(g => ({ g, hit: g.filter(x => x.includes(" ") && match(x)) })).filter(p => p.hit.length);
  const phrases = phraseGroups(x => typed.includes(stemmed(x)));
  const inPhrase = w => phrases.filter(p => p.hit.some(x => x.split(" ").map(dirStem).includes(dirStem(w))));
  const spelledOut = w => phraseGroups(x => joined(x) === joined(w));
  const sw = dirSkillWords(entry);
  const holdsPhrase = list => list.some(p => p.hit.some(x => sw.text.includes(" " + x + " ")));
  let score = 0;
  let hits = 0;
  q.words.forEach((w, i) => {
    const typedIn = inPhrase(w);
    const whole = spelledOut(w);
    const holdsWord = typedIn.length ? holdsPhrase(typedIn) : dirHas(sw.wide, w, dirIsOpen(q, i)) || holdsPhrase(whole);
    if (holdsWord) { score += 2; hits++; return; }
    const groups = DIR_SYNONYMS.filter(g => g.some(x => x === w || dirStem(x) === dirStem(w))).concat(typedIn.map(p => p.g), whole.map(p => p.g));
    const best = Math.max(0, ...groups.map(g => dirGroupScore(entry, g)));
    if (best) { score += best; hits++; }
  });
  return hits >= dirWordsNeeded(q.words.length) ? score : 0;
}

// The closest skills, best first: those within a point of the top score, or only the top scorers when
// that is more than DIR_CLOSE_MAX.
function dirClosest(entries, q) {
  const scored = entries.map(e => [e, dirRelevance(e, q)]).filter(p => p[1] > 0);
  const top = Math.max(0, ...scored.map(p => p[1]));
  const near = scored.filter(p => p[1] >= top - 1);
  const kept = near.length > DIR_CLOSE_MAX ? scored.filter(p => p[1] === top) : near;
  return kept.sort((x, y) => y[1] - x[1]).map(p => p[0]);
}

// The best of the skills that passed: a typed word in the skill's name counts most, then in its category's
// name, then in its prompts. When the top two are level, no skill is chosen rather than picking by list order.
function dirBestSkill(entries, q) {
  if (entries.length === 1) return entries[0];
  const rank = e => {
    const sw = dirSkillWords(e);
    return q.words.reduce((sum, w, i) => {
      const open = dirIsOpen(q, i);
      return sum + (dirHas(sw.name, w, open) ? 4 : dirHas(sw.category, w, open) ? 3 : dirHas(sw.prompts, w, open) ? 2 : 0);
    }, 0);
  };
  const ranked = entries.map(e => [e, rank(e)]).sort((x, y) => y[1] - x[1]);
  return ranked[0][1] > ranked[1][1] ? ranked[0][0] : null;
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

// Words of five letters or more the directory uses: the skills' own words and the related-word groups.
function dirVocabulary(entries) {
  const words = new Set();
  const add = list => list.forEach(w => { if (w.length >= 5) words.add(w); });
  entries.forEach(e => add(dirSkillWords(e).own));
  DIR_SYNONYMS.forEach(g => g.forEach(x => add(dirTextWords(x))));
  return [...words];
}

// A search with every misspelled word replaced, or "" when nothing needed fixing or a word could not
// be fixed. Only words of five letters or more are touched, only in searches of four meaningful words or
// fewer (a long ask is mostly everyday words), and never a word the directory already uses or starts
// like one ("quarterly" is left alone). Of equally close fixes, the one nearest the word as typed wins.
function dirSpellFix(entries, tokens) {
  if (dirContentWords(tokens).length > DIR_SPELL_MAX_WORDS) return "";
  const stems = dirVocabulary(entries).map(w => [w, dirStem(w)]);
  let changed = false;
  const fixed = tokens.map(t => {
    if (DIR_STOP_WORDS.has(t) || t.length < 5) return t;
    const stem = dirStem(t);
    if (stems.some(([w, st]) => w === t || st === stem || t.startsWith(w) || w.startsWith(t))) return t;
    const limit = t.length >= 9 ? 2 : 1;
    let best = null;
    for (const [w, st] of stems) {
      const raw = dirEditDistance(t, w);
      const dist = Math.min(dirEditDistance(stem, st), raw);
      if (dist <= limit && (!best || dist < best.dist || (dist === best.dist && raw < best.raw))) best = { w, dist, raw };
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
  const q = dirParse(query);
  if (!q.tokens.length) return { skills: entries, related: false, best: null, didYouMean: "" };
  const need = dirWordsNeeded(q.words.length);
  const passing = scope => entries.map(e => [e, dirHitCount(e, q, scope)]).filter(p => p[1] >= need);
  let passed = passing("own");
  // A search typed only in filler ("show"): when no word starts that way, the filler in skills counts.
  if (!passed.length && q.fillerOnly) passed = passing("all");
  if (passed.length) {
    // Several can pass: keep those holding the most typed words.
    const top = Math.max(...passed.map(p => p[1]));
    const skills = passed.filter(p => p[1] === top).map(p => p[0]);
    return { skills, related: false, best: dirBestSkill(skills, q), didYouMean: "" };
  }
  const skills = dirClosest(entries, q);
  if (skills.length) return { skills, related: true, best: null, didYouMean: "" };
  const fixed = dirSpellFix(entries, q.tokens);
  const check = fixed ? dirSearch(entries, fixed).skills.length : 0;
  return { skills: [], related: false, best: null, didYouMean: check ? fixed : "" };
}
