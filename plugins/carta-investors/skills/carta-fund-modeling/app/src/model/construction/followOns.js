import { defaultFollowOns } from "./plan.js";
import { companyTemplate } from "./engine.js";

export const FOLLOW_ON_PRESETS = [
  { id: "standard", short: "Pro-rata", label: "Pro-rata in the next two rounds", blurb: "Keeps your ownership in the next two rounds, following on in 60% then 40% of the companies that raise them." },
  { id: "none", short: "No follow-ons", label: "No follow-ons", blurb: "First checks only. All of the allocation's capital goes into new companies." },
  { id: "custom", short: "Custom", label: "Custom, round by round", blurb: "Choose the strategy (pro-rata, a fixed amount or none), the check and the participation for every later round." },
];

const sameRules = (a, b) => a.length === b.length && a.every((f, i) => (!f && !b[i])
  || (f && b[i] && f.mode === b[i].mode && (f.participation ?? 0) === (b[i].participation ?? 0) && (f.mode !== "amount" || f.amount === b[i].amount)));

/** Which preset an allocation's follow-ons match; rules with no saved preset are matched by shape. */
export function followOnPreset(a, sector) {
  // A saved "fixed" preset opens as Custom, keeping its rules.
  if (a.followOnPreset) return a.followOnPreset === "fixed" ? "custom" : a.followOnPreset;
  const n = sector?.stages.length ?? a.followOns?.length ?? 0;
  const list = a.followOns ?? [];
  if (sameRules(list, defaultFollowOns(n, a.entryStage))) return "standard";
  if (list.every((f) => !f || f.mode === "none")) return "none";
  return "custom";
}

export function presetFollowOns(id, a, sector) {
  const n = sector.stages.length;
  const base = defaultFollowOns(n, a.entryStage);
  if (id === "none") return base.map((f) => (f ? { ...f, mode: "none" } : f));
  return base;
}

/** In place; "custom" keeps the current rules for editing. */
export function applyFollowOnPreset(a, sector, id) {
  if (id !== "custom") a.followOns = presetFollowOns(id, a, sector);
  a.followOnPreset = id;
}

/** Share of one company's capital that goes to follow-ons under its rules. */
export function reserveShare(a, sector) {
  const t = companyTemplate(a, sector);
  return t.invested > 0 ? t.followOnCapital / t.invested : 0;
}

/** Scales every participation by one factor (capped at 100%) so follow-ons hold `target` of each company's capital; `max` is the most they can hold. */
export function reserveTarget(a, sector, target) {
  const active = (a.followOns ?? []).some((f) => f && f.mode !== "none");
  const base = active ? a.followOns : defaultFollowOns(sector.stages.length, a.entryStage);
  const on = (f) => f && f.mode !== "none";
  const anyP = base.some((f) => on(f) && f.participation > 0);
  const p0 = (f) => (anyP ? f.participation || 0 : 1);
  const scaled = (k) => base.map((f) => (on(f) ? { ...f, participation: Math.round(Math.min(1, p0(f) * k) * 100) / 100 } : f));
  const shareAt = (k) => reserveShare({ ...a, followOns: scaled(k) }, sector);
  const kMax = Math.max(1, ...base.filter((f) => on(f) && p0(f) > 0).map((f) => 1 / p0(f)));
  const max = shareAt(kMax);
  if (!(target > 0)) {
    return { followOns: base.map((f) => (on(f) ? { ...f, mode: "none" } : f)), share: 0, max, reachable: true };
  }
  if (target >= max) return { followOns: scaled(kMax), share: max, max, reachable: target <= max + 0.005 };
  let lo = 0, hi = kMax;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (shareAt(mid) < target) lo = mid; else hi = mid;
  }
  const followOns = scaled(hi);
  return { followOns, share: reserveShare({ ...a, followOns }, sector), max, reachable: true };
}
