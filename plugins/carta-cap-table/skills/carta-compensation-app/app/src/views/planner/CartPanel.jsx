// The cart — who this refresh cycle is for.
//
// Sits beside the table rather than under it, so the count stays on screen while
// the user scrolls a long roster. That is the whole point of it: the number is
// the plan, and it should never be somewhere you have to go looking for.

import { C, FS, RADIUS } from "../../ui/theme.js";
import ExportButton from "../../ui/ExportButton.jsx";
import { Tag } from "../../ui/components.jsx";

/** Unsaved change since the last save, as a chip. Absent when nothing changed.
 *
 *  Both directions are shown — "2 added · 1 removed" rather than a net "+1",
 *  because those are different edits and the net hides one of them.
 */
function DiffChip({ added, removed }) {
  if (!added && !removed) return null;
  const parts = [];
  if (added) parts.push(`${added} added`);
  if (removed) parts.push(`${removed} removed`);
  return (
    <Tag tone="notice" title="Unsaved change since this cart was last written to disk.">
      {parts.join(" · ")}
    </Tag>
  );
}

export default function CartPanel({
  rows, total, added, removed, hidden, dropped, saving, conflict, onExport, onClearHidden,
  onNext,
}) {
  return (
    <aside style={{
      background: C.surface, border: `1px solid ${C.border}`, borderRadius: RADIUS,
      alignSelf: "start", position: "sticky", top: 16, maxHeight: "calc(100vh - 32px)",
      display: "flex", flexDirection: "column", minWidth: 0,
    }}>
      <div style={{ padding: "14px 16px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{
          display: "flex", alignItems: "baseline", justifyContent: "space-between",
          gap: 10, flexWrap: "wrap",
        }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{
              fontSize: FS.xxl, fontWeight: 400, color: C.text,
              fontVariantNumeric: "tabular-nums",
            }}>
              {total}
            </span>
            <span style={{
              fontSize: FS.xs, color: C.textQuiet, textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}>
              in cart
            </span>
          </div>
          <DiffChip added={added} removed={removed} />
        </div>

        {/* The way forward. Disabled at zero with a reason rather than hidden —
            a button that appears once you have selected someone is harder to find
            than one that is visibly waiting. */}
        <button
          type="button"
          onClick={onNext}
          disabled={!total}
          title={total ? "Set the refresh grant policy for these employees"
                       : "Select at least one employee first"}
          style={{
            width: "100%", height: 40, marginTop: 10, fontSize: FS.md, fontWeight: 500,
            fontFamily: "inherit", borderRadius: RADIUS, cursor: total ? "pointer" : "not-allowed",
            color: total ? C.onPrimary : C.textQuiet,
            background: total ? C.interactivePrimary : C.surfaceUnderlay,
            border: `1px solid ${total ? C.interactivePrimary : C.borderDefault}`,
          }}
        >
          Next →
        </button>

        <div style={{ marginTop: 10 }}>
          <ExportButton
            onExport={onExport}
            title="Download the cart as CSV — the employees in this refresh cycle"
            disabled={!total}
          />
        </div>

        {/* A cart of 12 beside 9 ticked rows reads as a bug. Say it, and offer the
            way back — clearing the filters is what the user actually wants. */}
        {hidden > 0 && (
          <div style={{ marginTop: 10, fontSize: FS.sm, color: C.textSubtle, lineHeight: 1.5 }}>
            {hidden} {hidden === 1 ? "is" : "are"} hidden by the current filters.{" "}
            <button
              type="button"
              onClick={onClearHidden}
              style={{
                background: "none", border: "none", padding: 0, font: "inherit",
                color: C.linkDefault, cursor: "pointer", textDecoration: "underline",
              }}
            >
              Show {hidden === 1 ? "it" : "them"}
            </button>
          </div>
        )}

        {/* A rebuild can retire someone who was in the cart. Dropping them quietly
            would shrink a plan without telling anyone. */}
        {dropped > 0 && (
          <div style={{ marginTop: 10, fontSize: FS.sm, color: C.feedbackNotice, lineHeight: 1.5 }}>
            {dropped} previously selected {dropped === 1 ? "employee is" : "employees are"} no
            longer in this snapshot and {dropped === 1 ? "was" : "were"} removed.
          </div>
        )}

        {conflict && (
          <div style={{ marginTop: 10, fontSize: FS.sm, color: C.feedbackNotice, lineHeight: 1.5 }}>
            Another tab changed this cart. Reload to pick up its version — this one is
            not being saved.
          </div>
        )}

        {saving && !conflict && (
          <div style={{ marginTop: 10, fontSize: FS.xs, color: C.textQuiet }}>Saving…</div>
        )}
      </div>

      <div style={{ overflowY: "auto", padding: "8px 0" }}>
        {!total && (
          <div style={{ padding: "12px 16px", fontSize: FS.sm, color: C.textQuiet, lineHeight: 1.55 }}>
            Nothing selected yet. Tick an employee to add them to this cycle.
          </div>
        )}
        {rows.map((r) => (
          <div
            key={r.external_id}
            style={{
              padding: "5px 16px", fontSize: FS.md, color: C.textDefault,
              display: "flex", gap: 8, alignItems: "baseline",
            }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {r.full_name || r.external_id.slice(0, 8)}
            </span>
            {r.job_level && (
              <span style={{ fontSize: FS.xs, color: C.textQuiet, flex: "0 0 auto" }}>
                · {r.job_level}
              </span>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}
