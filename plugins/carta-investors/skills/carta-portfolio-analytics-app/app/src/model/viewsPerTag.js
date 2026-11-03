// One saved view per tag value (e.g. a view for each Lead), shared by every tab with saved views.
import { tagId } from "./tags.js";

export const viewNameFor = (cat, value) => `${cat}: ${value}`;

const nameKey = (s) => String(s || "").trim().toLowerCase();

/** Each new view copies `base` (the tab's current snapshot) and swaps its `cat`
 *  picks for one value; picks in other categories stay. A value whose view name
 *  exists is skipped, so a second click adds only new values. */
export function planViewsPerTag({ cat, values, base, existing = [], makeId }) {
  const catIds = new Set(values.map((v) => tagId(cat, v)));
  const keepTags = (base?.tags || []).filter((id) => !catIds.has(id));
  const taken = new Set(existing.map((v) => nameKey(v.name)));
  const views = [], skipped = [];
  for (const value of values) {
    const name = viewNameFor(cat, value);
    if (taken.has(nameKey(name))) { skipped.push(value); continue; }
    taken.add(nameKey(name));
    views.push({ id: makeId(), name, ...base, tags: [...keepTags, tagId(cat, value)] });
  }
  return { views, skipped };
}
