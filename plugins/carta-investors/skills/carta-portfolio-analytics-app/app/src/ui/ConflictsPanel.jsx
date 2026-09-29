import { useState, useRef, useMemo, useEffect } from "react";
import { useDismissable, Btn, WarningTriangleIcon, ChevronRightIcon } from "./components.jsx";
import { FS, sans, mono } from "./theme.js";
import { fmtVal, shortDate } from "./charts.jsx";
import { metricOf, companyOf } from "../model/kpi.js";
import { conflictEdits, keepMine, takeCartas } from "../model/pendingEdits.js";
import { trackClick } from "../analytics.js";
import { useOpenCorrections } from "./correctionEvents.js";

const NEG = "var(--ink-color-global-feedback-negative-strong)";
const NEG_BG = "var(--ink-color-global-feedback-negative-subtle)";
const LINE = "var(--ink-color-global-border-subtle)";
const SUBTLE = "var(--ink-color-global-text-subtle)";
const subtle = { ...sans, fontSize: FS.small, color: SUBTLE, lineHeight: 1.5 };
const ellipsis = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

const popoverWrapStyle = (inSidebar) => ({ position: "relative", lineHeight: inSidebar ? "normal" : 0, display: inSidebar ? "block" : "inline-block" });
const popoverAnchor = (inSidebar) => (inSidebar ? { left: 0, bottom: "calc(100% + 8px)" } : { right: 0, top: "calc(100% + 8px)" });
// Red-tinted trigger — the one control in the sidebar that means "something needs
// a human decision", so it borrows none of the app's usual chrome-neutral styling.
const triggerBase = { ...sans, display: "inline-flex", alignItems: "center", gap: 6, fontSize: FS.body, fontWeight: 600,
  cursor: "pointer", background: NEG_BG, color: NEG, border: `1px solid ${NEG}`, borderRadius: 4 };
const triggerStyle = (inSidebar) => (inSidebar
  // Same chip geometry as the other sidebar actions (UpdateDataButton); only the
  // red tint marks it out.
  ? { ...triggerBase, width: "100%", textAlign: "left", height: 40, padding: "0 12px", fontSize: 13, gap: 8 }
  : { ...triggerBase, height: 40, padding: "0 11px" });

const groupHeaderRow = { display: "flex", alignItems: "center", gap: 6, padding: "8px 2px 6px", fontSize: FS.small, fontWeight: 600, color: "var(--ink-color-global-text-default)" };
const smallBtn = { ...sans, fontSize: FS.micro, fontWeight: 600, padding: "3px 8px", border: `1px solid ${LINE}`, borderRadius: 4,
  background: "var(--ink-color-global-surface-background-default)", color: "var(--ink-color-global-text-default)", cursor: "pointer" };
const rowStyle = (isCurrent) => ({ ...sans, display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
  padding: "6px 8px", border: "none", borderRadius: 4, cursor: "pointer", fontSize: FS.small,
  background: isCurrent ? "var(--accent-soft)" : "transparent", color: "var(--ink-color-global-text-default)" });
const resolvedRowStyle = { ...sans, display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", fontSize: FS.small, color: SUBTLE, opacity: 0.6 };
const dot = { width: 6, height: 6, borderRadius: "50%", background: SUBTLE, flex: "none" };
const navBtn = (disabled) => ({ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, border: `1px solid ${LINE}`,
  borderRadius: 4, background: "var(--ink-color-global-surface-background-default)", color: "var(--ink-color-global-text-default)",
  cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.4 : 1 });
const cardStyle = { border: `1px solid ${LINE}`, borderRadius: 6, padding: "12px 14px" };
const cardLabel = { ...sans, fontSize: FS.small, fontWeight: 600, color: SUBTLE, marginBottom: 4 };

/** Red sidebar control + the Resolve-conflicts panel. Conflicts are resolved here and
 *  ONLY here: publishing never clears one. Group-by (Company | KPI) rail on the left with
 *  per-group bulk Mine / Carta's scoped to that group's open conflicts; a prev/next
 *  carousel on the right compares the user's number against what Carta holds now. */
export function ConflictsButton({ data, dashboard, variant }) {
  const [open, setOpen] = useState(false);
  const [groupBy, setGroupBy] = useState("company");   // "company" | "kpi"
  const [cursor, setCursor] = useState(0);             // index into the flattened open-conflict list
  // Snapshots of resolved edits, kept only to render a grayed rail row after the live
  // conflict disappears — never counted in a group's open count or in flat/cursor.
  const [resolvedRows, setResolvedRows] = useState([]);
  // Id of the conflict a dot-click asked us to jump to; resolved against `flat`
  // once it's computed below, since `flat` depends on state that isn't ready yet here.
  const [pendingTargetId, setPendingTargetId] = useState(null);
  const ref = useRef(null);
  useDismissable(open, setOpen, ref);
  useOpenCorrections((edit) => {
    if (edit?.status === "conflict") { setOpen(true); setPendingTargetId(edit.id); }
  });
  const inSidebar = variant === "sidebar";

  const conflicts = conflictEdits(dashboard?.doc);
  const groups = useMemo(() => {
    const key = (e) => (groupBy === "company" ? e.companyId : e.metricKey);
    const label = (k) => (groupBy === "company"
      ? (companyOf(data, k) || { name: k }).name
      : (metricOf(data, k) || { label: k }).label);
    const m = new Map();
    const ensure = (k) => {
      if (!m.has(k)) m.set(k, { key: k, label: label(k), edits: [], resolved: [] });
      return m.get(k);
    };
    for (const e of conflicts) ensure(key(e)).edits.push(e);
    for (const r of resolvedRows) ensure(key(r.edit)).resolved.push(r);
    return [...m.values()];
  }, [conflicts, resolvedRows, groupBy, data]);
  const flat = groups.flatMap((g) => g.edits);
  const current = flat[Math.min(cursor, flat.length - 1)] || null;

  // If the target isn't found (already resolved elsewhere), the panel just stays open.
  useEffect(() => {
    if (pendingTargetId == null) return;
    const idx = flat.findIndex((e) => e.id === pendingTargetId);
    if (idx >= 0) setCursor(idx);
    setPendingTargetId(null);
  }, [pendingTargetId, flat]);

  if (!conflicts.length) return null;

  const now = () => new Date().toISOString();
  const resolveOne = (e, keep) => {
    trackClick(keep ? "PortfolioAnalytics.Corrections.ConflictKeepMine" : "PortfolioAnalytics.Corrections.ConflictTakeCartas");
    setResolvedRows((r) => [...r, { edit: e, keep }]);
    dashboard.update((d) => (keep ? keepMine(d, e, now()) : takeCartas(d, e.id)));
  };
  const resolveGroup = (g, keep) => {
    trackClick(keep ? "PortfolioAnalytics.Corrections.ConflictKeepMine" : "PortfolioAnalytics.Corrections.ConflictTakeCartas");
    setResolvedRows((r) => [...r, ...g.edits.map((e) => ({ edit: e, keep }))]);
    // One update, folded over ONLY this group's open conflicts — resolving Nova's
    // group must never touch Beta LLC's, and vice versa.
    dashboard.update((d) => g.edits.reduce((acc, e) => (keep ? keepMine(acc, e, now()) : takeCartas(acc, e.id)), d));
  };

  const label = `Resolve ${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"}`;
  const m = current ? (metricOf(data, current.metricKey) || { label: current.metricKey, unit: "Number" }) : null;
  const c = current ? (companyOf(data, current.companyId) || { name: current.companyId }) : null;
  const cur = (current && current.cur) || data.source?.currency;

  return (
    <span ref={ref} style={popoverWrapStyle(inSidebar)}>
      <button type="button" data-testid="resolve-conflicts" aria-expanded={open} title={label}
        className={inSidebar ? "sidebar-action" : undefined}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) trackClick("PortfolioAnalytics.Corrections.ConflictsOpen");
        }}
        style={triggerStyle(inSidebar)}>
        <span style={{ lineHeight: 0 }}><WarningTriangleIcon size={15} strokeWidth={2} /></span>
        <span style={ellipsis}>{label}</span>
      </button>
      {open && (
        <div className="popin" data-testid="conflicts-panel" style={{ position: "absolute", ...popoverAnchor(inSidebar), width: 660, maxHeight: 560,
          display: "flex", flexDirection: "column", overflow: "hidden",
          background: "var(--ink-color-global-surface-background-default)", border: `1px solid ${LINE}`, borderRadius: 8,
          boxShadow: "var(--shadow-hover)", zIndex: 40 }}>
          <div style={{ padding: "14px 16px", borderBottom: `1px solid ${LINE}` }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <div style={{ ...sans, fontSize: FS.h3, fontWeight: 600, color: "var(--ink-color-global-text-default)" }}>Resolve conflicts</div>
              <div style={subtle}>{resolvedRows.length} of {resolvedRows.length + conflicts.length} resolved</div>
            </div>
            <div style={{ ...subtle, marginTop: 4 }}>Carta changed these values after you edited them. Conflicts aren't part of Publish changes — pick a side for each to clear it.</div>
          </div>
          <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
            <div style={{ width: 240, flex: "none", borderRight: `1px solid ${LINE}`, padding: 12, overflowY: "auto" }}>
              <div className="seg-group is-sm" style={{ marginBottom: 10 }}>
                <button type="button" className={`seg-btn${groupBy === "company" ? " is-selected" : ""}`} onClick={() => setGroupBy("company")}>Company</button>
                <button type="button" className={`seg-btn${groupBy === "kpi" ? " is-selected" : ""}`} onClick={() => setGroupBy("kpi")}>KPI</button>
              </div>
              {groups.map((g) => (
                <div key={g.key} data-testid={`conflict-group-${g.key}`} style={{ marginBottom: 10 }}>
                  <div style={groupHeaderRow}>
                    <span style={{ flex: 1, ...ellipsis }}>{g.label} — {g.edits.length}</span>
                    {g.edits.length > 0 && (
                      <>
                        <button type="button" style={smallBtn} onClick={() => resolveGroup(g, true)}
                          title={`Keep mine for every open conflict in ${g.label}`}>Mine</button>
                        <button type="button" style={smallBtn} onClick={() => resolveGroup(g, false)}
                          title={`Take Carta's for every open conflict in ${g.label}`}>Carta's</button>
                      </>
                    )}
                  </div>
                  {g.edits.map((e) => {
                    const isCurrent = !!current && current.id === e.id;
                    const rowLabel = groupBy === "company" ? (metricOf(data, e.metricKey)?.label || e.metricKey) : (companyOf(data, e.companyId)?.name || e.companyId);
                    return (
                      <button key={e.id} type="button" style={rowStyle(isCurrent)} onClick={() => setCursor(flat.indexOf(e))}>
                        <span style={dot} />
                        <span style={ellipsis}>{rowLabel} · {shortDate(e.period, e.freq === "Q")}</span>
                      </button>
                    );
                  })}
                  {g.resolved.map((r, i) => {
                    const rowLabel = groupBy === "company" ? (metricOf(data, r.edit.metricKey)?.label || r.edit.metricKey) : (companyOf(data, r.edit.companyId)?.name || r.edit.companyId);
                    return (
                      <div key={`${r.edit.id}-${i}`} style={resolvedRowStyle}>
                        <span style={dot} />
                        <span style={ellipsis}>{rowLabel} · {shortDate(r.edit.period, r.edit.freq === "Q")}</span>
                        <span style={{ flex: "none" }}>{r.keep ? "kept mine" : "took Carta's"}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            <div style={{ flex: 1, minWidth: 0, padding: 16, overflowY: "auto" }}>
              {current && (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <button type="button" aria-label="Previous conflict" disabled={flat.length < 2} style={navBtn(flat.length < 2)}
                      onClick={() => setCursor((n) => (n - 1 + flat.length) % flat.length)}>
                      <ChevronRightIcon size={14} style={{ transform: "rotate(180deg)" }} />
                    </button>
                    <div style={{ flex: 1, textAlign: "center", ...sans, fontSize: FS.bodyLg, fontWeight: 600, color: "var(--ink-color-global-text-default)" }}>
                      {c.name} · {m.label} · {shortDate(current.period, current.freq === "Q")}
                    </div>
                    <button type="button" aria-label="Next conflict" disabled={flat.length < 2} style={navBtn(flat.length < 2)}
                      onClick={() => setCursor((n) => (n + 1) % flat.length)}>
                      <ChevronRightIcon size={14} />
                    </button>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                    <div style={cardStyle}>
                      <div style={cardLabel}>Mine</div>
                      <div style={{ ...mono, fontSize: FS.h2, fontWeight: 600, color: "var(--ink-color-global-text-default)" }}>{fmtVal(current.value, m.unit, undefined, cur)}</div>
                      <div style={{ ...subtle, marginTop: 4 }}>was {fmtVal(current.prevValue, m.unit, undefined, cur)} when edited</div>
                    </div>
                    <div style={cardStyle}>
                      <div style={cardLabel}>Carta now</div>
                      <div style={{ ...mono, fontSize: FS.h2, fontWeight: 600, color: "var(--ink-color-global-text-default)" }}>{fmtVal(current.upstreamValue, m.unit, undefined, cur)}</div>
                      <div style={{ ...subtle, marginTop: 4 }}>updated {current.conflictAt?.slice(0, 10)} by data refresh</div>
                    </div>
                  </div>
                  <Btn kind="primary" onClick={() => resolveOne(current, true)} style={{ display: "block", width: "100%" }}>Keep mine</Btn>
                  <Btn onClick={() => resolveOne(current, false)} style={{ display: "block", width: "100%", marginTop: 8 }}>Take Carta's</Btn>
                  <div style={{ ...subtle, marginTop: 10 }}>Keep mine re-queues the value as a draft in Publish changes. Take Carta's drops your edit.</div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </span>
  );
}
