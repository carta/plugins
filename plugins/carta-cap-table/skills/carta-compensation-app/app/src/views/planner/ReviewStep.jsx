// Step 3 — review the plan and hand it off.
//
// The last thing anyone sees before a refresh cycle leaves this console, so it is
// the place where every number has to be defensible. Two rules do most of the work:
//
// The pool guardrail lives in PoolBar.jsx and appears on every step; see that file
// for why an absent pool is never rendered as a pool of zero.
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
  totals, grants = [], corporation, corporationId, settings,
  asOf, onBack, poolBar,
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

      {poolBar}

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
