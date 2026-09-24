// Step 2 — the refresh grant policy, applied to the cart.
//
// The settings start as the CORPORATION'S policy, read from Carta. Editing them
// models a different cycle; it does not change anything in Carta, and the UI has
// to keep saying so — this console cannot write, and a settings form that looks
// like it saved would be the worst possible misunderstanding.
//
// The grant column is the report's own `refresh_grant_num_shares` while the
// target matches policy, and a locally computed figure once it does not. Only the
// second is tagged. Tagging the first would be as wrong as leaving the second
// untagged: one is Carta's number, the other is ours.

import { useEffect, useMemo, useRef, useState } from "react";
import { C, CARD_TITLE, FS, RADIUS } from "../../ui/theme.js";
import { Select, TableAlign, Tag, Th, Td, useMediaQuery } from "../../ui/components.jsx";
import { shares } from "../../model/format.js";
import {
  OWNERSHIP, SHARES, VALUE,
  availableUnits, currencyOf, formatInUnit, perSharePrice, unitLabel,
} from "../../model/equityUnits.js";
import { tenureMonths } from "../../model/tenure.js";
import { vestingNext12, vestingLast12 } from "../../model/cohort.js";
import AskBar from "../../ui/AskBar.jsx";
import { DEFAULT_GRANT_REASON, GRANT_REASONS, reasonFor } from "../../model/grantReason.js";
import {
  cadenceLabel, eligibility, grantForRow, grantRange, joinMonths, planTotals,
  rangeStanding, scaleTargetForCadence, splitMonths, targetShares,
} from "../../model/policy.js";

// Cadences the form offers. 18 is included because the policy field is months and
// a corporation can hold any value; the list covers what the product's own
// settings expose.
const CADENCES = [6, 12, 18, 24];

/** Shared buffer/emit/blur for controlled <input type="number">.
 *
 *  Controlled numeric inputs reconcile by NUMBER — a DOM "012" whose parsed
 *  form matches the prop is left alone, leaving a sticky leading zero. The
 *  buffer holds the raw string; parse maps empty/invalid input to a numeric
 *  emit value; blur snaps the display back to the canonical string.
 */
function useNumericBuffer(value, onChange, parse = (raw) => (raw === "" ? 0 : Number(raw))) {
  const [buffer, setBuffer] = useState(String(value));
  // Guards the sync effect against the user's mid-typing buffer being clobbered
  // by our own onChange round-tripping through the numeric prop.
  const lastEmittedRef = useRef(value);

  useEffect(() => {
    if (value !== lastEmittedRef.current) {
      lastEmittedRef.current = value;
      setBuffer(String(value));
    }
  }, [value]);

  return {
    value: buffer,
    onChange: (e) => {
      const raw = e.target.value;
      setBuffer(raw);
      const next = parse(raw);
      lastEmittedRef.current = next;
      onChange(next);
    },
    onBlur: () => {
      setBuffer(String(lastEmittedRef.current));
    },
  };
}

/** A number field with a unit suffix, sized for 2-4 digits. */
function NumField({ value, onChange, suffix, width = 64, title, min = 0, disabled, label }) {
  const buffered = useNumericBuffer(value, onChange);
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 4 }}>
      <input
        type="number"
        min={min}
        value={buffered.value}
        title={title}
        aria-label={label}
        disabled={disabled}
        readOnly={disabled}
        onChange={buffered.onChange}
        onBlur={buffered.onBlur}
        style={{
          width, height: 32, padding: "0 8px", fontSize: FS.md, fontFamily: "inherit",
          color: disabled ? C.textQuiet : C.textDefault,
          background: disabled ? C.surfaceUnderlay : C.surfaceDefault,
          border: `1px solid ${C.borderDefault}`, borderRadius: RADIUS,
          fontVariantNumeric: "tabular-nums",
          cursor: disabled ? "not-allowed" : undefined,
        }}
      />
      {suffix && (
        <span style={{ fontSize: FS.md, color: disabled ? C.textQuiet : C.textSubtle }}>
          {suffix}
        </span>
      )}
    </span>
  );
}

function Tile({ label, value, sub, title }) {
  return (
    <div title={title} style={{
      flex: "1 1 150px", minWidth: 140, padding: "12px 14px",
      border: `1px solid ${C.border}`, borderRadius: RADIUS, background: C.surfaceDefault,
    }}>
      <div style={{
        fontSize: FS.xs, color: C.textQuiet, textTransform: "uppercase",
        letterSpacing: "0.06em",
      }}>
        {label}
      </div>
      <div style={{
        fontSize: FS.xl, color: C.text, marginTop: 4, fontVariantNumeric: "tabular-nums",
      }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: FS.xs, color: C.textQuiet, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}


/** One labelled setting, shaped like Ink's stacked `Field`: label, control, then
 *  help and the product's stated default underneath.
 *
 *  The default is shown because it is the only way to tell "this corporation chose
 *  30%" from "30% is simply what Carta starts everyone at".
 */
function PolicyField({ label, help, info, children }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ fontSize: FS.md, fontWeight: 600, color: C.textDefault }}>
        {label}
      </div>
      {children}
      <div style={{ fontSize: FS.xs, color: C.textQuiet, lineHeight: 1.6 }}>
        {help}
        {info && (
          <>
            <br />
            {info}
          </>
        )}
      </div>
    </div>
  );
}

/** A duration as the product edits it: a years box and a months box.
 *
 *  Both fields are ONE month count in the model and the API. The split is purely
 *  how CTC asks for it, and joining the pair here keeps that a presentation detail
 *  rather than letting two half-durations into the settings object.
 */
function YearsMonths({ total, onChange, title, disabled, label }) {
  const { years, months } = splitMonths(total);
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 8 }}>
      <NumField
        value={years}
        onChange={(v) => onChange(joinMonths({ years: v, months }))}
        suffix="year(s)"
        title={title}
        disabled={disabled}
        label={label && `${label}, years`}
      />
      <NumField
        value={months}
        onChange={(v) => onChange(joinMonths({ years, months: v }))}
        suffix="month(s)"
        title={title}
        disabled={disabled}
        label={label && `${label}, months`}
      />
    </span>
  );
}


/** Back / forward, rendered BOTH above and below the content.
 *
 *  The grants table runs one row per selected employee — 131 of them on a real
 *  cohort — so a footer-only Next sits several screens below the fold and reads as
 *  missing. The top copy is the one most people will use; the bottom one is there
 *  for anybody who has scrolled to the end of the table.
 */
function Nav({ onBack, onNext }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <button
        type="button"
        onClick={onBack}
        style={{
          height: 40, padding: "0 15px", fontSize: FS.md, fontWeight: 500,
          fontFamily: "inherit", color: C.textDefault, background: C.surfaceDefault,
          border: `1px solid ${C.borderDefault}`, borderRadius: RADIUS, cursor: "pointer",
        }}
      >
        ← Back to cohort
      </button>
      <button
        type="button"
        onClick={onNext}
        title="Review the plan before handing it off"
        style={{
          height: 40, padding: "0 15px", fontSize: FS.md, fontWeight: 500,
          fontFamily: "inherit", color: C.onPrimary, background: C.interactivePrimary,
          border: `1px solid ${C.interactivePrimary}`, borderRadius: RADIUS, cursor: "pointer",
        }}
      >
        Review →
      </button>
    </div>
  );
}

/** CTC's Equity Unit dropdown, applied to this table's equity columns.
 *
 *  Only units this build can compute are offered — the product removes one from
 *  its menu rather than showing a $0 or 0.0000% reading, and so does this.
 */
function EquityUnitToggle({ unit, onUnit, equityUnits }) {
  const options = availableUnits(equityUnits);
  if (options.length < 2) return null;
  return (
    <Select
      label="Equity unit"
      value={unit}
      onChange={onUnit}
      options={options.map((u) => ({ value: u, label: unitLabel(u, equityUnits) }))}
      minWidth={230}
      hint="Shows benchmark, grant and range in this unit. Share counts are Carta's own; ownership and value are calculated here from the corporation's fully diluted count and per-share value."
    />
  );
}


/** Take one employee out of the cycle, from the screen where you notice.
 *
 *  This table is where the consequence of including someone is visible — their
 *  benchmark, their modelled grant, where it sits in the range — and so it is
 *  where the decision "not them, not this cycle" actually gets made. Before this,
 *  acting on it meant going back to step 1 and finding the row again.
 *
 *  It removes from the CART, the same state step 1's checkbox writes, so the two
 *  screens stay one source of truth and the removal persists with the scenario
 *  like any other cart change. No confirm: it is one click to undo from step 1,
 *  and a dialog on a reversible action trains people to dismiss dialogs.
 */
function RemoveCell({ name, onRemove }) {
  const [hover, setHover] = useState(false);
  return (
    <Td align="center">
      <button
        type="button"
        onClick={onRemove}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        // Names the person, not the column: a screen reader hearing "remove"
        // fourteen times learns nothing about which row it is on.
        aria-label={`Remove ${name} from this cycle`}
        title={`Remove ${name} from this cycle`}
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 24, height: 24, padding: 0, borderRadius: RADIUS,
          border: "none", background: hover ? C.rowHover : "transparent",
          color: hover ? C.textDefault : C.textQuiet,
          font: "inherit", fontSize: FS.md, lineHeight: 1, cursor: "pointer",
        }}
      >
        ✕
      </button>
    </Td>
  );
}

/** The Grant reason column — why this grant is being made.
 *
 *  NOT a free-text note. The value rides into Carta through the handoff CSV, where
 *  issuance-import matches it against a synonym list and silently DROPS the column
 *  on a near-miss — so an invented reason issues a grant with no reason at all and
 *  nothing says so. The options are Carta's own vocabulary, and nothing else can
 *  be entered.
 *
 *  Everyone defaults to Refresh, which is what the handoff sent for every row
 *  before this column existed. Only a row that DIFFERS is stored, so an untouched
 *  plan writes no reasons at all.
 */
function ReasonCell({ externalId, name, reasons, onChange }) {
  const value = reasonFor(externalId, reasons);
  const isDefault = value === DEFAULT_GRANT_REASON;
  return (
    <Td align="left">
      <select
        value={value}
        aria-label={`Grant reason for ${name}`}
        onChange={(e) => onChange(externalId, e.target.value)}
        title={isDefault
          ? "Why this grant is being made. Sent to issuance with the plan."
          : `Set to ${value} — the rest of this plan is ${DEFAULT_GRANT_REASON}.`}
        style={{
          width: "100%", height: 32, padding: "0 6px",
          fontSize: FS.md, fontFamily: "inherit",
          // A changed reason is worth seeing at a glance down a 131-row table; the
          // default is the quiet case and stays unremarkable.
          color: isDefault ? C.textSubtle : C.textDefault,
          fontWeight: isDefault ? 400 : 500,
          background: C.surfaceDefault,
          border: `1px solid ${C.borderDefault}`, borderRadius: RADIUS,
        }}
      >
        {GRANT_REASONS.map((r) => (
          <option key={r.value} value={r.value}>{r.label}</option>
        ))}
      </select>
    </Td>
  );
}

/** The Grant column: figure + provenance + editor. Provenance may be untagged
 *  (Carta's `refresh_grant_num_shares` at policy), `Modelled` (benchmark x
 *  target, calculated here), or `Edited` (typed by hand). Clearing the field
 *  records a deliberate 0 override; the `reset` link is the only path back to
 *  the policy/modelled figure. */
function GrantCell({
  row, shares: sh, modelled, overridden, standing, targetPct, onEdit,
  unit, equityUnits,
}) {
  const title = overridden
    ? "Set by hand in this console — Carta's figure is unchanged"
    : sh == null
      ? "No benchmark, so no target"
      : modelled
        ? `Benchmark x ${targetPct}% — calculated here, not Carta's figure`
        : "Carta's own refresh grant figure at your current policy";

  // Grant parse rule: empty typed input records a deliberate 0 override; the
  // `reset` link is the only path back to the policy figure (see docstring).
  const buffered = useNumericBuffer(
    sh == null ? "" : sh,
    (v) => onEdit(row.external_id, v),
    (raw) => (raw === "" ? 0 : Math.max(0, Number(raw))),
  );

  return (
    <Td mono subtle={sh == null && !overridden} title={title}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
        <input
          type="number"
          min={0}
          value={buffered.value}
          aria-label={`Grant for ${row.full_name || row.external_id}`}
          placeholder="—"
          onChange={buffered.onChange}
          onBlur={buffered.onBlur}
          style={{
            width: 92, height: 30, padding: "0 7px", textAlign: "right",
            fontSize: FS.md, fontFamily: "inherit", fontVariantNumeric: "tabular-nums",
            color: C.textDefault, background: C.surfaceDefault,
            border: `1px solid ${standing === "under" || standing === "over"
              ? C.feedbackNotice : C.borderDefault}`,
            borderRadius: RADIUS,
          }}
        />
        {overridden && (
          <button
            type="button"
            onClick={() => onEdit(row.external_id, null)}
            title="Discard this edit and go back to the policy figure"
            style={{
              background: "none", border: "none", padding: 0, font: "inherit",
              fontSize: FS.xs, color: C.linkDefault, cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            reset
          </button>
        )}
      </span>
      {/* The figure stays EDITABLE in shares whatever unit is selected: a grant is
          issued as a share count, and typing a percentage would need a conversion
          nobody asked for. The chosen unit is shown beneath it instead. */}
      {unit !== SHARES && sh != null && (
        <div style={{ fontSize: FS.xs, color: C.textQuiet, marginTop: 2 }}>
          {formatInUnit(sh, unit, equityUnits, shares)}
        </div>
      )}
      {/* Guidance, not a rule: flagged, never rejected. Someone granting above band
          on purpose is doing their job, and a blocked field would stop them. */}
      {(standing === "under" || standing === "over") && (
        <div style={{ fontSize: FS.xs, color: C.feedbackNotice, marginTop: 2 }}>
          {standing === "under" ? "below range" : "above range"}
        </div>
      )}
    </Td>
  );
}

export default function SettingsStep({
  rows, policySettings, settings, onSettings, onBack, onNext, asOf,
  overrides, onOverride, reasons, onReason, onAllReasons, onRemove, poolBar,
  equityUnits, token,
}) {
  // Shares by default: the report's own figure, and the only unit that needs
  // no corporation-level input.
  const [unit, setUnit] = useState(SHARES);
  // Whether the policy panel is expanded. Held in React rather than left to
  // <details>' own DOM state because the GRID needs it: a collapsed panel has to
  // give its 430px column back to the grants table, and a column width cannot be
  // expressed in CSS from a sibling's [open] attribute. The <details> is still the
  // control — this mirrors it via onToggle, so keyboard and click both work.
  const [policyOpen, setPolicyOpen] = useState(true);
  const units = availableUnits(equityUnits);
  const ownershipAvailable = units.includes(OWNERSHIP);
  const valueAvailable = units.includes(VALUE);
  // Below this the two columns stack; the grants table needs the room.
  const wide = useMediaQuery("(min-width: 1100px)");

  // Null when no policy was captured — every control then renders disabled with a
  // reason rather than falling back to Carta's built-in defaults. Presenting those
  // as "your policy" would be invented data.
  const havePolicy = !!policySettings;

  const overridden = useMemo(() => {
    if (!havePolicy) return false;
    return ["targetPct", "cadenceMonths", "rangeBelowPct", "rangeAbovePct", "tenureMinMonths"]
      .some((k) => settings[k] !== policySettings[k]);
  }, [settings, policySettings, havePolicy]);

  const monthsFor = (r) => tenureMonths({ tenure: { start_date: r.hire_date } }, asOf);

  const judged = useMemo(() => rows.map((r) => ({
    row: r,
    ...eligibility(r, settings, monthsFor),
    ...grantForRow(r, settings, policySettings, overrides),
  })), [rows, settings, policySettings, overrides, asOf]);

  const eligible = useMemo(() => judged.filter((j) => j.eligible), [judged]);
  const totals = useMemo(
    () => planTotals(eligible.map((j) => j.row), settings, policySettings, overrides),
    [eligible, settings, policySettings, overrides]);

  // Everyone the cart holds, eligible or not. There was a "Show ineligible"
  // toggle here, defaulted ON, so it only ever removed information from the
  // screen — and hiding an ineligible row makes someone in the cart vanish from
  // this step, which is how "why isn't Bo getting anything?" stops having an
  // answer on screen. They stay, with their reason, contributing to no total.
  const shown = judged;

  const setCadence = (months) => {
    // Only a CADENCE change rescales. Editing the target directly is the user
    // changing the annualized rate, which is what editing it means.
    onSettings({
      ...settings,
      cadenceMonths: months,
      targetPct: scaleTargetForCadence(settings.targetPct, settings.cadenceMonths, months),
    });
  };

  return (
    <div style={{ padding: "18px 24px 28px", display: "grid", gap: 16 }}>
      <Nav onBack={onBack} onNext={onNext} />

      {/* Scenario and pool, composed by the planner so all three steps share one
          header. Reads before the numbers below it: which draft, and what it has
          to spend. */}
      {poolBar}

      {/* The box that edits this page. It was at the FOOT of the page — y=4713 of
          a 4953px page, below all 83 grant rows — which is indistinguishable from
          not being here at all.

          Open, not folded. This step has one of these where the cohort step has
          two nested ones competing for the same tile; there is nothing here for it
          to crowd out, so a fold would only hide it again. */}
      <div style={{
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: RADIUS,
        padding: 16,
      }}>
        <div style={{
          fontSize: FS.sm, color: C.textSubtle, marginBottom: 8,
        }}>
          Change this page
        </div>
        <AskBar
          token={token}
          page="RefreshPlanner:SettingsStep"
          placeholder="Ask Claude to change this page — e.g. add a column for unvested shares"
        />
      </div>

      <div style={{
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: RADIUS, padding: 16,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <span style={{ fontSize: FS.sm, fontWeight: 600, color: C.textSubtle }}>
            This cycle
          </span>
          <Tag tone="notice" pill title="Counts and totals are calculated in this console from the settings above and the benchmark each employee carries.">
            Modelled
          </Tag>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Tile label="Employees" value={totals.employees} sub="receiving grants" />
          <Tile
            label="Total shares"
            value={totals.totalShares ? shares(totals.totalShares) : "—"}
            sub="planned draw"
          />
          <Tile
            label="Avg per employee"
            value={totals.avgShares == null ? "—" : shares(totals.avgShares)}
            sub={totals.counted ? `over ${totals.counted}` : "nothing to average"}
          />
          {/* Shown ALONGSIDE the share counts rather than replacing them: the
              question "how much of the company is this" is a different one from
              "how many shares", and a cycle is usually discussed in both. Each
              appears only when its input was captured — CTC drops the unit rather
              than reading out a 0.0000% or a $0. */}
          {ownershipAvailable && (
            <Tile
              label="Of the company"
              value={formatInUnit(totals.totalShares, OWNERSHIP, equityUnits, shares)}
              sub="fully diluted"
              title={`${shares(equityUnits.fullyDilutedShares)} fully diluted shares`}
            />
          )}
          {valueAvailable && (
            <Tile
              label="Total value"
              value={formatInUnit(totals.totalShares, VALUE, equityUnits, shares)}
              sub={`at ${perSharePrice(equityUnits.equityValue, currencyOf(equityUnits))}/share`}
              title={equityUnits.asOf
                ? `The corporation's per-share equity value, as of ${equityUnits.asOf}`
                : "The corporation's per-share equity value"}
            />
          )}
        </div>
        {totals.noBenchmark > 0 && (
          <div style={{ marginTop: 10, fontSize: FS.sm, color: C.textSubtle, lineHeight: 1.55 }}>
            {totals.noBenchmark} of {totals.employees} have no equity benchmark for their
            role in this snapshot, so they carry no target and are counted in neither the
            total nor the average.
          </div>
        )}
        {judged.length > eligible.length && (
          <div style={{ marginTop: 6, fontSize: FS.sm, color: C.textSubtle, lineHeight: 1.55 }}>
            {judged.length - eligible.length} of {judged.length} do not meet the tenure
            requirement and are excluded from the totals.
          </div>
        )}
      </div>

      {/* Policy and grants side by side, the way the cohort step pairs its table
          with the cart. Editing a field and watching the column beside it move is
          the point of this screen, and stacked the two were never on screen at the
          same time. Stacks below the breakpoint — a fixed second column is the trap
          that hid the cohort step's cart. */}
      <div style={{
        display: "grid",
        // Collapsed, the policy column shrinks to its own content instead of
        // holding 430px open — `auto` is what hands the width to the table rather
        // than leaving a tall empty gutter beside it. Folding only vertically left
        // the column reserved, which is the thing that looked broken.
        //
        // The collapsed panel still occupies a column: it keeps its summary row,
        // and that row carries the Show control and the override tag. Dropping to
        // a single column would move the control under the table.
        gridTemplateColumns: !wide
          ? "minmax(0, 1fr)"
          : policyOpen
            ? "minmax(0, 430px) minmax(0, 1fr)"
            : "auto minmax(0, 1fr)",
        gap: 16,
        alignItems: "start",
      }}>
        <div style={{
          background: C.surface, border: `1px solid ${C.border}`, borderRadius: RADIUS, padding: 16,
        }}>
          {/* Collapsible, reusing step 1's fold: this panel is tall, and once the
              policy is set the grants table beside it is what the user is actually
              working in. Open by default — the settings drive every figure in that
              table, so hiding them by default would hide the explanation. */}
          <details
            open={policyOpen}
            onToggle={(e) => setPolicyOpen(e.currentTarget.open)}
            className="ctc-fold"
          >
            {/* nowrap while collapsed: the summary is the whole width of the
                column then, and letting the title wrap would make a narrow
                two-line stub instead of one tidy row. */}
            <summary style={{
              display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
              flexWrap: policyOpen ? "wrap" : "nowrap",
              whiteSpace: policyOpen ? undefined : "nowrap",
              marginBottom: policyOpen ? 10 : 0,
            }}>
              {/* The shared card title, as an h2 — it names this panel, and a bold
                  span reaches a screen reader as neither. */}
              <h2 style={{ ...CARD_TITLE, color: C.text, margin: 0 }}>
                Refresh grant policy
              </h2>
              {/* The override tag rides on the SUMMARY so it survives collapsing: a
                  folded panel that does not say the policy has been overridden is
                  how a local edit silently becomes the thing nobody notices. */}
              {overridden && (
                <Tag
                  tone="notice"
                  pill
                  title={`Local to this console. Carta's policy for this corporation is unchanged: ${policySettings.targetPct}% every ${cadenceLabel(policySettings.cadenceMonths)}, ${policySettings.tenureMinMonths}-month tenure requirement, ${policySettings.rangeBelowPct}–${policySettings.rangeAbovePct}% range.`}
                >
                  Local override — not saved to Carta
                </Tag>
              )}
              {/* A span, not a button: a <button> inside a <summary> swallows the
                  click that would toggle it. aria-hidden because the summary
                  announces its own open state, and both would be heard twice. */}
              <span
                aria-hidden="true"
                style={{
                  // Pinned right only while open, where the column is a fixed
                  // 430px. Collapsed the column is sized to this row, so an auto
                  // margin would have nothing to push against — it would widen the
                  // stub to fill whatever the grid allowed.
                  marginLeft: policyOpen ? "auto" : 4,
                  display: "inline-flex", alignItems: "center",
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

            {/* OUTSIDE the summary, deliberately: a <button> in there would eat the
                toggle click (see the span above). It belongs with the fields it
                resets anyway, so collapsing the panel takes it along. */}
            {overridden && (
              <div style={{ display: "flex", marginBottom: 10 }}>
                <button
                  type="button"
                  onClick={() => onSettings({ ...policySettings })}
                  style={{
                    height: 32, padding: "0 12px", fontSize: FS.md, fontFamily: "inherit",
                    color: C.textDefault, background: C.surfaceDefault,
                    border: `1px solid ${C.borderDefault}`, borderRadius: RADIUS, cursor: "pointer",
                  }}
                >
                  Reset to Carta policy
                </button>
              </div>
            )}

          {!havePolicy ? (
            <div style={{
              padding: "10px 12px", borderRadius: RADIUS,
              background: C.feedbackNoticeSubtle, border: `1px solid ${C.feedbackNotice}`,
              fontSize: FS.sm, color: C.feedbackNotice, lineHeight: 1.55,
            }}>
              <strong>Refresh grant policy could not be fetched.</strong> The corporation's
              own policy isn't in this build — either the account has no CTC role on it,
              or the fetch itself failed. So the settings below can't be applied. Say
              "refresh" to rebuild; if it fails again, the backend is degraded and this
              needs escalating rather than retrying.
            </div>
          ) : (
            <>
              {/* CTC's Plan Settings fields, in this planner's order and wording.
                  The VALUES are the modal's own and are stored unchanged: the range
                  stays "% below / % above" target, and both durations stay a single
                  month count. Only the labels and the order differ. */}
              <div style={{ display: "grid", gap: 18 }}>
                <PolicyField
                  label="Refresh Grant Target"
                  help={<>
                    Percentage of new hire benchmark used for Refresh Grants.<br />
                    (E.g. If Rachel would receive 100 shares if joining as a new hire
                    today, they would receive {settings.targetPct} as a refresh grant)
                  </>}
                  info="Default: 30%"
                >
                  <span style={{
                    display: "inline-flex", alignItems: "baseline", gap: 8, flexWrap: "wrap",
                  }}>
                    <NumField
                      value={settings.targetPct}
                      onChange={(v) => onSettings({ ...settings, targetPct: v })}
                      suffix="%"
                      title="Percent of the employee's new-hire benchmark"
                      label="Refresh grant target"
                    />
                    <span style={{ fontSize: FS.md, color: C.textSubtle }}>/ every</span>
                    {/* An ECHO of the Frequency field below, not a second control.
                        There is one stored cadence, and two live inputs over one
                        value invite the reader to wonder which one wins. Greyed and
                        read-only says "this is shown here, set there" — the target
                        still needs the period beside it to mean anything. */}
                    <YearsMonths
                      total={settings.cadenceMonths}
                      onChange={setCadence}
                      title="Set by the Frequency field below — one cadence, shown here because a target means nothing without the period it repeats over"
                      disabled
                    />
                  </span>
                </PolicyField>

                <PolicyField
                  label="Suggested Grant Range"
                  help="Preferred minimum and maximum refresh grant amounts based on Grant Target."
                  info="Default: 10% above and below target"
                >
                  <span style={{
                    display: "inline-flex", alignItems: "baseline", gap: 8, flexWrap: "wrap",
                  }}>
                    <NumField
                      value={settings.rangeBelowPct}
                      onChange={(v) => onSettings({ ...settings, rangeBelowPct: v })}
                      suffix="% below"
                      title="How far under target a manager may flex"
                      label="Suggested range, percent below target"
                    />
                    <span style={{ fontSize: FS.md, color: C.textSubtle }}>to</span>
                    <NumField
                      value={settings.rangeAbovePct}
                      onChange={(v) => onSettings({ ...settings, rangeAbovePct: v })}
                      suffix="% above"
                      title="How far over target a manager may flex"
                      label="Suggested range, percent above target"
                    />
                    <span style={{ fontSize: FS.md, color: C.textSubtle }}>based on Target</span>
                  </span>
                </PolicyField>

                <PolicyField
                  label="Frequency: How often can employees receive a tenure grant"
                  help="If there is no time constraint, leave both as 0."
                  info="Default: 1 year"
                >
                  <YearsMonths
                    total={settings.cadenceMonths}
                    onChange={setCadence}
                    title="How often an employee may receive a refresh grant"
                  />
                </PolicyField>

                <PolicyField
                  label="Eligibility: Tenure Requirement"
                  help={<>
                    Minimum time employee must work at company to be eligible.<br />
                    If there is no time constraint, leave both as 0.
                  </>}
                  info="Default: 2 year"
                >
                  <YearsMonths
                    total={settings.tenureMinMonths}
                    onChange={(v) => onSettings({ ...settings, tenureMinMonths: v })}
                    title="Minimum time at the company to be eligible"
                  />
                </PolicyField>
              </div>
            </>
          )}
          </details>
        </div>

        <div style={{
          background: C.surface, border: `1px solid ${C.border}`, borderRadius: RADIUS, padding: 16,
        }}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            gap: 16, marginBottom: 8,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <span style={{ fontSize: FS.sm, fontWeight: 600, color: C.textSubtle }}>
                Grants ({shown.length})
              </span>
              <EquityUnitToggle unit={unit} onUnit={setUnit} equityUnits={equityUnits} />
            </div>
            {/* One reason across the whole plan. A select that snaps back to its
                label rather than holding a value: it is an action on every row, not
                a field describing one, and leaving it showing "Promotion" would
                claim a uniformity the per-row cells below are free to break. */}
            <label style={{
              display: "inline-flex", alignItems: "center", gap: 7,
              fontSize: FS.sm, color: C.textSubtle,
            }}>
              Set all reasons to
              <select
                value=""
                onChange={(e) => { if (e.target.value) onAllReasons(e.target.value); }}
                title="Applies one grant reason to every employee in this plan, replacing any set per row"
                style={{
                  height: 32, padding: "0 6px", fontSize: FS.md, fontFamily: "inherit",
                  color: C.textDefault, background: C.surfaceDefault,
                  border: `1px solid ${C.borderDefault}`, borderRadius: RADIUS,
                }}
              >
                <option value="">Choose…</option>
                {GRANT_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ overflowX: "auto" }}>
            <TableAlign align="right">
              {/* 1414, MEASURED — the sum of what every column actually needs, not
                  a round number and not a guess.

                  `tableLayout: fixed` splits the width by the percentages below and
                  CLIPS whatever does not fit, so a floor that is too small squeezes
                  columns rather than scrolling the container. That is what went
                  wrong at the old 940: the two new headers got 61px against the
                  ~103px their text needs, and six headers were clipped at once —
                  reported from QA as columns overwriting each other.

                  Per column the need is its header text plus 20px of cell padding,
                  or its widest body cell where that is wider (Name 164,
                  Specialization 197, Suggested Range 167). Headers alone come to
                  1002; with the body cells it is 1414.

                  Specialization was ALREADY clipped before the new columns landed
                  (112 needed, 70 given) — adding two columns to a table with no
                  slack is what turned a latent squeeze into a visible one.

                  The percentages are each column's share of that 1414, so at the
                  floor every one gets what it needs and above it they grow
                  proportionally. Change one and re-measure the rest. */}
              <table style={{ width: "100%", minWidth: 1414, tableLayout: "fixed" }}>
                <thead>
                  <tr>
                    <Th width="12%" align="left">Name</Th>
                    <Th width="4%" align="left">Level</Th>
                    <Th width="10%" align="left">Area</Th>
                    <Th width="14%" align="left">Specialization</Th>
                    <Th width="5%">Tenure</Th>
                    {/* Before Benchmark, so the row reads context first and the
                        policy chain (benchmark → range → grant) stays unbroken to
                        the right. Carta's own NTM/TTM figures — see vestingNext12.

                        Their headers are the longest text in the table (~103px), so
                        they are sized from that rather than from the values. */}
                    <Th width="9%">Next 12 Months</Th>
                    <Th width="8%">Last 12 Months</Th>
                    <Th width="7%">Benchmark</Th>
                    {/* Range before Grant: the corridor is the recommendation and the
                        grant is the decision, so reading left to right goes from what
                        policy suggests, to what this plan does, to why.

                        "Suggested Range" rather than "Range": the policy field above
                        is already labelled Suggested Grant Range, and the two were
                        naming the same number differently. */}
                    <Th width="12%">Suggested Range</Th>
                    <Th width="9%">Grant</Th>
                    <Th width="8%" align="left">Grant reason</Th>
                    {/* No header text: the column is one control per row,
                        and "Remove" above a column of ✕ buttons labels the
                        column rather than saying anything new. */}
                    <Th width="2%" align="center"><span aria-hidden="true" /></Th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(({ row, eligible: ok, reason, shares: sh, modelled, overridden }) => {
                    const months = monthsFor(row);
                    const next12 = vestingNext12(row);
                    const last12 = vestingLast12(row);
                    // The corridor brackets the POLICY target, not the displayed
                    // figure. Bracketing the displayed one would move the goalposts
                    // with every edit, so nothing could ever read as out of range.
                    const target = targetShares(row, settings.targetPct);
                    const { min, max } = grantRange(
                      target, settings.rangeBelowPct, settings.rangeAbovePct);
                    const standing = rangeStanding(sh, row, settings);
                    return (
                      <tr key={row.external_id} style={ok ? undefined : { opacity: 0.55 }}>
                        <Td align="left" ellipsis title={ok ? row.full_name : `Excluded — ${reason}`}>
                          {row.full_name || row.external_id.slice(0, 8)}
                        </Td>
                        <Td align="left" subtle={!row.job_level}>{row.job_level || "—"}</Td>
                      <Td align="left" ellipsis subtle={!row.job_area}
                          title={row.job_area || "No job area recorded"}>
                        {row.job_area || "—"}
                      </Td>
                      {/* Sparse on real data — 4 of 134 rows on the corporation this
                          was built against. An em dash says "not recorded", where a
                          blank cell reads as "this role has no specialization". */}
                      <Td align="left" ellipsis subtle={!row.job_focus}
                          title={row.job_focus || "No specialization recorded for this role"}>
                        {row.job_focus || "—"}
                      </Td>
                        <Td mono subtle={months == null}>
                          {months == null ? "—" : `${months} mo`}
                        </Td>
                        {/* Through formatInUnit like every other equity figure in
                            this table, so the %/$ toggle moves them too — a column
                            of raw shares beside converted ones would misread. */}
                        <Td mono subtle={next12 === null}
                            title={next12 === null
                              ? "Next-12-month vesting is not in this snapshot"
                              : "Shares vesting over the next 12 months"}>
                          {next12 === null
                            ? "—" : formatInUnit(next12, unit, equityUnits, shares)}
                        </Td>
                        <Td mono subtle={last12 === null}
                            title={last12 === null
                              ? "Last-12-month vesting is not in this snapshot"
                              : "Shares vested over the last 12 months"}>
                          {last12 === null
                            ? "—" : formatInUnit(last12, unit, equityUnits, shares)}
                        </Td>
                        <Td mono subtle={row.four_year_grant_benchmark_num_shares == null}
                            title={row.four_year_grant_benchmark_num_shares == null
                              ? "No equity benchmark for this role in this snapshot" : undefined}>
                          {formatInUnit(
                            row.four_year_grant_benchmark_num_shares, unit, equityUnits, shares)}
                        </Td>
                        <Td mono subtle={min == null}>
                          {min == null
                            ? "—"
                            : `${formatInUnit(min, unit, equityUnits, shares)} – `
                              + `${formatInUnit(max, unit, equityUnits, shares)}`}
                        </Td>
                        <GrantCell
                          row={row}
                          shares={sh}
                          modelled={modelled}
                          overridden={overridden}
                          standing={standing}
                          targetPct={settings.targetPct}
                          onEdit={onOverride}
                          unit={unit}
                          equityUnits={equityUnits}
                        />
                        <ReasonCell
                          externalId={row.external_id}
                          name={row.full_name || row.external_id}
                          reasons={reasons}
                          onChange={onReason}
                        />
                        <RemoveCell
                          name={row.full_name || row.external_id}
                          onRemove={() => onRemove(row.external_id)}
                        />
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableAlign>
          </div>
          <div style={{ fontSize: FS.xs, color: C.textFaint, marginTop: 10 }}>
            At your corporation's policy the grant column is Carta's own figure, which
            honours any per-employee override. Change the target and the column is
            calculated here instead — the tooltip on each cell says which.
          </div>
        </div>
      </div>

      <Nav onBack={onBack} onNext={onNext} />
    </div>
  );
}
