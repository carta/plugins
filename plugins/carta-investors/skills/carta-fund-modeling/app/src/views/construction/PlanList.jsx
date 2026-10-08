import { useMemo } from "react";
import { FS, sans, inkNum } from "../../ui/theme.js";
import { Badge, CheckCircleIcon } from "../../ui/components.jsx";
import { fmtMIn, fmtX } from "../../ui/format.js";
import { modeLabel, stepLabel } from "../../model/construction/plan.js";
import { simulate } from "../../model/construction/engine.js";
import { isComplete } from "../../model/construction/summary.js";

const subtle = "var(--ink-color-global-text-subtle)";

const edited = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

/** Simulated once per saved version of each plan. */
function usePlanResults(plans) {
  const key = plans.map((p) => `${p.id}@${p.updatedAt}`).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => Object.fromEntries(plans.map((p) => [p.id, simulate(p)])), [key]);
}

const CSS = `
.fc-plans { width: 100%; border-collapse: collapse; table-layout: fixed; }
.fc-plans th, .fc-plans td { padding: 14px 16px; vertical-align: middle; }
.fc-plans th:first-child, .fc-plans td:first-child { padding-left: 24px; }
.fc-plans th:last-child, .fc-plans td:last-child { padding-right: 24px; }
.fc-plans thead th { font-size: 12px; font-weight: 600; color: var(--ink-color-global-text-subtle); white-space: nowrap;
  padding-top: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--ink-color-global-border-default); }
.fc-plans tbody tr { border-bottom: 1px solid var(--ink-color-global-border-subtle); cursor: pointer; }
.fc-plans tbody tr:last-child { border-bottom: none; }
.fc-plans tbody tr:hover { background: var(--row-hover); }
.fc-plans-wrap { container-type: inline-size; }
.fc-plans .fc-link { font: inherit; font-size: 12px; padding: 0; border: 0; background: none; cursor: pointer; white-space: nowrap; }
.fc-plans .fc-link:hover { text-decoration: underline; }
@container (max-width: 640px) { .fc-plans .fc-edited { display: none; } }
.fc-plans tbody tr:focus-visible { outline: 2px solid var(--ink-color-global-border-focus-default); outline-offset: -2px; }
`;

/** Where a plan stands: finalized, finished but not finalized yet, or still being built. */
export const planStatus = (p) => (!isComplete(p) ? "progress" : p.finalizedAt ? "finalized" : "ready");

// Each status has an icon and words, so it never reads by color alone.
const ProgressIcon = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flex: "none" }}>
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.2" />
    <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
  </svg>
);
const ReadyIcon = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flex: "none" }}>
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.2" />
    <circle cx="12" cy="12" r="4" fill="currentColor" />
  </svg>
);
const STATUS = {
  finalized: { label: "Finalized", tone: "positive", Icon: ({ size }) => <CheckCircleIcon size={size} /> },
  ready: { label: "Ready to finalize", tone: "info", Icon: ReadyIcon },
  progress: { label: "In progress", tone: "warning", Icon: ProgressIcon },
};

export function StatusTag({ plan, testId }) {
  const st = planStatus(plan);
  const { label, tone, Icon } = STATUS[st];
  const title = st === "finalized" ? `Finalized ${edited(plan.finalizedAt)}` : st === "ready" ? "Every step is done. Open it and finalize from Summary." : "Some steps still need input.";
  return (
    <span data-testid={testId} data-status={st} title={title}>
      <Badge tone={tone} style={{ gap: 5, fontWeight: 600 }}><Icon size={12} />{label}</Badge>
    </span>
  );
}

export default function PlanList({ plans, onOpen, onDelete }) {
  const results = usePlanResults(plans);
  const rows = [...plans].sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
  const right = { textAlign: "right" };
  // Buttons inside a row act on their own, not as a click on the row.
  const own = (fn) => (e) => { e.stopPropagation(); fn(); };
  return (
    <div data-testid="plan-list">
      <style>{CSS}</style>
      <div data-testid="plan-counts" style={{ ...sans, fontSize: FS.small, color: subtle, margin: "0 0 10px 2px" }}>
        {plans.length} {plans.length === 1 ? "plan" : "plans"}
        {["finalized", "ready", "progress"].map((k) => {
          const n = plans.filter((p) => planStatus(p) === k).length;
          return n ? <span key={k}> · {n} {STATUS[k].label.toLowerCase()}</span> : null;
        })}
        {" "}· click a plan to open it
      </div>
      <div className="card fc-plans-wrap" style={{ padding: 0, overflowX: "auto" }}>
        <table className="fc-plans" style={{ minWidth: 520 }}>
          <colgroup>
            <col style={{ width: "25%" }} /><col style={{ width: "17%" }} /><col style={{ width: "11%" }} /><col style={{ width: "11%" }} />
            <col style={{ width: "10%" }} /><col style={{ width: "9%" }} /><col className="fc-edited" style={{ width: "12%" }} /><col style={{ width: 76 }} />
          </colgroup>
          <thead><tr>
            <th style={{ textAlign: "left" }}>Plan</th>
            <th style={{ textAlign: "left" }}>Status</th>
            <th style={{ textAlign: "left" }}>Type</th>
            <th style={right}>Fund size</th>
            <th style={right}>Gross MOIC</th>
            <th style={right}>Net TVPI</th>
            <th className="fc-edited" style={{ textAlign: "left", paddingLeft: 28 }}>Last edited</th>
            <th aria-label="Actions" />
          </tr></thead>
          <tbody>
            {rows.map((p) => {
              const r = results[p.id];
              const m = r?.ok ? r.metrics : null;
              const pending = !r?.ok && r?.blockedBy?.length ? `Finish ${r.blockedBy.map(stepLabel).join(", ")} to see returns` : undefined;
              const num = (v) => <span style={{ ...inkNum, color: m ? undefined : subtle }} title={pending}>{m ? fmtX(v) : "—"}</span>;
              return (
                <tr key={p.id} data-testid={`plan-row-${p.id}`} tabIndex={0} onClick={() => onOpen(p.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) onOpen(p.id); }} aria-label={`Open ${p.name}`}>
                  <td>
                    <button type="button" onClick={own(() => onOpen(p.id))} data-testid={`open-plan-${p.id}`}
                      style={{ ...sans, fontSize: FS.body, fontWeight: 600, padding: 0, border: 0, background: "none", cursor: "pointer",
                        color: "var(--ink-color-global-text-default)", textAlign: "left", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>
                      {p.name}
                    </button>
                    {(p.convertedFrom || p.copiedFrom || p.finalizedAt) && (
                      <div style={{ ...sans, fontSize: FS.micro, color: subtle, marginTop: 2 }}>
                        {[p.finalizedAt && planStatus(p) === "finalized" && `Finalized ${edited(p.finalizedAt)}`,
                          p.convertedFrom && `Converted from ${p.convertedFrom.name}`,
                          p.copiedFrom && `Copied from ${p.copiedFrom.name}`].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </td>
                  <td><StatusTag plan={p} testId={`plan-status-${p.id}`} /></td>
                  <td>
                    <Badge tone={p.mode === "light" ? "neutral" : "info"}>{modeLabel(p.mode)}</Badge>
                  </td>
                  <td style={{ ...inkNum, ...right }}>{p.general?.committed > 0 ? fmtMIn(p.general.committed, p.general.currency) : "—"}</td>
                  <td style={right} data-testid={`plan-moic-${p.id}`}>{num(m?.grossMoic)}</td>
                  <td style={right} data-testid={`plan-tvpi-${p.id}`}>{num(m?.tvpi)}</td>
                  <td className="fc-edited" style={{ ...sans, fontSize: FS.small, color: subtle, paddingLeft: 28, whiteSpace: "nowrap" }}>{edited(p.updatedAt)}</td>
                  <td style={{ textAlign: "right" }}>
                    <button type="button" className="fc-link" onClick={own(() => onDelete(p))} data-testid={`delete-plan-${p.id}`} title={`Delete ${p.name}`}
                      style={{ color: "var(--ink-color-global-feedback-negative-strong)" }}>Delete</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
