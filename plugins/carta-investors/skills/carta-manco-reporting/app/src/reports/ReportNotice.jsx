import { useState } from "react";
import { sans, INK, FAINT, RED, FS } from "../ui/theme.js";
import HoverTip from "../ui/HoverTip.jsx";
import { trackClick } from "../analytics.js";
import { AlertIcon, CloudUploadIcon, UsersIcon } from "./icons.jsx";
import { UPDATED, shareOutcome } from "./shareOutcome.js";
import { ownShare } from "./reportState.js";
import { duplicateReport, REPORT_ACTIONS } from "../state/useReports.js";

export function fmtDate(iso) {
  if (!iso) return null;
  const d = new Date(String(iso).length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? null
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Who shared a report with you. Carta names only firm members, so a share made by
// Carta staff on the firm's behalf arrives without a name.
export function sharerName(shared) {
  return shared?.created_by_name || "Carta";
}

// Who a report you shared reaches, in words: everyone, one name, or a count.
export function audienceText(shared, firmName) {
  if (shared.shared_with_everyone) return `everyone at ${firmName || "your firm"} who can view this entity`;
  const ids = shared.shared_with || [];
  const people = peopleOf(shared);
  if (ids.length === 1 && people[0]) return people[0].name || people[0].email;
  return `${ids.length} ${ids.length === 1 ? "person" : "people"}`;
}

export function peopleOf(shared) {
  const known = new Map((shared?.people || []).map(p => [p.user_id, p]));
  return (shared?.shared_with || []).map(id => known.get(id)).filter(Boolean);
}

// One quiet line under the heading about the report on screen: who you shared
// it with (hover for the names), who shared it with you, and whether it was
// built on a different data date than yours. Figures are never adjusted.
// A quick update can't answer these itself — overwriting a newer copy or
// re-creating a deleted one is the owner's call, made in the Share dialog.
const NEEDS_DECISION = {
  stale: "It changed on Carta since you shared it — select Update to choose what to keep.",
  deleted: "The shared copy was deleted — select Update to share it again or keep it private.",
};

export default function ReportNotice({ report, asOf, firmName, reportsApi, onOpenReport, onShareDone }) {
  const [busy, setBusy] = useState(false);
  const [duplicateError, setDuplicateError] = useState(null);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState(null);
  if (!report) return null;
  const shared = report.shared || null;
  const sharedAsOf = shared?.snapshot_basis?.as_of;
  const drift = report.read_only && sharedAsOf && asOf && sharedAsOf !== asOf;

  const duplicate = async () => {
    trackClick("MancoReporting.ReportNotice.Duplicate");
    setBusy(true);
    setDuplicateError(null);
    try {
      await duplicateReport(reportsApi, report, onOpenReport);
    } catch (e) {
      setDuplicateError(e.message);
    } finally {
      setBusy(false);
    }
  };

  // Pushes the report's changes to the people it already reaches. Leaving
  // shared_with out keeps the audience exactly as it is on Carta; `updating` makes the
  // server refuse, not create a new share, when sharing was stopped from another tab.
  const shareUpdate = async () => {
    trackClick("MancoReporting.ReportNotice.ShareUpdate");
    setUpdating(true);
    setUpdateError(null);
    try {
      const outcome = shareOutcome(await reportsApi.runShareOp(REPORT_ACTIONS.SHARE, { report_id: report.id, updating: true }));
      if (outcome.kind === "decide") setUpdateError(`Couldn't share the update. ${NEEDS_DECISION[outcome.status]}`);
      else if (outcome.kind === "partial") setUpdateError(outcome.message);
      else onShareDone?.(UPDATED);
    } catch (e) {
      setUpdateError(`Couldn't share the update. ${e.message}`);
    } finally {
      setUpdating(false);
    }
  };

  const items = [];
  const own = ownShare(report);
  if (own) {
    const people = peopleOf(own);
    const hidden = (own.shared_with || []).length - people.length;
    const tip = own.shared_with_everyone || !(own.shared_with || []).length ? null : (
      <span style={S.tipList}>
        {people.map(p => <span key={p.user_id}>{p.name ? `${p.name} · ${p.email}` : p.email}</span>)}
        {hidden > 0 && <span>{hidden} more {hidden === 1 ? "person" : "people"}</span>}
      </span>
    );
    const when = fmtDate(own.updated_at);
    items.push(
      <span key="owner" style={S.item}>
        <UsersIcon size={14} />
        <HoverTip text={tip}>
          <span style={tip ? S.hoverable : null}>
            Shared with {audienceText(own, firmName)}
          </span>
        </HoverTip>
        {when && <span>· {when}</span>}
        {own.dirty && <span style={S.pending}>· Changes not shared yet</span>}
        {own.dirty && reportsApi.can(REPORT_ACTIONS.SHARE) && (
          <HoverTip text={updating ? "Sharing…" : "Share update"} style={S.iconTip}>
            <button type="button" onClick={shareUpdate} disabled={updating} aria-label="Share update"
              style={{ ...S.iconButton, ...(updating ? S.iconButtonBusy : null) }}>
              <CloudUploadIcon size={15} />
            </button>
          </HoverTip>
        )}
      </span>
    );
    if (updateError) {
      items.push(
        <span key="update-error" role="alert" style={{ ...S.item, color: RED }}>
          <AlertIcon size={14} />
          <span>{updateError}</span>
        </span>
      );
    }
  }
  if (report.read_only) {
    const who = sharerName(shared);
    const when = fmtDate(shared?.updated_at);
    items.push(
      <span key="ro" style={S.item}>
        <UsersIcon size={14} />
        <span>Shared by {who}{when ? ` · ${when}` : ""} · Read-only</span>
        {reportsApi.can(REPORT_ACTIONS.DUPLICATE) && (
          <button type="button" onClick={duplicate} disabled={busy} style={S.link}>Duplicate</button>
        )}
      </span>
    );
    if (duplicateError) {
      items.push(
        <span key="duplicate-error" role="alert" style={{ ...S.item, color: RED }}>
          <AlertIcon size={14} />
          <span>{duplicateError}</span>
        </span>
      );
    }
  }
  if (drift) {
    items.push(
      <span key="drift" style={S.item}>
        <AlertIcon size={14} />
        <span>Built on data as of {fmtDate(sharedAsOf)}; yours is as of {fmtDate(asOf)}.</span>
      </span>
    );
  }
  if (!items.length) return null;
  return <div role="status" style={S.row}>{items}</div>;
}

const S = {
  row: {
    ...sans, display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 16, rowGap: 4,
    margin: "-4px 0 14px", fontSize: FS.small, color: FAINT, lineHeight: "18px",
  },
  item: { display: "inline-flex", alignItems: "center", gap: 6 },
  hoverable: { textDecoration: "underline dotted", textUnderlineOffset: 3, cursor: "default" },
  pending: { color: INK },
  link: {
    ...sans, border: 0, background: "none", padding: 0, cursor: "pointer",
    color: INK, fontSize: "inherit", textDecoration: "underline", textUnderlineOffset: 3,
  },
  tipList: { display: "flex", flexDirection: "column", gap: 2 },
  iconTip: { display: "inline-flex" },
  iconButton: {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: 22, height: 22, padding: 0, border: 0, borderRadius: 4,
    background: "none", color: INK, cursor: "pointer",
  },
  iconButtonBusy: { opacity: 0.5, cursor: "progress" },
};
