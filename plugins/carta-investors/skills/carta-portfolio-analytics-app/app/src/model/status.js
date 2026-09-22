// Realization status, derived from Fund Admin holdings economics.
// Carta reports no status flag, so it is inferred from remaining value (fmv)
// and proceeds. Pure functions over kpi.json, like model/tags.js.

/** Computed here, not a firm-defined Carta category. It groups with the
 *  Carta-sourced tags because it is read-only in the same way. */
export const STATUS_CAT = "Status";

export const ACTIVE = "Active";
export const REALIZED = "Realized";
export const PARTIAL = "Partially realized";
export const WRITTEN_OFF = "Written off";

/** Menu order: what you still hold first, then what came back, then the losses.
 *  Not alphabetical — this is the order a portfolio review walks them in. */
export const STATUS_ORDER = [ACTIVE, PARTIAL, REALIZED, WRITTEN_OFF];

/** Badge tone per status. Uses the design system's semantic tones, so these
 *  follow the Ink tokens into dark mode instead of hard-coding hex.
 *  Colour is redundant here — the chip always carries its label too.
 *
 *  None of these is "info": that blue is what every other Carta category
 *  already uses, so a status wearing it would read as just another category. */
export const STATUS_TONE = {
  [ACTIVE]: "positive",      // green - live position
  [PARTIAL]: "warning",      // amber - part held, part returned
  [REALIZED]: "strong",      // dark  - closed out, proceeds banked
  [WRITTEN_OFF]: "negative", // red   - cost in, nothing back
};

/** Tone for a status value, falling back to the Carta-tag default. */
export const toneForStatus = (value) => STATUS_TONE[value] || "info";

const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);

/** Realization status for one company, or null when it cannot be known.
 *  Returns null rather than guessing: "unknown" and "active" are different
 *  claims about a portfolio, and only one of them is honest. */
export function statusOf(company) {
  const r = company?.returns;
  if (!r) return null;
  const fmv = num(r.fmv);
  const proceeds = num(r.proceeds);
  // Both absent -> no holdings economics -> unknowable.
  if (fmv === null && proceeds === null) return null;
  const f = fmv || 0;
  const p = proceeds || 0;
  if (f > 0) return p > 0 ? PARTIAL : ACTIVE;
  if (p > 0) return REALIZED;
  // Nothing held and nothing returned. Only a real cost basis makes that a
  // write-off; without one there is simply no position to describe.
  return (num(r.cost) || 0) > 0 ? WRITTEN_OFF : null;
}

/** True when at least one company has a knowable status, i.e. the Status filter
 *  is worth showing. Firms with KPI coverage but no Fund Admin holdings get
 *  nothing rather than an empty filter that never matches. */
export const hasStatus = (data) =>
  (data?.companies || []).some((c) => statusOf(c) !== null);

/** The status values actually present, in STATUS_ORDER. Never offers a filter
 *  option that would match nothing. */
export function statusValues(data) {
  const present = new Set();
  for (const c of data?.companies || []) {
    const s = statusOf(c);
    if (s) present.add(s);
  }
  return STATUS_ORDER.filter((s) => present.has(s));
}
