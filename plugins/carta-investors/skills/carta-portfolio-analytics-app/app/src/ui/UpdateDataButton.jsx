import { useState, useRef } from "react";
import { RefreshIcon, CheckCircleIcon, AlertCircleIcon, useDismissable } from "./components.jsx";
import { FS, sans } from "./theme.js";
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

// Ink feedback semantics (same tokens build-micro-app uses): strong fg + subtle tint bg.
const TONE = {
  positive: { fg: "var(--ink-color-global-feedback-positive-strong)", bg: "var(--ink-color-global-feedback-positive-subtle)" },
  warning: { fg: "var(--ink-color-global-feedback-warning-strong)", bg: "var(--ink-color-global-brand-yellow-20)" },
  negative: { fg: "var(--ink-color-global-feedback-negative-strong)", bg: "var(--ink-color-global-feedback-negative-subtle)" },
};

// This dataset's stage in a running refresh: "active" (a stem is fetching), "done" (all its
// stems fetched this run), "pending" (queued), or null (not part of this refresh / at rest).
function datasetStage(ds, st) {
  if (st.status !== "running") return null;
  const inScope = st.target == null || (st.target || []).includes(ds.key);
  if (!inScope) return null;
  const stems = ds.stems || [];
  const done = st.doneStems || [];
  const active = st.activeStems || [];
  if (stems.length && stems.every((s) => done.includes(s))) return "done";
  if (stems.some((s) => active.includes(s))) return "active";
  return "pending";
}

function rowSubline(stage, ds, progress) {
  if (stage === "active") return progress || "Updating…";
  if (stage === "done") return "Updated just now";
  if (stage === "pending") return "Waiting…";
  return ds.present ? `Updated ${fmtRelative(ds.fetchedAt)}` : "Not loaded";
}

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

function DatasetRow({ ds, running, stage, progress, canRefresh, onRefresh }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0",
      borderTop: "1px solid var(--ink-color-global-border-subtle)" }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ ...sans, fontSize: FS.small, fontWeight: 600, color: "var(--ink-color-global-text-default)" }}>{ds.label}</div>
        <div style={micro}>{rowSubline(stage, ds, progress)}</div>
      </div>
      {/* One control on the right: refresh action → spinner while fetching → green check when done. */}
      {canRefresh && (stage === "done" ? (
        <span data-testid={`update-row-done-${ds.key}`} title={`${ds.label} refreshed`}
          style={{ width: 30, height: 30, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none", color: TONE.positive.fg }}>
          <CheckCircleIcon size={16} strokeWidth={2} />
        </span>
      ) : (
        <button onClick={() => onRefresh([ds.key])} disabled={running} title={`Refresh ${ds.label}`}
          aria-label={`Refresh ${ds.label}`} data-testid={`update-row-${ds.key}`}
          style={{ ...iconBtn, width: 30, height: 30, flex: "none",
            opacity: running && stage !== "active" ? 0.4 : 1, cursor: running ? "default" : "pointer",
            color: stage === "active" ? "var(--ink-color-global-text-default)" : "var(--ink-color-global-text-subtle)" }}>
          <span style={stage === "active" ? { animation: "pa-spin 1s linear infinite", lineHeight: 0 } : { lineHeight: 0 }}>
            <RefreshIcon size={13} strokeWidth={2} />
          </span>
        </button>
      ))}
    </div>
  );
}

/** Topbar Update-data button: the icon reflects the refresh state and clicking it opens a
 *  popover listing each dataset's freshness with a per-dataset (and a Refresh-all) button.
 *  The refresh lifecycle lives in useRefresh(); freshness comes from data.source.datasets. */
export default function UpdateDataButton({ datasets = [], builtAt, variant }) {
  const [open, setOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const ref = useRef(null);
  useDismissable(open, setOpen, ref);
  useNow();  // keep the per-dataset "Updated Xm ago" labels ticking while the popover is open
  const st = useRefresh();
  const { canRefresh, runRefresh, loadNewData } = st;
  const running = st.status === "running";
  const busy = running || st.status === "applying";
  const inSidebar = variant === "sidebar";
  const visual = REFRESH_VISUAL[st.status] || REFRESH_VISUAL.idle;
  const rows = datasets.length ? datasets
    : [];  // no datasets stamped (older cache) -> panel shows the ask-Claude fallback only

  const onRefresh = (keys) => { trackClick("PortfolioAnalytics.UpdateData.Open"); runRefresh(keys); };
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
              <button onClick={st.retry === "apply" ? loadNewData : () => onRefresh()}
                style={{ ...primaryBtn, display: "block", width: "100%", textAlign: "center", marginTop: 12 }}>Try again</button>
            </div>
          ) : st.status === "applying" ? (
            <div data-testid="update-applying">
              <StatusHeader tone="warning" Icon={RefreshIcon} spin>Loading new data…</StatusHeader>
              <div style={{ ...subtle, marginTop: 8 }}>Applying the fresh data and rebuilding your dashboard…</div>
            </div>
          ) : st.status === "fetched" ? (
            <div data-testid="update-ready">
              <div style={subtle}>New Carta data is ready — load it to apply the latest figures across every view.</div>
              {(st.warnings || []).length > 0 && (
                <>
                  <div style={{ ...subtle, marginTop: 8, color: TONE.warning.fg, fontWeight: 600 }}>Some data didn’t refresh:</div>
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                    {st.warnings.map((w, i) => (
                      <li key={i} style={{ ...subtle, color: "var(--ink-color-global-text-default)" }}>{w}</li>
                    ))}
                  </ul>
                </>
              )}
              <button onClick={loadNewData} data-testid="update-load"
                style={{ ...primaryBtn, display: "block", width: "100%", textAlign: "center", marginTop: 12 }}>Load new data</button>
            </div>
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
                {rows.map((ds) => (
                  <DatasetRow key={ds.key} ds={ds} running={busy} stage={datasetStage(ds, st)}
                    progress={st.progress} canRefresh={canRefresh} onRefresh={onRefresh} />
                ))}
              </div>
              {canRefresh && (
                <button onClick={() => onRefresh()} disabled={busy} data-testid="update-all"
                  style={{ ...primaryBtn, display: "block", width: "100%", textAlign: "center", marginTop: 12,
                    opacity: busy ? 0.5 : 1, cursor: busy ? "default" : "pointer" }}>
                  Refresh all
                </button>
              )}
            </>
          )}
        </div>
      )}
    </span>
  );
}
