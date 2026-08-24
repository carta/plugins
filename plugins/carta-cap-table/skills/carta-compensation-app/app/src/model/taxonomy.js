// CTC taxonomy: ladder/track reconciliation, level ordering, and display casing.
//
// Pure — no React, no fetch. Everything here is derived from data the build step
// snapshotted into taxonomy.json, EXCEPT the display-label maps, which encode
// Carta's product vocabulary and have no API equivalent to read from.
//
// Casing contract (see the CTC skills): UPPER_SNAKE_CASE is for machine handoff
// only. Anything a user reads is Title Case. These helpers are the single place
// that conversion happens, so a view can never leak `CUSTOMER_SUCCESS` into the UI.

// Level rank drives two things: ordering rows within a job, and splitting the
// API's `LEADER` ladder into Manager vs Executive (the product UI shows those as
// distinct tracks, but the API returns one value for both).
export const LEVEL_RANK = {
  ENTRY: 1, MID1: 2, MID2: 3, SENIOR1: 4, SENIOR2: 5, STAFF1: 6,
  STAFF2: 7, PRINCIPAL: 8, VP1: 9, VP2: 10, C_LEVEL: 11, CEO: 12,
};

// The rank at/above which a LEADER row is an Executive rather than a Manager.
const EXEC_MIN_RANK = LEVEL_RANK.VP1;

// Per-track level display names. The same level code reads differently by track —
// VP1 is "Distinguished" for an IC but "Vice President" for an executive — which is
// why this is keyed by track, not by level alone.
const LEVEL_LABELS = {
  IC: {
    ENTRY: "Entry", MID1: "Mid 1", MID2: "Mid 2", SENIOR1: "Senior 1",
    SENIOR2: "Senior 2", STAFF1: "Staff 1", STAFF2: "Staff 2",
    PRINCIPAL: "Principal", VP1: "Distinguished", VP2: "Fellow",
  },
  MANAGER: {
    MID1: "Manager 1", MID2: "Manager 2", SENIOR1: "Senior Manager",
    SENIOR2: "Director 1", STAFF1: "Director 2", STAFF2: "Senior Director 1",
    PRINCIPAL: "Senior Director",
  },
  EXECUTIVE: {
    VP1: "Vice President", VP2: "Senior Vice President",
    C_LEVEL: "C-Level", CEO: "CEO",
  },
};

const JOB_LABELS = {
  ACCOUNTING: "Accounting", ADMIN: "Admin", CEO: "CEO",
  CORPORATE_AFFAIRS: "Corporate Affairs", CUSTOMER_SUCCESS: "Customer Success",
  DATA: "Data", DESIGN: "Design", ENGINEER: "Engineering", FINANCE: "Finance",
  HR: "Human Resources", IT: "IT", LEGAL: "Legal", MANUFACTURING: "Manufacturing",
  MARKETING: "Marketing", OPERATIONS: "Operations", PRODUCT: "Product",
  PROJECT_MANAGEMENT: "Project Management", RESEARCH: "Research", SALES: "Sales",
  STRATEGY: "Strategy", SUPPORT: "Support", OTHER: "Other",
};

export const TRACK_LABELS = { IC: "IC", MANAGER: "Manager", EXECUTIVE: "Executive" };

/** Title-Case display name for a job area enum. Unknown values are humanized, not dropped. */
export function jobLabel(job) {
  if (!job) return "—";
  return JOB_LABELS[job] || String(job).toLowerCase().replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Resolve the display track for a row.
 *
 * The API's `ladder` is only IC | LEADER, but the product UI distinguishes
 * Manager from Executive. Split LEADER on level rank so a VP row is never shown
 * under a "Manager" heading (and vice versa) — the mismatch users report.
 */
export function trackOf(ladder, level) {
  if (ladder === "LEADER") {
    return (LEVEL_RANK[level] || 0) >= EXEC_MIN_RANK ? "EXECUTIVE" : "MANAGER";
  }
  return "IC";
}

/** Per-track display label for a level code, falling back to a humanized form. */
export function levelLabel(level, track) {
  if (!level) return "—";
  const byTrack = LEVEL_LABELS[track] || LEVEL_LABELS.IC;
  if (byTrack[level]) return byTrack[level];
  // A level valid on another track (or new to the API) still renders readably
  // rather than leaking SENIOR1-style enum text into the UI.
  return String(level).replace(/_/g, " ").replace(/(\d)/, " $1")
    .toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\s+/g, " ").trim();
}

/** Sort comparator: job (by label), then track (IC → Manager → Executive), then level rank. */
const TRACK_ORDER = { IC: 0, MANAGER: 1, EXECUTIVE: 2 };
export function compareRows(a, b) {
  const j = jobLabel(a.job).localeCompare(jobLabel(b.job));
  if (j !== 0) return j;
  const ta = TRACK_ORDER[trackOf(a.ladder, a.level)] ?? 0;
  const tb = TRACK_ORDER[trackOf(b.ladder, b.level)] ?? 0;
  if (ta !== tb) return ta - tb;
  return (LEVEL_RANK[a.level] || 0) - (LEVEL_RANK[b.level] || 0);
}
