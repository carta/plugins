// Replaces the baked Skill Directory with the published list from plugin:list:skills,
// so a skill that ships after the build still appears without a rebuild.

const SKILL_DIRECTORY_PLUGIN = "carta-cap-table";

// The prompts arrive over the network now, so hold every entry to the same shape the
// baked list has; renderDirectory escapes what it prints either way.
function normalizeDirectoryEntries(raw) {
  if (!Array.isArray(raw)) return null;
  const known = new Set(DIR_CATEGORIES.map(cat => cat.id));
  const entries = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const name = typeof e.name === "string" ? e.name.trim() : "";
    const prompts = Array.isArray(e.prompts)
      ? e.prompts.filter(p => typeof p === "string" && p.trim()).map(p => p.trim())
      : [];
    if (!name || !known.has(e.category) || !prompts.length) continue;
    entries.push({
      skill: typeof e.skill === "string" ? e.skill : "",
      category: e.category,
      name,
      order: typeof e.order === "number" && isFinite(e.order) ? e.order : 0,
      prompts,
    });
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
    const entries = normalizeDirectoryEntries(extractDirectoryPayload(res)?.skills);
    if (!entries) return;
    _directorySkills = entries;
    renderDirectory();
    trackHome("render", "CaptableHome.Directory.Published");
  } catch (e) {
    console.log("[captable-home] published skill directory unavailable:", e && e.message);
  }
}

// Deferred so the read never competes with the first data paint.
setTimeout(loadPublishedDirectory, 0);
