// Replaces the baked Skill Directory with the published list from plugin:list:skills, so a
// skill that ships after the build still appears without a rebuild.
// Depends on core.js (carta-home.app.js): _mcp(), mcpAvailable(), tryParse(),
// _mcpResultCandidates(), renderDirectory(), DIR_CATEGORIES, BAKED_SKILL_DIRECTORY, and
// PLUGIN from version-check.js.

// The list arrives over the network, so hold every entry to the shape the baked list has;
// the renderer escapes what it prints either way. `tag` and `requires` are optional, and
// an entry that omits one keeps the baked value for that skill, so a server that does not
// pass them through yet cannot drop a skill's App tag or entitlement gate.
function normalizeDirectoryEntries(raw, baked) {
  if (!Array.isArray(raw)) return null;
  const known = new Set(DIR_CATEGORIES.map(cat => cat.id));
  const bakedBySkill = new Map((baked || []).map(e => [e.skill, e]));
  const entries = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const name = typeof e.name === "string" ? e.name.trim() : "";
    const prompts = Array.isArray(e.prompts)
      ? e.prompts.filter(p => typeof p === "string" && p.trim()).map(p => p.trim())
      : [];
    if (!name || !known.has(e.category) || !prompts.length) continue;
    const skill = typeof e.skill === "string" ? e.skill : "";
    const fallback = bakedBySkill.get(skill) || {};
    const entry = {
      skill,
      category: e.category,
      name,
      order: typeof e.order === "number" && isFinite(e.order) ? e.order : 0,
      prompts,
    };
    for (const key of ["tag", "requires"]) {
      const value = typeof e[key] === "string" && e[key].trim() ? e[key].trim() : fallback[key];
      if (value) entry[key] = value;
    }
    entries.push(entry);
  }
  // An empty list reads as "every skill is gone", which is never the right thing to show
  // — keep the baked list instead.
  return entries.length ? entries : null;
}

function extractDirectoryPayload(res) {
  const candidates = typeof res === "string" ? [tryParse(res)] : _mcpResultCandidates(res);
  for (const c of candidates) {
    if (c && typeof c === "object" && "skills" in c) return c;
  }
  return null;
}

// Silent on every failure: the baked list is already on screen and stays there.
async function loadPublishedDirectory() {
  if (!(await mcpAvailable())) return;
  try {
    const res = await _mcp("fetch", {
      command: "plugin:list:skills",
      params: { plugin: PLUGIN },
    });
    const entries = normalizeDirectoryEntries(extractDirectoryPayload(res)?.skills, BAKED_SKILL_DIRECTORY);
    if (!entries || JSON.stringify(entries) === JSON.stringify(_directorySkills)) return;
    _directorySkills = entries;
    // The directory tab paints from _directorySkills when it opens, so there is nothing
    // to redraw until then.
    if (_dirTabOpened) renderDirectory();
    trackHome("render", "CartaHome.Directory.Published");
  } catch (e) {
    console.log("[carta-home] published skill directory unavailable:", e && e.message);
  }
}

// Started here rather than from the Init block in core.js: the bundle is one script, so
// core.js's init runs before this file's `const`s are initialized and would hit the
// temporal dead zone. Held until the browser is idle so the read never competes with the
// first data paint; the timeout keeps it from waiting forever on a busy page.
if (typeof requestIdleCallback === "function") requestIdleCallback(loadPublishedDirectory, { timeout: 3000 });
else setTimeout(loadPublishedDirectory, 0);
