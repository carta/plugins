import { useMemo, useState } from "react";
import { FS, sans, PALETTE } from "../../ui/theme.js";
import { fmtM, fmtX, fmtAsOf, roundLabel } from "../../ui/format.js";
import { H1, H3, Btn, Segmented, Bubble, Avatar, Eyebrow, fundNameOnly, MixedCurrencyNote } from "../../ui/components.jsx";
import { recentActivity } from "../../model/activity.js";
import { quarterOf } from "../../model/pacing.js";
import { trackClick } from "../../analytics.js";

/** Recent activity — the firm's latest investments as cards: which fund, how
 *  much, when, and the company's latest priced round for context. Firm-wide, so
 *  a mixed-currency firm gets the notice instead (amounts can't share a symbol). */
// Recent-activity lanes: filter label + per-card tag + accent color. Order is the
// filter-tab order; the model tags each event with one of these `type`s.
const ACTIVITY_META = {
  investment: { label: "New", feedLabel: "New investment", bubble: "positive" },
  followOn: { label: "Follow-on", feedLabel: "Follow-on investment", bubble: "notice" },
  valuation: { label: "Valuations", feedLabel: "Valuation update", bubble: "info" },
  exit: { label: "Exits", feedLabel: "Exit", bubble: "neutral" },
};
const ACTIVITY_ORDER = ["investment", "followOn", "valuation", "exit"];
const REPORTS_PREVIEW = 5; // rows the Reports card shows per active filter; "Show more" opens the rest
const PAGE_SIZE = 25; // rows the full page adds per "Load more"

// The headline amount per lane: exits show proceeds, valuations the current mark,
// investments/follow-ons the check size.
const activityAmount = (r) => (r.type === "exit" ? r.proceeds : r.type === "valuation" ? r.mark : r.cost);

// Feed-row avatar fallback: first letter of up to the first two MEANINGFUL
// words ("Acme Health, Inc." → "AH", legal suffix excluded). A single
// remaining word (e.g. "BrightLeaf, Inc." → "BrightLeaf") falls back to its
// camelCase humps ("BrightLeaf" → "BL", "MyPlatform" → "MP") so one-word,
// compound-brand names still read as two distinct initials.
const LEGAL_SUFFIXES = new Set(["inc", "incorporated", "corp", "corporation", "co", "llc", "llp", "lp", "ltd", "limited", "pbc", "plc", "pc"]);
const initialsOf = (name) => {
  const base = name.replace(/\(.*\)/, ""); // drop a trailing "(dba X)" / "(acquired Y)" parenthetical
  const words = (base.match(/[A-Za-z0-9]+/g) || []).filter((w) => !LEGAL_SUFFIXES.has(w.toLowerCase()));
  if (words.length === 0) return "";
  if (words.length === 1) {
    const humps = words[0].match(/[A-Z][a-z0-9]*/g) || [];
    return (humps.length >= 2 ? humps.slice(0, 2).map((w) => w[0]).join("") : words[0].slice(0, 2)).toUpperCase();
  }
  return words.slice(0, 2).map((w) => w[0]).join("").toUpperCase();
};

// Deterministic pick of an initials-avatar color per company, so a feed of many
// different companies doesn't render as a wall of identical gray circles — the
// same company always lands on the same color. Drawn from PALETTE (theme.js) —
// the same categorical data-viz hues the fund charts use — skipping index 0
// (brand-black, the charts' "lead fund" special case) and the trailing
// brand-gray-30 fallback slot, neither of which is a real data-viz color.
const INITIALS_COLORS = PALETTE.slice(1, 9);
const colorFor = (name) => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return INITIALS_COLORS[Math.abs(h) % INITIALS_COLORS.length];
};

// Feed-row avatar: Ink's real Avatar (see ui/components.jsx) at its standard
// 38px size, always the round circle — a real logo renders via `imageUrl`,
// never Ink's separate non-circular `variant="company"` box. Avatar itself
// degrades to `initials` if the logo is missing or fails to load (a corrupt/
// truncated file fetch_logos.py's own validation makes rare, not impossible),
// so a non-empty `initials` is always passed here even when a logo is present.
function FeedAvatar({ logo, name }) {
  return (
    <Avatar imageUrl={logo || undefined}
      initials={initialsOf(name) || name.slice(0, 2).toUpperCase() || "?"} initialsColor={colorFor(name)}
      // nudge down to the company-name text's visual top (its 28px line-height
      // has ~6px of leading above the actual glyph-cap top) rather than the
      // row's box top, which sits a few px above where the name text starts
      style={{ marginTop: 6 }} />
  );
}

// The per-lane context line under the fund/security chips. Valuation rows
// match the design spec's "Multiplier" row exactly: "{moic}× MOIC" in the inherited
// subtle/regular tone, gap-12, then an arrow + colored medium-weight delta
// group (gap-4 between the arrow and its text, matching the DeltaTd caret
// spacing in the Firm Overview fund table) — no "Mark"/"·" framing.
function ActivityContext({ r }) {
  let content;
  if (r.type === "valuation") {
    const up = (r.gain || 0) >= 0;
    const deltaColor = up ? "var(--ink-color-global-feedback-positive-strong)" : "var(--ink-color-global-feedback-negative-strong)";
    content = (
      <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span>{fmtX(r.moic)} MOIC</span>
        <span style={{ display: "inline-flex", alignItems: "baseline", gap: 4, color: deltaColor, fontWeight: 500 }}>
          <span aria-hidden style={{ fontSize: FS.micro, lineHeight: 1 }}>{up ? "▲" : "▼"}</span>
          <span>{fmtM(Math.abs(r.gain || 0))} vs cost</span>
        </span>
      </span>
    );
  } else if (r.type === "exit") {
    content = <>Realized <strong style={{ color: "var(--ink-color-global-text-default)", fontWeight: 600 }}>{fmtX(r.moic)}</strong> on {fmtM(r.cost)} cost</>;
  } else if (r.round) {
    content = <>Latest round: <strong style={{ color: "var(--ink-color-global-text-default)", fontWeight: 600 }}>{roundLabel(r.round)}</strong>{r.postMoney ? ` · ${fmtM(r.postMoney)} post-money valuation` : ""}</>;
  }
  if (!content) return null;
  return <div style={{ ...sans, fontSize: FS.body, lineHeight: "20px", color: "var(--ink-color-global-text-subtle)" }}>{content}</div>;
}

/** One event: avatar, company and event type, date, funds, amount, then its context line. */
function ActivityRow({ r, last }) {
  const meta = ACTIVITY_META[r.type];
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start",
      padding: "16px 0", borderBottom: last ? "none" : "1px solid var(--ink-color-global-border-subtle)" }}>
      <FeedAvatar logo={r.logo} name={r.name} />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ ...sans, fontSize: FS.h3, lineHeight: "28px", fontWeight: 500, color: "var(--ink-color-global-text-default)" }}>{r.name}</span>
            <Bubble variant={meta.bubble}>{meta.feedLabel}</Bubble>
            <span style={{ marginLeft: "auto" }} />
            <span style={{ ...sans, fontSize: FS.value, lineHeight: "24px", color: "var(--ink-color-global-text-subtle)", whiteSpace: "nowrap" }}>{r.date ? fmtAsOf(r.date) : "—"}</span>
          </div>
          {r.fundNames.length > 0 && (
            <span style={{ ...sans, fontSize: FS.value, lineHeight: "24px", color: "var(--ink-color-global-text-subtle)" }}>{r.fundNames.map(fundNameOnly).join(", ")}</span>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <span style={{ ...sans, fontSize: FS.value, lineHeight: "24px", fontWeight: 500, color: "var(--ink-color-global-text-default)" }}>{fmtM(activityAmount(r))}</span>
            {r.securities && r.securities.length > 0 && (
              <span style={{ ...sans, fontSize: FS.value, lineHeight: "24px", color: "var(--ink-color-global-text-subtle)" }}>{r.securities.join(", ")}</span>
            )}
          </div>
          <ActivityContext r={r} />
        </div>
      </div>
    </div>
  );
}

// "2026-10-14" → "Q4 2026"; the full page groups its rows under these.
const quarterLabel = (date) => { const q = quarterOf(date.slice(0, 7)); return `${q.slice(5)} ${q.slice(0, 4)}`; };

/** Rows, each a divider apart. */
const RowList = ({ rows }) => rows.map((r, i) => <ActivityRow key={r.key} r={r} last={i === rows.length - 1} />);

/** The page's rows under a heading per quarter, newest first (rows arrive sorted by date). */
function QuarterGroups({ rows }) {
  const groups = [];
  for (const r of rows) {
    const label = r.date ? quarterLabel(r.date) : "Undated";
    if (groups.at(-1)?.label !== label) groups.push({ label, rows: [] });
    groups.at(-1).rows.push(r);
  }
  return groups.map((g) => (
    <section key={g.label} data-testid="activity-quarter">
      <Eyebrow style={{ padding: "20px 0 4px", borderBottom: "1px solid var(--ink-color-global-border-subtle)" }}>{g.label}</Eyebrow>
      <RowList rows={g.rows} />
    </section>
  ));
}

/** The feed: lane filter, then rows. The Reports card passes `preview`: it shows that
 *  many rows of the active lane and a "Show more" link beside its heading. The full page
 *  passes `pageSize`: it groups rows by quarter and adds `pageSize` more per "Load more". */
function ActivityFeed({ rows, mixed, Heading, preview, onShowMore, pageSize, byQuarter }) {
  const [filter, setFilter] = useState("all");
  const [count, setCount] = useState(pageSize);
  if (!rows.length) return null;
  // amounts can't share a symbol across currencies — keep the firm-wide guard
  if (mixed) return <MixedCurrencyNote title="Recent portfolio activity" />;

  // only offer tabs for lanes that actually have events; "All" is always present
  const present = ACTIVITY_ORDER.filter((t) => rows.some((r) => r.type === t));
  const options = [{ id: "all", label: "All" }, ...present.map((t) => ({ id: t, label: ACTIVITY_META[t].label }))];
  const active = options.some((o) => o.id === filter) ? filter : "all";
  const lane = active === "all" ? rows : rows.filter((r) => r.type === active);
  const shown = lane.slice(0, preview ?? count ?? Infinity);
  // a new lane starts again from the first page
  const pickLane = (id) => { setFilter(id); setCount(pageSize); };

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <Heading>Recent portfolio activity</Heading>
        {onShowMore && lane.length > shown.length && (
          <Btn kind="link" onClick={onShowMore} data-testid="activity-show-more" style={{ fontSize: FS.value }}>Show more →</Btn>
        )}
        <span style={{ marginLeft: "auto" }}><Segmented small options={options} value={active} onChange={pickLane} /></span>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {byQuarter ? <QuarterGroups rows={shown} /> : <RowList rows={shown} />}
      </div>
      {pageSize && lane.length > shown.length && (
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 16 }}>
          <Btn onClick={() => { trackClick("FundModeling.Activity.LoadMore"); setCount((n) => n + pageSize); }} data-testid="activity-load-more">Load more</Btn>
          <span data-testid="activity-count" style={{ ...sans, fontSize: FS.body, color: "var(--ink-color-global-text-subtle)" }}>Showing {shown.length} of {lane.length}</span>
        </div>
      )}
    </div>
  );
}

/** The Reports card: the latest few events, linking to the full page. */
export default function RecentActivityCard({ rows, mixed, onShowMore }) {
  return <ActivityFeed rows={rows} mixed={mixed} Heading={H3} preview={REPORTS_PREVIEW}
    onShowMore={() => { trackClick("FundModeling.Reports.ActivityShowMore"); onShowMore(); }} />;
}

/** The full activity page (/firm/<firm>/activity): every event, a page at a time and
 *  grouped by quarter, opened from the Reports card, with a way back to Reports. */
export function ActivityPage({ snapshot, portfolio, mixed, onBack }) {
  const rows = useMemo(
    () => recentActivity(portfolio.companies, snapshot.funds, snapshot.source?.navAsOf),
    [portfolio, snapshot]
  );
  return (
    <div>
      <Btn kind="link" onClick={onBack} data-testid="activity-back" style={{ fontSize: FS.value, marginBottom: 12 }}>← Reports</Btn>
      <ActivityFeed rows={rows} mixed={mixed} Heading={H1} pageSize={PAGE_SIZE} byQuarter />
    </div>
  );
}
