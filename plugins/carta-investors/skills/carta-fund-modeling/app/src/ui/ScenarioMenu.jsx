// The sidebar's scenario switcher: a trigger naming the active scenario that opens a
// floating panel of scenario tiles to the right of the sidebar.

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { FS, inkNum, sans, MICRO, TILE_CONTROL, RADIO_SIZE } from "./theme.js";
import { FIRM_METRICS } from "./format.js";
import { Btn, H3, Bubble, ScenarioMarker, VsBaseline, RadioGlyph, ChevronIcon, ActionMenu, POPOVER_SHADOW, ddTriggerStyle, useDismissable } from "./components.jsx";
import { isShared } from "../model/slices.js";
import { computeFundStates } from "../model/funds.js";
import { scenarioFirmFigures } from "../model/report.js";
import { trackClick } from "../analytics.js";

const TILE_PAD_X = 16, TILE_PAD_Y = 14;
const TILE_STYLE = { ...sans, display: "flex", flexDirection: "column", gap: 6, textAlign: "left", width: "100%",
  padding: `${TILE_PAD_Y}px ${TILE_PAD_X}px 12px`, cursor: "pointer", color: "var(--ink-color-global-text-default)" };
// Baseline's lock or the scenario's colour dot hangs in a wider left margin, so the
// name lines up with the labels and figures below it.
const MARKER_W = 12, MARKER_GAP = 8;
export const SCENARIO_TILE_STYLE = { ...TILE_STYLE, position: "relative", gap: 0, paddingLeft: TILE_PAD_X + MARKER_W + MARKER_GAP };
// The radio sits in the top right corner, centred on the title row; the ⋯ button
// sits to its left.
const RADIO_GAP = 6;
const RADIO_POS = { top: TILE_PAD_Y + (TILE_CONTROL - RADIO_SIZE) / 2, right: TILE_PAD_X };
const KEBAB_RIGHT = TILE_PAD_X + RADIO_SIZE + RADIO_GAP;
const SUBTLE = "var(--ink-color-global-text-subtle)";
// FIRM_METRICS stack under the name as label | figure | move rows: labels at the left,
// figures and moves at the right edge, the moves in one column so their carets line up.
const FIGURE_ROWS = { display: "grid", gridTemplateColumns: "1fr auto auto", columnGap: 8, alignItems: "baseline",
  marginTop: 6, whiteSpace: "nowrap", fontSize: FS.bodyLg, lineHeight: "20px" };

const KebabIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" />
  </svg>
);

/** A tile's vertical "⋯" menu of actions on its scenario. Hangs in the tile's top
 *  right, outside the tile's button. */
function TileActions({ name, actions }) {
  return (
    <ActionMenu items={actions} minWidth={180} style={{ position: "absolute", top: TILE_PAD_Y, right: KEBAB_RIGHT }}
      trigger={(p) => (
        <button type="button" className="tile-kebab" aria-label={`Actions for ${name}`} data-testid="tile-actions" {...p}>
          <KebabIcon />
        </button>
      )} />
  );
}

/** A tile's name row over its FIRM_METRICS rows, for any card laid out in
 *  SCENARIO_TILE_STYLE. `reserveRight` keeps the name clear of controls in the corner. */
export function TileContent({ slice, firm, reserveRight = 0 }) {
  // never sum across currencies — a mixed-currency firm has no combined figures
  const mixed = firm.mixedCurrency;
  const rows = FIRM_METRICS.map((m) =>
    ({ label: m.label, value: m.d.fmt(firm[m.key]), delta: firm[`${m.key}Delta`], d: m.d }));
  return (
    <>
      <span style={{ display: "flex", alignItems: "center", gap: MARKER_GAP, minWidth: 0, minHeight: TILE_CONTROL, paddingRight: reserveRight }}>
        {/* Baseline's lock, or the scenario's own colour, as in the sidebar's list */}
        <span className="tile-marker" aria-hidden style={{ width: MARKER_W, marginLeft: -(MARKER_W + MARKER_GAP), flex: "none",
          display: "inline-flex", justifyContent: "center", color: MICRO }}>
          <ScenarioMarker slice={slice} />
        </span>
        <span style={{ fontSize: FS.value, lineHeight: "20px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{slice.name}</span>
        {isShared(slice) && <Bubble variant="info" style={{ flex: "none" }}>Shared</Bubble>}
      </span>
      <span style={FIGURE_ROWS}>
        {rows.map((r) => (
          <span key={r.label} className="tile-figure" style={{ display: "contents" }}>
            <span style={{ color: SUBTLE }}>{r.label}</span>
            <span style={{ ...inkNum, fontWeight: 600, justifySelf: "end" }}>{mixed ? "—" : r.value}</span>
            {/* the move vs Baseline, when the scenario's marks changed this figure */}
            <span>{!mixed && <VsBaseline delta={r.delta} {...r.d} />}</span>
          </span>
        ))}
      </span>
    </>
  );
}

function ScenarioTile({ slice, firm, active, onPick, actions }) {
  const tile = (
    <button type="button" className={`card scenario-tile${active ? " is-active" : ""}`} data-testid={`scenario-tile-${slice.id}`} aria-pressed={active}
      title={active ? undefined : `Switch to ${slice.name}`}
      onClick={() => { trackClick("FundModeling.ScenarioMenu.PickScenario"); onPick(slice.id); }}
      style={SCENARIO_TILE_STYLE}>
      <TileContent slice={slice} firm={firm} reserveRight={RADIO_SIZE + RADIO_GAP + (actions ? TILE_CONTROL + RADIO_GAP : 0)} />
      {/* aria-pressed already tells assistive tech which tile is active */}
      <RadioGlyph checked={active} style={{ position: "absolute", ...RADIO_POS }} />
    </button>
  );
  if (!actions) return tile;
  return (
    <div className="scenario-tile-wrap" style={{ position: "relative", display: "flex" }}>
      {tile}
      <TileActions name={slice.name} actions={actions} />
    </div>
  );
}

/** Scenarios as tiles in the order given (scenariosInTileOrder: Baseline, own, shared),
 *  ending in an add tile when there is an `onNew`: rows of TILE_COLUMNS, or `stacked` in
 *  one column (the sidebar menu's panel). Clicking a tile switches the whole app
 *  to that scenario. Each tile's figures come from its raw slice, as the active
 *  scenario's fundStates do, so the active tile ties out to the Companies sidebar's Firm impact; they are
 *  computed here, so only while tiles are on screen. */
export function ScenarioTiles({ slices, snapshot, activeSliceId, onPick, onNew, onRename, onPublish, onDelete, publishBusy, stacked = false }) {
  const scenarios = useMemo(
    () => slices.map((s) => ({ slice: s, firm: scenarioFirmFigures(computeFundStates(snapshot, s)) })),
    [slices, snapshot]);
  // Baseline is locked: nothing to rename, publish or delete. A shared scenario's
  // actions (Update, Duplicate, Hide, …) stay in the top bar while it is active.
  const actionsFor = (slice) => slice.locked || isShared(slice) ? null : [
    { label: "Rename", onSelect: () => { trackClick("FundModeling.ScenarioMenu.Rename"); onRename(slice); } },
    onPublish && { label: "Publish", disabled: publishBusy, onSelect: () => { trackClick("FundModeling.ScenarioMenu.Publish"); onPublish(slice); } },
    { label: "Delete scenario", danger: true, onSelect: () => { trackClick("FundModeling.ScenarioMenu.Delete"); onDelete(slice); } },
  ].filter(Boolean);
  return (
    <div className={`scenario-tiles${stacked ? " is-stacked" : ""}`}>
      {scenarios.map(({ slice, firm }) => (
        <ScenarioTile key={slice.id} slice={slice} firm={firm}
          active={slice.id === activeSliceId} onPick={onPick} actions={actionsFor(slice)} />
      ))}
      {/* the grid without an add tile is a section of scenarios you can't add to */}
      {onNew && (
        <button type="button" className="scenario-tile is-add" data-testid="scenario-tile-add"
        onClick={() => { trackClick("FundModeling.ScenarioMenu.AddScenario"); onNew(); }}
        style={{ ...TILE_STYLE, alignItems: "center", justifyContent: "center",
          color: "var(--ink-button-background-color-primary-base-default)" }}>
          <span aria-hidden style={{ fontSize: 40, fontWeight: 300, lineHeight: 1 }}>+</span>
          <span style={{ fontSize: FS.bodyLg, fontWeight: 600 }}>Add new scenario</span>
        </button>
      )}
    </div>
  );
}

// Besides Baseline, the menu's panel shows this many scenarios: the ones viewed most
// recently. Its "View all" link opens the Scenarios page with every one.
export const MENU_RECENT_COUNT = 3;

/** The scenarios the menu shows: Baseline, then the MENU_RECENT_COUNT others viewed most
 *  recently (`recentIds`, newest first), topped up in tile order when fewer were viewed. */
export function menuScenarios(slices, recentIds, count = MENU_RECENT_COUNT) {
  const others = slices.filter((s) => !s.locked);
  const viewed = recentIds.map((id) => others.find((s) => s.id === id)).filter(Boolean);
  return [...slices.filter((s) => s.locked), ...[...new Set([...viewed, ...others])].slice(0, count)];
}

// The floating panel: PANEL_OFFSET from the trigger's right edge clears the sidebar's
// padding and border; it is PANEL_W wide (one column of tiles), and keeps PANEL_MARGIN
// from the window's right and bottom edges.
const PANEL_OFFSET = 18, PANEL_W = 380, PANEL_MARGIN = 16;
// The trigger fills the sidebar's width and, at shadcn's large sidebar-button height,
// holds its two lines.
const TRIGGER_STYLE = { width: "100%", height: 48, padding: "6px 12px" };

/** The Scenario switcher at the top of the sidebar: a trigger that opens the scenario tiles in a floating
 *  panel beside it, to the right of the sidebar. Picking a tile switches the scenario and leaves
 *  the panel open, so the page under it updates while you compare; the tiles (Baseline
 *  and the scenarios viewed most recently, see menuScenarios) stay the set the panel
 *  opened with, so the scenario you left is still there. Adding a
 *  scenario, choosing a tile action or following "View all" closes it; so do
 *  Escape and a click outside. */
export default function ScenarioMenu({ slices, snapshot, activeSliceId, activeName, recentIds = [], onPick, onNew, onRename, onPublish, onDelete, publishBusy, onShowAll }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  useDismissable(open, setOpen, [triggerRef, panelRef]);
  // The panel's tiles are picked when it opens and hold while it stays open: a pick
  // reorders the recently viewed list, and the tile you left should stay put.
  const [openedWith, setOpenedWith] = useState([]);
  const shown = useMemo(() => openedWith.map((id) => slices.find((s) => s.id === id)).filter(Boolean), [openedWith, slices]);
  // The panel floats beside the trigger, fixed to the window: the sidebar scrolls its
  // own overflow, which would clip anything hanging out of it. Measured before paint.
  const [anchor, setAnchor] = useState(null);
  useLayoutEffect(() => {
    if (!open) return;
    const r = triggerRef.current.getBoundingClientRect();
    setAnchor({ top: r.top, left: r.right + PANEL_OFFSET });
  }, [open]);
  const toggle = () => {
    if (!open) { trackClick("FundModeling.ScenarioMenu.Open"); setOpenedWith(menuScenarios(slices, recentIds).map((s) => s.id)); }
    setOpen((o) => !o);
  };
  return (
    <>
      <button ref={triggerRef} type="button" onClick={toggle} data-testid="scenario-menu-trigger"
        aria-haspopup="dialog" aria-expanded={open} aria-controls="scenario-menu"
        className={`dd-trigger${open ? " is-open" : ""}`} style={ddTriggerStyle(TRIGGER_STYLE)}>
        {/* two lines, as shadcn's sidebar switcher: a small label over the scenario's name */}
        <span style={{ display: "flex", flexDirection: "column", minWidth: 0, textAlign: "left" }}>
          <span style={{ fontSize: FS.body, lineHeight: "16px", fontWeight: 400, color: "var(--ink-color-global-text-subtle)" }}>Scenario</span>
          <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activeName}</span>
        </span>
        {/* points the way the panel opens */}
        <ChevronIcon size={16} strokeWidth={1.5} style={{ flex: "none" }} />
      </button>
      {open && (
        <div ref={panelRef} id="scenario-menu" role="dialog" aria-label="Scenarios" className="popin" data-testid="scenario-menu"
          style={{ position: "fixed", zIndex: 30, top: anchor?.top ?? 0, left: anchor?.left ?? 0,
            width: anchor ? `min(${PANEL_W}px, calc(100vw - ${anchor.left + PANEL_MARGIN}px))` : undefined,
            maxHeight: anchor ? `calc(100vh - ${anchor.top + PANEL_MARGIN}px)` : undefined,
            visibility: anchor ? undefined : "hidden", boxSizing: "border-box", padding: "20px 24px 24px", overflowY: "auto",
            background: "var(--ink-color-global-surface-background-default)", border: "1px solid var(--ink-color-global-border-subtle)", borderRadius: 6,
            boxShadow: POPOVER_SHADOW, transformOrigin: "top left" }}>
          {/* headed like a dashboard card: title, then "View all →" to the Scenarios page */}
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12 }}>
            <H3>Scenarios</H3>
            <span style={{ flex: 1 }} />
            <Btn kind="link" data-testid="scenario-menu-show-all"
              onClick={() => { trackClick("FundModeling.ScenarioMenu.ShowAll"); setOpen(false); onShowAll(); }}>
              View all →
            </Btn>
          </div>
          <ScenarioTiles stacked slices={shown} snapshot={snapshot} activeSliceId={activeSliceId}
            onPick={onPick}
            onNew={() => { setOpen(false); onNew(); }}
            onRename={(s) => { setOpen(false); onRename(s); }}
            onPublish={onPublish && ((s) => { setOpen(false); onPublish(s); })}
            onDelete={(s) => { setOpen(false); onDelete(s); }} publishBusy={publishBusy} />
        </div>
      )}
    </>
  );
}
