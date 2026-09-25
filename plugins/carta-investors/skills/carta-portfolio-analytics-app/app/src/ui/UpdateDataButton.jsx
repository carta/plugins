import { useState, useRef, useMemo, useEffect } from "react";
import { RefreshIcon, CheckCircleIcon, AlertCircleIcon, CalendarIcon, useDismissable } from "./components.jsx";
import { FS, sans, NOTICE, NOTICE_TINT } from "./theme.js";
import { fmtRelative } from "./format.js";
import { trackClick } from "../analytics.js";
import useRefresh from "../state/useRefresh.js";
import useNow from "../state/useNow.js";

const iconBtn = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", width: 40, height: 40,
  border: "1px solid var(--ink-color-global-border-subtle)", borderRadius: 4,
  background: "var(--ink-color-global-surface-background-default)", cursor: "pointer", lineHeight: 0,
};
// Sidebar-action chrome mirrors App.jsx: a full-width labeled chip whose popover opens upward.
const sidebarActionStyle = {
  ...sans, display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
  fontSize: 13, fontWeight: 400, height: 40, padding: "0 12px", border: "1px solid var(--ink-color-global-border-subtle)",
  borderRadius: 4, cursor: "pointer", background: "var(--ink-color-global-surface-background-default)",
  color: "var(--ink-color-global-text-default)",
};
const popoverWrapStyle = (inSidebar) => ({ position: "relative", lineHeight: inSidebar ? "normal" : 0, display: inSidebar ? "block" : "inline-block" });
const popoverAnchor = (inSidebar) => (inSidebar
  ? { left: 0, bottom: "calc(100% + 8px)" }
  : { right: 0, top: "calc(100% + 8px)" });
const primaryBtn = {
  ...sans, fontSize: FS.small, fontWeight: 650, cursor: "pointer",
  background: "var(--accent-soft)", color: "var(--ink-color-global-text-default)",
  border: "none", borderRadius: 4, padding: "7px 12px",
};

// The icon reflects the refresh state: idle=refresh, running/applying=spin, fetched=check, error=alert.
const REFRESH_VISUAL = {
  idle: { Icon: RefreshIcon, spin: false, color: "var(--ink-color-global-text-subtle)", title: "Update Carta data" },
  running: { Icon: RefreshIcon, spin: true, color: "var(--ink-color-global-text-default)", title: "Fetching Carta data…" },
  fetched: { Icon: CheckCircleIcon, spin: false, color: "var(--ink-color-global-feedback-positive-strong)", title: "New Carta data ready — load it" },
  applying: { Icon: RefreshIcon, spin: true, color: "var(--ink-color-global-text-default)", title: "Loading new data…" },
  error: { Icon: AlertCircleIcon, spin: false, color: "var(--ink-color-global-feedback-negative-strong)", title: "Update didn’t finish" },
};

const subtle = { ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", lineHeight: 1.5 };
const micro = { ...sans, fontSize: FS.micro, color: "var(--ink-color-global-text-subtle)", lineHeight: 1.5 };

// Ink feedback semantics: strong fg + subtle tint bg. Warning uses the app's one
// canonical warning pair (NOTICE, brand-yellow-80 — same as Badge/Coverage), not
// feedback-warning-strong, whose light-mode #F8D648 is unreadable on a tint.
const TONE = {
  positive: { fg: "var(--ink-color-global-feedback-positive-strong)", bg: "var(--ink-color-global-feedback-positive-subtle)" },
  warning: { fg: NOTICE, bg: NOTICE_TINT },
  negative: { fg: "var(--ink-color-global-feedback-negative-strong)", bg: "var(--ink-color-global-feedback-negative-subtle)" },
};

// Tinted, colored header shared by the fetched (green) / applying (yellow) / error (red) states.
function StatusHeader({ tone, Icon, spin, children }) {
  const t = TONE[tone];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, background: t.bg, borderRadius: 6, padding: "8px 10px" }}>
      <span style={{ color: t.fg, display: "inline-flex", lineHeight: 0, flex: "none",
        animation: spin ? "pa-spin 1s linear infinite" : "none" }}>
        <Icon size={15} strokeWidth={2} />
      </span>
      <span style={{ ...sans, fontSize: FS.small, fontWeight: 650, color: t.fg }}>{children}</span>
    </div>
  );
}

// The two time-series dataset keys the filters affect (see scripts/datasets.py); the
// panel shows them as ONE row — they're the only narrowable pull and run together.
const TS_KEYS = ["kpis", "forecasts"];
const TS_ROW_ID = "ts";
const TS_LABEL = "Operating KPIs & Forecasts";

/** Panel rows from source.datasets: kpis+forecasts merge into one narrowable row
 *  (freshness = the older of the two), snapshot datasets keep their own rows. */
function buildRows(datasets) {
  const byKey = {};
  for (const d of datasets) byKey[d.key] = d;
  const rows = [];
  const ts = TS_KEYS.map((k) => byKey[k]).filter(Boolean);
  if (ts.length) {
    rows.push({
      id: TS_ROW_ID, keys: ts.map((d) => d.key), label: TS_LABEL, narrowable: true,
      stems: ts.flatMap((d) => d.stems || []),
      present: ts.some((d) => d.present),
      fetchedAt: ts.map((d) => d.fetchedAt).filter(Boolean).sort()[0] || null,
    });
  }
  for (const d of datasets) {
    if (TS_KEYS.includes(d.key)) continue;
    rows.push({ id: d.key, keys: [d.key], label: d.label, narrowable: false,
      stems: d.stems || [], present: d.present, fetchedAt: d.fetchedAt });
  }
  return rows;
}

// This row's stage in a running refresh: "active" / "done" / "pending" / null (not in the run).
function rowStage(row, st) {
  if (st.status !== "running") return null;
  const inScope = st.target == null || row.keys.some((k) => (st.target || []).includes(k));
  if (!inScope) return null;
  const stems = row.stems || [];
  const done = st.doneStems || [];
  const active = st.activeStems || [];
  if (stems.length && stems.every((s) => done.includes(s))) return "done";
  if (stems.some((s) => active.includes(s))) return "active";
  return "pending";
}

const fmtDateLong = (iso) =>
  new Date(iso + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const fmtMonthYear = (iso) =>
  new Date(iso + "T00:00:00").toLocaleDateString(undefined, { month: "short", year: "numeric" });

/** "All companies" / "2 companies · since Jan 2025" — the TS row's scope suffix.
 *  `sel` is null when every eligible company is selected (= no filter sent). */
function scopeSuffix(sel, since) {
  const parts = [];
  parts.push(sel === null ? "All companies" : `${sel.size} ${sel.size === 1 ? "company" : "companies"}`);
  if (since) parts.push(`since ${fmtMonthYear(since)}`);
  return parts.join(" · ");
}

const filterInput = {
  ...sans, fontSize: FS.small, width: "100%", padding: "6px 8px", boxSizing: "border-box",
  border: "1px solid var(--ink-color-global-border-subtle)", borderRadius: 4,
  background: "var(--ink-color-global-surface-background-default)", color: "var(--ink-color-global-text-default)",
};
const filterLabel = { ...sans, fontSize: FS.micro, fontWeight: 650, color: "var(--ink-color-global-text-subtle)",
  display: "block", margin: "0 0 4px" };
const linkBtn = { ...sans, fontSize: FS.micro, color: "var(--ink-color-global-link-default)",
  background: "none", border: "none", padding: 0, cursor: "pointer" };
const backBtn = { ...linkBtn, fontSize: FS.small, fontWeight: 650 };
const narrowBtn = (set) => ({
  ...sans, flex: "none", fontSize: FS.micro, fontWeight: 650, whiteSpace: "nowrap",
  color: "var(--ink-color-global-link-default)", background: "none", cursor: "pointer",
  border: `1px solid var(${set ? "--ink-color-global-link-default" : "--ink-color-global-border-subtle"})`,
  borderRadius: 4, padding: "4px 8px",
});

/** One dataset row on the form: checkbox, name + freshness/scope sub-line, and (TS
 *  row only) the Narrow button that opens the filter page. */
function DatasetRow({ row, checked, onToggle, disabled, stage, progress, scope, canRefresh, showNarrow, onNarrow, narrowSet }) {
  const sub = stage === "active" ? (progress || "Updating…")
    : stage === "done" ? "Updated just now"
    : stage === "pending" ? "Waiting…"
    : row.present ? `Updated ${fmtRelative(row.fetchedAt)}` : "Not loaded";
  const dim = canRefresh && !checked;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0",
      borderTop: "1px solid var(--ink-color-global-border-subtle)" }}>
      {canRefresh && (
        <input type="checkbox" id={`ds-check-${row.id}`} data-testid={`ds-check-${row.id}`}
          checked={checked} disabled={disabled} onChange={onToggle}
          style={{ margin: 0, flex: "none", accentColor: "var(--ink-color-global-text-default)" }} />
      )}
      <label htmlFor={`ds-check-${row.id}`} style={{ minWidth: 0, flex: 1, cursor: canRefresh && !disabled ? "pointer" : "default" }}>
        <div style={{ ...sans, fontSize: FS.small, fontWeight: dim ? 500 : 600,
          color: dim ? "var(--ink-color-global-text-subtle)" : "var(--ink-color-global-text-default)" }}>{row.label}</div>
        <div style={{ ...micro, ...(stage === "active" ? { color: "var(--ink-color-global-text-default)" } : {}) }}>
          {stage === "active" && (
            <span style={{ display: "inline-flex", lineHeight: 0, marginRight: 5, verticalAlign: -2,
              animation: "pa-spin 1s linear infinite" }}><RefreshIcon size={10} strokeWidth={2} /></span>
          )}
          {sub}{scope ? ` · ${scope}` : ""}
        </div>
      </label>
      {canRefresh && showNarrow && (
        <button type="button" onClick={onNarrow} disabled={disabled || !checked}
          data-testid="refresh-narrow" style={{ ...narrowBtn(narrowSet), opacity: disabled || !checked ? 0.4 : 1 }}>
          {narrowSet ? "Narrowed ›" : "Narrow ›"}
        </button>
      )}
    </div>
  );
}

/** The Narrow page: an "All history"/date field and the all-selected-by-default
 *  company picker. Confirm saves the draft back to the form; ‹ Datasets discards. */
function NarrowPage({ companies, draft, setDraft, onConfirm, onBack }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    const list = q ? companies.filter((c) => (c.name || "").toLowerCase().includes(q)) : companies;
    return list.slice(0, 200);  // cap the rendered rows; searching narrows past it
  }, [companies, q]);
  const total = companies.length;
  const selCount = draft.sel.size;
  const allSelected = selCount === total;
  const toggle = (id) => setDraft((d) => {
    const sel = new Set(d.sel);
    if (sel.has(id)) sel.delete(id); else sel.add(id);
    return { ...d, sel };
  });
  // Bulk actions act on the searched rows while a search is active, all rows otherwise;
  // the header count always reflects the full selection.
  const bulk = (select) => setDraft((d) => {
    const sel = new Set(d.sel);
    const scope = q ? shown : companies;
    for (const c of scope) { if (select) sel.add(c.id); else sel.delete(c.id); }
    return { ...d, sel };
  });
  const summaryParts = [];
  if (!allSelected) summaryParts.push(`for ${selCount} ${selCount === 1 ? "company" : "companies"}`);
  if (draft.since) summaryParts.push(`since ${fmtDateLong(draft.since)}`);
  return (
    <div data-testid="narrow-page">
      <button type="button" onClick={onBack} data-testid="narrow-back" style={backBtn}>‹ Datasets</button>
      <div style={{ margin: "8px 0 10px" }}>
        <label style={filterLabel} htmlFor="refresh-since">Only pull data since</label>
        {/* One field: the display reads "All history" or the chosen date, and the real
            date input lies invisibly over it, so any click opens the calendar directly. */}
        <div style={{ position: "relative" }} data-testid="refresh-date-field">
          <div style={{ ...filterInput, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <span style={draft.since ? undefined : { color: "var(--ink-color-global-text-subtle)" }}>
              {draft.since ? fmtDateLong(draft.since) : "All history"}
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flex: "none" }}>
              {draft.since && (
                <button type="button" style={{ ...linkBtn, fontSize: FS.small, position: "relative", zIndex: 1 }}
                  data-testid="refresh-date-clear"
                  onClick={() => setDraft((d) => ({ ...d, since: "" }))}>Clear</button>
              )}
              <CalendarIcon size={13} style={{ color: "var(--ink-color-global-text-subtle)" }} />
            </span>
          </div>
          <input id="refresh-since" data-testid="refresh-since" type="date" value={draft.since}
            aria-label="Only pull data since"
            onChange={(e) => setDraft((d) => ({ ...d, since: e.target.value }))}
            onClick={(e) => { if (typeof e.currentTarget.showPicker === "function") { try { e.currentTarget.showPicker(); } catch { /* needs a user gesture; the click itself opens it */ } } }}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0,
              border: 0, padding: 0, cursor: "pointer" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", margin: "10px 0 4px" }}>
          <span style={{ ...filterLabel, margin: 0 }}>Companies</span>
          <span style={micro} data-testid="refresh-company-count">
            {allSelected ? `All ${total} selected` : selCount === 0 ? "None selected" : `${selCount} of ${total} selected`}
            {" · "}
            {allSelected ? (
              <button type="button" style={linkBtn} data-testid="refresh-companies-clear" onClick={() => bulk(false)}>Clear</button>
            ) : (
              <button type="button" style={linkBtn} data-testid="refresh-companies-selectall" onClick={() => bulk(true)}>Select all</button>
            )}
          </span>
        </div>
        <input data-testid="refresh-company-search" type="text" placeholder="Search companies…"
          style={filterInput} value={query} onChange={(e) => setQuery(e.target.value)} />
        <div style={{ maxHeight: 150, overflowY: "auto", marginTop: 6, border: "1px solid var(--ink-color-global-border-subtle)",
          borderRadius: 4 }}>
          {shown.length === 0 ? (
            <div style={{ ...micro, padding: "8px 9px" }}>No companies match.</div>
          ) : shown.map((c) => (
            <label key={c.id} style={{ ...sans, fontSize: FS.small, display: "flex", gap: 8, alignItems: "center",
              padding: "5px 9px", cursor: "pointer", color: "var(--ink-color-global-text-default)" }}>
              <input type="checkbox" checked={draft.sel.has(c.id)} onChange={() => toggle(c.id)} />
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
            </label>
          ))}
        </div>
      </div>
      {summaryParts.length > 0 && selCount > 0 && (
        <div style={{ ...micro, marginBottom: 2 }} data-testid="narrow-summary">
          Will refresh <strong style={{ color: "var(--ink-color-global-text-default)" }}>{TS_LABEL}</strong> {summaryParts.join(" ")}.
        </div>
      )}
      <button type="button" onClick={onConfirm} disabled={selCount === 0} data-testid="narrow-confirm"
        style={{ ...primaryBtn, display: "block", width: "100%", textAlign: "center", marginTop: 10,
          opacity: selCount === 0 ? 0.5 : 1, cursor: selCount === 0 ? "default" : "pointer" }}>
        Confirm
      </button>
    </div>
  );
}

// "No KPI rows" / "No forecast rows" / "No KPI or forecast rows" (+ " since <date>").
function noRowsText(keys, since) {
  const kp = keys.includes("kpis"), fc = keys.includes("forecasts");
  const what = kp && fc ? "No KPI or forecast rows" : kp ? "No KPI rows" : "No forecast rows";
  return since ? `${what} since ${fmtDateLong(since)}` : what;
}

const SKIPPED_TEXT = "Not matched to a Carta identity — skipped";

/** st.companyWarnings + the companies list -> [{id, name, text, skipped}], alphabetical. */
function companyWarningLines(st, companies) {
  const names = {};
  for (const c of companies) names[c.id] = c.name;
  return (st.companyWarnings || [])
    .map((w) => ({ id: w.id, name: names[w.id] || w.id, skipped: !!w.skipped,
      text: w.skipped ? SKIPPED_TEXT : noRowsText(w.noRows || [], st.filterSince) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const warnCoRow = { display: "flex", gap: 8, alignItems: "baseline", padding: "3px 0 0 12px" };
const warnCoName = { ...sans, fontSize: FS.micro, color: "var(--ink-color-global-text-default)", fontWeight: 600, flex: "none", minWidth: 108 };
const warnCoWhy = { ...sans, fontSize: FS.micro, color: "var(--ink-color-global-text-subtle)" };

/** Fetched summary: grouped warnings (per-company for the TS group, one line per
 *  snapshot string warning) + Load new data. */
function FetchedSummary({ st, companies, onLoad, onViewAll }) {
  const lines = companyWarningLines(st, companies);
  const strings = st.warnings || [];
  const hasWarnings = lines.length > 0 || strings.length > 0;
  return (
    <div data-testid="update-ready">
      <div style={subtle}>New Carta data is ready — load it to apply the latest figures across every view.</div>
      {hasWarnings && (
        <div style={{ ...subtle, marginTop: 8, color: TONE.warning.fg, fontWeight: 600 }}>Some data didn’t refresh:</div>
      )}
      {lines.length > 0 && (
        <div style={{ marginTop: 6 }} data-testid="warn-group-ts">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ ...sans, fontSize: FS.small, fontWeight: 600, color: "var(--ink-color-global-text-default)" }}>{TS_LABEL}</span>
            {st.selectedCount != null && <span style={micro}>{lines.length} of {st.selectedCount} selected</span>}
          </div>
          {lines.slice(0, 3).map((l) => (
            <div key={l.id} style={warnCoRow}>
              <span style={warnCoName}>{l.name}</span><span style={warnCoWhy}>{l.text}</span>
            </div>
          ))}
          {lines.length > 3 && (
            <button type="button" onClick={onViewAll} data-testid="warn-view-all"
              style={{ ...linkBtn, display: "block", padding: "4px 0 0 12px", fontWeight: 650 }}>
              View all {lines.length} ›
            </button>
          )}
        </div>
      )}
      {strings.map((w, i) => (
        <div key={i} style={{ marginTop: 8 }}>
          <div style={warnCoWhy}>{w}</div>
        </div>
      ))}
      <button onClick={onLoad} data-testid="update-load"
        style={{ ...primaryBtn, display: "block", width: "100%", textAlign: "center", marginTop: 12 }}>Load new data</button>
    </div>
  );
}

/** The View-all warnings page: every affected company, with reason-filter pills. */
function WarningsPage({ st, companies, onBack }) {
  const [reason, setReason] = useState("all");
  const lines = companyWarningLines(st, companies);
  const skipped = lines.filter((l) => l.skipped);
  const noRows = lines.filter((l) => !l.skipped);
  const shown = reason === "skipped" ? skipped : reason === "norows" ? noRows : lines;
  const pill = (on) => ({ ...sans, fontSize: FS.micro, padding: "2px 8px", borderRadius: 999, cursor: "pointer",
    background: "var(--ink-color-global-surface-background-default)",
    border: `1px solid var(${on ? "--ink-color-global-text-default" : "--ink-color-global-border-subtle"})`,
    color: on ? "var(--ink-color-global-text-default)" : "var(--ink-color-global-text-subtle)",
    fontWeight: on ? 600 : 400 });
  return (
    <div data-testid="warn-all-page">
      <button type="button" onClick={onBack} data-testid="warn-all-back" style={backBtn}>‹ Back</button>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 8 }}>
        <span style={{ ...sans, fontSize: FS.small, fontWeight: 600, color: "var(--ink-color-global-text-default)" }}>{TS_LABEL}</span>
        {st.selectedCount != null && <span style={micro}>{lines.length} of {st.selectedCount} selected</span>}
      </div>
      {skipped.length > 0 && noRows.length > 0 && (
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <button type="button" style={pill(reason === "all")} onClick={() => setReason("all")}>All {lines.length}</button>
          <button type="button" style={pill(reason === "norows")} onClick={() => setReason("norows")}>No rows · {noRows.length}</button>
          <button type="button" style={pill(reason === "skipped")} onClick={() => setReason("skipped")}>Skipped · {skipped.length}</button>
        </div>
      )}
      <div style={{ maxHeight: 190, overflowY: "auto", marginTop: 8, border: "1px solid var(--ink-color-global-border-subtle)", borderRadius: 4 }}>
        {shown.map((l) => (
          <div key={l.id} style={{ ...warnCoRow, padding: "6px 9px", borderTop: "1px solid var(--ink-color-global-border-subtle)" }}>
            <span style={{ ...warnCoName, minWidth: 118 }}>{l.name}</span><span style={warnCoWhy}>{l.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Topbar Update-data button: the popover is a form — check the datasets to refresh,
 *  optionally narrow the KPIs & Forecasts pull by company/date on the Narrow page,
 *  then one submit runs the whole selection. Lifecycle lives in useRefresh(). */
export default function UpdateDataButton({ datasets = [], builtAt, variant, companies = [] }) {
  const [open, setOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [page, setPage] = useState("main");          // "main" | "narrow" (idle) — "warnall" (fetched)
  const [unchecked, setUnchecked] = useState(() => new Set());
  const [since, setSince] = useState("");
  const [sel, setSel] = useState(null);              // null = all eligible companies (no filter)
  const [draft, setDraft] = useState(null);          // {since, sel} while the Narrow page is open
  const ref = useRef(null);
  useDismissable(open, setOpen, ref);
  useNow();  // keep the per-dataset "Updated Xm ago" labels ticking while the popover is open
  const st = useRefresh();
  const { canRefresh, runRefresh, loadNewData } = st;
  const rows = useMemo(() => buildRows(datasets), [datasets]);
  const hasFilters = !!since || sel !== null;
  // The form is single-use: once the fetch lands, datasets, companies and date all
  // reset to defaults so a stale selection can't narrow a later refresh.
  useEffect(() => {
    if (st.status === "fetched") {
      setUnchecked(new Set());
      setSince("");
      setSel(null);
      setPage("main");
    }
  }, [st.status]);
  const running = st.status === "running";
  const busy = running || st.status === "applying";
  const inSidebar = variant === "sidebar";
  const visual = REFRESH_VISUAL[st.status] || REFRESH_VISUAL.idle;

  const checkedRows = rows.filter((r) => !unchecked.has(r.id));
  const tsChecked = !unchecked.has(TS_ROW_ID);
  const toggleRow = (id) => setUnchecked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const submit = () => {
    trackClick("PortfolioAnalytics.UpdateData.Start");
    const allChecked = checkedRows.length === rows.length;
    const keys = allChecked ? undefined : checkedRows.flatMap((r) => r.keys);
    const opts = {};
    if (tsChecked) {
      if (since) opts.since = since;
      if (sel !== null) opts.companies = { ids: [...sel] };
    }
    runRefresh(keys, opts);
  };
  const submitLabel = busy ? "Refreshing…"
    : rows.length === 0 || checkedRows.length === rows.length ? "Refresh all"
    : checkedRows.length === 0 ? "Select a dataset"
    : checkedRows.length === 1 ? (checkedRows[0].id === TS_ROW_ID ? "Refresh KPIs & Forecasts" : `Refresh ${checkedRows[0].label}`)
    : `Refresh ${checkedRows.length} datasets`;
  const submitDisabled = busy || (rows.length > 0 && checkedRows.length === 0);

  const openNarrow = () => {
    setDraft({ since, sel: sel !== null ? new Set(sel) : new Set(companies.map((c) => c.id)) });
    setPage("narrow");
  };
  const confirmNarrow = () => {
    setSince(draft.since);
    setSel(draft.sel.size === companies.length ? null : new Set(draft.sel));
    setDraft(null);
    setPage("main");
  };
  const discardNarrow = () => { setDraft(null); setPage("main"); };

  const spin = visual.spin ? { animation: "pa-spin 1s linear infinite", lineHeight: 0 } : { lineHeight: 0 };
  // The button reflects live status even with the popover closed (useRefresh keeps polling).
  const statusLabel = running ? (st.progress || "Fetching data…")
    : st.status === "applying" ? "Loading new data…"
    : st.status === "fetched" ? "New data ready"
    : st.status === "error" ? "Update failed"
    : "Update data";

  return (
    <span ref={ref} style={popoverWrapStyle(inSidebar)}>
      <button onClick={() => setOpen((o) => !o)} data-testid="update-data" aria-expanded={open}
        data-state={st.status} title={statusLabel} aria-label={statusLabel}
        className={inSidebar ? "sidebar-action" : undefined}
        style={inSidebar ? { ...sidebarActionStyle, color: visual.color, minWidth: 0 } : { ...iconBtn, color: visual.color }}>
        <span style={{ ...spin, flex: "none" }}><visual.Icon size={16} strokeWidth={2} /></span>
        {inSidebar && <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{statusLabel}</span>}
      </button>
      {open && (
        <div className="popin" data-testid="update-popover" style={{ position: "absolute", ...popoverAnchor(inSidebar), width: 320, lineHeight: 1.5,
          background: "var(--ink-color-global-surface-background-default)", border: "1px solid var(--ink-color-global-border-subtle)", borderRadius: 8, padding: "14px 15px",
          boxShadow: "var(--shadow-hover)", zIndex: 40 }}>
          {st.status === "error" ? (
            <div data-testid="update-error">
              <StatusHeader tone="negative" Icon={AlertCircleIcon}>{st.message || "Update didn’t finish"}</StatusHeader>
              <div style={{ ...subtle, marginTop: 8 }}>
                You can also ask Claude: <span style={{ fontWeight: 650, color: "var(--ink-color-global-text-default)" }}>“Refresh KPI data”</span>.
              </div>
              {st.detail && (
                <>
                  <button onClick={() => setShowDetails((v) => !v)} data-testid="update-error-details-toggle"
                    style={{ ...sans, fontSize: FS.micro, color: "var(--ink-color-global-link-default)", background: "none", border: "none", padding: 0, marginTop: 8, cursor: "pointer" }}>
                    {showDetails ? "Hide details" : "Show details"}
                  </button>
                  {showDetails && (
                    <pre data-testid="update-error-details" style={{ margin: "6px 0 0", padding: "8px 9px", maxHeight: 150, overflow: "auto",
                      whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: FS.micro,
                      lineHeight: 1.45, color: "var(--ink-color-global-text-subtle)", background: "var(--accent-soft)", borderRadius: 4 }}>{st.detail}</pre>
                  )}
                </>
              )}
              <button onClick={st.retry === "apply" ? loadNewData : submit}
                style={{ ...primaryBtn, display: "block", width: "100%", textAlign: "center", marginTop: 12 }}>Try again</button>
            </div>
          ) : st.status === "applying" ? (
            <div data-testid="update-applying">
              <StatusHeader tone="warning" Icon={RefreshIcon} spin>Loading new data…</StatusHeader>
              <div style={{ ...subtle, marginTop: 8 }}>Applying the fresh data and rebuilding your dashboard…</div>
            </div>
          ) : st.status === "fetched" ? (
            page === "warnall"
              ? <WarningsPage st={st} companies={companies} onBack={() => setPage("main")} />
              : <FetchedSummary st={st} companies={companies} onLoad={loadNewData} onViewAll={() => setPage("warnall")} />
          ) : page === "narrow" && draft ? (
            <NarrowPage companies={companies} draft={draft} setDraft={setDraft}
              onConfirm={confirmNarrow} onBack={discardNarrow} />
          ) : (
            <>
              {/* Copy at the top of the popover. */}
              {canRefresh ? (
                <div style={subtle}>Refreshes run in the background — keep working. You’ll load the new data when it’s ready.</div>
              ) : (
                <div style={subtle}>
                  To pull fresh data, ask Claude: <span style={{ fontWeight: 650, color: "var(--ink-color-global-text-default)" }}>“Refresh KPI data”</span>.
                </div>
              )}
              <div style={{ marginTop: 10 }}>
                {rows.map((row) => (
                  <DatasetRow key={row.id} row={row} checked={!unchecked.has(row.id)}
                    onToggle={() => toggleRow(row.id)} disabled={busy}
                    stage={rowStage(row, st)} progress={st.progress}
                    scope={row.narrowable && canRefresh && companies.length > 0 ? scopeSuffix(sel, since) : ""}
                    canRefresh={canRefresh}
                    showNarrow={row.narrowable && companies.length > 0}
                    onNarrow={openNarrow} narrowSet={hasFilters} />
                ))}
              </div>
              {canRefresh && (
                <button onClick={submit} disabled={submitDisabled} data-testid="update-all"
                  style={{ ...primaryBtn, display: "block", width: "100%", textAlign: "center", marginTop: 12,
                    opacity: submitDisabled ? 0.5 : 1, cursor: submitDisabled ? "default" : "pointer" }}>
                  {submitLabel}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </span>
  );
}
