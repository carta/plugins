import { useEffect, useId, useRef, useState } from "react";
import { sans, INK, PAPER, LINE, BORDER_DEFAULT, MICRO, FS } from "../ui/theme.js";
import { Btn, Tag, Bubble, Chevron, Dropdown, TOOLBAR_CONTROL_STYLE } from "../ui/components.jsx";
import {
  FREQUENCIES, COLUMN_TYPES, MONTH_NAME, canHide, filterChips,
  isDefaultFilters, rangePresets, detectPreset, normalizeRange, DEFAULT_FILTERS,
} from "./budgetPeriods.js";
import { groupBreakouts } from "./accountBreakout.js";
import { trackClick, trackRender } from "../analytics.js";

const COLUMN_LABEL = { actual: "actual", budget: "budget", variance: "variance" };

/** The toolbar over a Budget vs Actuals grid: how often to break the year
 *  up, which columns to show, and over what window. */
export default function BudgetPeriodControls({
  filters, onFilters, range, onRange, year, asOfMonth, frequencyEnabled = true,
  breakouts, breakoutKey, onBreakoutKey,
}) {
  // No memo: the whole toolbar is a handful of literals, and staying a plain
  // function keeps it callable from the unit tests.
  const presets = rangePresets(year, asOfMonth);
  const preset = detectPreset(range, presets);
  const chips = filterChips(filters);
  const dirty = !isDefaultFilters(filters);

  const setFrequency = (key) => {
    trackClick("MancoReporting.BudgetVsActuals.PeriodChange");
    onFilters({ ...filters, frequency: key });
  };

  const dismissChip = (id) => {
    if (id === "hidden") onFilters({ ...filters, hidden: [] });
    if (id === "showYtd") onFilters({ ...filters, showYtd: false });
  };

  return (
    <div style={S.bar}>
      {frequencyEnabled && (
        <Dropdown
          triggerLabel="Period"
          options={FREQUENCIES.map((f) => ({ id: f.key, label: f.label }))}
          value={filters.frequency}
          onChange={setFrequency}
        />
      )}

      <FiltersMenu filters={filters} onFilters={onFilters} ytdPane={frequencyEnabled}
                   breakouts={breakouts} breakoutKey={breakoutKey}
                   onBreakoutKey={onBreakoutKey} />

      {chips.map((c) => (
        <Chip key={c.id} label={c.label} onDismiss={() => dismissChip(c.id)} />
      ))}

      {dirty && (
        <button type="button" className="gf-reset" onClick={() => onFilters({ ...DEFAULT_FILTERS })}>
          Reset
        </button>
      )}

      <span style={S.spacer} />

      {/* Both of these only bite on a budget with monthly detail: without it
          the window is the budget's own period and the YTD column is never
          built, so offering either would be a control that does nothing. */}
      {frequencyEnabled && (
        <RangePicker range={range} onRange={onRange} presets={presets}
                     preset={preset} year={year} />
      )}
    </div>
  );
}

function Chip({ label, onDismiss }) {
  return (
    <Tag tone="info" style={S.chip}>
      {label}
      <button type="button" className="tag-close-btn" aria-label={`Clear ${label}`} onClick={onDismiss}>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M2 2L8 8M8 2L2 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </Tag>
  );
}

/** Whether a Filters button would have any pane behind it. A firm whose data
 *  supports no breakout, on a view with no column filters, gets no button. */
export function hasFilterPanes({ filters, onFilters, breakouts, onBreakoutKey }) {
  return !!(filters && onFilters) || !!(breakouts?.length && onBreakoutKey);
}

// Ported from carta-fund-modeling's `GlobalFilter` (side-nav + right pane +
// Reset/Apply footer over a draft, committed on Apply). No
// createPortal/boundary-flip
// logic here: fund-modeling needs that because its toolbar sits inside a
// clipped scrollable column; this page's toolbar has no such container.
export function FiltersMenu({ filters, onFilters, ytdPane = true, breakouts, breakoutKey, onBreakoutKey }) {
  const hasColumns = !!(filters && onFilters);
  const hasBreakouts = !!(breakouts?.length && onBreakoutKey);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (open) trackRender("MancoReporting.BudgetFilterPanel.View"); }, [open]);
  const [activePane, setActivePane] = useState(hasColumns ? "columns" : "breakouts");
  const [draft, setDraft] = useState(filters || DEFAULT_FILTERS);
  const [draftBreakout, setDraftBreakout] = useState(breakoutKey ?? null);
  const ref = useOutsideClose(open, () => setOpen(false));

  useEffect(() => {
    if (open) return;
    setDraft(filters || DEFAULT_FILTERS);
    setDraftBreakout(breakoutKey ?? null);
  }, [open, filters, breakoutKey]);

  const draftHidden = draft.hidden || [];
  const toggleDraftHidden = (type) => {
    if (!draftHidden.includes(type) && !canHide(draftHidden, type)) return;
    setDraft({
      ...draft,
      hidden: draftHidden.includes(type) ? draftHidden.filter((t) => t !== type) : [...draftHidden, type],
    });
  };

  // Scoped per instance: three views can each mount a Filters panel.
  const uid = useId();
  const tabId = (k) => `${uid}tab-${k}`;
  const paneId = (k) => `${uid}pane-${k}`;

  // Arrow keys move between tabs, which is what a tablist owes a keyboard
  // reader once only the selected tab is tabbable.
  const onTabKeyDown = (e) => {
    const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1
               : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const keys = navItems.map((n) => n.key);
    const next = keys[(keys.indexOf(activePane) + step + keys.length) % keys.length];
    setActivePane(next);
    document.getElementById(tabId(next))?.focus();
  };

  const apply = () => {
    if (hasColumns) onFilters({ ...filters, hidden: draft.hidden, showYtd: draft.showYtd });
    if (hasBreakouts) onBreakoutKey(draftBreakout);
    setOpen(false);
  };
  const resetDraft = () => {
    setDraft({ ...draft, hidden: [], showYtd: DEFAULT_FILTERS.showYtd });
    setDraftBreakout("none");
  };

  const navItems = [
    ...(hasColumns ? [
      { key: "columns", label: "Columns", count: draftHidden.length },
      ...(ytdPane ? [{ key: "ytd", label: "Year-to-Date", count: draft.showYtd ? 1 : 0 }] : []),
    ] : []),
    ...(hasBreakouts ? [
      { key: "breakouts", label: "Break outs",
        count: draftBreakout && draftBreakout !== "none" ? 1 : 0 },
    ] : []),
  ];

  // The breakout in force, named beside the button — the panel it was set in
  // is closed by the time the reader is looking at the rows it opened.
  const appliedBreakout = hasBreakouts && breakoutKey && breakoutKey !== "none"
    ? breakouts.find((b) => b.key === breakoutKey)
    : null;

  if (!hasFilterPanes({ filters, onFilters, breakouts, onBreakoutKey })) return null;

  return (
    <div ref={ref} style={S.filterWrap}>
      <Btn kind="ghost" size="toolbar" onClick={() => setOpen((v) => !v)}
           aria-haspopup="dialog" aria-expanded={open}
           className={open ? "is-open" : undefined}>
        Filters
        <Chevron rotate={open ? 180 : 0} />
      </Btn>

      {appliedBreakout && (
        <Chip label={`Break out: ${appliedBreakout.label}`}
              onDismiss={() => onBreakoutKey("none")} />
      )}

      {open && (
        <div className="gf-panel" style={S.panelPos} role="dialog" aria-label="Filters">
          {/* A real tab widget: the panel is labelled by whichever tab
              selected it, and only the selected tab is in the tab order —
              the rest are reached with the arrow keys. */}
          <div className="gf-panel__menu" role="tablist" aria-orientation="vertical"
               aria-label="Filters">
            {navItems.map(({ key, label, count }) => (
              <button key={key} type="button" role="tab" id={tabId(key)}
                      aria-selected={activePane === key} aria-controls={paneId(key)}
                      tabIndex={activePane === key ? 0 : -1}
                      className={`gf-navitem${activePane === key ? " gf-navitem--active" : ""}`}
                      onClick={() => setActivePane(key)} onKeyDown={onTabKeyDown}>
                {label}
                {count > 0 && <Bubble tone="info">{count}</Bubble>}
              </button>
            ))}
          </div>

          <div className="gf-panel__right">
            <div className="gf-panel__view" role="tabpanel"
                 id={paneId(activePane)} aria-labelledby={tabId(activePane)}>
              {activePane === "columns" && (
                <>
                  <h3 className="gf-view__title">Hide columns</h3>
                  <div className="gf-check-list">
                    {COLUMN_TYPES.map((type) => (
                      <Check key={type}
                             checked={draftHidden.includes(type)}
                             disabled={!canHide(draftHidden, type)}
                             onChange={() => toggleDraftHidden(type)}
                             label={`Hide ${COLUMN_LABEL[type]} column`} />
                    ))}
                  </div>
                </>
              )}
              {activePane === "ytd" && (
                <>
                  <h3 className="gf-view__title">Year-to-date</h3>
                  <div className="gf-check-list">
                    <Check checked={!!draft.showYtd}
                           onChange={() => setDraft({ ...draft, showYtd: !draft.showYtd })}
                           label="Show YTD column" />
                  </div>
                </>
              )}
              {activePane === "breakouts" && (
                <BreakoutPane breakouts={breakouts} value={draftBreakout}
                              onChange={(k) => { trackClick("MancoReporting.BudgetVsActuals.BreakoutChange"); setDraftBreakout(k); }} />
              )}
            </div>

            <div className="gf-actions">
              <button type="button" className="gf-btn gf-btn--ghost" onClick={() => { trackClick("MancoReporting.BudgetVsActuals.FilterReset"); resetDraft(); }}>Reset</button>
              <button type="button" className="gf-btn gf-btn--primary" onClick={() => { trackClick("MancoReporting.BudgetVsActuals.FilterApply"); apply(); }}>Apply</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// A row opens by exactly one dimension, so these are radios, not checkboxes.
function BreakoutPane({ breakouts, value, onChange }) {
  const { tags, rest } = groupBreakouts(breakouts);
  const onTag = typeof value === "string" && value.startsWith("reporting_tag:");
  const tagValue = onTag ? value : null;

  return (
    <>
      <h3 className="gf-view__title">Break rows out by</h3>
      <div className="gf-check-list">
        <Radio name="breakout" checked={!value || value === "none"}
               onChange={() => onChange("none")} label="None" />
        {rest.map((b) => (
          <Radio key={b.key} name="breakout" checked={value === b.key}
                 onChange={() => onChange(b.key)} label={b.label} />
        ))}

        {/* One category is the answer, so it names itself. Several are a
            question, so the option stays generic and the picker answers it. */}
        {tags.length === 1 && (
          <Radio name="breakout" checked={value === tags[0].key}
                 onChange={() => onChange(tags[0].key)}
                 label={`Tag: ${tags[0].label}`} />
        )}
        {tags.length > 1 && (
          <div>
            <Radio name="breakout" checked={onTag}
                   onChange={() => onChange(tagValue || tags[0].key)} label="Tags" />
            {onTag && (
              <div className="gf-radio-sub">
                <Dropdown
                  triggerLabel="Tag"
                  options={tags.map((t) => ({ id: t.key, label: t.label }))}
                  value={tagValue}
                  onChange={onChange}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function Radio({ name, checked, onChange, label }) {
  return (
    <label className="gf-check-row">
      <input type="radio" name={name} checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}

function Check({ checked, disabled, onChange, label }) {
  return (
    <label className="gf-check-row" style={disabled ? S.checkOff : null}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} />
      {label}
    </label>
  );
}

function RangePicker({ range, onRange, presets, preset, year }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (open) trackRender("MancoReporting.BudgetPeriodPanel.View"); }, [open]);
  const ref = useOutsideClose(open, () => setOpen(false));
  const win = normalizeRange(range);
  const label = presets.find((p) => p.id === preset)?.label || "Custom range";

  const pick = (id) => {
    const p = presets.find((x) => x.id === id);
    if (!p || p.first == null) return;
    onRange({ first: p.first, last: p.last });
  };

  return (
    <div ref={ref} style={S.wrap}>
      <button type="button" onClick={() => setOpen((v) => !v)}
              aria-haspopup="dialog" aria-expanded={open}
              style={{ ...S.trigger, ...(open ? S.triggerOpen : null) }}>
        <CalendarIcon />
        <span>{label}:</span>
        <span>{monthLabel(win.first)} – {monthLabel(win.last)} {year}</span>
        <Chevron rotate={open ? 180 : 0} />
      </button>

      {open && (
        <div style={{ ...S.popover, right: 0, left: "auto", minWidth: 300 }}
             role="dialog" aria-label="Date range">
          <label style={S.fieldLabel}>Date range</label>
          <select style={S.select} value={preset} onChange={(e) => pick(e.target.value)}>
            {presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <div style={S.row}>
            <MonthField label="From" value={win.first}
                        onChange={(m) => onRange({ first: m, last: Math.max(m, win.last) })} />
            <MonthField label="To" value={win.last}
                        onChange={(m) => onRange({ first: Math.min(m, win.first), last: m })} />
          </div>
        </div>
      )}
    </div>
  );
}

function MonthField({ label, value, onChange }) {
  return (
    <div style={S.field}>
      <label style={S.fieldLabel}>{label}</label>
      <select style={S.select} value={value} aria-label={`${label} month`}
              onChange={(e) => { trackClick("MancoReporting.BudgetVsActuals.PeriodChange"); onChange(Number(e.target.value)); }}>
        {MONTH_NAME.map((name, i) => (
          <option key={name} value={i + 1}>{name}</option>
        ))}
      </select>
    </div>
  );
}

function monthLabel(m) {
  return MONTH_NAME[m - 1]?.slice(0, 3) || "";
}

// Popovers close on an outside click or Escape, the same as the app's
// other two. Returns the ref to hang on the wrapper.
function useOutsideClose(open, close) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) close(); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  });
  return ref;
}

function CalendarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="3.5" width="12" height="10.5" rx="1.25" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2 6.5h12" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5.5 2v3M10.5 2v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export const S = {
  bar: { ...sans, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8,
         margin: "0 0 10px" },
  spacer: { flex: "1 1 auto" },
  wrap: { ...sans, position: "relative", display: "inline-block" },
  filterWrap: { ...sans, position: "relative", display: "inline-flex",
                alignItems: "center", gap: 8 },
  // Same toolbar chrome as the Period dropdown and the Filters button beside it.
  trigger: {
    ...sans, display: "inline-flex", alignItems: "center", gap: 6, ...TOOLBAR_CONTROL_STYLE,
    boxSizing: "border-box",
    background: PAPER, color: INK, border: `1px solid ${BORDER_DEFAULT}`, borderRadius: 4,
    fontWeight: 500, cursor: "pointer", fontVariantNumeric: "tabular-nums",
  },
  // The same open/focus ring `.dd-trigger.is-open` draws, so the Filters
  // button and the dropdowns beside it open identically.
  triggerOpen: { borderColor: "var(--ink-color-global-border-focus-default)",
                 boxShadow: "0 0 0 4px var(--ink-color-global-border-focus-light)" },
  // Radius + shadow match Ink's GlobalFilter panel (.gf-panel)
  // exactly: 8px radius, two-layer elevation — not a single generic shadow.
  popover: {
    position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 40, minWidth: 220,
    padding: 12, background: PAPER, border: `1px solid ${LINE}`, borderRadius: 8,
    boxShadow: "0 8px 24px rgba(20, 24, 24, 0.12), 0 2px 6px rgba(20, 24, 24, 0.06)",
    display: "flex", flexDirection: "column", gap: 6,
  },
  // Everything else about the panel is Ink's own .gf-* CSS
  // (theme.js); only where it hangs off the trigger is this app's business.
  panelPos: { position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 40 },
  checkOff: { color: MICRO, cursor: "not-allowed" },
  // Tag's own base pill (28px, radius-subtle, tone bg/fg/border) carries the
  // shape and color — this only adds the removable layout Tag doesn't have.
  chip: { gap: 4, paddingRight: 4, fontWeight: 500 },
  fieldLabel: { ...sans, fontSize: FS.small, fontWeight: 600, color: INK, display: "block",
                marginBottom: 4 },
  select: {
    ...sans, padding: "5px 8px", fontSize: FS.body, color: INK, background: PAPER,
    border: `1px solid ${LINE}`, borderRadius: 4, cursor: "pointer", width: "100%",
  },
  row: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  field: { display: "flex", flexDirection: "column" },
};
