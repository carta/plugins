// Helpers for filtering the entries[] fixture by the current drill-down selection.
import { dimensionValue, noValueLabel } from "../../ui/dimension.js";


// A real fund name can carry regex metacharacters ("Fund II (Onshore), L.P.") —
// escape it so they compare literally. Bounded by a word-char lookaround
// rather than \b: a name ending in punctuation ("L.P.") has no trailing
// word character for \b to anchor to, so \b silently fails to match at all.
export function fundMatchRegex(fundMatch) {
  const escaped = fundMatch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "i");
}

const MONTH_LABELS = ["January", "February", "March", "April", "May",
                      "June", "July", "August", "September", "October",
                      "November", "December"];

export function monthLabel(mo) {
  return MONTH_LABELS[mo - 1] || String(mo);
}

// Return the selection's user-facing label (drawer header title).
export function selectionTitle(sel) {
  if (!sel) return "";
  if (sel.kind === "account") {
    const value = sel.childScope
      ? (sel.childScope.value ?? noValueLabel(sel.childScope)) : null;
    const head = value ? `${sel.name} · ${value}` : sel.name;
    return sel.periodLabel ? `${head} — ${sel.periodLabel}` : head;
  }
  if (sel.kind === "vendor")         return sel.vendor;
  if (sel.kind === "month-side")     return `${monthLabel(sel.month)} — ${sel.side === "income" ? "Income" : "Expenses"}`;
  if (sel.kind === "fund-year")      return `${sel.fund} — ${sel.yearLabel}`;
  if (sel.kind === "date-range-category") return sel.category;
  if (sel.kind === "department-account") {
    // From the variance chart the department half is always the Firm Total
    // sentinel, so appending it adds a word that never varies. The window
    // the figures were summed over does vary, and is the thing a reader
    // needs to know to trust them.
    if (sel.origin === "budget-category") {
      return sel.period?.label ? `${sel.account} · ${sel.period.label}` : sel.account;
    }
    return `${sel.account} — ${sel.tag_value}`;
  }
  if (sel.kind === "outline-cell")   return sel.quarter && sel.quarter !== "Total"
                                            ? `${sel.label} — ${sel.quarter}`
                                            : sel.label;
  return "";
}

// Format an ISO date range for drawer headers. Collapses to "Month YYYY"
// when the range is exactly one calendar month.
export function rangeLabel(startISO, endISO) {
  if (!startISO || !endISO) return "";
  const [sy, sm, sd] = startISO.split("-").map(Number);
  const [ey, em, ed] = endISO.split("-").map(Number);
  const monthNames = ["January","February","March","April","May","June",
                      "July","August","September","October","November","December"];
  const abbr = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const lastDay = new Date(sy, sm, 0).getDate();
  if (sy === ey && sm === em && sd === 1 && ed === lastDay) {
    return `${monthNames[sm - 1]} ${sy}`;
  }
  return `${abbr[sm - 1]} ${sd} – ${abbr[em - 1]} ${ed}, ${ey}`;
}

// Extract the 4-digit year from a fee-chart year label like "2021" or "2026 YTD".
export function parseYear(yearLabel) {
  const m = /(\d{4})/.exec(String(yearLabel || ""));
  return m ? Number(m[1]) : null;
}

// Filter fund-side mgmt fee entries (accounts.json.fund_fee_entries) to just
// the rows this selection covers. `display_fund` is the fee chart's top-N
// bucketed name (see "fund-year" below); `fund` is always the real name.
/** One member of a total, as the cell selection it stands for. */
export function memberSelection(sel, member) {
  return { ...sel, ...member, kind: "outline-cell", members: undefined };
}

export function filterFundFeeEntries(fundFeeEntries, sel) {
  if (!fundFeeEntries) return [];

  // A total covering per-fund lines: every fund it sums, from the fund-side
  // dataset those lines resolve against.
  if (sel?.kind === "outline-total") {
    const seen = new Set();
    const out = [];
    for (const m of sel.members || []) {
      if (!m.fundMatch) continue;
      for (const e of filterFundFeeEntries(fundFeeEntries, memberSelection(sel, m))) {
        const k = e.id ?? `${e.fund}:${e.mo}:${e.amount}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(e);
      }
    }
    return out;
  }

  // Budget-vs-Actuals outline: a per-fund management-fee budget line,
  // resolved to the fund's real name by backfill_fund_match_from_roster.
  // Word-boundary match so e.g. "Fund II" doesn't also catch "Fund III".
  if (sel?.kind === "outline-cell" && sel.fundMatch) {
    const rx = fundMatchRegex(sel.fundMatch);
    const months = QUARTER_MONTHS[sel.quarter] || null;
    const yr = sel.periodYear ? Number(sel.periodYear) : null;
    // A fee and its offset are different accounts. Naming one reports one;
    // naming none is the fund's net — the same rule the row's figure uses.
    const only = new Set(sel.glCodes || []);
    const mine = fundFeeEntries.filter((e) => {
      if (yr && Number(e.yr) !== yr) return false;
      if (months && !months.has(e.mo)) return false;
      if (only.size && !only.has(e.acct_type)) return false;
      return rx.test(e.fund || "");
    });
    // An offset-only line reports its magnitude on the row, and a drawer
    // totalling the other way would contradict the figure it opened from.
    return mine.length && mine.every(e => Number(e.amount ?? 0) < 0)
      ? mine.map(e => ({ ...e, amount: -Number(e.amount ?? 0) }))
      : mine;
  }

  if (sel?.kind !== "fund-year") return [];
  const yr = parseYear(sel.yearLabel);
  if (!yr) return [];
  return fundFeeEntries.filter(
    (e) => e.yr === yr && e.display_fund === sel.fund
  );
}

// Filter management-fee schedule terms (accounts.json.fee_schedule_terms) to
// the fund a "fund-year" drill opened. Terms carry only real fund names, so
// a drill on the FeeIncome chart's bucketed "Other funds" segment (several
// real funds summed into one bar) has no single fund's terms to show and
// intentionally returns [] rather than guess which fund's schedule to display.
export function filterFeeScheduleTerms(feeScheduleTerms, sel) {
  if (!feeScheduleTerms || sel?.kind !== "fund-year" || sel.fund === "Other funds") return [];
  return feeScheduleTerms
    .filter((t) => t.fund === sel.fund)
    .sort((a, b) => a.period_order - b.period_order);
}

const QUARTER_BOUNDS = [["01-01", "03-31"], ["04-01", "06-30"], ["07-01", "09-30"], ["10-01", "12-31"]];

// Per-quarter fee rows for a projected year, matching Carta's own
// Management fees page math (fee = capital * annual rate / 4).
export function quarterlyFeeSummary(scheduleTerms, committedCapital, year) {
  if (!scheduleTerms?.length || !committedCapital || !year) return [];
  const rows = [];
  for (let q = 0; q < 4; q++) {
    const [startMD, endMD] = QUARTER_BOUNDS[q];
    const qStart = `${year}-${startMD}`;
    const qEnd = `${year}-${endMD}`;
    const period = scheduleTerms.find(t =>
      t.start_date <= qStart && (!t.end_date || t.end_date >= qStart));
    if (!period || period.fee_rate == null) continue;
    rows.push({
      quarterLabel: `Q${q + 1} ${year}`,
      periodName: period.period_name,
      startDate: qStart,
      endDate: qEnd,
      feeRate: period.fee_rate,
      basis: period.calculation_base,
      amount: Math.round(committedCapital * period.fee_rate / 4 * 100) / 100,
    });
  }
  return rows;
}

// Month buckets per quarter, for outline-cell drills. "Total" maps to no
// constraint (handled by callers as a null lookup).
export const QUARTER_MONTHS = {
  Q1: new Set([1, 2, 3]),
  Q2: new Set([4, 5, 6]),
  Q3: new Set([7, 8, 9]),
  Q4: new Set([10, 11, 12]),
};

// Filter the entries[] fixture down to just the rows this selection covers.
//
// `topCategoryNames` is the ordered list of the top-N GL accounts that appear
// as their own bars in the Monthly Expenses by Category chart. When the user
// clicks the "Other" segment, we filter to expense entries whose account is
// NOT in that list — otherwise we'd double-count Rent, Salary, etc. which
// already have their own dedicated bars.
export function filterEntries(entries, sel, topCategoryNames = []) {
  if (!sel || !entries) return [];
  if (sel.kind === "account") {
    // The cell that opened this can be narrower than the account: one
    // column of a period axis, one value of a breakout beneath the row, or
    // both. Each was carried on the selection and then dropped here, so
    // every cell of a row opened the same list — clicking one vendor's
    // figure and clicking the next gave identical panels, each totalling
    // the whole account.
    let out = entries.filter(e => e.account === sel.name);
    if (sel.months && sel.months.length) {
      const months = new Set(sel.months);
      out = out.filter(e => typeof e.mo !== "number" || months.has(e.mo));
    }
    if (sel.childScope) {
      out = out.filter(e =>
        dimensionValue(e, sel.childScope) === sel.childScope.value);
    }
    return out;
  }
  // Expense side only: the chart is expense-only, and a fund-fee row's
  // vendor is the ManCo itself.
  if (sel.kind === "vendor") {
    return entries.filter(
      e => e.kind === "expense" && (e.vendor || "").trim() === sel.vendor
    );
  }
  if (sel.kind === "month-side") {
    return entries.filter(e => e.mo === sel.month && e.kind === sel.side);
  }
  if (sel.kind === "date-range-category") {
    const inRange = (d) => d >= sel.start && d <= sel.end;
    if (sel.category === "Other") {
      const topSet = new Set(topCategoryNames);
      return entries.filter(e =>
        e.kind === "expense" && inRange(e.date) && !topSet.has(e.account)
      );
    }
    return entries.filter(e =>
      e.kind === "expense" && inRange(e.date) && e.account === sel.category
    );
  }
  if (sel.kind === "outline-total") {
    // A subtotal has no accounts of its own — it means the lines beneath
    // it. Each is filtered exactly as it would be on its own click, and
    // the results are unioned, so the drawer holds precisely the entries
    // the figure was summed from. De-duplicated: two lines can legitimately
    // cover the same account, and an entry counted twice would make the
    // drawer disagree with the row that opened it.
    // Identified by the entry itself, not by its id: every member filters
    // the same array, so one entry is one object — and a firm's ledger can
    // carry the same journal-line id on two different lines, which a key
    // built from the id would silently collapse into one.
    const seen = new Set();
    const out = [];
    for (const m of sel.members || []) {
      if (m.fundMatch) continue;   // fund-side; see filterFundFeeEntries
      for (const e of filterEntries(entries, memberSelection(sel, m), topCategoryNames)) {
        if (seen.has(e)) continue;
        seen.add(e);
        out.push(e);
      }
    }
    return out;
  }
  if (sel.kind === "outline-cell") {
    // Budget-vs-Actuals outline cell. Fund-matched rows resolve from the
    // fund-side dataset instead (see filterFundFeeEntries), so this path
    // only handles GL-backed rows.
    if (sel.fundMatch) return [];
    const typeSet = new Set(sel.glCodes || []);
    if (typeSet.size === 0) return [];
    const months = QUARTER_MONTHS[sel.quarter] || null;   // null = Total, all months
    const tagSet = sel.cartaTags ? new Set(sel.cartaTags) : null;
    // A line scoped to a sub-account (or a vendor) reports that slice of
    // its accounts. Showing the account's whole spend behind it invites
    // the reader to reconcile against a figure that was never the row's.
    const scopes = (sel.scopes || []).filter(sc => sc.source !== "reporting_tag");
    const claims = sel.excludedClaims || [];
    return entries.filter(e => {
      if (!typeSet.has(e.acct_type)) return false;
      if (months && !months.has(e.mo)) return false;
      if (scopes.length
          && !scopes.every(sc => dimensionValue(e, sc) === sc.value)) return false;
      if (tagSet) {
        const v = dimensionValue(e, sel.dimension);
        if (v == null || !tagSet.has(v)) return false;
      } else if (claims.length
                 && claims.some(c => dimensionValue(e, c) === c.value)) {
        // Spend another line reports is not this line's, and the row's own
        // figure already left it out. Same rule the row is computed with.
        return false;
      }
      // One breakout row beneath the line: everything the line is filtered
      // by, and this value on top. Kept apart from `scopes` because a
      // line's tag scope carries the firm's aliases for its value, while
      // this carries the one label the row beneath it is showing.
      if (sel.childScope
          && dimensionValue(e, sel.childScope) !== sel.childScope.value) return false;
      return true;
    });
  }
  if (sel.kind === "department-account") {
    // Match by GL code (accountTypeAll handles multi-GL workbook rows like
    // "4170, 4175"). Then constrain by Department reporting-tag using
    // sel.cartaTags — coa-mapping-derived aliases (workbook "Founder
    // Services" → ["GAP"]); falls back to [sel.tag_value] for identity. An
    // empty cartaTags list is the Firm Total sentinel (no tag filter).
    // Constrain to the months the budget covers, so the list adds up to
    // the cell that opened it. Absent a stated period, every month shows.
    const first = sel.period?.first_month ?? 1;
    const last = sel.period?.last_month ?? 12;
    const inPeriod = e => typeof e.mo !== "number" || (e.mo >= first && e.mo <= last);
    const typeSet = new Set(sel.accountTypeAll || []);
    // What else narrows the line — a sub-account, a vendor. Without them a
    // whole account's entries sat behind a bar showing one office's rent.
    const scopes = sel.scopes || [];
    const byType = typeSet.size > 0
      ? entries.filter(e => typeSet.has(e.acct_type) && inPeriod(e)
                       && scopes.every(sc => dimensionValue(e, sc) === sc.value))
      : [];
    const tagSet = new Set(sel.cartaTags || (sel.tag_value === "Firm Total" ? [] : [sel.tag_value]));
    if (tagSet.size === 0) {
      // No tag narrows it, but a line beside it may still own part of the
      // money — and the figure that was clicked already left that out.
      const claims = sel.excludedClaims || [];
      if (!claims.length) return byType;
      return byType.filter(e =>
        !claims.some(c => dimensionValue(e, c) === c.value));
    }
    return byType.filter(e =>
      tagSet.has(dimensionValue(e, sel.dimension))
    );
  }
  return [];
}

// Normalize an entry's `tags` field into a list of {category, value} pairs.
// Handles two shapes:
//   NEW (structured): tags = [{category: "cost_center", value: "R&D"}, ...]
//   OLD (flat string, still in older caches): tags = "Creator, Marketing"
// Returns [] when there are no tags. Category is "" for flat-string sources.
export function normalizeTags(entry) {
  const raw = entry?.tags;
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .filter(t => t && t.value)
      .map(t => ({ category: t.category || "", value: t.value }));
  }
  if (typeof raw === "string") {
    return raw.split(",").map(v => v.trim()).filter(Boolean)
      .map(value => ({ category: "", value }));
  }
  return [];
}

// Stable string key for a (category, value) pair — used as Set membership
// key for the multi-select filter state and as React list keys.
export function tagKey(cat, val) {
  return `${cat || ""}::${val}`;
}

// Roll up a slice of entries into vendor/tag/partner aggregates + monthly series.
// Tag rollup is keyed by (category, value) tuples; the returned top_tags list
// is grouped by category downstream in the UI.
export function aggregate(entries) {
  const monthly = [0, 0, 0, 0, 0, 0, 0];
  const vendors = new Map();
  const tags    = new Map();  // key = tagKey(cat, val)
  const partners = new Map();
  const subs    = new Map();  // SUB_ACCOUNT_NAME — office/location/sub-ledger, firm-defined
  const accountMap = new Map();
  let total = 0;
  for (const e of entries) {
    total += e.amount;
    monthly[e.mo - 1] += e.amount;
    if (e.account) {
      const a = accountMap.get(e.account) || { name: e.account, amount: 0, count: 0, acct_type: e.acct_type };
      a.amount += e.amount; a.count += 1;
      accountMap.set(e.account, a);
    }
    if (e.vendor) {
      const v = vendors.get(e.vendor) || { name: e.vendor, amount: 0, count: 0 };
      v.amount += e.amount; v.count += 1;
      vendors.set(e.vendor, v);
    }
    for (const { category, value } of normalizeTags(e)) {
      const k = tagKey(category, value);
      const x = tags.get(k) || { key: k, category, value, amount: 0, count: 0 };
      x.amount += e.amount; x.count += 1;
      tags.set(k, x);
    }
    if (e.partner) {
      const p = partners.get(e.partner) || { name: e.partner, amount: 0, count: 0 };
      p.amount += e.amount; p.count += 1;
      partners.set(e.partner, p);
    }
    if (e.sub) {
      const s = subs.get(e.sub) || { name: e.sub, amount: 0, count: 0 };
      s.amount += e.amount; s.count += 1;
      subs.set(e.sub, s);
    }
  }
  const byAmount = (a, b) => b.amount - a.amount;
  return {
    total,
    count: entries.length,
    monthly,
    by_account: [...accountMap.values()].sort(byAmount),
    top_vendors: [...vendors.values()].sort(byAmount).slice(0, 8),
    all_tags:    [...tags.values()].sort(byAmount),  // full list, grouped by UI
    top_partners:[...partners.values()].sort(byAmount).slice(0, 8),
    top_subs:    [...subs.values()].sort(byAmount).slice(0, 8),
  };
}

// Filter an already-selection-filtered entry list further down by
// `selectedTagKeys` — OR within a category (any checked value there is a
// match), AND across categories (every category with a selection needs one).
// When `selectedTagKeys` is empty, returns `entries` unchanged.
export function filterEntriesByTags(entries, selectedTagKeys) {
  if (!selectedTagKeys || selectedTagKeys.size === 0) return entries;
  const byCategory = new Map();
  for (const k of selectedTagKeys) {
    const cat = k.slice(0, k.indexOf("::"));
    if (!byCategory.has(cat)) byCategory.set(cat, new Set());
    byCategory.get(cat).add(k);
  }
  return entries.filter(e => {
    const entryKeys = new Set(normalizeTags(e).map(t => tagKey(t.category, t.value)));
    for (const keys of byCategory.values()) {
      if (![...keys].some(k => entryKeys.has(k))) return false;
    }
    return true;
  });
}


/** The values worth offering as a filter — tags or accounts alike.
 *
 *  A value every entry in the drill already carries cannot narrow it, so
 *  offering it puts an unticked box over a list already filtered by it and
 *  ticking it changes nothing. Two ways a drill gets there: the row's own
 *  scope, which the panel states in its header instead, and an upstream
 *  filter that leaves one account or one value standing.
 */
export function offerableValues(values, entryCount) {
  return (values || []).filter(v => (v.count || 0) < entryCount);
}


/** Narrow an entry list to a chosen set of GL accounts.
 *
 *  Choosing none is no filter, the same as choosing no tags: the drawer
 *  opens on every entry behind the row and stays there until the reader
 *  picks. Unticking the last account returns them to all of it, rather
 *  than to an empty drawer for undoing what they just did.
 */
export function filterEntriesByAccounts(entries, selected) {
  if (!selected || !selected.size) return entries || [];
  return (entries || []).filter(e => selected.has(e.acct_type));
}
