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
import { C, FS, RADIUS } from "../ui/theme.js";
import ExportButton from "../ui/ExportButton.jsx";
import { MultiSelect, Select, TableAlign, Tag, Th, Td, useMediaQuery } from "../ui/components.jsx";
import { csvFilename, downloadCsv, toCsv } from "../model/csv.js";
import { shares } from "../model/format.js";
import { formatTenure, tenureMonths } from "../model/tenure.js";
import { applyFilters, levelRank, totalEquity } from "../model/cohort.js";
import {
  addAll, cartRows, diff, headerState, hiddenCount, reconcile, removeAll, toggle,
} from "../model/cart.js";
import { useScenario } from "../state/useScenario.js";
import CartPanel from "./planner/CartPanel.jsx";
import SettingsStep from "./planner/SettingsStep.jsx";
import ReviewStep from "./planner/ReviewStep.jsx";
import {
  eligibility, grantForRow, planTotals, policyToSettings,
} from "../model/policy.js";

// Offered windows, matching the CTC report's own dropdown so the two surfaces stay
// comparable even though this one inverts the direction.
const VESTING_WINDOWS = [6, 12, 18, 24];

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
      <table style={{ width: "100%", minWidth: 1090, tableLayout: "fixed" }}>
        <thead>
          <tr>
            <Th width="4%" align="center">
              <SelectAllBox state={headerSel} onChange={onToggleAll} count={rows.length} />
            </Th>
            <Th width="19%" align="left">Name</Th>
            <Th width="15%" align="left">Job Title</Th>
            <Th width="8%" align="left">Level</Th>
            <Th width="11%" align="left">Job Area</Th>
            <Th width="9%">Tenure</Th>
            <Th width="10%" align="left">Geo</Th>
            <Th width="8%">Total equity</Th>
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

export default function RefreshPlanner({ planner, corporation, corporationId }) {
  // One "now" for the whole render, so every row is measured against the same
  // instant. Calling new Date() per row would let a table straddle midnight and
  // report two different tenures for two people who started the same day.
  const asOf = useMemo(() => new Date(), []);

  const all = planner.rows || [];
  const availability = planner.availability || {};
  const recon = planner.reconciliation || {};

  const [hasGrants, setHasGrants] = useState(false);
  // A Set, not an array — MultiSelect reads `.has`/`.size` on it. The filter model
  // takes an array, so this is converted at that boundary rather than here.
  const [areas, setAreas] = useState(() => new Set());
  const [levelMin, setLevelMin] = useState(null);
  const [levelMax, setLevelMax] = useState(null);
  const [vestWindow, setVestWindow] = useState(0);

  // The cart. Held here rather than in the table so the panel, the counts and the
  // export all read one source.
  // Two steps, one state. No router: this is a two-screen flow inside one tab,
  // and a router would be more machinery than the thing it navigates.
  const [step, setStep] = useState("cohort");
  // Below this the cart stacks under the table rather than sitting off-screen.
  const wide = useMediaQuery("(min-width: 900px)");
  const [cart, setCart] = useState(() => new Set());
  const [dropped, setDropped] = useState(0);
  const { saved, loading: cartLoading, conflict, save } = useScenario(corporationId);
  const hydrated = useRef(false);

  // Adopt the saved cart once, after it loads. Ids that no longer exist in this
  // snapshot are dropped and counted — a rebuild can retire someone, and doing
  // that silently would shrink a plan without saying so.
  useEffect(() => {
    if (cartLoading || hydrated.current || !saved) return;
    hydrated.current = true;
    const { cart: kept, dropped: gone } = reconcile(saved, all.map((r) => r.external_id));
    setCart(kept);
    setDropped(gone);
  }, [cartLoading, saved, all]);

  // The corporation's policy, and the settings the user is modelling with. The
  // settings START as the policy and diverge only when edited — `null` until the
  // policy loads, so an absent policy never silently becomes Carta's defaults.
  const policySettings = useMemo(() => policyToSettings(planner.policy), [planner.policy]);
  const [settings, setSettings] = useState(null);
  useEffect(() => {
    if (policySettings && !settings) setSettings({ ...policySettings });
  }, [policySettings, settings]);

  // Every mutation goes through here so no path can change the cart without
  // scheduling the save that persists it.
  const updateCart = (next) => {
    setCart(next);
    save(next);
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

  const { rows, removed } = useMemo(() => applyFilters(
    all,
    {
      hasPriorGrants: hasGrants,
      jobAreas: [...areas],
      levelMin: levelMin === null ? null : Number(levelMin),
      levelMax: levelMax === null ? null : Number(levelMax),
      excludeVestingWithinMonths: vestWindow,
    },
    availability,
    asOf,
  ), [all, hasGrants, areas, levelMin, levelMax, vestWindow, availability, asOf]);

  // Cart figures, all derived from the one Set. `visibleIds` is the filtered view,
  // which is what select-all acts on — reaching past the filters would add people
  // the user has not looked at.
  const visibleIds = useMemo(() => rows.map((r) => r.external_id), [rows]);
  const headerSel = headerState(cart, visibleIds);
  const inCartRows = useMemo(() => cartRows(all, cart), [all, cart]);
  const { added, removed: cartRemoved } = diff(cart, saved);
  const hidden = hiddenCount(cart, visibleIds);

  const clearFilters = () => {
    setHasGrants(false);
    setAreas(new Set());
    setLevelMin(null);
    setLevelMax(null);
    setVestWindow(0);
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

  if (step === "settings") {
    return (
      <SettingsStep
        rows={inCartRows}
        policySettings={policySettings}
        settings={liveSettings}
        onSettings={setSettings}
        onBack={() => setStep("cohort")}
        onNext={() => setStep("review")}
        asOf={asOf}
      />
    );
  }

  if (step === "review") {
    // Computed here rather than carried from step 2 so the summary cannot drift
    // from the settings: one source, recomputed on the settings the user actually
    // left in place. Tenure-ineligible employees are already excluded upstream in
    // SettingsStep's own totals, so the same filter is applied here.
    // The SAME predicate step 2 uses, not a reimplementation of it — a summary
    // that counted a different cohort than the screen before it would be worse
    // than no summary.
    const monthsFor = (r) => tenureMonths({ tenure: { start_date: r.hire_date } }, asOf);
    const eligibleRows = inCartRows.filter(
      (r) => eligibility(r, liveSettings, monthsFor).eligible);
    // Per-employee, for the issuance hand-off. Same grantForRow the settings
    // screen's own table uses, so the prompt cannot disagree with what was on
    // screen when the user decided to hand it off.
    const grants = eligibleRows.map((r) => ({
      name: r.full_name,
      externalId: r.external_id,
      shares: grantForRow(r, liveSettings, policySettings).shares,
    }));
    return (
      <ReviewStep
        totals={planTotals(eligibleRows, liveSettings, policySettings)}
        poolAvailableShares={planner.poolAvailableShares ?? null}
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
      <div style={{
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: RADIUS,
        padding: 16,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <span style={{ fontSize: FS.lg, fontWeight: 600, color: C.text }}>
            Refresh cohort
          </span>
          {/* Only tenure is modelled — the equity figures are the report's own and
              carry no tag, because tagging a value the product already displays is
              as misleading as leaving a derived one untagged. */}
          <Tag tone="notice" title="Tenure is calculated in this console from the report's hire date. Every other figure is Carta's own, as shown in the Equity Refresh Report.">
            Tenure is modelled
          </Tag>
        </div>
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
            <Checkbox
              label="Has prior grants"
              checked={hasGrants}
              onChange={setHasGrants}
              title="Keeps only employees holding at least one live grant. Cancelled and forfeited awards are already excluded by Carta."
            />
          )}

          <MultiSelect
            label="Job area"
            options={areaOptions}
            selected={areas}
            onToggle={(v) => setAreas((prev) => {
              const next = new Set(prev);
              if (next.has(v)) next.delete(v);
              else next.add(v);
              return next;
            })}
            onAll={() => setAreas(new Set())}
            allLabel={`All (${areaOptions.length})`}
            minWidth={170}
          />

          <Select
            label="Level from"
            value={levelMin === null ? "" : levelMin}
            onChange={(v) => setLevelMin(v === "" ? null : v)}
            options={[{ value: "", label: "Any" }, ...levelOptions]}
            minWidth={110}
          />
          <Select
            label="Level to"
            value={levelMax === null ? "" : levelMax}
            onChange={(v) => setLevelMax(v === "" ? null : v)}
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
              onChange={(v) => setVestWindow(Number(v))}
              options={[
                { value: "0", label: "No exclusion" },
                ...VESTING_WINDOWS.map((m) => ({ value: String(m), label: `${m} months` })),
              ]}
              minWidth={190}
              hint="Removes employees about to fully vest — the opposite of the CTC report's filter, which keeps them."
            />
          )}
        </div>

        {removed > 0 && (
          <div style={{ marginTop: 12 }}>
            <Tag>{removed} excluded by filters</Tag>
          </div>
        )}

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
          conflict={conflict}
          onExport={exportCart}
          onClearHidden={clearFilters}
          onNext={() => setStep("settings")}
        />
      </div>
    </div>
  );
}
