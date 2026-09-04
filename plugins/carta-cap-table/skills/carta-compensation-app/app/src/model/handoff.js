// The Issue-with-Claude handoff — a prompt the user pastes into their session.
//
// WHY A COPIED PROMPT RATHER THAN A BUTTON THAT ISSUES
// This console cannot write to Carta, by design and in three enforced places (see
// references/refresh-grant-issuance-handoff.md). Issuance also needs an equity
// plan, a vesting template and a document set, none of which the planner holds and
// all of which carta-issuance collects through interactive gates it explicitly
// refuses to delegate. So the handoff carries the part we DO know — who, and how
// many shares — and hands the rest to the flow built to ask for it.
//
// WHAT IS DELIBERATELY LEFT BLANK
// Vesting schedule, equity plan and exercise price. An almost-right vesting
// template issues genuinely wrong terms that no server-side check will catch, so
// the prompt says they are absent rather than guessing. This mirrors the CSV
// path's own rule: unresolved is blank, never inferred.

import { toCsv } from "./csv.js";

/** Column headers from issuance-import's documented vocabulary.
 *
 *  Exact spellings matter: `parse_upload.py` matches against a synonym list, and a
 *  near-miss silently drops the column rather than failing loudly. Only the three
 *  the planner can fill honestly are emitted.
 */
const HEADERS = ["Name", "Quantity", "Grant Reason"];

/** The plan as CSV rows, one per employee receiving a grant.
 *
 *  Employees with no computable grant are omitted entirely rather than sent with a
 *  blank or zero quantity — a zero-share grant is a real thing to issue by mistake.
 */
export function handoffRows(grants) {
  return grants
    .filter((g) => g.shares != null && g.shares > 0)
    .map((g) => [g.name || "", String(g.shares), "Refresh"]);
}

export function handoffCsv(grants) {
  return toCsv([HEADERS, ...handoffRows(grants)]);
}

/** The single largest grant's share of the plan, or null when there is nothing.
 *
 *  Surfaced because a plan can be arithmetically correct and still be dominated by
 *  one row: on real data a single EX 12 benchmark of 40.4M produced a grant that was
 *  90% of the cycle. The figure is the report's own and is not second-guessed here,
 *  but handing it to issuance without comment invites drafting it unnoticed.
 */
export function concentration(rows) {
  if (!rows.length) return null;
  const totals = rows.map((r) => Number(r[1]));
  const total = totals.reduce((a, b) => a + b, 0);
  if (!total) return null;
  const max = Math.max(...totals);
  const at = totals.indexOf(max);
  return { name: rows[at][0], shares: max, pct: (max / total) * 100 };
}

/** An ISO date, from either a Date or an already-formatted string.
 *
 *  The planner holds `asOf` as a Date; the tests pass a string. A raw Date lands in
 *  the prompt as "Thu Sep 03 2026 10:20:57 GMT-0400 (Eastern Daylight Time)", which
 *  is noise in a document someone reads before drafting real grants.
 */
function isoDay(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

/** A share of the plan, as a percentage that never claims the whole of it.
 *
 *  Math.round alone reports 99.886% as "100%", which reads as "everyone else got
 *  nothing" — and on the plan that surfaced this, the other three employees held a
 *  real 27,783 shares between them. So while other rows exist the figure is capped
 *  just below the whole: a dominant row may say 99.9%, never 100%.
 *
 *  Rounding is to one decimal, so 99.886 reads as 99.9 rather than being floored to
 *  99.8 — the cap is there to stop the claim of totality, not to understate.
 *
 *  A genuinely sole row is exempt, because there 100% is simply true.
 */
export function sharePct(pct, rowCount) {
  if (rowCount <= 1) return 100;
  return Math.min(Math.round(pct * 10) / 10, 99.9);
}

/** Plural-safe "1 employee" / "12 employees". */
function count(n, noun) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** The prompt to paste into a Claude session.
 *
 *  Written as an instruction to Claude, not as prose about the plan: the user
 *  pastes it verbatim, so it has to be directly actionable. It names the skill's
 *  own trigger words ("draft option grants" from a CSV) so the right flow starts,
 *  and states the omissions up front so the gates ask rather than assume.
 */
export function handoffPrompt({ grants, corporation, corporationId, settings, asOf }) {
  const rows = handoffRows(grants);
  const total = rows.reduce((sum, r) => sum + Number(r[1]), 0);
  const skipped = grants.length - rows.length;

  const lines = [
    `Draft option grants in Carta for ${corporation || "this corporation"}`
      + `${corporationId ? ` (corporation ${corporationId})` : ""} from the refresh`
      + ` plan below.`,
    "",
    `This is a refresh cycle for ${count(rows.length, "employee")}, `
      + `${total.toLocaleString("en-US")} shares in total, planned in the CTC`
      + ` compensation console${isoDay(asOf) ? ` on ${isoDay(asOf)}` : ""}.`,
  ];

  if (settings) {
    lines.push(
      "",
      `Policy applied: ${settings.targetPct}% of each employee's new-hire equity`
        + ` benchmark, every ${settings.cadenceMonths} months`
        + `${settings.tenureMinMonths
          ? `, for employees with at least ${settings.tenureMinMonths} months' tenure`
          : ""}.`,
    );
  }

  // A dominant row is stated before the CSV, where it will be read, rather than
  // left to be noticed among a hundred lines of it.
  const top = concentration(rows);
  if (top && top.pct >= 25) {
    const others = total - top.shares;
    lines.push(
      "",
      `Note: ${top.name} accounts for ${sharePct(top.pct, rows.length)}% of this cycle`
        + ` (${top.shares.toLocaleString("en-US")} shares). That is the benchmark`
        + ` Carta holds for their role, carried through unchanged — worth confirming`
        + ` before drafting.`
        // Stated explicitly: at 99.9% the remainder is easy to read as nothing, and
        // it is not — those are real grants for real people.
        + (rows.length > 1
          ? ` The other ${count(rows.length - 1, "employee")} share`
            + `${rows.length === 2 ? "s" : ""} ${others.toLocaleString("en-US")} shares.`
          : ""),
    );
  }

  lines.push(
    "",
    "Grant reason is Refresh for every row.",
    "",
    "IMPORTANT — these are NOT in the plan and must not be guessed:",
    "- Vesting schedule",
    "- Equity plan",
    "- Exercise price",
    "",
    "Ask me for them. An almost-right vesting template issues wrong terms.",
    "",
    "Draft only — do not issue.",
    "",
    "```csv",
    handoffCsv(grants).trimEnd(),
    "```",
  );

  if (skipped > 0) {
    lines.push(
      "",
      `(${count(skipped, "employee")} in the plan had no computable grant and`
        + ` ${skipped === 1 ? "is" : "are"} not in this list.)`,
    );
  }

  return lines.join("\n");
}
