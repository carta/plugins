// Refresh planner — Step 1 of the refresh grant workflow: load the cohort.
//
// This is the employee list a refresh cycle starts from, before any filtering,
// exceptions or grant settings. It answers one question — "who is in scope, and
// what do we know about them?" — and deliberately stops there. Filters are Step 2.
//
// WHAT IS DERIVED HERE, AND WHY IT IS LABELLED
//
// Everything on the Scorecard tab is the server's own number. This tab is the first
// that is not: tenure-in-months and active/departed are computed in the browser from
// the start and end dates the roster carries. That is unavoidable — a month count
// depends on today, so a value captured at build time would silently age — but it
// means these columns have no counterpart in the CTC product UI to reconcile
// against. Hence the `Modelled` tag in the heading and a title on each derived
// column, per SKILL.md's derived-value rule.
//
// COHORT SOURCE
//
// The PRD names cap-table stakeholders as the source of truth. That is not reachable:
// `cap_table:get:stakeholders` has no enumeration — summary mode returns counts, and
// search mode AND-s its terms so it matches exactly one person. The roster this skill
// already sweeps IS the employee list, already coverage-gated by build_datadir, so it
// is what the cohort is built from. Stakeholder ids get joined in Step 2, where they
// are needed for grant history and where the join can be validated on its own.

import { useMemo, useState } from "react";
import { C, FS, RADIUS } from "../ui/theme.js";
import ExportButton from "../ui/ExportButton.jsx";
import { MultiSelect, TableAlign, Tag, Th, Td } from "../ui/components.jsx";
import { jobLabel, levelLabel, trackOf, TRACK_LABELS } from "../model/taxonomy.js";
import { csvFilename, downloadCsv, toCsv } from "../model/csv.js";
import { money } from "../model/format.js";
import { formatTenure, isActive, tenureMonths } from "../model/tenure.js";

/** Employment status as a chip.
 *
 *  Three states, not two. `null` means this build never captured tenure at all, which
 *  is a different fact from "active" and must not be shown as one — the whole reason
 *  isActive returns a tri-state.
 */
function StatusChip({ active }) {
  if (active === null) {
    return (
      <Tag tone="notice" title="This dashboard was built before the export carried tenure. Re-run the skill to fetch it.">
        Unknown
      </Tag>
    );
  }
  return active
    ? <Tag tone="positive">Active</Tag>
    : <Tag tone="neutral" title="Recorded end date has passed">Departed</Tag>;
}

/** Identity cell — name over title and a truncated id.
 *
 *  Mirrors the Scorecard's IdentityCell deliberately: the same person appears on both
 *  tabs and should look the same on each. Same caveat too — this is a named person
 *  beside their pay, it stays local, and it must not be screenshotted into a ticket.
 */
function IdentityCell({ row }) {
  const label = row.name || row.title || "Unknown";
  return (
    <Td ellipsis title={`${label}${row.title && row.name ? ` · ${row.title}` : ""} · ${row.externalId}`}>
      <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>
        {row.name || row.title || <span style={{ color: C.textQuiet }}>Unknown</span>}
      </span>
      <span style={{
        display: "block", fontSize: FS.xs, color: C.textQuiet,
        overflow: "hidden", textOverflow: "ellipsis",
      }}>
        {row.name && row.title ? row.title : `${row.externalId.slice(0, 8)}…`}
      </span>
    </Td>
  );
}

function CohortTable({ rows, asOf }) {
  return (
    <TableAlign align="center">
      <table style={{ width: "100%", minWidth: 900, tableLayout: "fixed" }}>
        <thead>
          <tr>
            <Th width="26%">Employee</Th>
            <Th width="14%">Job area</Th>
            <Th width="14%">Level</Th>
            <Th width="12%">Location</Th>
            {/* Both of these are computed here rather than returned by the API, so
                both carry a title naming the calculation. */}
            <Th width="12%">Tenure</Th>
            <Th width="12%">Status</Th>
            <Th width="10%">Salary</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const track = trackOf(r.leader ? "LEADER" : "IC", r.level);
            const months = tenureMonths(r, asOf);
            const label = formatTenure(months);
            const home = (r.location || {}).home_location || {};
            const place = [home.city, home.state || home.country].filter(Boolean).join(", ");
            const pay = r.salary || {};
            return (
              <tr key={r.externalId}>
                <IdentityCell row={r} />
                <Td ellipsis title={jobLabel(r.jobArea)}>{jobLabel(r.jobArea)}</Td>
                <Td ellipsis title={`${levelLabel(r.level, track)} · ${TRACK_LABELS[track] || track}`}>
                  <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {levelLabel(r.level, track)}
                  </span>
                  <span style={{ display: "block", fontSize: FS.xs, color: C.textQuiet }}>
                    {TRACK_LABELS[track] || track}
                  </span>
                </Td>
                <Td ellipsis subtle={!place} title={place || "No location recorded"}>
                  {place || "—"}
                </Td>
                {/* Em dash, never "0m", when the start date is missing: an employee
                    whose start was never recorded is unknown, not a day-one hire. */}
                <Td mono subtle={label === null}
                    title={label === null
                      ? "No start date recorded for this employee"
                      : `Calculated from start date ${(r.tenure || {}).start_date}`}>
                  {label === null ? "—" : label}
                </Td>
                <Td><StatusChip active={isActive(r, asOf)} /></Td>
                <Td mono subtle={pay.amount == null}>
                  {/* No `|| "USD"`. An amount whose currency the API did not supply
                      renders unsymbolised — `money` already does that for a null
                      currency — because stamping "$" on an unknown figure misstates
                      it, and this roster carries USD, GBP and CAD. */}
                  {pay.amount == null ? "—" : money(pay.amount, pay.currency)}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableAlign>
  );
}

export default function RefreshPlanner({ roster, corporation }) {
  // One "now" for the whole render, so every row is measured against the same
  // instant. Calling new Date() per row would let a table straddle midnight and
  // report two different tenures for two employees who started the same day.
  const asOf = useMemo(() => new Date(), []);

  const [areas, setAreas] = useState([]);

  const all = roster.rows || [];

  // Job area is the one control here. It is NOT a Step 2 cohort filter — it does not
  // narrow the cycle, it just makes a 130-row table readable while checking the list.
  // Real filters (prior grant, level range, geo) come in Step 2 and persist to the
  // scenario; this is a view control and deliberately does not.
  const areaOptions = useMemo(() => {
    const seen = new Map();
    for (const r of all) {
      if (r.jobArea && !seen.has(r.jobArea)) seen.set(r.jobArea, jobLabel(r.jobArea));
    }
    return [...seen.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [all]);

  const rows = useMemo(() => {
    const picked = areas.length ? all.filter((r) => areas.includes(r.jobArea)) : all;
    // Job area, then level, then id — the same ordering build_datadir writes, which
    // groups people who are compared against the same market row together.
    return [...picked].sort((a, b) =>
      (a.jobArea || "").localeCompare(b.jobArea || "")
      || (a.level || "").localeCompare(b.level || "")
      || (a.externalId || "").localeCompare(b.externalId || ""));
  }, [all, areas]);

  // Counted over the WHOLE roster, not the filtered view: these describe the cohort a
  // refresh cycle would draw from, and a job-area filter is a reading aid rather than
  // a change to that cohort.
  const summary = useMemo(() => {
    let active = 0, departed = 0, unknown = 0, noTenure = 0;
    for (const r of all) {
      const a = isActive(r, asOf);
      if (a === null) unknown += 1;
      else if (a) active += 1;
      else departed += 1;
      if (tenureMonths(r, asOf) === null) noTenure += 1;
    }
    return { active, departed, unknown, noTenure };
  }, [all, asOf]);

  const tenureAvailable = (roster.availability || {}).tenure !== false;

  const exportCohort = () => {
    // employee_id first and name included, matching the Scorecard export — same
    // sensitivity caveat applies: a named person beside their salary. Not for
    // tickets or shared drives.
    const header = [
      "employee_id", "name", "title", "job_area", "level", "track", "focus",
      "location", "tenure_start_date", "tenure_end_date", "tenure_months",
      "employment_status", "salary", "currency",
    ];
    const body = rows.map((r) => {
      const track = trackOf(r.leader ? "LEADER" : "IC", r.level);
      const home = (r.location || {}).home_location || {};
      const t = r.tenure || {};
      const months = tenureMonths(r, asOf);
      const a = isActive(r, asOf);
      const pay = r.salary || {};
      return [
        r.externalId, r.name || "", r.title || "",
        jobLabel(r.jobArea), levelLabel(r.level, track), TRACK_LABELS[track] || track,
        r.focus || "",
        [home.city, home.state || home.country].filter(Boolean).join(", "),
        t.start_date || "", t.end_date || "",
        // Empty, not 0, for unknown — a spreadsheet would otherwise average a
        // missing tenure as zero and understate the cohort's seniority.
        months === null ? "" : months,
        a === null ? "unknown" : (a ? "active" : "departed"),
        pay.amount ?? "",
        pay.currency || "",
      ];
    });
    downloadCsv(csvFilename(corporation, "refresh-cohort"), toCsv([header, ...body]));
  };

  return (
    <div style={{ padding: "18px 24px 28px", display: "grid", gap: 16 }}>
      <div style={{
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: RADIUS,
        padding: 16,
      }}>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "baseline",
          gap: 16, flexWrap: "wrap", marginBottom: 4,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: FS.lg, fontWeight: 600, color: C.text }}>
              Step 1 · Load cohort
            </span>
            {/* Visible on first render, not behind a disclosure: these columns have no
                counterpart in the CTC product UI, so a reader has nothing to reconcile
                them against and must be told they were calculated here. */}
            <Tag tone="notice" title="Tenure and employment status are calculated in this console from the start and end dates the roster carries. They are not returned by Carta as shown.">
              Modelled
            </Tag>
          </div>
          <MultiSelect
            label="Job area"
            options={areaOptions}
            selected={areas}
            onToggle={(v) => setAreas((prev) =>
              prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v])}
            onAll={() => setAreas([])}
            allLabel="All job areas"
            minWidth={190}
          />
        </div>
        <div style={{ fontSize: FS.sm, color: C.textSubtle, lineHeight: 1.55 }}>
          Every benchmarked employee on this corporation's roster. Filters, exceptions
          and grant settings come next — nothing here narrows the cycle yet.
        </div>

        <div style={{
          display: "flex", gap: 18, flexWrap: "wrap", marginTop: 12,
          fontSize: FS.sm, color: C.textSubtle,
        }}>
          <span><strong style={{ color: C.text }}>{summary.active}</strong> active</span>
          {summary.departed > 0 && (
            <span><strong style={{ color: C.text }}>{summary.departed}</strong> departed</span>
          )}
          {summary.unknown > 0 && (
            <span><strong style={{ color: C.text }}>{summary.unknown}</strong> status unknown</span>
          )}
        </div>

        {/* The gate this tab exists to protect. Without tenure the eligibility rule in
            Step 4 cannot run at all, and saying so here is far better than letting a
            later step silently admit everyone. */}
        {!tenureAvailable && (
          <div style={{
            marginTop: 12, padding: "10px 12px", borderRadius: RADIUS,
            background: C.feedbackNoticeSubtle, border: `1px solid ${C.feedbackNotice}`,
            fontSize: FS.sm, color: C.feedbackNotice, lineHeight: 1.55,
          }}>
            <strong>No tenure data in this build.</strong> This dashboard was built before
            the scorecard export carried start and end dates, so the tenure eligibility
            rule cannot be applied. Say "refresh" to re-fetch.
          </div>
        )}
        {tenureAvailable && summary.noTenure > 0 && (
          <div style={{ marginTop: 12, fontSize: FS.sm, color: C.textSubtle, lineHeight: 1.55 }}>
            {summary.noTenure} of {all.length} employees have no recorded start date. A
            tenure requirement cannot be evaluated for them, so they will need an
            explicit decision rather than being silently included or dropped.
          </div>
        )}
      </div>

      <div style={{
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: RADIUS,
        padding: 16,
      }}>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          gap: 16, marginBottom: 8,
        }}>
          <div style={{ fontSize: FS.sm, fontWeight: 600, color: C.textSubtle }}>
            Employees ({rows.length}{rows.length !== all.length ? ` of ${all.length}` : ""})
          </div>
          <ExportButton
            onExport={exportCohort}
            title="Download this cohort as CSV — one row per employee, with tenure and status"
            disabled={!rows.length}
          />
        </div>
        <div style={{ overflowX: "auto" }}>
          <CohortTable rows={rows} asOf={asOf} />
        </div>
        <div style={{ fontSize: FS.xs, color: C.textFaint, marginTop: 10 }}>
          Tenure is measured in whole months from the recorded start date — the 24th
          monthly anniversary counts as 24 months, a day earlier does not. An em dash
          means no start date was recorded for that employee.
        </div>
      </div>
    </div>
  );
}
