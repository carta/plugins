// Step 3 — review the plan and hand it off.
//
// The last thing anyone sees before a refresh cycle leaves this console, so it is
// the place where every number has to be defensible. Two rules do most of the work:
//
// THE POOL GUARDRAIL IS ABSENT OR HONEST, NEVER ZERO
// `poolAvailableShares` is the equity ledger's own `available`, summed across the
// corporation's pools. It arrives absent when nobody has warmed the cache that
// serves it, and — deliberately, in the capture — when the ledger returns no pools
// at all, because that sums to 0 and is indistinguishable from a genuinely spent
// pool. An absent pool renders as a stated reason. Showing "0 available" would tell
// someone their plan overruns a pool we cannot actually see.
//
// EVERY FIGURE HERE IS OURS, SO EVERY FIGURE IS TAGGED
// Unlike the cohort table, nothing on this screen is a value CTC displays: the
// totals are summed here from the settings the user just chose. The card carries
// one Modelled tag rather than four, and the pool row carries its own, because a
// remaining-shares figure is a subtraction we performed.

import { useState } from "react";
import { C, FS, RADIUS } from "../../ui/theme.js";
import { Tag } from "../../ui/components.jsx";
import { shares } from "../../model/format.js";
import { handoffPrompt } from "../../model/handoff.js";

function Tile({ label, value, sub, title }) {
  return (
    <div
      title={title}
      style={{
        flex: "1 1 150px", minWidth: 140, padding: "12px 14px",
        border: `1px solid ${C.border}`, borderRadius: RADIUS, background: C.surfaceDefault,
      }}
    >
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

/** The planned draw against the corporation's pool.
 *
 *  Renders a stated reason instead of a bar when the pool is unknown, matching how
 *  the cohort's filters degrade: a disabled control with a cause reads as a data
 *  gap the user can fix, where a missing one reads as a product that forgot.
 */
function PoolBar({ available, planned }) {
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
  // Clamped only for the BAR's width. The printed numbers stay exact, so an overrun
  // reads as a full bar plus a negative remaining rather than a quietly capped one.
  const pct = available > 0 ? Math.min(100, (planned / available) * 100) : 0;

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
          <div
            title={`${shares(planned)} planned of ${shares(available)} available`}
            style={{
              height: 12, borderRadius: 999, background: C.poolRemaining,
              overflow: "hidden", display: "flex",
            }}
          >
            <div style={{
              width: `${pct}%`, height: "100%",
              background: over ? C.feedbackNegative : C.poolPlanned,
            }} />
          </div>
          <div style={{
            display: "flex", gap: 14, marginTop: 6, fontSize: FS.xs, color: C.textQuiet,
          }}>
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


/** Copies a ready-to-paste issuance prompt.
 *
 *  Deliberately NOT a button that issues. Three separate places enforce this
 *  console's read-only relationship with Carta, and issuance needs terms the plan
 *  does not carry — an equity plan, a vesting template, a document set — which
 *  carta-issuance collects through interactive gates it refuses to delegate.
 *  Copying a prompt keeps every one of those properties intact.
 */
function HandoffCard({ issuable, prompt, copied, failed }) {
  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`, borderRadius: RADIUS,
      padding: 16,
    }}>
      <div style={{ fontSize: FS.sm, fontWeight: 600, color: C.textSubtle, marginBottom: 6 }}>
        Hand off
      </div>
      <div style={{ fontSize: FS.sm, color: C.textSubtle, lineHeight: 1.55, marginBottom: 12 }}>
        Copies a prompt describing this plan — {issuable.length}{" "}
        {issuable.length === 1 ? "employee" : "employees"} and their share counts — to
        paste into your Claude session. Claude drafts the grants there, where it can
        ask you for the vesting schedule, equity plan and exercise price this plan
        does not carry. Nothing is issued from here.
      </div>

      {copied && (
        <div style={{ fontSize: FS.sm, color: C.feedbackPositive }}>
          Copied — paste it into your Claude session.
        </div>
      )}
      {failed && (
        <div style={{ fontSize: FS.sm, color: C.feedbackNotice }}>
          Could not reach the clipboard. Select the prompt below and copy it.
        </div>
      )}

      {/* Shown on failure so the prompt is never trapped behind a broken clipboard. */}
      {failed && (
        <textarea
          readOnly
          value={prompt}
          onFocus={(e) => e.target.select()}
          style={{
            width: "100%", marginTop: 10, minHeight: 160, padding: 10,
            fontSize: FS.sm, fontFamily: "ui-monospace, monospace",
            color: C.textDefault, background: C.surfaceDefault,
            border: `1px solid ${C.borderDefault}`, borderRadius: RADIUS,
          }}
        />
      )}
    </div>
  );
}

export default function ReviewStep({
  totals, poolAvailableShares, grants = [], corporation, corporationId, settings,
  asOf, onBack,
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  const issuable = grants.filter((g) => g.shares != null && g.shares > 0);
  const prompt = handoffPrompt({ grants, corporation, corporationId, settings, asOf });

  const copy = async () => {
    setFailed(false);
    try {
      // Only available on a secure context; the console runs on plain localhost,
      // which browsers do treat as secure — but a failure still has to be visible
      // rather than a button that silently does nothing.
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setFailed(true);
    }
  };
  return (
    <div style={{ padding: "18px 24px 28px", display: "grid", gap: 16 }}>
      <div style={{ fontSize: FS.lg, fontWeight: 600, color: C.text }}>
        Review + hand off
      </div>

      <PoolBar available={poolAvailableShares} planned={totals.totalShares} />

      <div style={{
        background: C.surface, border: `1px solid ${C.border}`, borderRadius: RADIUS, padding: 16,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <span style={{ fontSize: FS.sm, fontWeight: 600, color: C.textSubtle }}>
            Plan summary
          </span>
          <Tag tone="notice" title="Every figure here is calculated in this console from the policy settings and each employee's benchmark. None of it is a value Carta returned.">
            Modelled
          </Tag>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Tile
            label="Employees"
            value={totals.employees}
            sub="receiving refresh grants"
          />
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
          <Tile
            label="No benchmark"
            value={totals.noBenchmark}
            sub="carry no target"
            title="Employees with no equity benchmark for their role in this snapshot. They are in the cohort but contribute to neither the total nor the average — counting them as zero would understate the cycle."
          />
        </div>
        {totals.noBenchmark > 0 && (
          <div style={{ marginTop: 10, fontSize: FS.sm, color: C.textSubtle, lineHeight: 1.55 }}>
            {totals.noBenchmark} of {totals.employees} have no equity benchmark for their
            role in this snapshot, so they carry no target and are counted in neither the
            total nor the average.
          </div>
        )}
      </div>

      {/* The hand-off copies a prompt rather than issuing anything itself. This
          console cannot write to Carta, and issuance needs an equity plan, a
          vesting template and a document set that the plan does not hold — so the
          prompt carries what we know and hands the rest to the flow built to ask
          for it. */}
      <HandoffCard issuable={issuable} prompt={prompt} copied={copied} failed={failed} />

      {/* Back left, primary action right — the same row the cohort and policy
          steps use, so the way forward is always in the same place. */}
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
          ← Back to policy
        </button>
        <button
          type="button"
          onClick={copy}
          disabled={!issuable.length}
          title={issuable.length
            ? "Copy the issuance prompt for this plan"
            : "No employee in this plan has a computable grant"}
          style={{
            height: 40, padding: "0 15px", fontSize: FS.md, fontWeight: 500,
            fontFamily: "inherit", borderRadius: RADIUS,
            cursor: issuable.length ? "pointer" : "not-allowed",
            color: issuable.length ? C.onPrimary : C.textQuiet,
            background: issuable.length ? C.interactivePrimary : C.surfaceUnderlay,
            border: `1px solid ${issuable.length ? C.interactivePrimary : C.borderDefault}`,
          }}
        >
          Issue with Claude
        </button>
      </div>
    </div>
  );
}
