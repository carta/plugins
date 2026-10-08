import { planId, defaultSector, defaultAllocation } from "./plan.js";
import { lightFees, lightPortfolio } from "./light.js";
import { reserveTarget } from "./followOns.js";

/** What a converted plan couldn't take from Light, for the user to review. */
export const NOT_CARRIED = [
  "How the portfolio turns out (the Failed to Unicorn table and its return shape). Advanced works outcomes out round by round, so the market starts at Typical.",
  "Follow-on timing in months. Advanced times follow-ons by round.",
];

/** A new Advanced plan filled in from a Light plan's assumptions as far as they go; the Light plan is left as it is. */
export function convertLightToAdvanced(plan, { now = new Date() } = {}) {
  const l = plan.light;
  const copy = structuredClone(plan);
  const name = `${plan.name} (Advanced)`;
  const at = now.toISOString();
  const general = { ...copy.general, closes: [{ month: 0, pct: 1 }] };
  const sector = defaultSector("Core");
  const alloc = defaultAllocation(sector, { name: "Core" });
  alloc.initialCheck = l.initialCheck;
  alloc.horizonMonths = Math.max(1, Math.round((general.investmentPeriodYears || 3) * 12));
  alloc.followOns = reserveTarget(alloc, sector, l.reservePct || 0).followOns;
  delete copy.light;
  delete copy.finalizedAt; // a new plan starts unfinalized, like a copy
  delete copy.copiedFrom;
  return {
    ...copy,
    id: planId(name),
    name,
    mode: "advanced",
    createdAt: at.slice(0, 10),
    updatedAt: at,
    general,
    fees: { ...structuredClone(l.fees), tiers: structuredClone(l.fees.tiers ?? []) },
    sectors: [sector],
    allocations: [alloc],
    target: { metric: "grossMoic", value: l.targetMoic ?? null },
    convertedFrom: { id: plan.id, name: plan.name, at, companies: lightPortfolio(l).companies, dismissed: false },
    // Fund terms came across; Market and Strategy are new in Advanced, so they wait to be confirmed.
    confirmed: plan.confirmed?.terms ? { terms: true } : {},
  };
}
