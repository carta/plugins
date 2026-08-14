// Scenario-sharing UI: topbar actions for the active scenario, a Pull control, and a status
// panel. Publish/pull/delete run server-side via useShare; names/notes render as escaped text.
import { sans, tightSans, FS } from "./theme.js";
import { Btn } from "./components.jsx";
import { isShared, sharedByLabel } from "../model/slices.js";

const subtle = "var(--ink-color-global-text-subtle)";

function fmtWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Contextual share actions for the active (non-baseline) scenario, styled like the
 *  Rename/Delete tools they sit beside. */
export function ShareControls({ slice, snapshot, userId, busy, onPublish, onFork, onRemove, onDelete }) {
  if (!slice || slice.locked) return null;
  const shared = isShared(slice);
  const owner = shared && slice.shared?.createdBy != null && slice.shared.createdBy === userId;
  const dirty = !!slice.shared?.dirty;
  const btn = { height: "auto", padding: "6px 13px", fontSize: FS.small };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      {!shared && <Btn onClick={onPublish} disabled={busy} style={btn}>Publish</Btn>}
      {shared && (
        <>
          {/* Always shown, disabled until there are edits — so the edit→publish path is
              visible before the user edits, not only after they've changed something. */}
          <Btn onClick={onPublish} disabled={busy || !dirty} style={btn}
            title="Edit any company to change this scenario, then push your changes to the firm.">Update</Btn>
          <Btn onClick={onFork} disabled={busy} style={btn}>Duplicate</Btn>
          <Btn onClick={onRemove} disabled={busy} style={btn}
            title="Hide this from your list — the firm's copy stays; Show hidden brings it back.">Hide</Btn>
          {owner && <Btn kind="danger" onClick={onDelete} disabled={busy} style={btn}>Delete</Btn>}
          {/* Trails the button group so the controls stay visually contiguous. */}
          <span style={{ ...sans, fontSize: FS.small, color: subtle }}>
            Shared · updated {fmtWhen(slice.shared?.updatedAt)} · by {sharedByLabel(slice, userId)}
            {dirty && <strong style={{ color: "var(--ink-color-global-text-default)" }}> · unpublished edits</strong>}
          </span>
        </>
      )}
    </span>
  );
}

/** Firm-level "Load shared scenarios" control for the SHARED sidebar-section header. */
export function PullButton({ onPull, busy }) {
  return (
    <button onClick={onPull} disabled={busy} title="Load shared scenarios" aria-label="Load shared scenarios"
      data-testid="pull-shared"
      style={{ width: 18, height: 18, borderRadius: 4, border: "none", background: "var(--accent-soft)",
        color: "var(--ink-button-background-color-primary-base-default)", cursor: busy ? "default" : "pointer",
        display: "grid", placeItems: "center", padding: 0, opacity: busy ? 0.5 : 1 }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
        strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v11M6 12l6 6 6-6" /></svg>
    </button>
  );
}

const DONE_MSG = {
  pull: (r) => {
    const bits = [];
    if (r.added) bits.push(`${r.added} added`);
    if (r.updated) bits.push(`${r.updated} updated`);
    if (r.skipped) bits.push(`${r.skipped} kept with your edits`);
    if (r.removed) bits.push(`${r.removed} removed`);
    let msg = bits.length ? `Shared scenarios loaded — ${bits.join(", ")}.` : "No shared scenarios yet.";
    if (r.dropped?.length) msg += ` Dropped ${r.dropped.length} company override(s) no longer in Carta.`;
    return msg;
  },
  publish: () => "Scenario shared.",
  delete: () => "Shared scenario deleted.",
};

/** Floating status panel — one at a time, driven by useShare's state machine. */
export function SharePopover({ share, onUpdateAnyway, onPullFirst, onPublishAsNew, onKeepPrivate }) {
  const { status } = share;
  if (!status || status === "idle") return null;
  const panel = {
    position: "fixed", top: 64, right: 20, zIndex: 100, width: 320, ...sans,
    background: "var(--ink-color-global-surface-background-default)", color: "var(--ink-color-global-text-default)",
    border: "1px solid var(--ink-color-global-border-subtle)", borderRadius: 8, padding: 14,
    boxShadow: "0 8px 30px rgba(0,0,0,0.16)", fontSize: FS.body, lineHeight: 1.5,
  };
  const row = { display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" };

  let body;
  if (status === "running") {
    const label = { publish: "Sharing your scenario…", pull: "Loading shared scenarios…", delete: "Deleting…" }[share.action] || "Working…";
    body = <>
      <strong>{label}</strong>
      <div style={{ color: subtle, marginTop: 4 }}>{share.progress || "This takes a moment."}
        {share.total ? ` (${share.step || 0}/${share.total})` : ""}</div>
    </>;
  } else if (status === "stale") {
    body = <>
      <strong>Someone else updated this scenario</strong>
      <div style={{ color: subtle, marginTop: 4 }}>
        It changed on Carta since you loaded it{share.updatedAt ? ` (${fmtWhen(share.updatedAt)})` : ""}.
        Publishing now overwrites those changes.</div>
      <div style={row}>
        <Btn onClick={onUpdateAnyway}>Update anyway</Btn>
        <Btn onClick={onPullFirst}>Load theirs first</Btn>
        <Btn onClick={share.dismiss}>Cancel</Btn>
      </div>
    </>;
  } else if (status === "deleted") {
    body = <>
      <strong>This scenario was deleted</strong>
      <div style={{ color: subtle, marginTop: 4 }}>
        Its owner removed the shared copy for the firm. Your edits are still here — publish them as a
        new shared scenario, or keep a private copy.</div>
      <div style={row}>
        <Btn onClick={onPublishAsNew}>Publish as new</Btn>
        <Btn onClick={onKeepPrivate}>Keep private</Btn>
        <Btn onClick={share.dismiss}>Cancel</Btn>
      </div>
    </>;
  } else if (status === "error") {
    body = <>
      <strong>Couldn't finish</strong>
      <div style={{ color: subtle, marginTop: 4 }}>{share.message || "Something went wrong."}</div>
      <div style={row}><Btn onClick={share.dismiss}>Dismiss</Btn></div>
    </>;
  } else { // done
    const msg = (DONE_MSG[share.action] || (() => "Done."))(share.result || {});
    body = <>
      <strong>Done</strong>
      <div style={{ color: subtle, marginTop: 4 }}>{msg}</div>
      <div style={row}><Btn onClick={share.dismiss}>Dismiss</Btn></div>
    </>;
  }
  return <div style={panel} role="status">{body}</div>;
}
