// Overview's Filters ribbon: the button, the active-filter chips, and a two-pane panel whose nav
// is generated from the column catalog. Companies is the one non-column dimension and is session-only.
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { FS, sans, MICRO } from "../../ui/theme.js";
import { Btn, SearchInput, MarqueeLabel, ddTriggerStyle, ChevronDownIcon, ChevronRightIcon, useDismissable, Z, POPOVER_SHADOW } from "../../ui/components.jsx";
import { columnCatalog, columnValueType, readColumns, setColumnVisible } from "../../model/overviewColumns.js";
import { trackClick } from "../../analytics.js";
import { readFilters, setFilter, removeFilter, clearFilters, filterPredicate, filterLabel, filterFor, specKey, isEmptyCond } from "../../model/overviewFilters.js";
import { signalHitsByCompany } from "../../model/signals.js";
import { ColumnFilterBody, emptyCond } from "./ColumnFilterPopover.jsx";
import ColumnsPane from "./ColumnsPane.jsx";

const EMPTY_RULES = [];

/** Owns the Overview's filter state: persisted `doc.filters` plus the
 *  session-only Companies pick. Returns the predicate, the `filterApi` the
 *  table's header funnels use, and the props GlobalFilter renders from. */
export function useOverviewFilter(data, dashboard) {
  const dashDoc = dashboard?.doc;
  const allFunds = data.dimensions?.funds || [];
  const rules = dashDoc?.rules || EMPTY_RULES;
  const [selCompanies, setSelCompanies] = useState(() => new Set()); // company ids; empty = all

  const hitsByCompany = useMemo(() => signalHitsByCompany(data, rules), [data, rules]);
  const ctx = useMemo(() => ({ dashDoc, hitsByCompany }), [dashDoc, hitsByCompany]);
  const catalog = useMemo(() => columnCatalog(data, [], ctx), [data, ctx]);
  const filters = useMemo(() => readFilters(dashDoc, data, ctx), [dashDoc, data, ctx]);
  const visibleColumns = useMemo(() => new Set(readColumns(dashDoc, data).map(specKey)), [dashDoc, data]);

  const predicate = useMemo(() => filterPredicate(filters, data, ctx), [filters, data, ctx]);
  const filterCompanies = useCallback((companies) =>
    companies.filter((c) => selCompanies.size === 0 || selCompanies.has(c.id)).filter(predicate),
    [selCompanies, predicate]);

  const filterApi = useMemo(() => {
    const write = (fn) => dashboard?.update((d) => fn(d));
    return {
      filters, ctx,
      setFilter: (kind, key, cond) => write((d) => setFilter(d, { kind, key, cond })),
      removeFilter: (kind, key) => write((d) => removeFilter(d, kind, key)),
      resetAll: () => { setSelCompanies(new Set()); write((d) => clearFilters(d)); },
      // Same event the Columns chooser emits — both are "the user edited the stack".
      setColumnVisible: (kind, key, on) => { trackClick("PortfolioAnalytics.Overview.ColumnsEdit"); write((d) => setColumnVisible(d, data, { kind, key }, on)); },
      // Rows passing every filter EXCEPT this column's — what the editor counts.
      companiesExcept: (kind, key) => {
        const others = filters.filter((f) => !(f.kind === kind && f.key === key));
        const pred = filterPredicate(others, data, ctx);
        return (data.companies || []).filter((c) => selCompanies.size === 0 || selCompanies.has(c.id)).filter(pred);
      },
    };
  }, [filters, ctx, data, selCompanies, dashboard]);

  const companyOpts = useMemo(() => {
    const fundOrder = new Map(allFunds.map((f, i) => [f, i]));
    const firstFundOf = (c) => (c.funds || []).slice()
      .sort((a, b) => (fundOrder.get(a) ?? Infinity) - (fundOrder.get(b) ?? Infinity))[0];
    return (data.companies || [])
      .map((c) => ({ id: c.id, label: c.name, group: firstFundOf(c) || "No fund" }))
      .sort((a, b) => ((fundOrder.get(a.group) ?? Infinity) - (fundOrder.get(b.group) ?? Infinity)) || a.label.localeCompare(b.label));
  }, [data, allFunds]);

  const filterProps = { data, dashboard, catalog, filterApi, companyOpts, selCompanies, onCompanies: setSelCompanies, visibleColumns };
  return { filterCompanies, filterApi, filterProps };
}

// Local composed tokens the app's tokens.css doesn't carry — same light-dark()
// convention, values copied from theme-with-ink's own components-globalfilter.html.
const GF_WARM_SURFACE = "light-dark(#FBFAF9, #2D2D2D)";
const GF_NAV_ACTIVE_BG = "light-dark(#E9EAEA, #394040)";
const GF_TAG_BORDER = "light-dark(#285DA3, #2C67B5)";
const GF_TAG_BG = "light-dark(#EAF0F8, transparent)";
const GF_BUBBLE_BG = "light-dark(#EAF0F8, rgb(18 18 18))";
const GF_PANEL_WIDTH = 600;
const COLUMNS = "__columns";
const COMPANIES = "__companies";

const navBtn = (active) => ({ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%",
  height: 36, padding: "0 16px", gap: 10, fontSize: 14, lineHeight: "20px", fontWeight: active ? 500 : 400,
  color: "var(--ink-color-global-text-default)", cursor: "pointer", border: "none", textAlign: "left",
  background: active ? GF_NAV_ACTIVE_BG : "transparent", ...sans });
const bubble = { display: "inline-flex", alignItems: "center", height: 18, padding: "0 8px", fontSize: 12,
  fontWeight: 500, letterSpacing: "0.01em", borderRadius: 999, whiteSpace: "nowrap", boxSizing: "border-box",
  border: `1px solid var(--ink-color-global-feedback-info-strong)`, background: GF_BUBBLE_BG,
  color: "var(--ink-color-global-feedback-info-strong)", ...sans };
const checkRow = { ...sans, display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "var(--ink-color-global-text-default)", cursor: "pointer" };
const checkBox = { width: 16, height: 16, margin: 0, accentColor: "var(--ink-color-global-border-active)", cursor: "pointer" };

/** Ribbon "Filters & columns" control. Left nav: Columns (the table's stack, edited
 *  in place), Companies, then one expandable entry per catalog group; picking a
 *  field shows ColumnFilterBody on the right, where it can also be added as a
 *  column. Filter drafts commit on Apply; chips read the committed filters. */
export function GlobalFilter({ data, dashboard, catalog, filterApi, companyOpts, selCompanies, onCompanies, visibleColumns }) {
  const { filters, ctx } = filterApi;
  const [open, setOpen] = useState(false);
  const [paneSearch, setPaneSearch] = useState("");
  const [activePane, setActivePane] = useState(COLUMNS);   // COLUMNS | COMPANIES | "kind:key"
  const [openGroup, setOpenGroup] = useState(null);           // which catalog group is expanded
  const [draftCompanies, setDraftCompanies] = useState(selCompanies);
  const [draftFilters, setDraftFilters] = useState(filters);  // full working copy of doc.filters
  const ref = useRef(null), panelRef = useRef(null);
  // The operator Dropdown in the right pane portals its menu to <body>; a click
  // there must not read as "outside" and close the whole panel.
  useDismissable(open, setOpen, [ref, panelRef], { insideSelector: ".popin" });

  const [alignRight, setAlignRight] = useState(false);
  useEffect(() => {
    if (!open) return;
    const place = () => { const el = ref.current; if (el) setAlignRight(el.getBoundingClientRect().left + GF_PANEL_WIDTH > window.innerWidth - 8); };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);
  // Re-seed drafts from the committed state whenever the panel closes.
  useEffect(() => {
    if (open) return;
    setDraftCompanies(selCompanies); setDraftFilters(filters); setPaneSearch("");
  }, [open, selCompanies, filters]);

  const byKey = useMemo(() => new Map(catalog.flatMap((g) => g.options.map((o) => [specKey(o), o]))), [catalog]);
  const activeSpec = byKey.get(activePane) || null; // undefined for COLUMNS / COMPANIES
  const draftFor = (spec) => filterFor(draftFilters, spec.kind, spec.key)?.cond || emptyCond(columnValueType(spec));
  // Empty drafts stay in the list until Apply — dropping them here would forget
  // an operator picked before its value is typed. setFilter treats empty as "remove".
  const setDraftFor = (spec, cond) => setDraftFilters((list) => {
    const rest = list.filter((f) => !(f.kind === spec.kind && f.key === spec.key));
    return [...rest, { id: filterFor(list, spec.kind, spec.key)?.id || `draft-${specKey(spec)}`, kind: spec.kind, key: spec.key, cond }];
  });
  const isActiveDraft = (f) => !isEmptyCond(columnValueType(f), f.cond);
  const draftCount = (o) => { const f = filterFor(draftFilters, o.kind, o.key); return f && isActiveDraft(f) ? 1 : 0; };
  // Anything in the draft that Apply would change — drives the footer so a pending
  // filter is never mistaken for an applied one, whichever pane is showing.
  const sig = (list) => list.filter(isActiveDraft).map((f) => `${specKey(f)}=${JSON.stringify(f.cond)}`).sort().join("|");
  const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
  const isDirty = sig(draftFilters) !== sig(filters) || !sameSet(draftCompanies, selCompanies);

  const apply = () => {
    onCompanies(draftCompanies);
    for (const f of filters) if (!filterFor(draftFilters, f.kind, f.key)) filterApi.removeFilter(f.kind, f.key);
    for (const f of draftFilters) if (isActiveDraft(f) || filterFor(filters, f.kind, f.key)) filterApi.setFilter(f.kind, f.key, f.cond);
    setOpen(false);
  };
  const resetDraft = () => { setDraftCompanies(new Set()); setDraftFilters([]); };

  const chips = [];
  if (selCompanies.size > 0) chips.push({ key: COMPANIES, label: `Companies (${selCompanies.size})`, clear: () => onCompanies(new Set()) });
  for (const f of filters) {
    chips.push({ key: specKey(f), label: filterLabel(f, data, ctx), hidden: !visibleColumns.has(specKey(f)), clear: () => filterApi.removeFilter(f.kind, f.key) });
  }

  const companyGroups = useMemo(() => {
    if (activePane !== COMPANIES) return [];
    const q = paneSearch.toLowerCase();
    const byGroup = new Map();
    for (const o of companyOpts) {
      if (q && !o.label.toLowerCase().includes(q)) continue;
      if (!byGroup.has(o.group)) byGroup.set(o.group, []);
      byGroup.get(o.group).push(o);
    }
    return [...byGroup];
  }, [activePane, companyOpts, paneSearch]);
  const toggleDraftCompany = (id) => setDraftCompanies((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  // Companies passing every OTHER draft filter and the draft companies pick — for counts.
  const otherCompaniesFor = (spec) => {
    const others = draftFilters.filter((f) => !(f.kind === spec.kind && f.key === spec.key));
    const pred = filterPredicate(others, data, ctx);
    return (data.companies || []).filter((c) => draftCompanies.size === 0 || draftCompanies.has(c.id)).filter(pred);
  };

  const tagChip = ({ key, label, clear, hidden }) => (
    <span key={key} title={hidden ? `${label} — not shown as a column` : undefined}
      style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 8px 6px 10px",
        fontSize: 13, whiteSpace: "nowrap", borderRadius: 4, boxSizing: "border-box",
        border: `1px dashed var(--ink-color-global-border-focus-default)`,
        background: "var(--ink-color-global-feedback-info-subtle)",
        color: "var(--ink-color-global-link-default)", ...sans }}>
      {label}
      <button onClick={clear} aria-label={`Clear ${label} filter`}
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 13, height: 13, border: "none", background: "transparent",
          color: "inherit", cursor: "pointer", padding: 0, flex: "none" }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </span>
  );

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      {/* Trigger first, then chips, then Reset at the far end. */}
      <button onClick={() => setOpen((o) => !o)} className={`dd-trigger${open ? " is-open" : ""}`}
        style={{ ...ddTriggerStyle({ minWidth: 110, gap: 22 }), cursor: "pointer" }}>
        <span>Filters &amp; columns</span>
        <ChevronDownIcon size={16} strokeWidth={1.5} style={{ flex: "none" }} />
      </button>
      {chips.map(tagChip)}
      {chips.length > 0 && (
        <button onClick={filterApi.resetAll} style={{ height: 28, padding: "0 4px", border: "none",
          background: "transparent", color: "var(--ink-color-global-link-default)", fontSize: 13,
          cursor: "pointer", textDecoration: "none", ...sans }}>Reset</button>
      )}

      {open && (
        <div ref={panelRef} className="popin" style={{ position: "absolute", top: "calc(100% + 4px)", ...(alignRight ? { right: 0 } : { left: 0 }),
          width: GF_PANEL_WIDTH, height: 440, background: "var(--ink-color-global-surface-background-default)",
          border: `1px solid var(--ink-color-global-border-subtle)`, borderRadius: 8, boxShadow: POPOVER_SHADOW,
          zIndex: Z.popover, display: "flex", overflow: "hidden" }}>
          <nav style={{ width: 200, background: GF_WARM_SURFACE, borderRight: `1px solid var(--ink-color-global-border-subtle)`,
            padding: "8px 0", overflowY: "auto", flex: "none" }}>
            <button onClick={() => { setActivePane(COLUMNS); setPaneSearch(""); }} style={navBtn(activePane === COLUMNS)}>
              <span>Columns</span>
              {visibleColumns.size > 0 && <span style={bubble}>{visibleColumns.size}</span>}
            </button>
            {/* Columns edits the table itself; everything below it is a filter dimension. */}
            <div role="separator" style={{ height: 1, margin: "6px 0", background: "var(--ink-color-global-border-subtle)" }} />
            <button onClick={() => { setActivePane(COMPANIES); setPaneSearch(""); }} style={navBtn(activePane === COMPANIES)}>
              <span>Companies</span>
              {draftCompanies.size > 0 && <span style={bubble}>{draftCompanies.size}</span>}
            </button>
            {catalog.map((g) => {
              const expanded = openGroup === g.group;
              const n = g.options.reduce((s, o) => s + draftCount(o), 0);
              return (
                <div key={g.group}>
                  <button onClick={() => setOpenGroup(expanded ? null : g.group)} style={navBtn(false)} aria-expanded={expanded}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      {expanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}{g.group}
                    </span>
                    {n > 0 && <span style={bubble}>{n}</span>}
                  </button>
                  {expanded && g.options.map((o) => {
                    const k = specKey(o);
                    return (
                      <button key={k} onClick={() => { setActivePane(k); setPaneSearch(""); }} style={{ ...navBtn(activePane === k), paddingLeft: 34, height: 32 }}>
                        <MarqueeLabel hoverParent style={{ flex: 1 }}>{o.label}</MarqueeLabel>
                        {draftCount(o) > 0 && <span style={bubble}>1</span>}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </nav>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <div style={{ flex: 1, padding: "20px 24px", overflowY: "auto" }}>
              {activePane === COLUMNS ? (
                <ColumnsPane data={data} dashboard={dashboard} />
              ) : activeSpec ? (
                <ColumnFilterBody key={activePane} spec={activeSpec} data={data} ctx={ctx}
                  draft={draftFor(activeSpec)} onDraft={(cond) => setDraftFor(activeSpec, cond)}
                  otherCompanies={otherCompaniesFor(activeSpec)}
                  action={(() => {
                    const shown = visibleColumns.has(activePane);
                    return (
                      <Btn kind="link" style={{ fontSize: FS.small, whiteSpace: "nowrap" }}
                        onClick={() => filterApi.setColumnVisible(activeSpec.kind, activeSpec.key, !shown)}>
                        {shown ? "− Remove from columns" : "+ Add to columns"}
                      </Btn>
                    );
                  })()} />
              ) : (
                <>
                  <h3 style={{ ...sans, fontSize: 14, fontWeight: 500, color: "var(--ink-color-global-text-default)", margin: "0 0 14px" }}>Filter by companies</h3>
                  {companyOpts.length > 6 && (
                    <SearchInput placeholder="Search companies" value={paneSearch} onChange={(e) => setPaneSearch(e.target.value)} style={{ width: "100%" }} />
                  )}
                  {companyGroups.length > 0 && (
                    <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                      <Btn kind="link" style={{ fontSize: FS.small }}
                        onClick={() => setDraftCompanies(new Set([...draftCompanies, ...companyGroups.flatMap(([, opts]) => opts.map((o) => o.id))]))}>
                        Select all{paneSearch ? " matching" : ""}
                      </Btn>
                      <Btn kind="link" style={{ fontSize: FS.small }}
                        onClick={() => { const visible = new Set(companyGroups.flatMap(([, opts]) => opts.map((o) => o.id)));
                          setDraftCompanies(new Set([...draftCompanies].filter((id) => !visible.has(id)))); }}>
                        Clear{paneSearch ? " matching" : ""}
                      </Btn>
                    </div>
                  )}
                  {companyGroups.length === 0 && (
                    <p style={{ ...sans, fontSize: FS.bodyLg, color: MICRO, margin: 0 }}>
                      {paneSearch ? `No companies match "${paneSearch}".` : "No companies to filter by."}
                    </p>
                  )}
                  {companyGroups.map(([group, opts]) => (
                    <div key={group} style={{ marginTop: 16 }}>
                      <div style={{ ...sans, fontSize: FS.micro, fontWeight: 700, color: MICRO, textTransform: "uppercase", margin: "0 0 8px" }}>{group}</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {opts.map((o) => (
                          <label key={o.id} style={checkRow}>
                            <input type="checkbox" checked={draftCompanies.has(o.id)} onChange={() => toggleDraftCompany(o.id)} style={checkBox} />
                            <MarqueeLabel hoverParent style={{ flex: 1 }}>{o.label}</MarqueeLabel>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 24px", borderTop: `1px solid var(--ink-color-global-border-subtle)` }}>
              {/* Column edits save as they happen; Reset/Apply only ever mean the filter draft. */}
              <span style={{ ...sans, fontSize: FS.small, color: MICRO, flex: 1 }}>
                {activePane === COLUMNS ? (isDirty ? "Filter changes not applied yet" : "Column changes save as you go") : ""}
              </span>
              {(activePane !== COLUMNS || isDirty) && (
                <>
                  <Btn onClick={resetDraft}>Reset</Btn>
                  <Btn kind={isDirty ? "primary" : "ghost"} onClick={apply}>Apply</Btn>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
