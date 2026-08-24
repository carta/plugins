// Scorecard tab — how this corporation's employees sit against market.
//
// Reads roster.json verbatim. Every band, percentile and compa-ratio here came
// from the API; none is derived in the browser. Recomputing a compa-ratio locally
// would drift from the product UI the moment the server changed its rounding or
// geo-adjustment order, and the drift would look like data rather than a bug.
//
// The distribution is PER METRIC, never a single headline number. Two reasons, both
// measured rather than assumed:
//
//   * The metrics genuinely disagree. On the reference roster one employee is HIGH
//     on salary (81st percentile) and MID on total cash (61st). Any one-number
//     summary picks one and hides the other.
//   * The overall band is null on ~73% of rows. Keyed on it, this tab would render
//     "Low 0 / Mid 0 / High 0", which reads as "nobody is below market" rather than
//     "not scored" — the worst available failure for compensation data.
//
// So each metric carries its own denominator, and an unscored metric says so
// explicitly instead of drawing an empty chart.

import { Fragment, useMemo, useState } from "react";
import { C, FS, RADIUS } from "../ui/theme.js";
import ExportButton from "../ui/ExportButton.jsx";
import { TableAlign, Tag, Th, Td } from "../ui/components.jsx";
import { jobLabel, levelLabel, trackOf, TRACK_LABELS } from "../model/taxonomy.js";
import { csvFilename, downloadCsv, toCsv } from "../model/csv.js";
import { money, ratio as formatRatio, isBlank } from "../model/format.js";

const BANDS = ["LOW", "MID", "HIGH"];

const BAND_LABELS = { LOW: "Below market", MID: "At market", HIGH: "Above market" };

// Bands are judgements about pay, so the palette stays informational rather than
// pass/fail: "below market" is a fact about position, not a failing grade.
//
// All six values are Ink semantic tones — the MID fill was a hardcoded #E3F2F1 until
// the Ink retrofit, which is the exact drift class the retrofit audit looks for.
const BAND_COLORS = {
  LOW: C.feedbackNotice,
  MID: C.feedbackPositive,
  HIGH: C.linkDefault,
};
const BAND_FILLS = {
  LOW: C.feedbackNoticeSubtle,
  MID: C.positiveSubtle,
  HIGH: C.infoSubtle,
};

const METRIC_LABELS = {
  salary: "Salary",
  totalCash: "Total cash",
  ntmEquity: "Equity (NTM)",
  overall: "Overall",
};

// Presentation order, mirroring ROSTER_METRICS in build_datadir.py. `overall` last
// because it is the least populated, never the default.
const METRIC_ORDER = ["salary", "totalCash", "ntmEquity", "overall"];

// Band -> Ink Tag tone. The tones are semantic, not a pass/fail scale: "below market"
// is a fact about position, not a failing grade, so LOW takes `notice` rather than
// `negative`.
const BAND_TONES = { LOW: "notice", MID: "positive", HIGH: "info" };

/** A band chip. Renders an em dash for null — "not scored" is a fact, not a blank.
 *
 *  Uses the shared Tag rather than its own span: this previously hand-rolled weight 600
 *  and a 10px pill radius, both of which drift from Ink's recipe (regular 400 weight,
 *  radius-subtle, tone-matched border). Bolding a status label is the single most
 *  common drift away from that recipe.
 */
function BandChip({ band }) {
  if (!band || !BANDS.includes(band)) {
    return <span style={{ color: C.textQuiet }} title="Not scored on this metric">—</span>;
  }
  return <Tag tone={BAND_TONES[band]}>{BAND_LABELS[band]}</Tag>;
}

/** Horizontal stacked distribution for one metric. */
function Distribution({ entry }) {
  const scored = entry.scoredTotal || 0;
  if (!scored) {
    return (
      <div style={{
        padding: "18px 14px", borderRadius: RADIUS, background: C.surfaceAlt,
        border: `1px solid ${C.border}`, fontSize: FS.md, color: C.textSubtle,
      }}>
        Not scored for this corporation.
        <div style={{ fontSize: FS.sm, color: C.textFaint, marginTop: 4 }}>
          None of the {entry.unscoredCount} employees on this roster has a band on this
          metric, so there is no distribution to show. This is a gap in the source data,
          not a filter you can change here.
        </div>
      </div>
    );
  }
  return (
    <div>
      <div style={{
        display: "flex", height: 26, borderRadius: RADIUS, overflow: "hidden",
        border: `1px solid ${C.border}`,
      }}>
        {BANDS.map((b) => {
          const n = entry[b] || 0;
          if (!n) return null;
          return (
            <div
              key={b}
              title={`${BAND_LABELS[b]}: ${n} of ${scored} scored`}
              style={{
                width: `${(n / scored) * 100}%`,
                background: BAND_FILLS[b],
                borderRight: `1px solid ${C.border}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: FS.xs, fontWeight: 600, color: BAND_COLORS[b],
              }}
            >{n}</div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
        {BANDS.map((b) => (
          <span key={b} style={{ fontSize: FS.sm, color: C.textSubtle }}>
            <span style={{
              display: "inline-block", width: 9, height: 9, borderRadius: 2,
              background: BAND_FILLS[b], border: `1px solid ${BAND_COLORS[b]}`,
              marginRight: 5, verticalAlign: "middle",
            }} />
            {BAND_LABELS[b]} <strong style={{ color: C.text }}>{entry[b] || 0}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

/** The scored/unscored reconciliation. Mandatory, not decorative. */
function Reconciliation({ roster, metric }) {
  const entry = roster.bandRollup[metric] || {};
  const total = roster.reconciliation.rosterTotal;
  const scored = entry.scoredTotal || 0;
  const unscoredEverywhere = roster.reconciliation.unscoredOnEveryMetric || 0;

  return (
    <div style={{
      marginTop: 12, padding: "10px 12px", borderRadius: RADIUS,
      background: C.surfaceAlt, border: `1px solid ${C.border}`,
      fontSize: FS.sm, color: C.textSubtle, lineHeight: 1.55,
    }}>
      {/* Spelled out rather than shown as a bare fraction: the counts differ per
          metric, and a reader who assumes one denominator across the tab would
          silently misread every other metric. */}
      <strong style={{ color: C.text }}>{scored}</strong> of{" "}
      <strong style={{ color: C.text }}>{total}</strong> employees have a{" "}
      {METRIC_LABELS[metric].toLowerCase()} band
      {entry.unscoredCount ? (
        <> — the other {entry.unscoredCount} {entry.unscoredCount === 1 ? "is" : "are"} not
          scored on this metric and {entry.unscoredCount === 1 ? "is" : "are"} excluded from the
          distribution above.</>
      ) : <>.</>}
      {unscoredEverywhere > 0 && (
        <div style={{ marginTop: 6 }}>
          {unscoredEverywhere} {unscoredEverywhere === 1 ? "employee has" : "employees have"} no
          band on <em>any</em> metric, so {unscoredEverywhere === 1 ? "it appears" : "they appear"} in
          no distribution on this tab. {unscoredEverywhere === 1 ? "It is" : "They are"} still
          listed in the table below.
        </div>
      )}
      <div style={{ marginTop: 6, color: C.textFaint }}>
        Counts per metric differ — each is measured against the employees scored on that
        metric, not against the roster total.
      </div>
    </div>
  );
}

function MetricPicker({ roster, metric, setMetric }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {METRIC_ORDER.map((m) => {
        const entry = roster.bandRollup[m];
        if (!entry) return null;
        const active = m === metric;
        const empty = !entry.scoredTotal;
        return (
          <button
            key={m}
            onClick={() => setMetric(m)}
            // Selectable even when empty: "not scored" is information the user may
            // want to see and cite, and greying it out invites the reading that the
            // tab is broken rather than the data absent.
            title={empty ? `${METRIC_LABELS[m]} — not scored for this corporation` : undefined}
            style={{
              background: active ? C.accentSoft : C.surface,
              border: `1px solid ${active ? C.accent : C.border}`,
              color: empty ? C.textFaint : active ? C.accent : C.textSubtle,
              borderRadius: RADIUS, padding: "5px 11px", fontSize: FS.sm,
              fontWeight: active ? 600 : 500, cursor: "pointer",
            }}
          >
            {METRIC_LABELS[m]}
            <span style={{ marginLeft: 6, fontSize: FS.xs, color: C.textFaint }}>
              {entry.scoredTotal || 0}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// All three metrics render TOGETHER, one column group each: value, compa-ratio, and the
// band. No picker needed to see them — salary and total cash disagree constantly (a big
// bonus lands someone at market on cash while below market on salary) and that
// disagreement is the interesting part, so it has to be visible at a glance.
//
// Market mid and gap-to-mid were dropped from the table at the engineer's request to keep
// it readable. NOTE what that costs: those were the numbers the band is DERIVED from, so
// nobody can now check why a row says "below market", or size a raise, from this table.
// They are gone from the CSV too, so there is no reconciliation path left in the product
// at all — if that becomes a problem, `metrics.<m>.marketMid` / `.diffFromMid` are still
// captured in roster.json and only need re-surfacing.
const METRICS = ["salary", "totalCash", "ntmEquity"];

// Equity has no yearly money amount: it is a share count, an FD percentage, or a notional
// value depending on representation. Cash metrics read their amount from a `{amount,
// currency}` pay node; equity reads its own holding node, whose shape is UNVERIFIED
// because no reachable corp returns one (see save_roster_page._roster_row).
const CASH_METRICS = ["salary", "totalCash"];

/** The equity holding as text, or null when there is nothing renderable.
 *
 *  Defensive by design: the node's shape has never been observed populated, so this reads
 *  the plausible fields and returns null rather than guessing. It never fabricates a unit
 *  — an unlabelled bare number in an equity column would be read as dollars.
 */
function equityValueText(node) {
  if (node == null) return null;
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (typeof node !== "object") return null;
  // Notional value is money and carries a currency, so it is the one representation that
  // can be formatted unambiguously.
  const notional = node.as_notional_value ?? node.notional_value ?? node.notional;
  if (notional != null) return money(notional, node.currency || node.currency_code || "USD");
  const shares = node.as_shares ?? node.shares ?? node.quantity;
  if (shares != null) return `${shares} shares`;
  const fd = node.as_fd_percentage ?? node.fd_percentage;
  // The API returns FD as a FRACTION, not a percent (0.0004 = 0.04%) — see
  // references/queries.md. Labelled explicitly so it cannot be misread as 0.0004%.
  if (fd != null) return `${(Number(fd) * 100).toFixed(4)}% FD`;
  return null;
}

/** value / compa-ratio / band for ONE metric, for one row. */
function MetricCells({ row, metric }) {
  const det = (row.metrics || {})[metric] || {};
  const isCash = CASH_METRICS.includes(metric);
  // `null` (absent) and "0.00" (recorded zero) are DIFFERENT facts and must not both
  // render as "$0" — two employees on the reference roster have a null salary alongside a
  // 0.00 total cash, so this distinction is live rather than hypothetical.
  const payNode = isCash ? row[metric] : null;
  const payAmount = payNode ? payNode.amount : null;
  // Per-row currency: this roster mixes USD, GBP and CAD, so a table-wide currency would
  // mislabel real amounts.
  const currency = (payNode && payNode.currency) || det.currency || "USD";
  const equityText = isCash ? null : equityValueText(row.equity);
  const value = isCash
    ? (payAmount == null ? null : money(payAmount, currency))
    : equityText;
  const bonus = (row.targetVariable || {}).target_bonus;
  const ratio = (row.compaRatios || {})[metric];
  return (
    <>
      <Td mono subtle={value == null}>
        {value == null
          ? <span title="No amount recorded for this employee">—</span>
          : value}
        {/* On total cash only, break out the variable component — it is the entire reason
            this figure differs from the salary column beside it. */}
        {metric === "totalCash" && bonus && (
          <span
            title="Target bonus, included in total cash"
            style={{
              display: "block", fontSize: FS.xs, color: C.textQuiet,
              fontVariantNumeric: "tabular-nums", marginTop: 2,
            }}
          >
            incl. {money(bonus, currency)}
          </span>
        )}
      </Td>
      <Td mono subtle={isBlank(ratio)}>{formatRatio(ratio)}</Td>
      <Td>
        <BandChip band={(row.bands || {})[metric]} />
        {/* Percentile beneath the band: the band is a three-way bucket, so two people
            both "below market" can sit 20 percentile points apart. */}
        {det.percentile && (
          <span style={{
            display: "block", fontSize: FS.xs, color: C.textQuiet,
            fontVariantNumeric: "tabular-nums", marginTop: 2,
          }}>
            {det.percentile}th pctile
          </span>
        )}
      </Td>
    </>
  );
}

/** Identity cell — name over job title and a truncated id.
 *
 *  The name is here at the engineer's explicit request. It is worth being clear-eyed about
 *  what this row now is: a named person beside their salary and a below/above-market
 *  judgement. That stays local (serve.py is localhost-bound and token-gated) and must not
 *  be screenshotted into a ticket or uploaded.
 *
 *  The id is kept as the join key — it is what a reader quotes when discussing a row, and
 *  it is truncated because these are 36-char UUIDs, not short HRIS ids; at full width the
 *  column clipped mid-UUID, which is unreadable AND unusable. Full value in the tooltip.
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
        {/* Title beneath the name when both exist — the title is what ties the row to the
            market comparison being made, so it stays visible rather than moving to a
            tooltip. Falls back to the id when there is no title. */}
        {row.name && row.title ? row.title : `${row.externalId.slice(0, 8)}…`}
      </span>
    </Td>
  );
}

function RosterTable({ rows }) {
  // Every metric renders, so this no longer depends on the picker at all. The picker still
  // drives the distribution chart above, which is one metric at a time by nature.
  return (
    // Every column centred, headers and cells alike, set once for the whole table rather
    // than repeated on twelve cells. Note the tradeoff this accepts: centred figures no
    // longer share a decimal edge, so a column of amounts is harder to scan for the
    // largest value than a right-aligned one would be.
    <TableAlign align="center">
    <table style={{ width: "100%", minWidth: 1360, tableLayout: "fixed" }}>
      <thead>
        {/* Two header rows: a spanning row naming each metric, then the shared column
            names. Without the group row, "Value / Compa-ratio / vs market" appears three
            times with nothing saying which metric each third belongs to. */}
        <tr>
          <Th width="17%" group />
          <Th width="9%" group />
          <Th width="8%" group />
          {METRICS.map((m) => (
            <Th key={m} colSpan={3} align="center" group>{METRIC_LABELS[m]}</Th>
          ))}
        </tr>
        <tr>
          <Th>Employee</Th>
          <Th>Job area</Th>
          <Th>Level</Th>
          {METRICS.map((m) => (
            <Fragment key={m}>
              <Th>{CASH_METRICS.includes(m) ? "Pay" : "Value"}</Th>
              <Th>Compa-ratio</Th>
              <Th>vs market</Th>
            </Fragment>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const track = trackOf(r.leader ? "LEADER" : "IC", r.level);
          return (
            <tr key={r.externalId}>
              <IdentityCell row={r} />
              <Td ellipsis title={jobLabel(r.jobArea)}>{jobLabel(r.jobArea)}</Td>
              {/* Track folded into the level cell: it is a property OF the level
                  (Senior 2 IC vs Senior 2 Manager), and three metric groups need the
                  horizontal room more than it needs its own column. */}
              <Td ellipsis title={`${levelLabel(r.level, track)} · ${TRACK_LABELS[track] || track}`}>
                <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {levelLabel(r.level, track)}
                </span>
                <span style={{ display: "block", fontSize: FS.xs, color: C.textQuiet }}>
                  {TRACK_LABELS[track] || track}
                </span>
              </Td>
              {METRICS.map((m) => <MetricCells key={m} row={r} metric={m} />)}
            </tr>
          );
        })}
      </tbody>
    </table>
    </TableAlign>
  );
}

/** Which scorecard these figures came from, and whether it was mid-recalculation.
 *
 *  CTC serves the last COMPLETED scorecard. When a recalculation is in flight that
 *  snapshot can be well behind the corporation's real state, and a rating absent from the
 *  old run is indistinguishable in the data from a rating that does not apply — an
 *  employee with equity looks equity-less. Without this the tab would state that absence
 *  as fact.
 *
 *  Renders nothing when the build predates provenance capture (no scorecard node) rather
 *  than claiming a freshness it cannot verify.
 */
function ScorecardProvenance({ scorecard }) {
  if (!scorecard || !scorecard.asOfDate) return null;
  const asOf = String(scorecard.asOfDate).slice(0, 10);
  const stale = !!scorecard.regenerating;
  return (
    <div style={{
      marginBottom: 14, padding: "10px 12px", borderRadius: RADIUS,
      background: stale ? C.feedbackNoticeSubtle : C.surfaceAlt,
      border: `1px solid ${stale ? C.feedbackNotice : C.border}`,
      fontSize: FS.sm, color: stale ? C.feedbackNotice : C.textSubtle, lineHeight: 1.55,
    }}>
      {stale ? (
        <>
          <strong>These figures are from a snapshot taken {asOf}, and CTC was
          recalculating when it was read.</strong> Ratings missing below — equity in
          particular — may already exist in the pending run. Re-run the skill once CTC
          reports the recalculation finished, and treat an absent rating here as
          "not in this snapshot" rather than "not applicable".
        </>
      ) : (
        <>Scorecard as of {asOf}{scorecard.benchmarkVersion ? ` · benchmarks ${scorecard.benchmarkVersion}` : ""}.</>
      )}
    </div>
  );
}

/** Employee name order, so a reader can find a person without scanning 130+ rows.
 *
 *  localeCompare, not `<`: the roster carries accents and mixed case ("João das
 *  neves" alongside "Joao das Neves"), and codepoint order files an accented name
 *  after every plain-ASCII one — separating the near-duplicate pair a reader most
 *  needs to see together. Those two compare equal under `sensitivity: "base"`, so
 *  their relative order falls back to sort stability, which the spec guarantees.
 *
 *  `name` is API-sourced and typed only by convention, so a non-string is treated as
 *  absent rather than being handed to `.trim()` — this runs inside sort(), where a
 *  throw would take down the whole tab rather than one cell. Nameless rows sort last:
 *  a row with no name cannot be looked up alphabetically.
 */
function compareByName(a, b) {
  const an = typeof a.name === "string" ? a.name.trim() : "";
  const bn = typeof b.name === "string" ? b.name.trim() : "";
  if (!an && !bn) return 0;
  if (!an) return 1;
  if (!bn) return -1;
  return an.localeCompare(bn, undefined, { sensitivity: "base" });
}

export default function Scorecard({ roster, corporation }) {
  // The default comes from the data, not a constant here: a corporation with no
  // salary ratings but real equity ones should open on something populated.
  const [metric, setMetric] = useState(roster.defaultMetric || "salary");
  const entry = roster.bandRollup[metric] || {};

  // Sorted here rather than inside the table so the CSV export below sees the same
  // order that is on screen.
  const rows = useMemo(() => [...(roster.rows || [])].sort(compareByName), [roster.rows]);

  /** Roster -> CSV. Exports ALL FOUR metrics, not just the selected one.
   *
   *  That is a deliberate difference from the Benchmarks export (which follows the
   *  view's job filter): the metric picker changes which distribution you're LOOKING
   *  at, not which employees are in scope. Someone exporting a roster wants to compare
   *  metrics in a spreadsheet — handing them only the visible one would force four
   *  exports and a manual join.
   *
   *  Compa-ratios are written exactly as the API returned them (decimal strings). Not
   *  reformatted, not re-derived: the value in the file must be the value Carta
   *  computed, or a reconciliation against the product UI fails on rounding.
   */
  const exportRoster = () => {
    // employee_id, never a name. A CSV is the most likely artifact to be mailed
    // around or dropped in a shared drive, so it is the LAST place a named salary
    // should exist. `title` is included because a reader reconciling the export
    // against their HRIS needs the role, and it identifies the comparison, not the
    // person.
    // Per metric: band, compa-ratio, percentile, the market mid and the gap to it. The
    // mid and gap are what make the file actionable — "$73,000 below a mid of $138,000"
    // is a budget line, where "0.47" needs the reader to reconstruct it. All were
    // already on the wire and previously discarded.
    const header = [
      // Name is here at the engineer's explicit request. This file is therefore a list of
      // named people with their salaries and a below/above-market judgement — the most
      // sensitive combination in the product. It must not be attached to a ticket,
      // uploaded, or committed.
      "employee_id", "name", "title", "job_area", "level", "track", "focus",
      "salary", "total_cash", "target_bonus", "equity_value",
      // The table dropped market_mid and diff_from_mid to stay readable. They are KEPT
      // here deliberately: a spreadsheet has no width limit, and without them the export
      // cannot answer "why is this person below market" or "what would it cost to fix" —
      // which is most of what a roster export is for. Removing them from the CSV as well
      // would leave no reconciliation path anywhere in the product.
      "salary_band", "salary_compa_ratio", "salary_percentile",
      "salary_market_mid", "salary_diff_from_mid", "salary_diff_pct",
      "total_cash_band", "total_cash_compa_ratio", "total_cash_percentile",
      "total_cash_market_mid", "total_cash_diff_from_mid", "total_cash_diff_pct",
      "equity_band", "equity_compa_ratio", "equity_percentile",
      "overall_band",
      "currency",
    ];    const body = rows.map((r) => {
      const track = trackOf(r.leader ? "LEADER" : "IC", r.level);
      const b = r.bands || {};
      const cr = r.compaRatios || {};
      const m = r.metrics || {};
      const sal = m.salary || {};
      const tcc = m.totalCash || {};
      const eq = m.ntmEquity || {};
      return [
        r.externalId, r.name || "", r.title || "",
        jobLabel(r.jobArea), levelLabel(r.level, track), TRACK_LABELS[track] || track,
        r.focus || "",
        // Empty, not 0, when the amount is absent — the same null-vs-zero distinction the
        // table draws. A spreadsheet would otherwise average a missing salary as zero.
        (r.salary || {}).amount ?? "",
        (r.totalCash || {}).amount ?? "",
        (r.targetVariable || {}).target_bonus ?? "",
        // Raw equity node stringified only when it is a scalar; an object shape would be
        // meaningless in a CSV cell and its real shape is still unverified.
        (typeof r.equity === "string" || typeof r.equity === "number") ? r.equity : "",
        b.salary || "", cr.salary || "", sal.percentile || "",
        sal.marketMid || "", sal.diffFromMid || "", sal.diffPct || "",
        b.totalCash || "", cr.totalCash || "", tcc.percentile || "",
        tcc.marketMid || "", tcc.diffFromMid || "", tcc.diffPct || "",
        b.ntmEquity || "", cr.ntmEquity || "", eq.percentile || "",
        b.overall || "",
        // One currency per row: this roster mixes USD/GBP/CAD, and pay and its benchmark
        // are always quoted in the same one. Prefer the pay node, which is the figure a
        // reader is most likely to re-add up.
        (r.salary || {}).currency || (r.totalCash || {}).currency
          || sal.currency || tcc.currency || "",
      ];
    });
    downloadCsv(csvFilename(corporation, "roster"), toCsv([header, ...body]));
  };

  return (
    <div style={{ padding: "10px 24px 24px" }}>
      <ScorecardProvenance scorecard={roster.scorecard} />
      <div style={{
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: RADIUS,
        padding: 16, marginBottom: 18,
      }}>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "baseline",
          gap: 16, flexWrap: "wrap", marginBottom: 12,
        }}>
          <div style={{ fontSize: FS.lg, fontWeight: 600, color: C.text }}>
            Market positioning
          </div>
          <MetricPicker roster={roster} metric={metric} setMetric={setMetric} />
        </div>

        <Distribution entry={entry} />
        <Reconciliation roster={roster} metric={metric} />
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
            Employees ({rows.length})
          </div>
          <ExportButton
            onExport={exportRoster}
            title="Download this roster as CSV — every employee, all four metrics, raw values"
            disabled={!rows.length}
          />
        </div>
        <div style={{ overflowX: "auto" }}>
          <RosterTable rows={rows} />
        </div>
        <div style={{ fontSize: FS.xs, color: C.textFaint, marginTop: 10 }}>
          Compa-ratio is the employee's pay against the market mid for their role, as
          returned by Carta — shown for the selected metric. An em dash means that metric
          is not scored for that employee.
        </div>
      </div>
    </div>
  );
}
