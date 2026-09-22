// Favorites — a one-click "star" a user puts on the companies they watch most.
// Stored as a flat list of company ids on the dashboard doc (beside userTags),
// so a star is just "id present in doc.favorites". Absence = not favorited, so
// nothing per-company needs migrating and an older doc simply starts empty.
//
// On a firm's first load we pre-star the top quartile by position size (total
// cost basis), so the list isn't empty on day one. That seed runs exactly ONCE
// — recorded by doc.seededFavorites — so a user who un-stars an auto-pick never
// sees it silently return, and manual stars are never overridden later. This
// mirrors seededFormulas in model/formula.js.

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Position size for concentration ranking: total invested (cost basis). */
export const costBasisOf = (company) => num(company?.returns?.cost);

/** The favorited company ids on this doc. Always an array. */
export function favoritesOf(doc) {
  return Array.isArray(doc?.favorites) ? doc.favorites : [];
}

/** Is this company starred? */
export function isFavorite(doc, companyId) {
  return favoritesOf(doc).includes(companyId);
}

/** How many companies are starred — for the filter chip's count. */
export const favoriteCount = (doc) => favoritesOf(doc).length;

/** Reducer: flip a company's star. Mutates and returns the caller's doc clone,
 *  per dashboard.update. No-ops on a falsy id. */
export function toggleFavorite(doc, companyId) {
  if (!companyId) return doc;
  const list = favoritesOf(doc);
  doc.favorites = list.includes(companyId)
    ? list.filter((id) => id !== companyId)
    : [...list, companyId];
  return doc;
}

/** The ids of the top quartile by cost basis (largest positions first).
 *  Only companies with a positive finite cost basis are eligible, so a firm
 *  that reports no cost bases seeds nothing rather than starring blanks. */
export function topQuartileByCostBasis(companies) {
  const ranked = (companies || [])
    .map((c) => ({ id: c.id, cost: costBasisOf(c) }))
    .filter((c) => c.cost != null && c.cost > 0)
    .sort((a, b) => b.cost - a.cost);
  if (!ranked.length) return [];
  // Top 25%, at least one so a tiny portfolio still gets a starter star.
  const cut = Math.max(1, Math.ceil(ranked.length * 0.25));
  return ranked.slice(0, cut).map((c) => c.id);
}

/** Seed favorites ONCE with the top quartile by cost basis.
 *
 *  Returns a new doc, or null when there is nothing to do (already seeded, or no
 *  companies) so the caller can skip the write entirely. Marks the doc seeded
 *  even when nothing qualifies, so an all-blank firm isn't re-ranked every load.
 */
export function seedFavorites(doc, companies) {
  if (!doc || doc.seededFavorites) return null;
  if (!companies || !companies.length) return null;
  const picks = topQuartileByCostBasis(companies);
  // Union with any existing stars — never clobber a manual pick made before seed.
  const existing = favoritesOf(doc);
  const merged = [...existing];
  for (const id of picks) if (!merged.includes(id)) merged.push(id);
  return { ...doc, favorites: merged, seededFavorites: true };
}
