import { useMemo, useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { sans, INK, PAPER, LINE, FAINT, MICRO, GREEN, RED, FS, SPACING, BANNER_SURFACE_INFO, INFO_STRONG, BANNER_TEXT, BORDER_DEFAULT } from "../../ui/theme.js";
import { ChartTitle, Btn, Tag, Bubble, Chevron, HelpCircleIcon } from "../../ui/components.jsx";
import HoverTip from "../../ui/HoverTip.jsx";
import { fmtCurrencyShort, fmtCurrencyWhole, fmtCurrencyExact } from "../../charts/chartTheme.js";
import { varianceColor, fmtVarianceWhole } from "../../ui/variance.js";
import { filterEntries, filterFundFeeEntries, filterFeeScheduleTerms, aggregate, rangeLabel, filterEntriesByTags, tagKey, offerableValues, filterEntriesByAccounts, quarterlyFeeSummary, parseYear } from "./util.js";
import CompositionChart from "./CompositionChart.jsx";
import BudgetPaceChart, { paceNote, paceModeFor } from "./BudgetPaceChart.jsx";
import EntriesTable from "./EntriesTable.jsx";
import BudgetInsight from "./BudgetInsight.jsx";
import MonthSideGLBreakdown from "./MonthSideGLBreakdown.jsx";
import FeeScheduleTerms from "./FeeScheduleTerms.jsx";
import { trackClick, trackRender } from "../../analytics.js";

/** What to call a scope in the header: the firm's own category for a tag,
 *  Carta's word for everything else. */
function scopeLabel(sc) {
  const source = sc.source || "reporting_tag";
  if (source === "reporting_tag") return sc.category || "Reporting tag";
  if (source === "sub_account") return "Sub-account";
  if (source === "vendor") return "Vendor";
  if (source === "account") return "GL account";
  return "Scope";
}

// Body of the drawer. Filters `entries` by `selection`, aggregates,
// and renders header → composition mini-chart → tag summary → JE table.
export default function DrilldownContent({
  selection,
  entries,
  fundFeeEntries,
  feeScheduleTerms,
  spendByGL,
  buildJournalUrl,
  topCategoryNames = [],
  asOf,
  onDrillAccountForMonth,
}) {
  // Lookup {name → {actual, budget}} for account-scoped drills so we can
  // surface the account's YTD budget line in the Budget-insight section.
  const budgetLine = useMemo(() => {
    if (selection?.kind !== "account") return null;
    // Prefer the row's own figure. The lookup below only covers the top-10
    // spend list, and where both exist they can print two budgets for one row.
    if (typeof selection.budget === "number") {
      return { name: selection.name, budget: selection.budget, actual: selection.actual };
    }
    if (!spendByGL?.accounts) return null;
    return spendByGL.accounts.find(a => a.name === selection.name) || null;
  }, [selection, spendByGL]);
  // For fund-year drills, filter the fund-side fee entries (separate dataset
  // than ManCo entries). For other drill kinds, use the ManCo entries as before.
  const filtered = useMemo(() => {
    if (selection?.kind === "fund-year") {
      return filterFundFeeEntries(fundFeeEntries, selection);
    }
    // Outline cells on a per-fund management-fee line resolve from the
    // fund-side dataset too — the ManCo's own GL 4160 aggregates Fund II
    // + Fund III and can't be split by fund.
    if (selection?.kind === "outline-cell" && selection.fundMatch) {
      return filterFundFeeEntries(fundFeeEntries, selection);
    }
    // A total can cover both kinds of line — per-fund fee lines resolve
    // against the fund-side dataset, everything else against the ManCo's
    // own entries — so it draws from both and the drawer holds the whole
    // of what the figure summed.
    if (selection?.kind === "outline-total") {
      return [...filterEntries(entries, selection, topCategoryNames),
              ...filterFundFeeEntries(fundFeeEntries, selection)];
    }
    return filterEntries(entries, selection, topCategoryNames);
  }, [entries, fundFeeEntries, selection, topCategoryNames]);

  // Contracted LPA fee terms for a fund-year drill — a different dataset
  // than the fee actuals above (what the LPA says vs. what was booked).
  const scheduleTerms = useMemo(
    () => filterFeeScheduleTerms(feeScheduleTerms, selection),
    [feeScheduleTerms, selection]
  );

  // BASE aggregate — computed once from the selection-filtered set. Used for
  // the tag pill list (pill amounts stay stable — they represent each tag's
  // slice of the *whole drill*, not the tag-filtered subset) and for the
  // account-level rollups that shouldn't move with tag toggles (BudgetInsight
  // vendor concentration, MonthSideGLBreakdown GL rows).
  const agg = useMemo(() => aggregate(filtered), [filtered]);

  // Checkbox multi-select: filterEntriesByTags ORs within a category, ANDs
  // across categories. Resets on drill-selection change.
  // Filters hold what the reader chose, and nothing else. The scope a row
  // arrives with is stated in the header above — saying it here too, as a
  // box that cannot be unticked, said one fact three times and made tags
  // behave unlike every other filter in the panel.
  const [selectedTagKeys, setSelectedTagKeys] = useState(() => new Set());
  useEffect(() => { setSelectedTagKeys(new Set()); }, [selection]);
  const applyTags = (next) => setSelectedTagKeys(new Set(next));

  // Which of the drill's accounts the reader picked. Empty is the default
  // and means no filter, the same as no tags picked.
  const [selectedAccounts, setSelectedAccounts] = useState(() => new Set());
  useEffect(() => { setSelectedAccounts(new Set()); }, [selection]);

  // Entries shown in the JE table + stats + monthly chart — narrows the
  // selection-filtered set to those matching every selected tag.
  const accountsInDrill = useMemo(
    () => (agg.by_account || []).filter(a => a.acct_type != null),
    [agg]
  );
  // A value every entry already carries cannot narrow anything — most often
  // the row's own scope, which is why it needs no special case here.
  const offeredTags = useMemo(
    () => offerableValues(agg.all_tags, agg.count),
    [agg]
  );
  // Same rule for the accounts: a drill that has narrowed to one of them
  // offers a box whose only effect is to leave the list exactly as it is.
  const offeredAccounts = useMemo(
    () => offerableValues(accountsInDrill, agg.count),
    [accountsInDrill, agg.count]
  );
  const tagFiltered = useMemo(
    () => filterEntriesByAccounts(
      filterEntriesByTags(filtered, selectedTagKeys), selectedAccounts),
    [filtered, selectedTagKeys, selectedAccounts]
  );

  // FILTERED aggregate — recomputed as tag selections change. Drives the
  // stats row (Total / Entries / Vs. prior month) and the drawer's monthly
  // chart, so those visibly update as the user picks tags.
  const aggFiltered = useMemo(() => aggregate(tagFiltered), [tagFiltered]);

  // Prior-month total for the month-side delta stat. Same side, month-1,
  // ALSO respecting the current tag filter so the delta compares apples to
  // apples with the (tag-filtered) current-month total shown in Total above.
  const priorMonthTotal = useMemo(() => {
    if (selection?.kind !== "month-side" || selection.month <= 1) return null;
    const prev = entries.filter(e =>
      e.mo === selection.month - 1 && e.kind === selection.side
    );
    return filterEntriesByTags(prev, selectedTagKeys)
      .reduce((s, e) => s + e.amount, 0);
  }, [entries, selection, selectedTagKeys]);

  // For category drills, the drawer shows a
  // MoM chart for the category across all months, highlighting the clicked
  // month. Also respect the tag filter so the graph updates as pills toggle.
  const categoryMoM = useMemo(() => {
    if (selection?.kind !== "date-range-category") return null;
    const monthly = [0, 0, 0, 0, 0, 0, 0];
    const topSet = new Set(topCategoryNames);
    const matchesOther = (e) => e.kind === "expense" && !topSet.has(e.account);
    const categoryHits = entries.filter(e =>
      selection.category === "Other" ? matchesOther(e) : e.account === selection.category
    );
    const filtered2 = filterEntriesByTags(categoryHits, selectedTagKeys);
    for (const e of filtered2) monthly[e.mo - 1] += e.amount;
    return monthly;
  }, [entries, selection, topCategoryNames, selectedTagKeys]);

  if (!selection) return null;

  const netColor = selection.kind === "month-side" && selection.side === "income" ? GREEN
                  : selection.kind === "account" && aggFiltered.total < 0 ? RED
                  : INK;

  // Budget-vs-actuals drills arrive carrying the cell's own budget. The
  // user clicked a comparison, so the drawer answers the comparison — a
  // journal-entry list under a Total alone leaves them to hold the budget
  // in their head while they read it. Both figures are the table's, not
  // recomputed here, so the two always agree.
  //
  // The stats row deliberately reports the cell's actual rather than
  // `aggFiltered.total`: the tag pills below narrow the entry list, and a
  // variance that moved as pills toggled would be measuring a subset of the
  // actual against the whole budget.
  const hasBudget = typeof selection.budget === "number";
  const variance = hasBudget && typeof selection.actual === "number"
    ? selection.actual - selection.budget
    : null;

  if (selection.isProjected) {
    return (
      <ProjectedFeeSummary
        selection={selection}
        scheduleTerms={scheduleTerms}
      />
    );
  }

  return (
    <div style={{ ...sans, color: INK, display: "flex", flexDirection: "column", gap: SPACING.section }}>
      <div>
        <div style={S.statsRow}>
          {/* The drill's own figures, not the filter's. These restate the
              cell the reader clicked, and a Total that moved as they ticked
              a box would stop being the thing they came to check — the
              footer carries the filtered figure instead. */}
          <StatBlock label="Total" value={fmtCurrencyWhole(agg.total)} valueColor={netColor} />
          <StatBlock label="Entries" value={String(agg.count)} />
          {hasBudget && (
            <StatBlock
              label="Budget"
              value={selection.budget === 0 ? "—" : fmtCurrencyWhole(selection.budget)}
            />
          )}
          {hasBudget && (
            <StatBlock
              label="Variance"
              // An unmapped line has a budget but no reachable actual, so
              // there is nothing to subtract from — the table withholds the
              // variance there and so does this.
              value={selection.unmapped || variance == null ? "—" : fmtVarianceWhole(variance)}
              valueColor={selection.unmapped || variance == null
                ? FAINT
                : varianceColor(variance, selection.polarity, 2)}
            />
          )}
          {selection.kind === "account" && (
            <StatBlock label="Type" value={String(entries.find(e => e.account === selection.name)?.acct_type || "—")} />
          )}
          {/* Which slice of the account this row reports — without it the
              drawer's total reads as the whole account's. Every source says
              it the same way: a reporting tag is context about what this
              panel IS, exactly as a sub-account or a vendor is. */}
          {[...(selection.scopes || []),
            ...(selection.childScope ? [selection.childScope] : [])]
            .map(sc => (
              <StatBlock key={`${sc.source}:${sc.category || ""}:${sc.value}`}
                         label={scopeLabel(sc)}
                         // The panel for entries this dimension says nothing
                         // about. Just "None" — the block's own label already
                         // names the dimension, so repeating it here would
                         // read as a value some entry holds.
                         value={sc.value == null ? "None" : sc.value} />
            ))}
          {selection.kind === "date-range-category" && (
            <StatBlock label="Date range" value={rangeLabel(selection.start, selection.end)} />
          )}
          {selection.kind === "month-side" && priorMonthTotal != null && (
            <PriorMonthDelta
              current={agg.total}
              prior={priorMonthTotal}
              side={selection.side}
              month={selection.month}
            />
          )}
        </div>
      </div>

      {/* Workbook Comments — the client's own annotation explaining why a
          budget line is set to a given amount. Rendered only for the
          Budget-vs-Actuals crosstab drill, as an Ink info banner
          (Ink's components-banner.html). */}
      {(selection.kind === "department-account" || selection.kind === "outline-cell") && selection.comment && (
        <div style={S.commentCallout} role="status">
          <span style={S.commentIcon} aria-hidden="true">
            <svg viewBox="0 0 14 14" fill="currentColor">
              <circle cx="7" cy="3.4" r="0.9" />
              <rect x="6.15" y="5.6" width="1.7" height="6.1" rx="0.4" />
            </svg>
          </span>
          <div>
            <div style={S.commentTitle}>Budget note</div>
            <div style={S.commentBody}>{selection.comment}</div>
          </div>
        </div>
      )}

      {/* GL account breakdown for the month-side drill (Cashflow chart). */}
      {/* Rows are display-only — the journal-entry table below already exposes
          per-account detail via its Account column, so an in-row drill was
          redundant. onDrillAccountForMonth prop remains threaded but unused,
          in case a future design surfaces per-account drills elsewhere. */}
      {selection.kind === "month-side" && agg.by_account?.length > 0 && (
        <MonthSideGLBreakdown
          rows={agg.by_account}
          sideLabel={selection.side === "income" ? "income" : "expenses"}
        />
      )}

      {/* Budget insight (account drills with a budget line) */}
      {selection.kind === "account" && budgetLine?.budget > 0 && (
        <BudgetInsight
          account={selection.name}
          agg={agg}
          budgetLine={budgetLine}
        />
      )}

      {/* A drill that arrived from a budget comparison gets the budget over
          time, at the resolution the workbook states it. Drills with no
          budget behind them (a chart segment, a bare account) skip it. */}
      {typeof selection.budget === "number" && !selection.unmapped && (
        <div>
          <div style={S.paceHeader}>
            <ChartTitle>Budget vs actual over time</ChartTitle>
            <HoverTip text={paceNote(paceModeFor(selection.monthlyBudget, selection.quarterlyBudget), selection.period)}>
              <HelpCircleIcon size={16} strokeWidth={1.6} style={{ color: INFO_STRONG }} />
            </HoverTip>
          </div>
          <BudgetPaceChart
            quarterlyBudget={selection.quarterlyBudget}
            monthlyBudget={selection.monthlyBudget}
            monthlyActual={agg.monthly}
            budget={selection.budget}
            period={selection.period}
            // Same favorable-side rule as varianceColor() above: exceeding
            // budget is good for income, bad for expense.
            actualColor={(selection.polarity === "income"
              ? Math.abs(agg?.total ?? 0) > selection.budget
              : Math.abs(agg?.total ?? 0) < selection.budget)
              ? "var(--local-cat-positive-2)" : "var(--local-cat-negative-2)"}
          />
        </div>
      )}

      {/* Contracted fee schedule terms (fund-year drills only). Rendered
          above the actuals composition chart — the LPA terms are the
          reference point a reader checks the actuals against, not an
          afterthought below them. */}
      {scheduleTerms.length > 0 && (
        <FeeScheduleTerms terms={scheduleTerms} />
      )}

      {/* Composition mini-chart */}
      {filtered.length > 0 && (
        <CompositionSection selection={selection} agg={aggFiltered} categoryMoM={categoryMoM} />
      )}

      {/* Filters for the JE table below. Shown when there is something to
          filter by: a drill over several accounts is worth narrowing even
          where the firm tags nothing. */}
      {(offeredTags.length > 0 || offeredAccounts.length > 0) && (
        <ReportingTagsFilter
          allTags={offeredTags}
          selectedTagKeys={selectedTagKeys}
          onApply={applyTags}
          accounts={offeredAccounts}
          selectedAccounts={selectedAccounts}
          onApplyAccounts={setSelectedAccounts}
        />
      )}

      {/* Journal-entry table — narrowed by selected tags. */}
      <div>
        <div style={S.jeHeader}>
          <ChartTitle>Carta journal entries</ChartTitle>
        </div>
        <EntriesTable
          entries={tagFiltered}
          buildJournalUrl={buildJournalUrl}
        />
      </div>

      {/* What the filters currently add up to. Sticky, because the answer
          to "what did I just narrow this to" should not require scrolling
          to the end of the list to read. The count is of the whole filtered
          set, not of the rows built so far, and the total with it. */}
      <div style={S.footer}>
        <span style={S.footerCount}>
          {`${aggFiltered.count} of ${agg.count} journal entries visible`}
        </span>
        <span style={S.footerTotal}>{fmtCurrencyWhole(aggFiltered.total)}</span>
      </div>
    </div>
  );
}

// Reporting-tags multi-select filter. Groups pills by category when the
// underlying data has category structure (from REPORTING_TAGS_JSON); falls
// back to a single ungrouped block when tags are flat-text-only (older
// caches, or firms whose REPORTING_TAGS_JSON is empty). Click a pill to
// toggle inclusion; "Clear all" resets. Selected pills use the ACCENT
// (Ink brand-black) treatment; unselected use tone="info" (link blue),
// matching the drilldown's other "active vs. link" affordance conventions.
function ReportingTagsFilter({ allTags, selectedTagKeys, onApply,
                              accounts = [], selectedAccounts, onApplyAccounts }) {
  // Empty means no filter, exactly as it does for tags: the list shows
  // every entry behind the row until the reader picks an account.
  const appliedAccounts = selectedAccounts || new Set();
  // Group by category, preserving top-by-amount order within each group.
  const byCategory = new Map();
  for (const t of allTags) {
    const cat = t.category || "";
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(t);
  }
  const groups = [...byCategory.entries()].map(([cat, tags]) => ({ category: cat, tags }));

  const [open, setOpen] = useState(false);
  useEffect(() => { if (open) trackRender("MancoReporting.DrilldownFilterPanel.View"); }, [open]);
  const [tab, setTab] = useState(allTags.length ? "tags" : "accounts");
  // Which tab is really showing. The stored one survives a change of
  // selection, and either list can empty between drills — leaving the panel
  // parked on a tab it no longer renders, and a reader looking at nothing.
  const activeTab = (tab === "tags" && !allTags.length) ? "accounts"
                  : (tab === "accounts" && !accounts.length) ? "tags"
                  : tab;
  const [draft, setDraft] = useState(selectedTagKeys);
  const [draftAccounts, setDraftAccounts] = useState(appliedAccounts);
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);

  // Draft is scratch state — only committed to the real filter on Apply.
  useEffect(() => { if (!open) setDraft(selectedTagKeys); }, [open, selectedTagKeys]);
  useEffect(() => {
    if (!open) setDraftAccounts(selectedAccounts || new Set());
  }, [open, selectedAccounts]);

  // Clicking away commits rather than discards. Unticking three accounts
  // and closing the panel is a decision, and throwing it out silently
  // reads as the filter not working at all — which is exactly how it was
  // first reported.
  //
  // Through a ref because useOutsideClose binds its handler once per open
  // (deps: [open]) on the premise that the callback is stable. This one
  // isn't — it closes over the draft — so the ref keeps it current instead
  // of committing whatever the draft was when the panel opened.
  const applyRef = useRef(null);
  useOutsideClose(open, () => applyRef.current?.(), [triggerRef, panelRef]);

  // Portaled + position:fixed (as in carta-fund-modeling's GlobalFilter): a
  // plain absolute popover would get clipped by the drawer's own scroll body.
  useEffect(() => {
    if (!open) { setPos(null); return; }
    const reposition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const left = Math.min(Math.max(rect.left, 8), window.innerWidth - GF_PANEL_WIDTH - 8);
      // The panel is a fixed 416px tall, and the drawer's filter row sits
      // low enough on a short window that its Apply button fell off the
      // bottom of the screen. Open upwards where that buys more room, and
      // shorten it to what's left either way — the list inside scrolls,
      // the actions must not.
      const below = window.innerHeight - rect.bottom - GF_PANEL_MARGIN;
      const above = rect.top - GF_PANEL_MARGIN;
      const flip = below < GF_PANEL_MIN_HEIGHT && above > below;
      const room = Math.max(GF_PANEL_MIN_HEIGHT, flip ? above : below);
      const height = Math.min(GF_PANEL_HEIGHT, room);
      setPos({ top: flip ? Math.max(GF_PANEL_MARGIN, rect.top - height - 6) : rect.bottom + 6,
               left, height });
    };
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  const toggleDraft = (k) => {
    setDraft(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };
  const apply = () => {
    onApply(draft);
    onApplyAccounts?.(new Set(draftAccounts));
    setOpen(false);
  };
  applyRef.current = apply;

  const resetDraft = () => {
    setDraft(new Set());
    setDraftAccounts(new Set());
  };
  const toggleDraftAccount = (t) => setDraftAccounts(prev => {
    const next = new Set(prev);
    if (next.has(t)) next.delete(t); else next.add(t);
    return next;
  });
  const removeApplied = (k) => onApply(new Set([...selectedTagKeys].filter(x => x !== k)));

  return (
    <div>
      <div ref={triggerRef} style={S.filterRow}>
        <Btn kind="ghost" size="toolbar" onClick={() => setOpen(v => !v)}
             aria-haspopup="dialog" aria-expanded={open}
             className={open ? "is-open" : undefined}>
          Filters
          {/* Everything the list below is filtered by, matching the counts
              in the panel's own rail. Counting only what the reader
              changed left the button reading "no filters" over a list
              that was filtered from the moment it opened. */}
          {selectedTagKeys.size + appliedAccounts.size > 0
            && <Bubble tone="info">{selectedTagKeys.size + appliedAccounts.size}</Bubble>}
          <Chevron rotate={open ? 180 : 0} />
        </Btn>

        {[...selectedTagKeys].map(k => {
          const t = allTags.find(x => tagKey(x.category, x.value) === k);
          if (!t) return null;
          return (
            <Tag key={k} tone="info" style={S.filterChip}>
              {t.value}
              <button type="button" className="tag-close-btn" aria-label={`Remove ${t.value}`}
                      onClick={() => { trackClick("MancoReporting.Drilldown.FilterChipRemove"); removeApplied(k); }}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                  <path d="M2 2L8 8M8 2L2 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </Tag>
          );
        })}

        {/* Named rather than counted: "2 of 8 accounts" says a filter is
            on, not which one. A chip appears when the reader picks it. */}
        {accounts
          .filter(a => appliedAccounts.has(a.acct_type))
          .slice(0, ACCOUNT_CHIP_LIMIT)
          .map(a => (
            <Tag key={a.acct_type} tone="info" style={S.filterChip}>
              {`${a.acct_type} ${a.name}`}
              <button type="button" className="tag-close-btn"
                      aria-label={`Stop showing ${a.name}`}
                      onClick={() => {
                        trackClick("MancoReporting.Drilldown.FilterChipRemove");
                        onApplyAccounts?.(
                          new Set([...appliedAccounts].filter(t => t !== a.acct_type)));
                      }}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                  <path d="M2 2L8 8M8 2L2 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </Tag>
          ))}
        {appliedAccounts.size > ACCOUNT_CHIP_LIMIT && (
          <Tag tone="neutral" style={S.filterChip}>
            {`+${appliedAccounts.size - ACCOUNT_CHIP_LIMIT} more`}
          </Tag>
        )}

        {open && pos && createPortal(
          <div ref={panelRef} className="gf-panel popin" data-drawer-popover
               style={{ position: "fixed", top: pos.top, left: pos.left,
                        height: pos.height, zIndex: 1200 }}
               role="dialog" aria-label="Filter by reporting tag">
            <div className="gf-panel__menu" role="tablist" aria-orientation="vertical" aria-label="Filter type">
              {/* Offered only where there is something to choose. A drill
                  whose every entry carries the same value has nothing to
                  narrow, and an empty tab reads as a filter that is broken
                  rather than one that does not apply. */}
              {allTags.length > 0 && (
                <button type="button"
                        className={`gf-navitem${activeTab === "tags" ? " gf-navitem--active" : ""}`}
                        role="tab" aria-selected={activeTab === "tags"} onClick={() => { trackClick("MancoReporting.Drilldown.TabTags"); setTab("tags"); }}>
                  <span style={S.navItemRow}>
                    Reporting tags
                    {draft.size > 0 && <Bubble tone="info">{draft.size}</Bubble>}
                  </span>
                </button>
              )}
              {accounts.length > 0 && (
                <button type="button"
                        className={`gf-navitem${activeTab === "accounts" ? " gf-navitem--active" : ""}`}
                        role="tab" aria-selected={activeTab === "accounts"} onClick={() => { trackClick("MancoReporting.Drilldown.TabAccounts"); setTab("accounts"); }}>
                  <span style={S.navItemRow}>
                    GL accounts
                    {draftAccounts.size > 0 && <Bubble tone="info">{draftAccounts.size}</Bubble>}
                  </span>
                </button>
              )}
            </div>
            <div className="gf-panel__right">
              <div className="gf-panel__view" role="tabpanel">
                {activeTab === "accounts" && (
                  <div style={S.categorySection}>
                    <h3 className="gf-view__title">Accounts in this figure</h3>
                    <div className="gf-check-list">
                      {accounts.map(a => (
                        <label key={a.acct_type} className="gf-check-row">
                          <input type="checkbox" checked={draftAccounts.has(a.acct_type)}
                                 onChange={() => toggleDraftAccount(a.acct_type)} />
                          <span style={S.checkLabel}>{a.acct_type} — {a.name}</span>
                          <span style={S.checkAmount}>{fmtCurrencyShort(a.amount, 1)}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {activeTab === "tags" && groups.map(({ category, tags }) => (
                  <div key={category || "_ungrouped"} style={S.categorySection}>
                    <h3 className="gf-view__title">{category || "Tags"}</h3>
                    <div className="gf-check-list">
                      {tags.map(t => {
                        const k = tagKey(t.category, t.value);
                        return (
                          <label key={k} className="gf-check-row">
                            <input type="checkbox" checked={draft.has(k)}
                                   onChange={() => toggleDraft(k)} />
                            <span style={S.checkLabel}>{t.value}</span>
                            <span style={S.checkAmount}>{fmtCurrencyShort(t.amount, 1)}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <div className="gf-actions">
                <button type="button" className="gf-btn gf-btn--ghost" onClick={() => { trackClick("MancoReporting.Drilldown.FilterReset"); resetDraft(); }}>Reset</button>
                <button type="button" className="gf-btn gf-btn--primary" onClick={() => { trackClick("MancoReporting.Drilldown.FilterApply"); apply(); }}>Apply</button>
              </div>
            </div>
          </div>,
          document.body
        )}
      </div>
    </div>
  );
}

// Same as SIDEBAR_WIDTH-style constants elsewhere — .gf-panel's own CSS
// (theme.js) fixes this at 560px; kept in sync here for the reposition math.
const GF_PANEL_WIDTH = 560;

// Past this the chip row wraps into the entry list. The rest are counted,
// and the popover still lists every one.
const ACCOUNT_CHIP_LIMIT = 4;

// .gf-panel's own height (theme.js), the least it can usefully shrink to
// before the list is unreadable, and the gap kept from the window edge.
const GF_PANEL_HEIGHT = 416;
const GF_PANEL_MIN_HEIGHT = 240;
const GF_PANEL_MARGIN = 16;

// Same contract as BudgetPeriodControls.jsx's useOutsideClose, generalized
// to N refs (trigger + portaled panel).
function useOutsideClose(open, close, refs) {
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (!refs.some(r => r.current && r.current.contains(e.target))) close();
    };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- close/refs are stable across renders
  }, [open]);
}

// Picks the right composition view based on selection kind.
function CompositionSection({ selection, agg, categoryMoM }) {
  if (selection.kind === "date-range-category" && categoryMoM) {
    const label = selection.category === "Other"
      ? "Total expenses month over month"
      : `${selection.category} — month over month`;
    return (
      <div>
        <ChartTitle as="div" style={{ marginBottom: 8 }}>{label}</ChartTitle>
        <CompositionChart kind="monthly" monthly={categoryMoM} highlightIndex={selection.month - 1} color={selection.color} />
      </div>
    );
  }

  // account-scoped: monthly trend for the whole year
  if (selection.kind === "account") {
    // Budget vs Actual Over Time already plots these actuals, against the
    // plan. This would be the same series again, saying less.
    if (typeof selection.budget === "number") return null;
    return (
      <div>
        <ChartTitle as="div" style={{ marginBottom: 8 }}>Monthly trend</ChartTitle>
        <CompositionChart kind="monthly" monthly={agg.monthly} />
      </div>
    );
  }

  // fund-year: monthly within-year trend (usually quarterly booking spikes)
  if (selection.kind === "fund-year") {
    return (
      <div>
        <ChartTitle as="div" style={{ marginBottom: 8 }}>Monthly bookings within {selection.yearLabel}</ChartTitle>
        <CompositionChart kind="monthly" monthly={agg.monthly} color={selection.color} />
      </div>
    );
  }

  // month-side has no composition mini-chart of its own — the GL account
  // breakdown section (rendered separately above) is the primary rollup.
  // Top-vendors / top-partners fallbacks were removed because VENDOR_NAME
  // and PARTNER_NAME are only sparsely populated on ManCo JEs, so the
  // chart was often misleading.
  return null;
}

// Delta stat block: signed $ + % vs. prior month, colored by "good direction"
// for each side. For expenses, growth is bad (red). For income, growth is good
// (green). Neutral within ±5%.
const MONTH_NAMES_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function PriorMonthDelta({ current, prior, side, month }) {
  const diff = current - prior;
  const pct = prior === 0 ? null : (diff / Math.abs(prior)) * 100;
  const sign = diff > 0 ? "+" : diff < 0 ? "−" : "";
  const magnitude = fmtCurrencyWhole(Math.abs(diff));
  const pctStr = pct == null ? "n/a" : `${Math.abs(pct).toFixed(0)}%`;
  const value = `${sign}${magnitude} (${sign}${pctStr})`;

  const withinNeutral = pct != null && Math.abs(pct) < 5;
  let color = INK;
  if (!withinNeutral && pct != null) {
    if (side === "expense") color = diff > 0 ? RED : GREEN;
    else                     color = diff > 0 ? GREEN : RED;
  }
  return (
    <div style={S.statBlock}>
      <div style={{ ...S.statLabel, color: MICRO }}>vs. {MONTH_NAMES_SHORT[month - 2]}</div>
      <div style={{ ...S.statValue, color }}>{value}</div>
    </div>
  );
}

function StatBlock({ label, value, valueColor }) {
  return (
    <div style={S.statBlock}>
      <div style={{ ...S.statLabel, color: MICRO }}>{label}</div>
      <div style={{ ...S.statValue, color: valueColor || INK }}>{value}</div>
    </div>
  );
}

const QTR_MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function formatQtrDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${QTR_MONTH_ABBR[m - 1]} ${d}, ${y}`;
}

// Projected year drawer: fee schedule (unchanged, same as every other
// fund-year drill) plus a per-quarter summary below it, mirroring Carta's
// own Management fees page.
function ProjectedFeeSummary({ selection, scheduleTerms }) {
  const { projectedAmounts = [], committedCapital, yearLabel, fund } = selection;
  const isBucket = fund === "Other funds";  // several real funds summed — no single schedule to show
  const total = projectedAmounts.reduce((s, f) => s + f.amount, 0);
  const year = parseYear(yearLabel);
  const quarters = isBucket ? [] : quarterlyFeeSummary(scheduleTerms, committedCapital, year);

  return (
    <div style={{ ...sans, color: INK, display: "flex", flexDirection: "column", gap: SPACING.section }}>
      <div style={SP.banner} role="status">
        <span style={SP.bannerIcon} aria-hidden="true">
          <svg viewBox="0 0 14 14" fill="currentColor">
            <circle cx="7" cy="3.4" r="0.9" />
            <rect x="6.15" y="5.6" width="1.7" height="6.1" rx="0.4" />
          </svg>
        </span>
        <div>
          <div style={SP.bannerTitle}>Projected year</div>
          <div style={SP.bannerBody}>
            No journal entries yet for {yearLabel} — amounts below are estimated from the fee schedule.
          </div>
        </div>
      </div>

      {scheduleTerms.length > 0 && <FeeScheduleTerms terms={scheduleTerms} />}

      {!isBucket && quarters.length > 0 && (
        <div>
          <div style={SP.summaryHeaderRow}>
            <ChartTitle>Management fee summary — {yearLabel}</ChartTitle>
          </div>
          <div style={SP.qtrHeader}>
            <span style={SP.qtrPeriod}>Period</span>
            <span style={SP.qtrDate}>Start</span>
            <span style={SP.qtrDate}>End</span>
            <span style={SP.qtrRate}>Fee %</span>
            <span style={SP.qtrAmountHeader}>Fees + Savings - Reductions</span>
          </div>
          <ul style={SP.qtrList}>
            {quarters.map(q => (
              <li key={q.quarterLabel} style={SP.qtrRow}>
                <div style={SP.qtrMainRow}>
                  <span style={SP.qtrPeriod}>
                    {q.quarterLabel}
                    <div style={SP.qtrPeriodName}>{q.periodName}</div>
                  </span>
                  <span style={SP.qtrDate}>{formatQtrDate(q.startDate)}</span>
                  <span style={SP.qtrDate}>{formatQtrDate(q.endDate)}</span>
                  <span style={SP.qtrRate}>{(Math.round(q.feeRate * 100 * 10000) / 10000)}%</span>
                  <span style={SP.qtrAmount}>{fmtCurrencyExact(q.amount)}</span>
                </div>
                {q.basis && <div style={SP.qtrBasisRow}>Basis: {q.basis}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* "Other funds" bucket — no single fund's schedule applies, so show
          the per-fund breakdown that makes up the bar instead. */}
      {isBucket && projectedAmounts.length > 0 && (
        <div>
          <ChartTitle as="div" style={{ marginBottom: 8 }}>Projected management fees — {yearLabel}</ChartTitle>
          <ul style={SP.amountList}>
            {projectedAmounts.map(f => (
              <li key={f.name} style={SP.amountRow}>
                <span style={SP.amountSwatch}>
                  <svg width="10" height="10" aria-hidden="true">
                    <rect width="10" height="10" rx="2" fill={f.color} />
                  </svg>
                </span>
                <span style={SP.amountName}>{f.name}</span>
                <span style={SP.amountValue}>{fmtCurrencyWhole(f.amount)}</span>
              </li>
            ))}
            <li style={{ ...SP.amountRow, borderTop: `1px solid ${BORDER_DEFAULT}`, marginTop: 4, paddingTop: 8 }}>
              <span style={SP.amountName}><strong>Total</strong></span>
              <span style={{ ...SP.amountValue, fontWeight: 600 }}>{fmtCurrencyWhole(total)}</span>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

const SP = {
  banner: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: 16,
    background: BANNER_SURFACE_INFO,
  },
  bannerIcon: {
    flex: "none",
    width: 20,
    height: 20,
    marginTop: 4,
    borderRadius: 999,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: INFO_STRONG,
    color: PAPER,
  },
  // Sized against Ink's Alert, not its Banner. The two share a recipe —
  // tinted background, 16px padding, no border or radius — but Banner is
  // "rendered full-bleed at the top of a page or section", and this is an
  // inline status message inside a 519px drawer. Built against Banner's
  // exemplar (title 16/28, message 14/24) it was the biggest thing on a
  // panel whose own content runs at 13 and below.
  //
  // Alert states 14/20/400 for its text and carries no title row at all.
  // The title here earns its place — "Projected year" names a state the
  // body then explains — so it takes Alert's size at weight 500 and the
  // body sits a rung below it. An eyebrow (10–11px, tracked, per brand.md)
  // is the fully in-spec alternative if this should get quieter still.
  bannerTitle: {
    ...sans,
    fontSize: FS.value,
    lineHeight: "20px",
    fontWeight: 500,
    color: INK,
  },
  bannerBody: {
    ...sans,
    fontSize: FS.bodyLg,
    lineHeight: "20px",
    color: BANNER_TEXT,
    marginTop: 2,
  },
  amountList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
  },
  amountRow: {
    ...sans,
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 0",
    borderBottom: `1px solid ${LINE}`,
    fontSize: FS.bodyLg,
  },
  amountSwatch: {
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
  },
  amountName: {
    flex: 1,
    color: INK,
  },
  amountValue: {
    fontVariantNumeric: "tabular-nums",
    color: INK,
    whiteSpace: "nowrap",
  },
  summaryHeaderRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 8,
  },
  qtrHeader: {
    ...sans,
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "6px 4px",
    borderBottom: `1px solid ${BORDER_DEFAULT}`,
    fontSize: FS.small,
    fontWeight: 500,
    color: INK,
  },
  qtrList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    background: PAPER,
  },
  qtrRow: {
    padding: "8px 4px",
    borderBottom: `1px solid ${LINE}`,
  },
  qtrMainRow: {
    ...sans,
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: FS.bodyLg,
    color: INK,
  },
  qtrPeriod: {
    flex: 1,
    minWidth: 64,
  },
  qtrPeriodName: {
    ...sans,
    fontSize: FS.micro,
    color: MICRO,
    marginTop: 2,
  },
  qtrDate: {
    width: 76,
    flexShrink: 0,
    textAlign: "right",
    color: FAINT,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  qtrRate: {
    width: 50,
    flexShrink: 0,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
    fontWeight: 500,
  },
  qtrAmount: {
    width: 138,
    flexShrink: 0,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
    fontWeight: 600,
    whiteSpace: "nowrap",
  },
  qtrAmountHeader: {
    width: 138,
    flexShrink: 0,
    textAlign: "right",
    fontSize: FS.micro,
    lineHeight: 1.3,
    whiteSpace: "normal",
  },
  qtrBasisRow: {
    ...sans,
    fontSize: FS.micro,
    color: MICRO,
    marginTop: 4,
  },
};

const S = {
  statsRow: {
    display: "flex",
    gap: 24,
  },
  statBlock: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  // Sentence case — per Ink brand.md, all-caps is reserved for eyebrows;
  // summary metrics like these stay sentence case at the same size/weight.
  statLabel: {
    fontSize: FS.micro,
    fontWeight: 600,
  },
  // Snapped from an off-scale 18px to FS.h3 (16px, Ink's heading-3/4 step) —
  // the nearest Ink step, confirmed not a deliberate choice. Weight capped at
  // 600 (Ink's max — was 700, which no Ink text style ever uses).
  statValue: {
    fontSize: FS.h3,
    fontWeight: 600,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  // Ink Banner, info variant. Appears on a budget-line drill with a
  // workbook comment attached.
  commentCallout: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: 16,
    background: BANNER_SURFACE_INFO,
  },
  commentIcon: {
    flex: "none",
    width: 20,
    height: 20,
    marginTop: 4,
    borderRadius: 999,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: INFO_STRONG,
    color: PAPER,
  },
  // Same treatment as bannerTitle above, for the same reason — see that note.
  commentTitle: {
    ...sans,
    fontSize: FS.value,
    lineHeight: "20px",
    fontWeight: 500,
    color: INK,
  },
  // Matches bannerBody.
  commentBody: {
    ...sans,
    fontSize: FS.bodyLg,
    lineHeight: "20px",
    color: BANNER_TEXT,
    marginTop: 2,
    whiteSpace: "pre-wrap",
  },
  // --- Reporting tags multi-select ---
  // Trigger button + inline removable chips for applied tags.
  filterRow: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  // Tag's own base pill carries shape/color; this only adds removable layout.
  filterChip: {
    gap: 4,
    paddingRight: 4,
    fontWeight: 500,
  },
  navItemRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
  },
  // Vertical rhythm between stacked category sections in the right pane.
  categorySection: {
    marginBottom: 20,
  },
  checkLabel: {
    flex: 1,
  },
  // Same size as the label (.gf-check-row's 14px) — only the color signals
  // this is secondary, not a smaller size.
  checkAmount: {
    ...sans,
    fontSize: FS.value,
    color: FAINT,
  },
  jeHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 8,
  },
  paceHeader: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
  },
  // Sticky to the bottom of the drawer's own scroll area. The drawer body
  // carries no bottom padding, so this sits flush rather than floating.
  footer: {
    position: "sticky",
    bottom: 0,
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
    padding: "10px 20px",
    // Full-bleed across the body's own side padding, so it reads as a bar
    // rather than a card that happens to be last.
    margin: "0 -20px",
    background: PAPER,
    borderTop: `1px solid ${LINE}`,
  },
  footerCount: { ...sans, fontSize: FS.micro, color: MICRO },
  footerTotal: { ...sans, fontSize: FS.body, fontWeight: 600, fontVariantNumeric: "tabular-nums" },
  // Native title attribute for the hover text — matches this file's existing
  // convention (EntriesTable's inferred/reimbursed hints use the same pattern).
  jeHeaderHint: {
    ...sans,
    fontSize: FS.small,
    color: MICRO,
  },
};
