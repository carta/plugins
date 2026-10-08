import { FS, sans, inkNum } from "../../ui/theme.js";
import { InfoTip } from "../../ui/components.jsx";
import { stepLabel } from "../../model/construction/plan.js";
import { assumptions, assumptionSummary } from "../../model/construction/summary.js";

const subtle = "var(--ink-color-global-text-subtle)";

export const ASSUMPTIONS_CSS = `
.mv-edit { font: inherit; padding: 0; border: 0; background: none; cursor: pointer; text-align: left; color: inherit; width: 100%; }
.mv-edit:hover .mv-edit-go { text-decoration: underline; }
.mv-group summary { list-style: none; cursor: pointer; }
.mv-group summary::-webkit-details-marker { display: none; }
.mv-group .mv-caret { transition: transform .15s; display: inline-block; }
.mv-group[open] .mv-caret { transform: rotate(90deg); }
.mv-edit:focus-visible, .mv-group summary:focus-visible { outline: 2px solid var(--ink-color-global-border-focus-default); outline-offset: 2px; }
`;

export default function Assumptions({ plan, result, onEdit, className }) {
  const all = assumptions(plan, result);
  if (!all.length) return null;
  return (
    <aside className={className} data-testid="model-assumptions" aria-label="Assumptions">
      <style>{ASSUMPTIONS_CSS}</style>
      <div className="card" style={{ padding: "12px 14px" }}>
        <div style={{ ...sans, fontSize: FS.body, fontWeight: 600, display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
          Assumptions
          <InfoTip label="About assumptions" portal width={240}>
            Open a group to see each input. Click any of them to change it in the steps. The portfolio group is worked out from your market and strategy inputs and updates as you edit.
          </InfoTip>
        </div>
        {all.map((g) => {
          const editable = g.rows[0]?.step;
          return (
            <details key={g.id} className="mv-group" data-testid={`assume-group-${g.id}`} 
              style={{ borderTop: "1px solid var(--ink-color-global-border-subtle)", padding: "8px 0" }}>
              <summary data-testid={`assume-toggle-${g.id}`}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span className="mv-caret" aria-hidden="true" style={{ ...sans, fontSize: 10, color: subtle, width: 8 }}>▶</span>
                  <span style={{ ...sans, fontSize: FS.small, fontWeight: 700, flex: 1 }}>{g.title}</span>
                  {editable && (
                    <button type="button" className="mv-edit" data-testid={`edit-${g.id}`} style={{ width: "auto", ...sans, fontSize: FS.small, color: "var(--ink-color-global-link-default)" }}
                      onClick={(e) => { e.preventDefault(); onEdit(g.rows[0].step, g.rows[0].section); }}>Edit</button>
                  )}
                </div>
                <div data-testid={`assume-summary-${g.id}`} style={{ ...sans, fontSize: FS.micro, color: subtle, marginLeft: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {assumptionSummary(g)}
                </div>
              </summary>
              <div style={{ marginLeft: 14, marginTop: 6 }}>
                {g.rows.map((r) => {
                  // Long values (fee tiers, allocations) read better on their own line under the label.
                  const long = String(r.value).length > 20 || r.label.length + String(r.value).length > 26;
                  const slug = r.label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
                  const inner = (
                    <>
                      <span style={{ display: "block", color: subtle, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
                      <span className="mv-edit-go" style={{ ...inkNum, display: "block", textAlign: long ? "left" : "right" }}>{r.value}</span>
                    </>
                  );
                  const box = { display: long ? "block" : "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 8, padding: "2px 0", ...sans, fontSize: FS.small };
                  return r.step ? (
                    <button key={r.label} type="button" className="mv-edit" data-testid={`assume-${g.id}-${slug}`} title={`Change in ${stepLabel(r.step)}`}
                      onClick={() => onEdit(r.step, r.section)} style={box}>{inner}</button>
                  ) : (
                    <div key={r.label} data-testid={`assume-${g.id}-${slug}`} style={box}>{inner}</div>
                  );
                })}
              </div>
            </details>
          );
        })}
      </div>
    </aside>
  );
}
