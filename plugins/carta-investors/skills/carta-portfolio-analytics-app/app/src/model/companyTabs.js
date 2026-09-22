// The Company page's tabs and the cards each one owns. One mapping drives the
// tab bar, the URL segment and the order the printed tearsheet stacks them in.
export const COMPANY_TABS = [
  { id: "summary", label: "Summary",
    cards: ["signals", "kpiSnapshot", "qualitative", "returns", "valuation", "credit"] },
  { id: "captable", label: "Cap table", cards: ["captable", "soiPerformance"] },
  { id: "forecast", label: "Forecast", cards: ["forecast"] },
];

// Notes sits below the tabs on every tab, so a deep link to it opens Summary.
const NOTES = "notes";

const tabOfCard = (cardId) => COMPANY_TABS.find((t) => t.cards.includes(cardId))?.id || null;

/** Turn the URL's second segment into { tab, anchor }. Accepts a tab id or a
 *  card id from an older link; anything else, or a hidden tab, opens Summary. */
export function resolveCompanySub(sub, visibleTabIds) {
  const summary = { tab: "summary", anchor: null };
  if (!sub) return summary;
  if (visibleTabIds.includes(sub)) return { tab: sub, anchor: null };
  if (COMPANY_TABS.some((t) => t.id === sub)) return summary;
  if (sub === NOTES) return { tab: "summary", anchor: NOTES };
  const owner = tabOfCard(sub);
  return owner && visibleTabIds.includes(owner) ? { tab: owner, anchor: sub } : summary;
}
