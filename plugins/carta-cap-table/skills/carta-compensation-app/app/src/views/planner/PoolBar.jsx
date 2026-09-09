// The equity pool a refresh cycle draws against, shown on every step.
//
// Every step, not just the last one: a planner who only discovers an overrun on the
// review screen has already done the work twice.
//
// AN ABSENT POOL IS NEVER A POOL OF ZERO
// `available` arrives absent when nobody has warmed the cache that serves it, and
// — deliberately, in the capture — when the ledger returns no pools at all,
// because that sums to exactly 0 and is indistinguishable from a spent pool. Both
// render a stated reason. "0 available" would tell someone their plan overruns a
// pool we cannot actually see.

import { C, FS, RADIUS } from "../../ui/theme.js";
import { Tag } from "../../ui/components.jsx";
import { shares } from "../../model/format.js";

/** The planned draw against the corporation's pool.
 *
 *  Renders a stated reason instead of a bar when the pool is unknown, matching how
 *  the cohort's filters degrade: a disabled control with a cause reads as a data
 *  gap the user can fix, where a missing one reads as a product that forgot.
 */
export default function PoolBar({ available, planned, reserved, outstanding }) {
  if (available == null) {
    return (
      <div style={{
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: RADIUS,
        padding: 16,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: FS.sm, fontWeight: 600, color: C.textSubtle }}>
            Equity pool
          </span>
          <Tag tone="notice" title="The pool figure is served from a cache primed out of band, and a corporation whose ledger reports no pools is indistinguishable from one that has spent it. Neither is reported as zero.">
            Not in this build
          </Tag>
        </div>
        <div style={{ fontSize: FS.sm, color: C.textSubtle, lineHeight: 1.55 }}>
          This plan draws <strong>{shares(planned)}</strong> shares. There is no pool
          figure in this snapshot to measure that against, so no remaining balance is
          shown — rather than a zero that would read as an exhausted pool.
        </div>
      </div>
    );
  }

  const remaining = available - planned;
  const over = remaining < 0;

  // Two independent decisions, deliberately not one guard.
  //
  // WHAT TO SCALE AGAINST: the whole reserved pool whenever we know it. Against
  // `available` alone a pool that is mostly spent still renders as mostly empty,
  // because the spent part is never drawn, and a nearly exhausted pool then looks
  // comfortable. `available` is only the fallback for a capture predating these
  // fields.
  //
  // WHETHER TO DRAW A USED SEGMENT: only when something is actually granted.
  //
  // These come apart, and coupling them was a bug: a pool can be authorised with
  // nothing granted yet (`outstanding` 0) while `available` still sits well below
  // `reserved`, because the ledger also nets off non-returning, poured-out and
  // terminated shares. Corp 7 shows the gap even with grants — reserved minus
  // outstanding is 44,274,151 against an available of 44,260,517. Scaling such a
  // pool to `available` would defeat the point of the change.
  const total = reserved > 0 ? reserved : available;
  const showsUsed = reserved > 0 && outstanding > 0;
  const usedPct = showsUsed ? (outstanding / total) * 100 : 0;
  // Clamped only for the BAR's width. The printed numbers stay exact, so an overrun
  // reads as a full bar plus a negative remaining rather than a quietly capped one.
  const pct = total > 0 ? Math.min(100 - usedPct, (planned / total) * 100) : 0;

  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`, borderRadius: RADIUS,
      padding: 16,
    }}>
      <div style={{
        display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", gap: 24 }}>
          <div>
            <div style={{ fontSize: FS.xs, color: C.textQuiet }}>Available</div>
            <div style={{ fontSize: FS.lg, color: C.text, fontVariantNumeric: "tabular-nums" }}>
              {shares(available)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: FS.xs, color: C.textQuiet }}>Planned</div>
            <div style={{ fontSize: FS.lg, color: C.text, fontVariantNumeric: "tabular-nums" }}>
              {shares(planned)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: FS.xs, color: C.textQuiet }}>Remaining</div>
            <div style={{
              fontSize: FS.lg, fontVariantNumeric: "tabular-nums",
              color: over ? C.feedbackNegative : C.text,
            }}>
              {shares(remaining)}
            </div>
          </div>
        </div>

        {/* Two coloured portions, not one bar on a grey track: the planned draw and
            what would be left. Both segments are named in the legend below, because
            a colour with no key is a decoration rather than a reading. */}
        <div style={{ flex: "1 1 240px", minWidth: 200 }}>
          {/* The title names whatever the bar is actually scaled to. Branching it
              on the used segment instead would say "of N available" on a bar drawn
              against `reserved`. */}
          <div
            title={reserved > 0
              ? (showsUsed
                ? `${shares(outstanding)} already granted, ${shares(planned)} planned, `
                  + `of ${shares(reserved)} reserved`
                : `${shares(planned)} planned of ${shares(reserved)} reserved`)
              : `${shares(planned)} planned of ${shares(available)} available`}
            style={{
              height: 12, borderRadius: 999, background: C.poolRemaining,
              overflow: "hidden", display: "flex",
            }}
          >
            {showsUsed && (
              <div style={{ width: `${usedPct}%`, height: "100%", background: C.poolUsed }} />
            )}
            <div style={{
              width: `${pct}%`, height: "100%",
              background: over ? C.feedbackNegative : C.poolPlanned,
            }} />
          </div>
          <div style={{
            display: "flex", gap: 14, marginTop: 6, fontSize: FS.xs, color: C.textQuiet,
          }}>
            {showsUsed && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 9, height: 9, borderRadius: 2, background: C.poolUsed }} />
                Already granted
              </span>
            )}
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{
                width: 9, height: 9, borderRadius: 2,
                background: over ? C.feedbackNegative : C.poolPlanned,
              }} />
              Planned
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{
                width: 9, height: 9, borderRadius: 2, background: C.poolRemaining,
              }} />
              Remaining
            </span>
          </div>
        </div>
      </div>

      {over && (
        <div style={{ marginTop: 10, fontSize: FS.sm, color: C.feedbackNegative, lineHeight: 1.55 }}>
          This plan draws {shares(planned - available)} more shares than the pool has
          available. Reduce the target, narrow the cohort, or have the pool topped up
          before issuing.
        </div>
      )}
    </div>
  );
}
