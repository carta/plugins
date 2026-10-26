import { useState, useRef } from "react";
import { RefreshIcon, CheckCircleIcon, AlertCircleIcon, useDismissable } from "./components.jsx";
import { FS, sans } from "./theme.js";
import useRefresh from "../state/useRefresh.js";
import useFirmReload from "../state/useFirmReload.js";
import { CONNECTING_STEP } from "../state/firmLoad.js";

const btnStyle = {
  ...sans, fontSize: FS.small, fontWeight: 650, cursor: "pointer",
  background: "var(--accent-soft)", color: "var(--ink-color-global-text-default)",
  border: "none", borderRadius: 4, padding: "7px 12px",
};

function fmtElapsed(s) {
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

// Fetch phases map to a filling checklist (so instant sub-steps don't flash as rows); the
// build is a separate click-triggered step, not shown here. The phase strings are refresh.py's
// emit() contract (preflight/enumerate/fetch/build/issue) — a rename there must land here too.
const REFRESH_STEPS = [
  { label: "Finding your funds", phases: ["preflight", "enumerate"] },
  { label: "Fetching fund data", phases: ["fetch"] },
];
function phaseStepIndex(phase) {
  const i = REFRESH_STEPS.findIndex((s) => s.phases.includes(phase));
  return i < 0 ? 0 : i;
}
// prefers-reduced-motion kills all CSS animation, so a static dot (not a spinner ring).
function StepDot({ state }) {
  if (state === "done") return <span style={{ color: "var(--ink-color-global-text-default)" }}>✓</span>;
  const active = state === "active";
  return <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%",
    background: active ? "var(--ink-color-global-text-default)" : "transparent",
    border: active ? "none" : "1.5px solid var(--ink-color-global-border-subtle)" }} />;
}

// The icon itself is the state signal: idle=refresh, running/applying=spin, fetched=check, error=alert.
const REFRESH_VISUAL = {
  idle:     { Icon: RefreshIcon,     spin: false, color: "var(--ink-color-global-text-subtle)",              title: "Update Carta data" },
  running:  { Icon: RefreshIcon,     spin: true,  color: "var(--ink-color-global-text-default)",             title: "Fetching Carta data…" },
  fetched:  { Icon: CheckCircleIcon, spin: false, color: "var(--ink-color-global-feedback-positive-strong)", title: "New Carta data ready — load it" },
  applying: { Icon: RefreshIcon,     spin: true,  color: "var(--ink-color-global-text-default)",             title: "Loading new data…" },
  error:    { Icon: AlertCircleIcon, spin: false, color: "var(--ink-color-global-feedback-negative-strong)", title: "Update didn’t finish" },
};

/** The topbar button and popover frame both Update-data flows share. */
function UpdateDataShell({ status, visual, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useDismissable(open, setOpen, ref);
  return (
    <span ref={ref} style={{ position: "relative", lineHeight: 0 }}>
      <button onClick={() => setOpen((o) => !o)} data-testid="update-data" aria-expanded={open}
        data-state={status} title={visual.title} aria-label={visual.title}
        style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 40, height: 40,
          border: `1px solid var(--ink-color-global-border-subtle)`, borderRadius: 4, background: "var(--ink-color-global-surface-background-default)", color: visual.color, cursor: "pointer", lineHeight: 0 }}>
        <span style={visual.spin ? { animation: "fm-spin 1s linear infinite", lineHeight: 0 } : { lineHeight: 0 }}>
          <visual.Icon size={16} strokeWidth={2} />
        </span>
      </button>
      {open && (
        <div className="popin" data-testid="update-popover" style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", width: 300, lineHeight: 1.5,
          background: "var(--ink-color-global-surface-background-default)", border: `1px solid var(--ink-color-global-border-subtle)`, borderRadius: 8, padding: "14px 15px",
          boxShadow: "var(--shadow-hover)", zIndex: 40 }}>
          {children}
        </div>
      )}
    </span>
  );
}

const headingStyle = { ...sans, fontSize: FS.body, fontWeight: 650, color: "var(--ink-color-global-text-default)" };
const noteStyle = { ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", lineHeight: 1.5, marginTop: 6 };

const RELOAD_VISUAL = {
  idle:    REFRESH_VISUAL.idle,
  tooSoon: REFRESH_VISUAL.idle,
  running: { ...REFRESH_VISUAL.running, title: "Reloading from Carta…" },
  error:   REFRESH_VISUAL.error,
};

const waitText = (seconds) => {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
};

// Hosted: one forced firm load that reloads the page when it is done.
function ReloadFirmButton({ firm }) {
  const st = useFirmReload(firm);
  return (
    <UpdateDataShell status={st.status} visual={RELOAD_VISUAL[st.status]}>
      {st.status === "running" ? (
        <div data-testid="update-progress">
          <div style={headingStyle}>Reloading from Carta…</div>
          <div style={noteStyle}>{st.step || CONNECTING_STEP}</div>
          <div style={{ ...noteStyle, fontSize: FS.micro, marginTop: 13 }}>Keep this page open. It reloads when the new data is ready.</div>
        </div>
      ) : st.status === "tooSoon" ? (
        <div data-testid="update-too-soon">
          <div style={headingStyle}>Updated a few minutes ago</div>
          <div style={noteStyle}>Your Carta data was refreshed recently. You can update it again in {waitText(st.retryAfter)}.</div>
          <button onClick={st.reloadFirm} data-testid="update-now" style={{ ...btnStyle, marginTop: 12 }}>Update now</button>
        </div>
      ) : st.status === "error" ? (
        <div data-testid="update-error">
          <div style={headingStyle}>Update didn’t finish</div>
          <div style={{ ...noteStyle, wordBreak: "break-word" }}>{st.message}</div>
          <div style={noteStyle}>Your current data is unchanged.</div>
          <button onClick={st.reloadFirm} style={{ ...btnStyle, marginTop: 11 }}>Try again</button>
        </div>
      ) : (
        <div>
          <div style={headingStyle}>Update Carta data</div>
          <div style={noteStyle}>Reloads this firm from Carta, which takes about 30 seconds. Your scenarios are kept.</div>
          <button onClick={st.reloadFirm} data-testid="update-now" style={{ ...btnStyle, marginTop: 12 }}>Update now</button>
        </div>
      )}
    </UpdateDataShell>
  );
}

/** Local: the icon reflects the refresh state and clicking it opens a popover with the live
 *  checklist, the "Load new data" action, or the error. The refresh lifecycle lives in useRefresh(). */
function RefreshButton() {
  const st = useRefresh();
  const { elapsed, runRefresh, loadNewData } = st;
  const running = st.status === "running";
  const activeIdx = phaseStepIndex(st.phase);
  const visual = REFRESH_VISUAL[st.status] || REFRESH_VISUAL.idle;
  return (
    <UpdateDataShell status={st.status} visual={visual}>
      {running ? (
        <div data-testid="update-progress">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={headingStyle}>Fetching Carta data…</span>
            <span style={{ ...sans, fontVariantNumeric: "tabular-nums", fontSize: FS.small, color: "var(--ink-color-global-text-subtle)" }}>{fmtElapsed(elapsed)}</span>
          </div>
          <div style={{ marginTop: 12, borderTop: "1px solid var(--ink-color-global-border-subtle)", paddingTop: 11 }}>
            {REFRESH_STEPS.map((s, i) => {
              const state = i < activeIdx ? "done" : i === activeIdx ? "active" : "pending";
              const label = (s.phases[0] === "fetch" && st.fetchTotal)
                ? `${s.label} (${st.fetchStep} of ${st.fetchTotal})` : s.label;
              return (
                <div key={i} style={{ ...sans, display: "flex", alignItems: "center", gap: 9, fontSize: FS.small, lineHeight: 1.9,
                  color: state === "pending" ? "var(--ink-color-global-text-subtle)" : "var(--ink-color-global-text-default)",
                  fontWeight: state === "active" ? 650 : 400 }}>
                  <span style={{ width: 12, display: "inline-flex", justifyContent: "center", lineHeight: 0 }}><StepDot state={state} /></span>
                  {label}
                </div>
              );
            })}
          </div>
          <div style={{ ...sans, fontSize: FS.micro, lineHeight: 1.5, color: "var(--ink-color-global-text-subtle)", marginTop: 13 }}>Runs in the background — keep working. Your edits are kept; you’ll load the new data when it’s ready.</div>
        </div>
      ) : st.status === "fetched" ? (
        <div data-testid="update-ready">
          <div style={headingStyle}>New Carta data ready</div>
          <div style={noteStyle}>Load it to apply the latest holdings, valuations, and financials. Your scenarios — including edits you’ve just made — are kept.</div>
          {st.warnings.length > 0 && (
            <>
              <div style={{ ...noteStyle, marginTop: 8 }}>Some data didn’t load:</div>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {st.warnings.map((w, i) => (
                  <li key={i} style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-default)", lineHeight: 1.5 }}>{w}</li>
                ))}
              </ul>
            </>
          )}
          <button onClick={loadNewData} data-testid="update-load" style={{ ...btnStyle, marginTop: 12 }}>Load new data</button>
        </div>
      ) : st.status === "applying" ? (
        <div data-testid="update-applying">
          <div style={headingStyle}>Loading new data…</div>
          <div style={noteStyle}>Applying the fresh data and reconciling your scenarios. This takes a moment.</div>
        </div>
      ) : st.status === "error" ? (
        <div data-testid="update-error">
          <div style={headingStyle}>Update didn’t finish</div>
          <div style={{ ...noteStyle, wordBreak: "break-word" }}>{st.message}</div>
          {st.needsHuman && (
            <div style={{ ...noteStyle, marginTop: 8 }}>
              You can also ask Claude: <span style={{ fontWeight: 650, color: "var(--ink-color-global-text-default)" }}>“Refresh Carta holdings”</span>.
            </div>
          )}
          <button onClick={st.retry === "apply" ? loadNewData : runRefresh} style={{ ...btnStyle, marginTop: 11 }}>Try again</button>
        </div>
      ) : (
        <div>
          <div style={headingStyle}>Update Carta data</div>
          <div style={noteStyle}>
            Pull the latest holdings, valuations, and financials from Fund Admin. Runs in the background — keep working while it updates. Your scenarios are kept.
          </div>
          <button onClick={runRefresh} data-testid="update-now" style={{ ...btnStyle, marginTop: 12 }}>Update now</button>
        </div>
      )}
    </UpdateDataShell>
  );
}

/** Topbar Update-data button: hosted reloads the firm in one step; local runs useRefresh()'s
 *  fetch-then-load flow. */
export default function UpdateDataButton({ features, firm }) {
  return features.reloadFirm ? <ReloadFirmButton firm={firm} /> : <RefreshButton />;
}
