import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { sans, INK, PAPER, LINE, EASE_OUT } from "../ui/theme.js";
import { H2 } from "../ui/components.jsx";
import DrilldownContent from "./drilldown/DrilldownContent.jsx";
import { selectionTitle } from "./drilldown/util.js";
import { trackClick, trackRender } from "../analytics.js";

// Non-modal ("inspector") drawer for journal-entry drill-downs. The drawer
// sits fixed on the right side; the main page stays interactive so the user
// can click a different chart segment to swap the drawer's content
// without closing it first. ESC or × explicitly closes.
//
// Portaled to document.body so it escapes any overflow-x scroll container.
// Explicit sans font styling on the drawer root per the skill's
// font-inheritance gotcha (portaled content doesn't inherit App's inline
// font-family).
// Selection kind -> the name its id carries. An unmapped kind buckets as Other
// rather than vanishing.
const DRILL_NAMES = {
  "account": "Account", "vendor": "Vendor", "date-range-category": "DateRangeCategory",
  "month-side": "MonthSide", "fund-year": "FundYear",
  "department-account": "DepartmentAccount", "outline-cell": "OutlineCell",
  "outline-total": "OutlineTotal",
};

export default function DrilldownDrawer({ selection, onClose, entries, fundFeeEntries, feeScheduleTerms, spendByGL, buildJournalUrl, topCategoryNames, asOf, onDrillAccountForMonth }) {
  const open = !!selection;
  const drawerRef = useRef(null);

  // Keyed on the selection, not on `open`: useDrilldown hands over a new object per
  // drill, so a swap that leaves the drawer open still counts.
  useEffect(() => {
    if (selection) {
      trackRender(`MancoReporting.Drilldown.Open.${DRILL_NAMES[selection.kind] || "Other"}`);
    }
  }, [selection]);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        trackClick("MancoReporting.Drilldown.Close");
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Click outside closes the drawer, except on things that open a drill.
  // Closing on mousedown and re-opening on the follow-up click survives a
  // list row but not a chart: the close rebuilds the chart, and the click
  // that should select the next bar lands in the gap.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e) => {
      if (!drawerRef.current || drawerRef.current.contains(e.target)) return;
      // [data-drawer-popover]: a portaled popover (e.g. the tag filter panel)
      // renders outside drawerRef's own DOM subtree.
      if (e.target.closest?.("canvas, [data-drill-source], [data-drawer-popover]")) return;
      trackClick("MancoReporting.Drilldown.Close");
      onClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, onClose]);

  // data-overlay-right is read by the charts' tooltip placement: this panel
  // is fixed over the right of the page, so a tooltip clamped only to its
  // own plot can land underneath it. See placeTip in ui/components.jsx.
  return createPortal(
    <aside
      ref={drawerRef}
      style={{
        ...sans,
        ...S.drawer,
        transform: open ? "translateX(0)" : "translateX(100%)",
        pointerEvents: open ? "auto" : "none",
      }}
      role="dialog"
      data-overlay-right=""
      aria-label="Journal-entry drill-down"
      aria-hidden={!open}
    >
      <header style={S.header}>
        {open && (
          <div style={S.headerTitle}>
            <H2>{selectionTitle(selection)}</H2>
          </div>
        )}
        {/* Borderless icon button, matching Visual Accounting's drawer close
            affordance (GeneralHeader's CloseButton) — no chrome, just the
            glyph. Global focus-visible ring (theme.js's GLOBAL_CSS) still
            applies to a plain <button>. */}
        <button type="button" aria-label="Close" onClick={() => { trackClick("MancoReporting.Drilldown.Close"); onClose(); }} style={S.closeBtn}>
          ×
        </button>
      </header>
      <div style={S.body}>
        {open && (
          <DrilldownContent
            selection={selection}
            entries={entries}
            fundFeeEntries={fundFeeEntries}
            feeScheduleTerms={feeScheduleTerms}
            spendByGL={spendByGL}
            buildJournalUrl={buildJournalUrl}
            topCategoryNames={topCategoryNames}
            asOf={asOf}
            onDrillAccountForMonth={onDrillAccountForMonth}
          />
        )}
      </div>
    </aside>,
    document.body
  );
}

const S = {
  drawer: {
    position: "fixed",
    top: 0, right: 0, bottom: 0,
    width: "min(560px, 92vw)",
    zIndex: 1000,
    background: PAPER,
    color: INK,
    borderLeft: `1px solid ${LINE}`,
    boxShadow: "-6px 0 26px -4px rgba(0, 16, 76, 0.10)",
    display: "flex",
    flexDirection: "column",
    transition: `transform 220ms ${EASE_OUT}`,
    // Body has overflow-y auto — don't also set overflow-x here or we'd steal
    // position: sticky per the skill's overflow-x gotcha.
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    padding: "16px 20px 12px",
    borderBottom: `1px solid ${LINE}`,
    flexShrink: 0,
  },
  headerTitle: {
    minWidth: 0,
  },
  closeBtn: {
    background: "transparent",
    border: "none",
    padding: "6px 10px",
    margin: 0,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    color: INK,
    fontSize: 20,
    lineHeight: 1,
    flexShrink: 0,
    alignSelf: "flex-start",
  },
  body: {
    // No bottom padding: DrilldownContent's sticky footer sits flush on
    // the bottom edge of this scroll area and carries its own.
    padding: "20px 20px 0",
    overflowY: "auto",
    // Stop scroll input from chaining into the page behind the drawer once
    // this reaches its own top/bottom — the drawer is non-modal by design.
    overscrollBehavior: "contain",
    flex: 1,
  },
};
