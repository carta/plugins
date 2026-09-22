// The favorite star, shared by the Company page header and the Dashboard rows so
// the two toggles behave and look identical. One click flips doc.favorites.
import { STAR_FILL, MICRO } from "./theme.js";
import { isFavorite, toggleFavorite } from "../model/favorites.js";
import { trackClick } from "../analytics.js";

const STAR = "M8 1.2l2.1 4.25 4.7.68-3.4 3.31.8 4.68L8 11.9 3.8 14.12l.8-4.68L1.2 6.13l4.7-.68z";

/** A one-click star toggling one company's favorite state. `compact` shrinks it
 *  for the dense Dashboard grid; the Company header uses the standard size.
 *  Renders nothing when it can't persist (no `onUpdate`) — a read-only surface
 *  shouldn't show a control that does nothing. */
export function FavoriteStar({ company, doc, onUpdate, compact = false }) {
  if (!onUpdate || !company?.id) return null;
  const on = isFavorite(doc, company.id);
  const size = compact ? 14 : 18;
  const label = on ? `Unfavorite ${company.name}` : `Favorite ${company.name}`;
  return (
    <button type="button" title={label} aria-label={label} aria-pressed={on}
      onClick={() => { trackClick("PortfolioAnalytics.Favorite.Toggle"); onUpdate((d) => toggleFavorite(d, company.id)); }}
      style={{ border: "none", background: "transparent", cursor: "pointer", padding: 0, margin: 0,
        lineHeight: 0, display: "inline-flex", alignItems: "center" }}>
      <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true"
        fill={on ? STAR_FILL : "none"} stroke={on ? STAR_FILL : MICRO} strokeWidth="1.3"
        strokeLinejoin="round">
        <path d={STAR} />
      </svg>
    </button>
  );
}
