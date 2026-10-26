// Replaces the baked Skill Directory with the published list from plugin:list:skills,
// so a skill that ships after the build still appears without a rebuild.
// Depends on captable-home.app.js: _mcp(), mcpAvailable(), renderDirectory(), DIR_CATEGORIES,
// BAKED_SKILL_DIRECTORY; and wnRefresh() from app/whats-new.js.

const SKILL_DIRECTORY_PLUGIN = "carta-cap-table";

// Published entries arrive over the network, so each is held to the baked shape. An entry
// that omits `tag` or `whatsNew` keeps the baked value for that skill.
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
    const tag = typeof e.tag === "string" && e.tag.trim() ? e.tag.trim() : fallback.tag;
    if (tag) entry.tag = tag;
    const whatsNew = typeof e.whatsNew === "boolean" ? e.whatsNew : fallback.whatsNew;
    if (typeof whatsNew === "boolean") entry.whatsNew = whatsNew;
    entries.push(entry);
  }
  // An empty list reads as "every skill is gone", which is never the right thing to
  // show — keep the baked list instead.
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
      params: { plugin: SKILL_DIRECTORY_PLUGIN },
    });
    const entries = normalizeDirectoryEntries(extractDirectoryPayload(res)?.skills, BAKED_SKILL_DIRECTORY);
    if (!entries || JSON.stringify(entries) === JSON.stringify(_directorySkills)) return;
    _directorySkills = entries;
    // What's new re-picks its skills against the published list.
    wnRefresh();
    renderDirectory();
    trackHome("render", "CaptableHome.Directory.Published");
  } catch (e) {
    console.log("[captable-home] published skill directory unavailable:", e && e.message);
  }
}

// Deferred so the read never competes with the first data paint.
setTimeout(loadPublishedDirectory, 0);
