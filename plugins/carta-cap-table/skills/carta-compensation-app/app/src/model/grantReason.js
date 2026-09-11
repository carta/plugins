// Why a grant is being issued — the reason that rides with it into Carta.
//
// NOT A FREE-TEXT NOTE. These are Carta's own SecurityCreatedReason values, and
// the handoff CSV's "Grant Reason" column is matched against issuance-import's
// synonym list on the way in. A near-miss there silently DROPS the column rather
// than failing loudly, so an invented value would be worse than none: the grant
// would issue with no reason at all and nothing would say so.
//
// The subset is deliberate. The full enum carries values that describe how a
// security came to exist rather than why it was granted — FROM_PROTO,
// CORPORATE_TRANSACTION, BOXCAR_GRANT, UNSPECIFIED — and offering those in a
// planner would invite stamping a refresh cycle with a reason nobody means.
//
// REFRESH IS THE DEFAULT because that is what this planner is for, and it is what
// the handoff already sent for every row before the column existed.

/** The reasons a refresh planner can honestly offer, in the order they are shown.
 *
 *  `value` is what goes into the CSV and must match issuance-import's vocabulary.
 *  `label` is what a person reads.
 */
export const GRANT_REASONS = Object.freeze([
  { value: "Refresh", label: "Refresh" },
  { value: "Merit", label: "Merit" },
  { value: "Promotion", label: "Promotion" },
  { value: "Retention", label: "Retention" },
  { value: "Performance Bonus", label: "Performance bonus" },
  { value: "New Hire", label: "New hire" },
]);

/** What a grant carries when nobody has said otherwise. */
export const DEFAULT_GRANT_REASON = "Refresh";

const VALID = new Set(GRANT_REASONS.map((r) => r.value));

/** True when `value` is one this console is willing to send. */
export function isGrantReason(value) {
  return VALID.has(value);
}

/** The reason for one employee, falling back to the default.
 *
 *  An unrecognised stored value falls back rather than passing through: a document
 *  could have been written by a build offering a value this one does not, and
 *  sending an unknown reason downstream is the failure mode this module exists to
 *  prevent.
 */
export function reasonFor(externalId, reasons) {
  const stored = reasons && reasons.get(externalId);
  return isGrantReason(stored) ? stored : DEFAULT_GRANT_REASON;
}

/** The reasons worth persisting — anything at the default is left out.
 *
 *  Same rule as grantOverrides: a map holding "Refresh" for all 134 employees says
 *  nothing a reader could not infer, and writing it would make a scenario nobody
 *  edited look like one somebody did.
 */
export function reasonsToStore(reasons) {
  const out = {};
  for (const [id, value] of reasons || []) {
    if (isGrantReason(value) && value !== DEFAULT_GRANT_REASON) out[id] = value;
  }
  return out;
}

/** Stored reasons back into a Map, dropping anything unusable. */
export function reasonsFromStored(raw) {
  if (!raw || typeof raw !== "object") return new Map();
  return new Map(Object.entries(raw).filter(([, v]) => isGrantReason(v)));
}
