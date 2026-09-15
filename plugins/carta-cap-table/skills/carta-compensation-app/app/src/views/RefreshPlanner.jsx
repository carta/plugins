// Refresh planner — the employee list a refresh grant cycle draws from, and the
// filters that narrow it.
//
// WHERE THE FIGURES COME FROM
//
// Every equity value here is CTC's Equity Refresh Report's own, passed through
// unchanged from /reports/equity-refresh/all-employees. They must tie out against
// that page row for row, so nothing on this tab recomputes one. The single
// exception is Total equity, and even that is not a new derivation: the product's
// own table computes "Total Shares Granted" as vested + unvested at render, and
// this does the same addition on the same two numbers.
//
// Tenure is the one genuinely modelled column — months from the report's hire_date
// against today. It is derived at render rather than captured because a month count
// baked in at build time silently ages: a January dashboard would still claim
// January's tenure in June.
//
// FILTERS BEHAVE DIFFERENTLY FROM THE REPORT
//
// The CTC page filters to employees "completing vesting in" a window — it KEEPS
// them. This planner EXCLUDES them, because the cohort it wants is the people who
// still have runway. Same field, opposite direction, deliberately.

import { useEffect, useMemo, useRef, useState } from "react";
import { C, CARD_TITLE, FS, RADIUS } from "../ui/theme.js";
import ExportButton from "../ui/ExportButton.jsx";
import { MultiSelect, Select, TableAlign, Tag, Th, Td, useMediaQuery } from "../ui/components.jsx";
import { csvFilename, downloadCsv, toCsv } from "../model/csv.js";
import { shares } from "../model/format.js";
import { formatTenure, tenureMonths } from "../model/tenure.js";
import {
  applyFilters, levelRank, PRIOR_GRANTS, priorGrantsMode, totalEquity,
} from "../model/cohort.js";
import { applyPredicate } from "../model/predicate.js";
import { DEFAULT_GRANT_REASON, reasonFor } from "../model/grantReason.js";
import {
  addAll, cartRows, diff, headerState, hiddenCount, reconcile, removeAll, toggle,
} from "../model/cart.js";
import { useScenario } from "../state/useScenario.js";
import CartPanel from "./planner/CartPanel.jsx";
import SettingsStep from "./planner/SettingsStep.jsx";
import ReviewStep from "./planner/ReviewStep.jsx";
import PoolBar from "./planner/PoolBar.jsx";
import ScenarioBar from "./planner/ScenarioBar.jsx";
import FilterBox, { CommittedFilters } from "./planner/FilterBox.jsx";
import {
  eligibility, grantForRow, planTotals, policyToSettings,
} from "../model/policy.js";

// Offered windows, matching the CTC report's own dropdown so the two surfaces stay
// comparable even though this one inverts the direction.
const VESTING_WINDOWS = [6, 12, 18, 24];

/** No filters applied — what a scenario means when it stores no `filters` key. */
const NO_FILTERS = Object.freeze({
  hasPriorGrants: PRIOR_GRANTS.ANY,
  jobAreas: [],
  levelMin: null,
  levelMax: null,
  excludeVestingWithinMonths: 0,
});

/** A filter control that is unavailable because this build never captured its data.
 *
 *  Rendered in place of the control rather than hiding it: a missing filter reads as
 *  a product gap, whereas a disabled one with a reason reads as a data gap the user
 *  can fix by re-fetching. Never silently pass everyone instead.
 */
function UnavailableFilter({ label, reason }) {
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <span style={{ fontSize: FS.xs, color: C.textQuiet }}>{label}</span>
      <Tag tone="notice" title={reason}>Not in this build</Tag>
    </div>
  );
}

function Checkbox({ label, checked, onChange, title }) {
  return (
    <label style={{
      display: "inline-flex", alignItems: "center", gap: 7, cursor: "pointer",
      fontSize: FS.md, color: C.textDefault,
    }} title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** The header's select-all. Tri-state, because "some of these are selected" is a
 *  real answer and a plain checkbox cannot say it.
 *
 *  `indeterminate` is a DOM property with no React prop, so it is set through a
 *  ref on every render. Forgetting that is invisible in a snapshot test and
 *  obvious the moment someone clicks — which is why an interaction test covers it.
 */
function SelectAllBox({ state, onChange, count }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "some";
  }, [state]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={state === "all"}
      onChange={(e) => onChange(e.target.checked)}
      aria-label={`Select all ${count} shown`}
      title={`Add or remove the ${count} employees currently shown`}
      style={{ cursor: "pointer" }}
    />
  );
}

function EmployeeTable({ rows, asOf, cart, onToggle, headerSel, onToggleAll }) {
  return (
    <TableAlign align="right">
      <table style={{ width: "100%", minWidth: 1210, tableLayout: "fixed" }}>
        <thead>
          <tr>
            <Th width="4%" align="center">
              <SelectAllBox state={headerSel} onChange={onToggleAll} count={rows.length} />
            </Th>
            <Th width="16%" align="left">Name</Th>
            <Th width="13%" align="left">Job Title</Th>
            <Th width="7%" align="left">Level</Th>
            <Th width="10%" align="left">Job Area</Th>
            <Th width="11%" align="left">Specialization</Th>
            <Th width="8%">Tenure</Th>
            <Th width="8%" align="left">Geo</Th>
            <Th width="7%">Total equity</Th>
            <Th width="8%">Total Vested</Th>
            <Th width="8%">Completing Vesting</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const months = tenureMonths({ tenure: { start_date: r.hire_date } }, asOf);
            const tenure = formatTenure(months);
            const total = totalEquity(r);
            const inCart = cart.has(r.external_id);
            // A tint, not a fill. The cells set their own `color` — Td uses a
            // quiet grey for missing values — so the background stays pale enough
            // to keep both weights legible.
            //
            // `selectedRow` is safe to use here now that ::selection has its own
            // darker `selectionTint`. Previously the two were the same value, so
            // drag-selecting text on a marked row painted highlight-over-identical
            // -tint and the text vanished. `userSelect: none` also stands: a click
            // meant to tick a checkbox should never start a text selection.
            return (
              <tr
                key={r.external_id}
                style={{
                  userSelect: "none",
                  ...(inCart ? { background: C.selectedRow } : null),
                }}
              >
                <Td align="center">
                  {/* A bare input, not the labelled Checkbox: 134 rows would mean
                      134 redundant labels. The aria-label names the person. */}
                  <input
                    type="checkbox"
                    checked={inCart}
                    onChange={() => onToggle(r.external_id)}
                    aria-label={`Add ${r.full_name || r.external_id} to the cart`}
                    style={{ cursor: "pointer" }}
                  />
                </Td>
                <Td align="left" ellipsis title={`${r.full_name || "Unknown"} · ${r.external_id}`}>
                  {r.full_name || <span style={{ color: C.textQuiet }}>Unknown</span>}
                </Td>
                <Td align="left" ellipsis subtle={!r.job_title} title={r.job_title || "No title recorded"}>
                  {r.job_title || "—"}
                </Td>
                <Td align="left" subtle={!r.job_level}>{r.job_level || "—"}</Td>
                <Td align="left" ellipsis subtle={!r.job_area} title={r.job_area || "No job area recorded"}>
                  {r.job_area || "—"}
                </Td>
                {/* Sparse on real data — 4 of 134 rows on the corporation this was
                    built against. An em dash says "not recorded"; a blank cell would
                    read as "this role has no specialization". */}
                <Td align="left" ellipsis subtle={!r.job_focus}
                    title={r.job_focus || "No specialization recorded for this role"}>
                  {r.job_focus || "—"}
                </Td>
                {/* Em dash, never "0m", for a missing hire date: an employee whose
                    start was never recorded is unknown, not a day-one hire. */}
                <Td mono subtle={tenure === null}
                    title={tenure === null
                      ? "No hire date recorded for this employee"
                      : `Calculated from hire date ${r.hire_date}`}>
                  {tenure === null ? "—" : tenure}
                </Td>
                <Td align="left" ellipsis subtle={!r.location} title={r.location || "No location recorded"}>
                  {r.location || "—"}
                </Td>
                <Td mono subtle={total === null}
                    title={total === null ? "No equity in this snapshot" : "Vested plus unvested"}>
                  {total === null ? "—" : shares(total)}
                </Td>
                <Td mono subtle={r.total_vested_shares == null}>
                  {r.total_vested_shares == null ? "—" : shares(r.total_vested_shares)}
                </Td>
                <Td mono subtle={!r.date_of_final_vest}>
                  {r.date_of_final_vest || "—"}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableAlign>
  );
}

export default function RefreshPlanner({ planner, corporation, corporationId, token }) {
  // One "now" for the whole render, so every row is measured against the same
  // instant. Calling new Date() per row would let a table straddle midnight and
  // report two different tenures for two people who started the same day.
  const asOf = useMemo(() => new Date(), []);

  const all = planner.rows || [];
  const availability = planner.availability || {};
  const recon = planner.reconciliation || {};

  const [hasGrants, setHasGrants] = useState(PRIOR_GRANTS.ANY);
  // A Set, not an array — MultiSelect reads `.has`/`.size` on it. The filter model
  // takes an array, so this is converted at that boundary rather than here.
  const [areas, setAreas] = useState(() => new Set());
  const [levelMin, setLevelMin] = useState(null);
  const [levelMax, setLevelMax] = useState(null);
  const [vestWindow, setVestWindow] = useState(0);
  // Claude-authored filters, stacked after the four presets. A list rather than
  // one slot: "engineering" and "hired before 2023" are two separate thoughts,
  // and each has to be removable on its own.
  const [claudeFilters, setClaudeFilters] = useState([]);

  // The cart. Held here rather than in the table so the panel, the counts and the
  // export all read one source.
  // Two steps, one state. No router: this is a two-screen flow inside one tab,
  // and a router would be more machinery than the thing it navigates.
  const [step, setStep] = useState("cohort");
  // Below this the cart stacks under the table rather than sitting off-screen.
  const wide = useMediaQuery("(min-width: 900px)");
  const [cart, setCart] = useState(() => new Set());
  const [dropped, setDropped] = useState(0);
  const {
    saved, savedOverrides, savedReasons, savedSettings, savedFilters,
    savedClaudeFilters,
    scenarios, activeId,
    loading: cartLoading, conflict, saving, futureDoc, save, reload,
    switchScenario, createScenario, duplicateScenario, renameScenario, deleteScenario,
  } = useScenario(corporationId);
  const hydratedFor = useRef(null);

  // Adopt the saved cart once, after it loads. Ids that no longer exist in this
  // snapshot are dropped and counted — a rebuild can retire someone, and doing
  // that silently would shrink a plan without saying so.
  useEffect(() => {
    if (cartLoading || hydratedFor.current === activeId || !saved) return;
    hydratedFor.current = activeId;
    const ids = all.map((r) => r.external_id);
    const { cart: kept, dropped: gone } = reconcile(saved, ids);
    setCart(kept);
    setDropped(gone);
    // Hand-set grants are reconciled the same way: an override for someone no
    // longer in the snapshot is dropped rather than kept against a ghost row.
    const present = new Set(ids);
    if (savedOverrides && savedOverrides.size) {
      setOverrides(new Map([...savedOverrides].filter(([id]) => present.has(id))));
    }
    // Reasons follow the cart for the same reason: a reason against someone who is
    // no longer in the snapshot would be written back on the next save.
    setReasons(savedReasons && savedReasons.size
      ? new Map([...savedReasons].filter(([id]) => present.has(id)))
      : new Map());
    // The cohort filters, restored so a reload lands on the same list. Absent means
    // this scenario never recorded any, which is the initial state already.
    const f = savedFilters || NO_FILTERS;
    setHasGrants(priorGrantsMode(f.hasPriorGrants));
    setAreas(new Set(f.jobAreas));
    setLevelMin(f.levelMin === null ? null : String(f.levelMin));
    setLevelMax(f.levelMax === null ? null : String(f.levelMax));
    setVestWindow(f.excludeVestingWithinMonths);
    // Adopted in the same one-shot gate as the presets, so a scenario's whole
    // filter state arrives together rather than in two renders.
    setClaudeFilters(savedClaudeFilters || []);
    // Settings are adopted through the same one-shot gate rather than their own
    // effect: the policy-defaulting effect below fires whenever `settings` is null,
    // and a second effect racing it would flip the target between the scenario's
    // value and the corporation's on load.
    // null lets the policy-defaulting effect below fill it, which is exactly what
    // "this scenario records no settings" should mean.
    setSettings(savedSettings || null);
    // Hand-set grants belong to the draft that recorded them.
    if (!savedOverrides || !savedOverrides.size) setOverrides(new Map());
  }, [cartLoading, activeId, saved, savedOverrides, savedReasons, savedSettings,
      savedFilters, savedClaudeFilters, all]);

  // The corporation's policy, and the settings the user is modelling with. The
  // settings START as the policy and diverge only when edited — `null` until the
  // policy loads, so an absent policy never silently becomes Carta's defaults.
  const policySettings = useMemo(() => policyToSettings(planner.policy), [planner.policy]);
  const [settings, setSettings] = useState(null);
  // Per-employee hand-set grants, keyed by external_id. A Map rather than an
  // object so an id that looks numeric cannot be reordered or coerced.
  const [overrides, setOverrides] = useState(() => new Map());
  // Why each grant is being made. Sparse: only employees whose reason differs from
  // the default are held, so an untouched plan carries an empty map.
  const [reasons, setReasons] = useState(() => new Map());

  const setReason = (externalId, value) => {
    setReasons((prev) => {
      const next = new Map(prev);
      // Back to the default clears the entry rather than storing it — the stored
      // map is the set of DEVIATIONS, not a row per employee.
      if (!value || value === DEFAULT_GRANT_REASON) next.delete(externalId);
      else next.set(externalId, value);
      save({ reasons: next });
      return next;
    });
  };

  const setOverride = (externalId, value) => {
    setOverrides((prev) => {
      const next = new Map(prev);
      // null clears: a blank field means "no longer overriding", which is a
      // different intent from a deliberate 0.
      if (value == null) next.delete(externalId);
      else next.set(externalId, value);
      // Same debounced write as the cart: an edit that vanished on reload would
      // be worse than not offering the edit at all.
      save(cart, next);
      return next;
    });
  };
  useEffect(() => {
    if (policySettings && !settings) setSettings({ ...policySettings });
  }, [policySettings, settings]);

  // Every mutation goes through here so no path can change the cart without
  // scheduling the save that persists it.
  const updateCart = (next) => {
    setCart(next);
    save(next, overrides);
  };

  const areaOptions = useMemo(() => {
    const seen = [...new Set(all.map((r) => r.job_area).filter(Boolean))].sort();
    return seen.map((a) => ({ value: a, label: a }));
  }, [all]);

  // Built from the levels actually present, so the bounds cannot offer a rung this
  // corporation has nobody on. Ordered by canonical rank, not label.
  const levelOptions = useMemo(() => {
    const seen = new Map();
    for (const r of all) {
      const rank = levelRank(r.job_level);
      if (rank !== null && !seen.has(rank)) seen.set(rank, r.job_level);
    }
    return [...seen.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([rank, label]) => ({ value: String(rank), label }));
  }, [all]);

  // The five controls as one object — the shape applyFilters consumes AND the shape
  // persisted to the scenario, so the saved form is the form the filter runs on
  // rather than a second vocabulary that can drift from it.
  const currentFilters = useMemo(() => ({
    hasPriorGrants: hasGrants,
    jobAreas: [...areas],
    levelMin: levelMin === null ? null : Number(levelMin),
    levelMax: levelMax === null ? null : Number(levelMax),
    excludeVestingWithinMonths: vestWindow,
  }), [hasGrants, areas, levelMin, levelMax, vestWindow]);

  const { rows, removed } = useMemo(() => {
    const preset = applyFilters(all, currentFilters, availability, asOf);
    if (!claudeFilters.length) return preset;
    // Claude's filters narrow what the presets left, and `removed` counts BOTH —
    // "N excluded by filters" is one number about one cohort, and splitting it
    // would make the user reconcile two counts to learn how many people are gone.
    //
    // Each predicate was validated before it was committed (FilterBox refuses an
    // invalid one), so evaluate() only ever sees a predicate that passed the gate.
    const kept = claudeFilters.reduce(
      (rows_, f) => applyPredicate(rows_, f.node, { asOf }), preset.rows);
    return { rows: kept, removed: all.length - kept.length };
  }, [all, currentFilters, availability, asOf, claudeFilters]);

  // Cart figures, all derived from the one Set. `visibleIds` is the filtered view,
  // which is what select-all acts on — reaching past the filters would add people
  // the user has not looked at.
  const visibleIds = useMemo(() => rows.map((r) => r.external_id), [rows]);
  const headerSel = headerState(cart, visibleIds);
  const inCartRows = useMemo(() => cartRows(all, cart), [all, cart]);
  const { added, removed: cartRemoved } = diff(cart, saved);
  const hidden = hiddenCount(cart, visibleIds);

  // Every filter change goes through here, so no path can narrow the cohort
  // without persisting it — the same rule updateCart follows for the cart. The
  // NEXT values are passed explicitly rather than read back from state, which has
  // not committed yet at the moment this runs.
  const saveFilters = (next) => save({ filters: { ...currentFilters, ...next } });

  const updateHasGrants = (v) => { setHasGrants(v); saveFilters({ hasPriorGrants: v }); };
  const updateAreas = (next) => { setAreas(next); saveFilters({ jobAreas: [...next] }); };
  const updateLevelMin = (v) => {
    setLevelMin(v);
    saveFilters({ levelMin: v === null ? null : Number(v) });
  };
  const updateLevelMax = (v) => {
    setLevelMax(v);
    saveFilters({ levelMax: v === null ? null : Number(v) });
  };
  const updateVestWindow = (v) => { setVestWindow(v); saveFilters({ excludeVestingWithinMonths: v }); };

  // Claude's filters persist the same way the presets do, so a narrowed cohort
  // survives a reload and comes across on duplicate. The NEXT list is passed
  // explicitly rather than read back from state, which has not committed yet.
  const saveClaudeFilters = (next) => save({ claudeFilters: next });

  const addClaudeFilter = ({ text, node, sentence }) => {
    // The sentence is stored alongside the predicate rather than re-derived on
    // read: it is what the user approved, and describe() is free to improve its
    // wording later without silently rewriting what a saved plan says it does.
    const next = [...claudeFilters, {
      id: `f${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
      text, node, sentence,
    }];
    setClaudeFilters(next);
    saveClaudeFilters(next);
  };

  const removeClaudeFilter = (id) => {
    const next = claudeFilters.filter((f) => f.id !== id);
    setClaudeFilters(next);
    saveClaudeFilters(next);
  };

  // The user edited the policy they are modelling with. Distinct from the effect
  // above that DEFAULTS settings from the corporation's policy: that one must not
  // save, or it would stamp a settings key onto a scenario nobody configured.
  const updateSettings = (next) => { setSettings(next); save({ settings: next }); };

  const clearFilters = () => {
    setHasGrants(false);
    setAreas(new Set());
    setLevelMin(null);
    setLevelMax(null);
    setVestWindow(0);
    // One save, not five. Five would re-arm the debounce five times and, worse,
    // each would carry a filter set the other four had not been applied to.
    save({ filters: NO_FILTERS });
  };

  const exportCart = () => {
    const header = [
      "employee_id", "name", "job_title", "job_area", "level", "track", "location",
      "hire_date", "tenure_months", "total_equity", "total_vested_shares",
      "total_unvested_shares", "completing_vesting",
    ];
    const body = inCartRows.map((r) => {
      const months = tenureMonths({ tenure: { start_date: r.hire_date } }, asOf);
      const total = totalEquity(r);
      return [
        r.external_id, r.full_name || "", r.job_title || "", r.job_area || "",
        r.job_level || "", r.job_track || "", r.location || "", r.hire_date || "",
        months === null ? "" : months,
        total === null ? "" : total,
        r.total_vested_shares ?? "",
        r.total_unvested_shares ?? "",
        r.date_of_final_vest || "",
      ];
    });
    downloadCsv(csvFilename(corporation, "refresh-cart"), toCsv([header, ...body]));
  };

  const exportCohort = () => {
    // employee_id first and name included, matching the Scorecard export — same
    // sensitivity caveat: a named person beside their equity. Not for tickets or
    // shared drives.
    const header = [
      "employee_id", "name", "job_title", "job_area", "level", "track",
      "location", "hire_date", "tenure_months",
      "total_equity", "total_vested_shares", "total_unvested_shares",
      "completing_vesting", "live_award_count",
    ];
    const body = rows.map((r) => {
      const months = tenureMonths({ tenure: { start_date: r.hire_date } }, asOf);
      const total = totalEquity(r);
      return [
        r.external_id, r.full_name || "", r.job_title || "", r.job_area || "",
        r.job_level || "", r.job_track || "", r.location || "",
        r.hire_date || "",
        // Empty, not 0, for unknown — a spreadsheet would otherwise average a
        // missing tenure as zero and understate the cohort's seniority.
        months === null ? "" : months,
        total === null ? "" : total,
        r.total_vested_shares ?? "",
        r.total_unvested_shares ?? "",
        r.date_of_final_vest || "",
        r.live_award_count ?? "",
      ];
    });
    downloadCsv(csvFilename(corporation, "refresh-cohort"), toCsv([header, ...body]));
  };

  const liveSettings = settings || policySettings || {
    targetPct: 0, cadenceMonths: 12, rangeBelowPct: 0, rangeAbovePct: 0, tenureMinMonths: 0,
  };

  // The planned draw, computed ONCE for every step. The pool bar appears on all
  // three, and a figure that differed between them would be three answers to one
  // question. Uses the same eligibility predicate and the same grantForRow the
  // policy table renders from, so the bar cannot disagree with the rows above it.
  const plannedTotals = useMemo(() => {
    const monthsFor = (r) => tenureMonths({ tenure: { start_date: r.hire_date } }, asOf);
    const eligibleRows = inCartRows.filter(
      (r) => eligibility(r, liveSettings, monthsFor).eligible);
    return {
      eligibleRows,
      totals: planTotals(eligibleRows, liveSettings, policySettings, overrides),
    };
  }, [inCartRows, liveSettings, policySettings, overrides, asOf]);

  // The scenario bar rides with the pool bar rather than inside it: PoolBar has a
  // real early return for an unknown pool figure, and a switcher nested in there
  // would vanish exactly when the pool is missing. Composing here also means all
  // three steps get both without changing their props — the switcher has to be
  // reachable from the review step, not only from the cohort one.
  const scenarioBar = (
      <ScenarioBar
        scenarios={scenarios}
        activeId={activeId}
        saving={saving}
        conflict={conflict}
        futureDoc={futureDoc}
        onSwitch={switchScenario}
        onCreate={createScenario}
        onDuplicate={duplicateScenario}
        onRename={renameScenario}
        onDelete={deleteScenario}
        onReload={reload}
      />
  );

  const poolOnly = (
    <PoolBar
      available={planner.poolAvailableShares ?? null}
      planned={plannedTotals.totals.totalShares}
      reserved={planner.poolReservedShares ?? null}
      outstanding={planner.poolOutstandingShares ?? null}
    />
  );

  /** The header every step shows: which draft, and what it has to spend.
   *
   *  One row, scenario on the LEFT — it names the thing the rest of the screen is
   *  about, so it reads first. The pool takes the flexible column because its bar
   *  chart uses whatever width it is given, where the scenario tile's contents are
   *  a fixed set of controls.
   *
   *  No alignItems:"start" — these are two cards of similar size side by side, and
   *  a step between their bottom edges reads as a mistake rather than as a
   *  difference in content. Stretch is the default, so this is the absence of a
   *  line; removing it later would silently misalign them.
   *
   *  Stacks below the breakpoint, scenario first, which is the same order.
   */
  const poolBar = (
    <div style={{
      display: "grid",
      gridTemplateColumns: wide ? "minmax(0, 430px) minmax(0, 1fr)" : "minmax(0, 1fr)",
      gap: 12,
    }}>
      {scenarioBar}
      {poolOnly}
    </div>
  );

  if (step === "settings") {
    return (
      <SettingsStep
        poolBar={poolBar}
        equityUnits={planner.equityUnits ?? null}
        rows={inCartRows}
        policySettings={policySettings}
        settings={liveSettings}
        onSettings={updateSettings}
        onBack={() => setStep("cohort")}
        onNext={() => setStep("review")}
        asOf={asOf}
        overrides={overrides}
        onOverride={setOverride}
        reasons={reasons}
        onReason={setReason}
        // Through updateCart, the same path step 1's checkbox takes, so the two
        // screens write one cart and the removal persists like any other change.
        onRemove={(id) => updateCart(toggle(cart, id))}
        token={token}
      />
    );
  }

  if (step === "review") {
    const { eligibleRows } = plannedTotals;
    // Per-employee, for the issuance hand-off. Same grantForRow the settings
    // screen's own table uses, so the prompt cannot disagree with what was on
    // screen when the user decided to hand it off.
    const grants = eligibleRows.map((r) => ({
      name: r.full_name,
      externalId: r.external_id,
      shares: grantForRow(r, liveSettings, policySettings, overrides).shares,
      // Carried into the handoff CSV's Grant Reason column, per row rather than the
      // single hardcoded "Refresh" it sent before this column existed.
      reason: reasonFor(r.external_id, reasons),
    }));
    return (
      <ReviewStep
        totals={plannedTotals.totals}
        poolBar={poolBar}
        grants={grants}
        corporation={corporation}
        corporationId={corporationId}
        settings={liveSettings}
        asOf={asOf}
        onBack={() => setStep("settings")}
      />
    );
  }

  return (
    <div style={{ padding: "18px 24px 28px", display: "grid", gap: 16 }}>
      {poolBar}

      <div style={{
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: RADIUS,
        padding: 16,
      }}>
        {/* The whole tile folds. Collapsed it is a heading and a count — which is
            the one thing someone scrolling past needs to know is still true.

            A second <details>, nested inside the first's sibling: the Claude box
            folds on its own because it is occasional even when the filters are in
            use, and this folds the filters too once a cohort is settled. Both are
            <details> for the same reasons — real keyboard and screen-reader
            behaviour, and findable by in-page search while shut. */}
        <details open className="ctc-fold">
          {/* The whole summary is the hit target — that is how <details> works, and
              it is worth keeping — but a heading you can click is not an AFFORDANCE.
              The browser's own marker is a small OS triangle that reads as
              decoration, so it is hidden (in the global stylesheet, since
              ::-webkit-details-marker cannot be set inline) and replaced by a
              labelled control on the right that says what it does. */}
          <summary style={{
            display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
            marginBottom: 4,
          }}>
            {/* An h2, like the scenario title beside it: this names the step, so
                it should reach a screen reader as a heading rather than as a bold
                span. margin:0 because the shared style carries no reset. */}
            <h2 style={{ ...CARD_TITLE, color: C.text, margin: 0 }}>
              Refresh cohort
            </h2>
            {/* Only tenure is modelled — the equity figures are the report's own and
                carry no tag, because tagging a value the product already displays is
                as misleading as leaving a derived one untagged. */}
            <Tag tone="notice" title="Tenure is calculated in this console from the report's hire date. Every other figure is Carta's own, as shown in the Equity Refresh Report.">
              Tenure is modelled
            </Tag>
            {/* The count rides on the SUMMARY so it survives collapsing. A folded
                tile that does not say how many are excluded is how a narrowed
                cohort becomes invisible. */}
            {removed > 0 && <Tag>{removed} excluded by filters</Tag>}

            {/* A span, not a button: a <button> inside a <summary> swallows the
                click that would toggle it, so this is the label for a control the
                summary already is. aria-hidden for the same reason — the summary
                announces the open state itself, and a screen reader hearing both
                would hear it twice. */}
            <span
              aria-hidden="true"
              style={{
                marginLeft: "auto", display: "inline-flex", alignItems: "center",
                // Grey, not link blue: this reveals what is already on the page
                // rather than navigating anywhere, and blue among these controls
                // read as the one link on a tile full of fields.
                gap: 6, fontSize: FS.sm, color: C.textSubtle,
              }}
            >
              <span className="ctc-fold-label" />
              <span className="ctc-fold-chevron" style={{ display: "inline-flex" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  style={{ stroke: "currentColor" }}>
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </span>
            </span>
          </summary>
        <div style={{ fontSize: FS.sm, color: C.textSubtle, lineHeight: 1.55 }}>
          Equity figures come from CTC's Equity Refresh Report and tie out against it.
        </div>

        <div style={{
          display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-end", marginTop: 14,
        }}>
          {availability.grants === false ? (
            <UnavailableFilter
              label="Prior grants"
              reason="This build captured no equity for any employee, so prior grants cannot be determined. Say 'refresh' to re-fetch."
            />
          ) : (
            // A dropdown, not a checkbox. A checkbox has two states and this
            // filter has three, and the one it could not express — has NONE — is
            // the one a refresh cycle asks for most: who has never been granted.
            //
            // The definition sits UNDER the control rather than in a title. It is
            // the one filter here whose meaning is not obvious from its name
            // ("prior" could mean any grant ever, including cancelled ones), and a
            // definition only reachable by hovering is one most people never read.
            // NOT wrapped with its help text. The row aligns on flex-END, so a
            // wrapper's bottom edge is what lines up — and with the help text
            // inside, that bottom was the text, which lifted the field 37px above
            // every other control. The definition moved below the row instead.
            <Select
              label="Prior grants"
              value={hasGrants}
              onChange={updateHasGrants}
              options={[
                { value: PRIOR_GRANTS.ANY, label: "Any" },
                { value: PRIOR_GRANTS.HAS, label: "Has prior grants" },
                { value: PRIOR_GRANTS.NONE, label: "No prior grants" },
              ]}
              minWidth={170}
            />
          )}

          <MultiSelect
            label="Job area"
            options={areaOptions}
            selected={areas}
            onToggle={(v) => {
              const next = new Set(areas);
              if (next.has(v)) next.delete(v);
              else next.add(v);
              updateAreas(next);
            }}
            onAll={() => updateAreas(new Set())}
            allLabel={`All (${areaOptions.length})`}
            minWidth={170}
          />

          <Select
            label="Level from"
            value={levelMin === null ? "" : levelMin}
            onChange={(v) => updateLevelMin(v === "" ? null : v)}
            options={[{ value: "", label: "Any" }, ...levelOptions]}
            minWidth={110}
          />
          <Select
            label="Level to"
            value={levelMax === null ? "" : levelMax}
            onChange={(v) => updateLevelMax(v === "" ? null : v)}
            options={[{ value: "", label: "Any" }, ...levelOptions]}
            minWidth={110}
          />

          {availability.vesting === false ? (
            <UnavailableFilter
              label="Vesting"
              reason="No completing-vesting dates in this build, so this filter cannot be applied."
            />
          ) : (
            <Select
              label="Exclude completing vesting within"
              value={String(vestWindow)}
              onChange={(v) => updateVestWindow(Number(v))}
              options={[
                { value: "0", label: "No exclusion" },
                ...VESTING_WINDOWS.map((m) => ({ value: String(m), label: `${m} months` })),
              ]}
              minWidth={190}
              hint="Removes employees about to fully vest — the opposite of the CTC report's filter, which keeps them."
            />
          )}
        </div>

        {/* Under the row, not inside a control. "Prior grants" is the one filter
            here whose name does not settle its meaning — it could be read as any
            grant ever, including cancelled ones — so the definition is on screen
            rather than in a title attribute. Below the row because the row aligns
            on flex-end, where a taller control lifts its own field out of line. */}
        {availability.grants !== false && (
          <div style={{
            marginTop: 8, fontSize: FS.xs, color: C.textQuiet, lineHeight: 1.5,
          }}>
            Prior grants means a live grant. Cancelled and forfeited awards are
            already excluded by Carta.
          </div>
        )}

        {/* A FILTER, not a source edit — the one box on this console that means
            something different from the others.

            Elsewhere the ask box edits the app and reloads, which is right for
            "add a P60 column". Here that would be wrong: "show only engineering"
            is a filter over these rows, and as a code change it is durable,
            invisible in the UI, and undoable only by asking again. So it produces
            a predicate that behaves like the four presets above — previewed,
            readable, removable, and saved with the scenario. */}
        <div style={{
          marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}`,
          display: "grid", gap: 8,
        }}>
          {/* The filters already applied stay on screen whether the box below is
              open or not. An active filter is silently narrowing the cohort, and
              putting one behind a collapsed section is how someone ends up looking
              at 25 of 134 employees with no visible reason why. */}
          <CommittedFilters filters={claudeFilters} onRemove={removeClaudeFilter} />

          {/* COLLAPSED BY DEFAULT. The input, its examples and the space the
              preview needs ran to 151px — a third of a tile that already filled
              half the fold before the first employee row. Authoring a filter is a
              deliberate act a few times a session; the preset controls above are
              what people touch on every visit, so this is the part that folds.

              A <details>, not a hand-rolled toggle: it opens on click and on
              Enter, announces its own state, and is findable by the browser's own
              in-page search even while closed — three things a div with an onClick
              would each need building and would probably get wrong. */}
          <details className="ctc-fold">
            {/* The same control as the tile's own fold, so two nested collapsing
                sections do not each teach a different gesture. */}
            {/* Chevron FIRST here, unlike the tile's fold. This summary is one
                short label, so a marker at the end floats away from the words it
                belongs to; the tile's summary is a heading with tags after it,
                where a right-hand control reads as belonging to the whole row. */}
            <summary style={{
              display: "flex", alignItems: "center", gap: 6,
              fontSize: FS.sm, color: C.textSubtle, cursor: "pointer",
            }}>
              <span aria-hidden="true" className="ctc-fold-chevron"
                style={{ display: "inline-flex", color: C.textSubtle }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  style={{ stroke: "currentColor" }}>
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </span>
              Add a Claude generated filter
            </summary>
            <div style={{ marginTop: 8 }}>
              <FilterBox rows={rows} asOf={asOf} onApply={addClaudeFilter} />
            </div>
          </details>
        </div>

        {/* Gaps a filter cannot judge, surfaced rather than left for a reader to
            derive from a shrinking row count. */}
        {(recon.missingTenure > 0 || recon.missingEquity > 0) && (
          <div style={{ marginTop: 12, fontSize: FS.sm, color: C.textSubtle, lineHeight: 1.55 }}>
            {recon.missingEquity > 0 && (
              <div>
                {recon.missingEquity} of {all.length} employees have no equity in this
                snapshot — shown with an em dash rather than a zero.
              </div>
            )}
            {recon.missingTenure > 0 && (
              <div>
                {recon.missingTenure} of {all.length} employees have no recorded hire
                date, so a tenure requirement cannot be evaluated for them.
              </div>
            )}
          </div>
        )}
        </details>
      </div>

      {/* Table and cart side by side, the cart narrow and sticky. minmax(0,1fr)
          rather than 1fr: a grid child defaults to min-content width, so a wide
          table would push the cart off screen instead of scrolling itself.

          The cart column WRAPS below the table rather than holding a fixed track:
          at a fixed 260px on a narrow window the cart sat off-screen, taking the
          Next button — the only way into step 2 — with it. Rendered but invisible
          is the same as missing. */}
      <div style={{
        display: "grid",
        gridTemplateColumns: wide ? "minmax(0, 1fr) 260px" : "minmax(0, 1fr)",
        gap: 16,
        alignItems: "start",
      }}>
        <div style={{
          background: C.surface, border: `1px solid ${C.border}`, borderRadius: RADIUS,
          padding: 16, minWidth: 0,
        }}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            gap: 16, marginBottom: 8,
          }}>
            <div style={{ fontSize: FS.sm, fontWeight: 600, color: C.textSubtle }}>
              Employees ({rows.length}{rows.length !== all.length ? ` of ${all.length}` : ""})
            </div>
            <ExportButton
              onExport={exportCohort}
              title="Download this cohort as CSV — the filtered employee list with equity and vesting"
              disabled={!rows.length}
            />
          </div>
          <div style={{ overflowX: "auto" }}>
            <EmployeeTable
              rows={rows}
              asOf={asOf}
              cart={cart}
              onToggle={(id) => updateCart(toggle(cart, id))}
              headerSel={headerSel}
              onToggleAll={(checked) =>
                updateCart(checked ? addAll(cart, visibleIds) : removeAll(cart, visibleIds))}
            />
          </div>
          <div style={{ fontSize: FS.xs, color: C.textFaint, marginTop: 10 }}>
            Tick an employee to add them to the refresh cycle. The header checkbox
            adds or removes everything currently shown, so a filter narrows what it
            reaches. Total equity is vested plus unvested, the same total CTC's
            Equity Refresh Report shows.
          </div>
        </div>

        <CartPanel
          rows={inCartRows}
          total={cart.size}
          added={added}
          removed={cartRemoved}
          hidden={hidden}
          dropped={dropped}
          saving={saving}
          conflict={conflict}
          onExport={exportCart}
          onClearHidden={clearFilters}
          onNext={() => setStep("settings")}
        />
      </div>
    </div>
  );
}
