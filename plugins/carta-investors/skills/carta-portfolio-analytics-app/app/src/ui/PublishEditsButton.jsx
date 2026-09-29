import { useState, useRef, useEffect } from "react";
import { useDismissable, Badge, Btn, AlertCircleIcon, CheckCircleIcon, RefreshIcon } from "./components.jsx";
import { FS, sans } from "./theme.js";
import { fmtVal, shortDate } from "./charts.jsx";
import { metricOf, companyOf } from "../model/kpi.js";
import { publishableEdits, markPublishing, applyPublishResults, failRun, discardEdit } from "../model/pendingEdits.js";
import usePublish from "../state/usePublish.js";
import { trackClick } from "../analytics.js";
import { useOpenCorrections } from "./correctionEvents.js";

const iconBtn = { display: "inline-flex", alignItems: "center", justifyContent: "center", height: 40, padding: "0 11px", gap: 6,
  border: "1px solid var(--ink-color-global-border-subtle)", borderRadius: 4, cursor: "pointer",
  background: "var(--ink-color-global-surface-background-default)", color: "var(--ink-color-global-text-default)", ...sans, fontSize: FS.body, fontWeight: 600 };
// Same chip geometry as UpdateDataButton's sidebar trigger — the stacked sidebar
// actions must read as one family; keep the two styles identical.
const sidebarActionStyle = { ...sans, display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
  fontSize: 13, fontWeight: 500, height: 40, padding: "0 12px", border: "1px solid var(--ink-color-global-border-subtle)",
  borderRadius: 4, cursor: "pointer", background: "var(--ink-color-global-surface-background-default)", color: "var(--ink-color-global-text-default)" };
const popoverWrapStyle = (inSidebar) => ({ position: "relative", lineHeight: inSidebar ? "normal" : 0, display: inSidebar ? "block" : "inline-block" });
const popoverAnchor = (inSidebar) => (inSidebar ? { left: 0, bottom: "calc(100% + 8px)" } : { right: 0, top: "calc(100% + 8px)" });
const subtle = { ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", lineHeight: 1.5 };
const TONE = { draft: "warning", publishing: "warning", published: "info", failed: "negative" };
const LABEL = { draft: "draft", publishing: "publishing…", published: "pending refresh", failed: "failed" };

function EditRow({ e, data, onDiscard }) {
  const m = metricOf(data, e.metricKey) || { label: e.metricKey, unit: "Number" };
  const c = companyOf(data, e.companyId) || { name: e.companyId };
  const cur = e.cur || data.source?.currency;
  return (
    <div style={{ padding: "8px 0", borderTop: "1px solid var(--ink-color-global-border-subtle)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ ...sans, fontSize: FS.small, fontWeight: 600, color: "var(--ink-color-global-text-default)", flex: 1, minWidth: 0 }}>
          {c.name} · {m.label} · {shortDate(e.period, e.freq === "Q")}
        </div>
        <Badge tone={TONE[e.status] || "neutral"}>{LABEL[e.status] || e.status}</Badge>
        {e.status !== "publishing" && (
          <button type="button" onClick={() => onDiscard(e.id)} aria-label={`Discard correction to ${m.label}`}
            style={{ border: "none", background: "none", cursor: "pointer", color: "var(--ink-color-global-text-subtle)", fontSize: 16, lineHeight: 1, padding: "0 2px" }}>×</button>
        )}
      </div>
      <div style={{ ...subtle, marginTop: 2 }}>
        {fmtVal(e.prevValue, m.unit, undefined, cur)} → <span style={{ fontWeight: 600, color: "var(--ink-color-global-text-default)" }}>{fmtVal(e.value, m.unit, undefined, cur)}</span>
      </div>
      {e.status === "failed" && e.error && <div style={{ ...subtle, color: "var(--ink-color-global-feedback-negative-strong)", marginTop: 2 }}>{e.error}</div>}
    </div>
  );
}

/** "Publish N changes": reviews the staged KPI corrections, sends the publishable ones
 *  through usePublish, and folds the per-edit results back into the portfolio doc. */
export default function PublishEditsButton({ data, dashboard, variant }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useDismissable(open, setOpen, ref);
  // A conflict dot's click belongs to the Resolve-conflicts panel, not here.
  useOpenCorrections((edit) => { if (edit?.status !== "conflict") setOpen(true); });
  const st = usePublish();
  const inSidebar = variant === "sidebar";
  // Conflicts never appear here — they have their own view and publishing can't clear them.
  const edits = (dashboard?.doc?.pendingEdits || []).filter((e) => e.status !== "conflict");
  const ready = publishableEdits(dashboard?.doc);
  const appliedRun = useRef(null);

  // Fold a finished run in exactly once. "error" moves its publishing edits to failed
  // (publishable again) but does NOT reset — the error block must stay visible.
  useEffect(() => {
    if (!st.runId || appliedRun.current === st.runId || !dashboard?.update) return;
    if (st.status === "done") {
      appliedRun.current = st.runId;
      const now = new Date().toISOString();
      dashboard.update((d) => applyPublishResults(d, st.runId, st.results, now));
      trackClick("PortfolioAnalytics.Corrections.PublishDone");
      st.reset();
    } else if (st.status === "error") {
      appliedRun.current = st.runId;
      dashboard.update((d) => failRun(d, st.runId, st.message));
    }
  }, [st.status, st.runId]);

  if (!edits.length) return null;

  const run = async () => {
    const batch = ready;
    const runId = await st.publish(batch);
    if (runId) dashboard.update((d) => markPublishing(d, batch.map((e) => e.id), runId));
  };
  const discard = (id) => { trackClick("PortfolioAnalytics.Corrections.Discard"); dashboard.update((d) => discardEdit(d, id)); };

  const running = st.status === "running";
  const n = ready.length;
  const label = running ? (st.progress || "Publishing…") : n ? `Publish ${n} change${n === 1 ? "" : "s"}` : "Pending changes";
  const Icon = running ? RefreshIcon : st.status === "error" ? AlertCircleIcon : CheckCircleIcon;

  return (
    <span ref={ref} style={popoverWrapStyle(inSidebar)}>
      <button onClick={() => setOpen((o) => !o)} data-testid="publish-edits" aria-expanded={open} title={label}
        className={inSidebar ? "sidebar-action" : undefined} style={inSidebar ? sidebarActionStyle : iconBtn}>
        <span style={{ lineHeight: 0, animation: running ? "pa-spin 1s linear infinite" : "none" }}><Icon size={15} strokeWidth={2} /></span>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      </button>
      {open && (
        <div className="popin" data-testid="publish-popover" style={{ position: "absolute", ...popoverAnchor(inSidebar), width: 360, maxHeight: 520, overflowY: "auto",
          background: "var(--ink-color-global-surface-background-default)", border: "1px solid var(--ink-color-global-border-subtle)", borderRadius: 8, padding: "14px 15px",
          boxShadow: "var(--shadow-hover)", zIndex: 40 }}>
          {st.status === "error" && (
            <div data-testid="publish-error" style={{ ...subtle, color: "var(--ink-color-global-feedback-negative-strong)", marginBottom: 10 }}>
              {st.message || "The publish didn't finish."}
              <div style={{ ...subtle, marginTop: 4 }}>Ask Claude: <b style={{ color: "var(--ink-color-global-text-default)" }}>"Refresh KPI data"</b>, then publish again.</div>
            </div>
          )}
          <div style={subtle}>Corrections stay marked pending until the next data refresh confirms them.</div>
          <div style={{ marginTop: 8 }}>
            {edits.map((e) => <EditRow key={e.id} e={e} data={data} onDiscard={discard} />)}
          </div>
          {st.canPublish ? (
            n > 0 && (
              <Btn kind="primary" onClick={run} disabled={running} data-testid="publish-run"
                style={{ display: "block", width: "100%", marginTop: 12 }}>{running ? "Publishing…" : `Publish ${n} change${n === 1 ? "" : "s"}`}</Btn>
            )
          ) : (
            <div style={{ ...subtle, marginTop: 10 }}>Publishing needs the Claude CLI on this machine. Ask Claude to publish these corrections instead.</div>
          )}
        </div>
      )}
    </span>
  );
}
