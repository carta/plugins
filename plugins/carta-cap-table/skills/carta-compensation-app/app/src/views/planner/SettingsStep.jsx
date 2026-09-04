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

import { useMemo, useState } from "react";
import { C, FS, RADIUS } from "../../ui/theme.js";
import { Select, TableAlign, Tag, Th, Td, useMediaQuery } from "../../ui/components.jsx";
import { shares } from "../../model/format.js";
import { tenureMonths } from "../../model/tenure.js";
import {
  cadenceLabel, eligibility, grantForRow, grantRange, joinMonths, planTotals,
  scaleTargetForCadence, splitMonths,
} from "../../model/policy.js";

// Cadences the form offers. 18 is included because the policy field is months and
// a corporation can hold any value; the list covers what the product's own
// settings expose.
const CADENCES = [6, 12, 18, 24];

/** A number field with a unit suffix, sized for 2-4 digits. */
function NumField({ value, onChange, suffix, width = 64, title, min = 0 }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 4 }}>
      <input
        type="number"
        min={min}
        value={value}
        title={title}
        onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
        style={{
          width, height: 32, padding: "0 8px", fontSize: FS.md, fontFamily: "inherit",
          color: C.textDefault, background: C.surfaceDefault,
          border: `1px solid ${C.borderDefault}`, borderRadius: RADIUS,
          fontVariantNumeric: "tabular-nums",
        }}
      />
      {suffix && <span style={{ fontSize: FS.md, color: C.textSubtle }}>{suffix}</span>}
    </span>
  );
}

function Tile({ label, value, sub }) {
  return (
    <div style={{
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
function YearsMonths({ total, onChange, title }) {
  const { years, months } = splitMonths(total);
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 8 }}>
      <NumField
        value={years}
        onChange={(v) => onChange(joinMonths({ years: v, months }))}
        suffix="year(s)"
        title={title}
      />
      <NumField
        value={months}
        onChange={(v) => onChange(joinMonths({ years, months: v }))}
        suffix="month(s)"
        title={title}
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
function Nav({ onBack }) {
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
    </div>
  );
}

export default function SettingsStep({
  rows, policySettings, settings, onSettings, onBack, asOf,
}) {
  const [showIneligible, setShowIneligible] = useState(true);
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
    ...grantForRow(r, settings, policySettings),
  })), [rows, settings, policySettings, asOf]);

  const eligible = useMemo(() => judged.filter((j) => j.eligible), [judged]);
  const totals = useMemo(
    () => planTotals(eligible.map((j) => j.row), settings, policySettings),
    [eligible, settings, policySettings]);

  const shown = showIneligible ? judged : eligible;

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
      <Nav onBack={onBack} />

      <div style={{
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: RADIUS, padding: 16,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <span style={{ fontSize: FS.sm, fontWeight: 600, color: C.textSubtle }}>
            This cycle
          </span>
          <Tag tone="notice" title="Counts and totals are calculated in this console from the settings above and the benchmark each employee carries.">
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
        gridTemplateColumns: wide ? "minmax(0, 430px) minmax(0, 1fr)" : "minmax(0, 1fr)",
        gap: 16,
        alignItems: "start",
      }}>
        <div style={{
          background: C.surface, border: `1px solid ${C.border}`, borderRadius: RADIUS, padding: 16,
        }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            gap: 12, flexWrap: "wrap", marginBottom: 10,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: FS.lg, fontWeight: 600, color: C.text }}>
                Refresh grant policy
              </span>
              {overridden && (
                <Tag
                  tone="notice"
                  title={`Local to this console. Carta's policy for this corporation is unchanged: ${policySettings.targetPct}% every ${cadenceLabel(policySettings.cadenceMonths)}, ${policySettings.tenureMinMonths}-month tenure requirement, ${policySettings.rangeBelowPct}–${policySettings.rangeAbovePct}% range.`}
                >
                  Local override — not saved to Carta
                </Tag>
              )}
            </div>
            {overridden && (
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
            )}
          </div>

          {!havePolicy ? (
            <div style={{
              padding: "10px 12px", borderRadius: RADIUS,
              background: C.feedbackNoticeSubtle, border: `1px solid ${C.feedbackNotice}`,
              fontSize: FS.sm, color: C.feedbackNotice, lineHeight: 1.55,
            }}>
              <strong>No refresh grant policy in this build.</strong> The settings below
              cannot be applied, and Carta's built-in defaults are deliberately not shown
              in their place — they are not this corporation's policy. Say "refresh" to
              fetch it.
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
                    />
                    <span style={{ fontSize: FS.md, color: C.textSubtle }}>/ every</span>
                    {/* The SAME stored cadence as the Frequency field below — a target
                        only means something paired with the period it repeats over.
                        Editing either moves both, because there is one value. */}
                    <YearsMonths
                      total={settings.cadenceMonths}
                      onChange={setCadence}
                      title="How often an employee may receive a refresh grant"
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
                    />
                    <span style={{ fontSize: FS.md, color: C.textSubtle }}>to</span>
                    <NumField
                      value={settings.rangeAbovePct}
                      onChange={(v) => onSettings({ ...settings, rangeAbovePct: v })}
                      suffix="% above"
                      title="How far over target a manager may flex"
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
        </div>

        <div style={{
          background: C.surface, border: `1px solid ${C.border}`, borderRadius: RADIUS, padding: 16,
        }}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            gap: 16, marginBottom: 8,
          }}>
            <div style={{ fontSize: FS.sm, fontWeight: 600, color: C.textSubtle }}>
              Grants ({shown.length})
            </div>
            <label style={{
              display: "inline-flex", alignItems: "center", gap: 7, cursor: "pointer",
              fontSize: FS.md, color: C.textDefault,
            }}>
              <input
                type="checkbox"
                checked={showIneligible}
                onChange={(e) => setShowIneligible(e.target.checked)}
              />
              Show ineligible
            </label>
          </div>
          <div style={{ overflowX: "auto" }}>
            <TableAlign align="right">
              <table style={{ width: "100%", minWidth: 760, tableLayout: "fixed" }}>
                <thead>
                  <tr>
                    <Th width="26%" align="left">Name</Th>
                    <Th width="10%" align="left">Level</Th>
                    <Th width="12%">Tenure</Th>
                    <Th width="16%">Benchmark</Th>
                    <Th width="16%">Grant</Th>
                    <Th width="20%">Range</Th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(({ row, eligible: ok, reason, shares: sh, modelled }) => {
                    const months = monthsFor(row);
                    const { min, max } = grantRange(sh, settings.rangeBelowPct, settings.rangeAbovePct);
                    return (
                      <tr key={row.external_id} style={ok ? undefined : { opacity: 0.55 }}>
                        <Td align="left" ellipsis title={ok ? row.full_name : `Excluded — ${reason}`}>
                          {row.full_name || row.external_id.slice(0, 8)}
                        </Td>
                        <Td align="left" subtle={!row.job_level}>{row.job_level || "—"}</Td>
                        <Td mono subtle={months == null}>
                          {months == null ? "—" : `${months} mo`}
                        </Td>
                        <Td mono subtle={row.four_year_grant_benchmark_num_shares == null}
                            title={row.four_year_grant_benchmark_num_shares == null
                              ? "No equity benchmark for this role in this snapshot" : undefined}>
                          {row.four_year_grant_benchmark_num_shares == null
                            ? "—" : shares(row.four_year_grant_benchmark_num_shares)}
                        </Td>
                        <Td mono subtle={sh == null}
                            title={sh == null
                              ? "No benchmark, so no target"
                              : modelled
                                ? `Benchmark x ${settings.targetPct}% — calculated here, not Carta's figure`
                                : "Carta's own refresh grant figure at your current policy"}>
                          {sh == null ? "—" : shares(sh)}
                        </Td>
                        <Td mono subtle={min == null}>
                          {min == null ? "—" : `${shares(min)} – ${shares(max)}`}
                        </Td>
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

      <Nav onBack={onBack} />
    </div>
  );
}
