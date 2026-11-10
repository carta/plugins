import { useCallback, useEffect, useRef, useState } from "react";
import { sans, INK, FAINT, LINE, RED, FS } from "../ui/theme.js";
import { Btn, MenuItem, POPOVER_SHADOW } from "../ui/components.jsx";
import { trackClick } from "../analytics.js";
import { actSaved, duplicateReport, REPORT_ACTIONS } from "../state/useReports.js";
import Modal from "./Modal.jsx";
import ShareDialog from "./ShareDialog.jsx";
import HoverTip from "../ui/HoverTip.jsx";
import { ClaudePrompt, ClaudeSignIn, claudeFixPrompt } from "../ui/claudeFix.jsx";
import { MoreIcon, ShareIcon, UnsharedDot, XIcon } from "./icons.jsx";
import { fmtDate } from "./ReportNotice.jsx";
import { ownShare, ownSync } from "./reportState.js";

const UNSHARED_TIP = "Changes not shared yet. Open Share to update.";
const UNSYNCED_TIP = "This report has changes not yet synced to the hosted app.";
const SYNC_PURPOSE = "sync this report to the hosted app";

// Whether a report gets the Share panel, which also holds Export: yours, or one shared
// with you (the panel then says why you can't share it).
export const hasSharePanel = (report) => !!(report?.editable || report?.read_only);

// The Budget vs Actuals header's report controls: Share, which also holds Export, and a menu
// for editing a custom report, renaming, duplicating, hiding and deleting.
export default function ReportActions({ report, reportsApi, firmName, entityName, exportProps, hosted, accountsData, onOpenReport, onShareDone, onEditCustomReport }) {
  const [open, setOpen] = useState(null); // "share" | "rename" | "confirm-delete"
  const [menu, setMenu] = useState(false);
  const [error, setError] = useState(null);
  // While a share runs, the panel stays open so its outcome lands; only it closes itself.
  const [shareBusy, setShareBusy] = useState(false);
  const onShareBusy = useCallback((busy) => {
    setShareBusy(busy);
    if (busy) setMenu(false); // a menu left open from the keyboard
  }, []);
  const menuRef = useRef(null);
  const shareRef = useRef(null);

  // The Sync error popover lives in this same anchor (menuRef), so a click outside it
  // or Escape closes whichever of the two is open, the same way ShareDialog's own
  // panel does for Share.
  useEffect(() => {
    if (!menu && !error) return undefined;
    const onDoc = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) { setMenu(false); setError(null); } };
    const onKey = (e) => { if (e.key === "Escape") { setMenu(false); setError(null); } };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu, error]);

  if (!report) return null;
  const own = ownShare(report);
  const dirty = !!own?.dirty;
  // A report you are sharing can't go until you stop sharing it. "synced" is an own-sync
  // mirror of a local custom report (server/reportShare.js's ownReportsFromBundle) — deletable
  // the same way a copy is, but kept a distinct origin so it never passes CustomReportView's
  // copy-only canSave check.
  const canDelete = !own && (report.origin === "copy" || report.origin === "shared" || report.origin === "synced");

  // own_sync is local-only — the hosted copy is the destination, never a source
  // syncing itself — and a report shared with you isn't yours to mirror
  // (own_sync.plan_push refuses it the same way hasSharePanel's own check does for Share).
  const ownSyncState = ownSync(report);
  const syncStale = !!ownSyncState?.stale;
  const syncTip = !ownSyncState
    ? "Pushes a private copy of this report to the hosted app, visible only to you there."
    : syncStale
    ? "This report has changed since it was last synced — select to sync it again."
    : `Last synced to the hosted app ${fmtDate(ownSyncState.synced_at)} — select to sync again.`;

  // Computed once per render (not once per self-heal element) so the two spots that
  // read it — whether to show ClaudePrompt at all, and what to put in it — can never
  // disagree, the same shape ShareDialog's own `peopleFixPrompt`/`errorFixPrompt` use.
  const fixPrompt = error ? claudeFixPrompt(error.code, hosted, SYNC_PURPOSE) : null;

  // Kept as the whole thrown error (not just its message): a Carta action's own error
  // carries a `code` share_bridge.ShareError set, which the Claude self-heal UI below
  // reads — the same one Share's own dialogs already render for exactly these two codes.
  const act = (fn) => async (...args) => {
    setMenu(false);
    setError(null);
    try {
      await fn(...args);
    } catch (e) {
      setError(e);
    }
  };

  const duplicate = act(async () => {
    trackClick("MancoReporting.ReportMenu.Duplicate");
    await duplicateReport(reportsApi, report, onOpenReport);
  });
  const hide = act(async () => {
    trackClick("MancoReporting.ReportMenu.Hide");
    const { notice } = await actSaved(reportsApi, report.id, REPORT_ACTIONS.HIDE, { hidden: true });
    if (notice) onShareDone?.(notice);
    onOpenReport(null);
  });

  // No audience to pick — own_sync is always visible to nobody but you — so, unlike
  // Share, there's no dialog: one click plans and sends the push.
  const sync = act(async () => {
    trackClick("MancoReporting.ReportMenu.Sync");
    await reportsApi.runShareOp(REPORT_ACTIONS.SYNC, { report_id: report.id });
  });

  return (
    <>
      {/* On a report shared with you the panel still opens: it says why you can't share, and holds Export. */}
      {hasSharePanel(report) && (
        <div ref={shareRef} style={{ position: "relative" }}>
          {/* The label stays Share: the dot and its tooltip say there are changes to send. */}
          <HoverTip text={dirty && open !== "share" ? UNSHARED_TIP : null}>
            <Btn onClick={() => setOpen(o => (o === "share" ? null : "share"))} disabled={shareBusy}
              aria-label={dirty ? "Share report, changes not shared yet" : "Share report"}
              aria-expanded={open === "share"} aria-haspopup="dialog">
              <UnsharedDot show={dirty}><ShareIcon /></UnsharedDot>
              Share
            </Btn>
          </HoverTip>
          {open === "share" && (
            <ShareDialog report={report} reportsApi={reportsApi} firmName={firmName} entityName={entityName}
              accountsData={accountsData}
              exportProps={exportProps} hosted={hosted} anchorRef={shareRef} onClose={() => setOpen(null)}
              onDone={onShareDone} onBusyChange={onShareBusy} />
          )}
        </div>
      )}
      <div ref={menuRef} style={{ position: "relative" }}>
        {/* The dot and its tooltip carry the same "changes not synced yet" signal Share's
            own dot carries, right on the trigger — so it reads before the menu opens. */}
        <HoverTip text={!hosted && syncStale ? UNSYNCED_TIP : null}>
          <Btn onClick={() => setMenu(m => !m)} disabled={shareBusy} aria-haspopup="menu" aria-expanded={menu}
            aria-label={!hosted && syncStale ? "Report actions, changes not synced yet" : "Report actions"}>
            <UnsharedDot show={!hosted && syncStale}><MoreIcon /></UnsharedDot>
          </Btn>
        </HoverTip>
        {menu && (
          <div role="menu" style={S.menu}>
            {report.editable && reportsApi.can(REPORT_ACTIONS.RENAME) && (
              <MenuItem small onClick={() => { setMenu(false); setOpen("rename"); }}>Rename</MenuItem>
            )}
            {onEditCustomReport && reportsApi.can(REPORT_ACTIONS.EDIT) && (
              <MenuItem small onClick={() => { setMenu(false); trackClick("MancoReporting.ReportMenu.EditCustomReport"); onEditCustomReport(); }}>Edit report</MenuItem>
            )}
            {reportsApi.can(REPORT_ACTIONS.DUPLICATE) && <MenuItem small onClick={duplicate}>Duplicate</MenuItem>}
            {reportsApi.can(REPORT_ACTIONS.HIDE) && <MenuItem small onClick={hide}>Hide</MenuItem>}
            {!hosted && report.editable && reportsApi.can(REPORT_ACTIONS.SYNC) && (
              <HoverTip text={syncTip} style={S.menuTip}>
                <MenuItem small onClick={sync}>
                  <UnsharedDot show={syncStale}>Sync to hosted app</UnsharedDot>
                </MenuItem>
              </HoverTip>
            )}
            {canDelete && reportsApi.can(REPORT_ACTIONS.REMOVE) && (
              <MenuItem small onClick={() => { setMenu(false); setOpen("confirm-delete"); }} style={{ color: RED }}>
                {report.origin === "shared" ? "Remove from my reports" : report.origin === "synced" ? "Delete this report" : "Delete this copy"}
              </MenuItem>
            )}
          </div>
        )}
        {/* Anchored to the ⋯ trigger that caused it, not a stray block in the page flow —
            closes the same way the Share panel does (click outside, Escape, or its own ×). */}
        {error && (
          <div role="alert" style={S.errorPopover}>
            <button type="button" aria-label="Dismiss" onClick={() => setError(null)} style={S.errorClose}>
              <XIcon size={14} />
            </button>
            <div style={S.errorTitle}>Couldn't finish</div>
            <div style={S.errorMsg}>{error.message}</div>
            <ClaudeSignIn code={error.code} hosted={hosted} event="MancoReporting.ReportMenu.SyncSignIn" />
            {fixPrompt && <ClaudePrompt text={fixPrompt} event="MancoReporting.ReportMenu.SyncCopyFixPrompt" />}
          </div>
        )}
      </div>

      {open === "rename" && (
        <RenameDialog report={report} reportsApi={reportsApi} onClose={() => setOpen(null)} onShareDone={onShareDone} />
      )}
      {open === "confirm-delete" && (
        <DeleteDialog report={report} reportsApi={reportsApi} onClose={() => setOpen(null)}
          onDeleted={(notice) => { setOpen(null); if (notice) onShareDone?.(notice); onOpenReport(null); }} />
      )}
    </>
  );
}

function RenameDialog({ report, reportsApi, onClose, onShareDone }) {
  const [name, setName] = useState(report.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const save = async () => {
    trackClick("MancoReporting.ReportMenu.Rename");
    setBusy(true);
    setError(null);
    try {
      const { notice } = await actSaved(reportsApi, report.id, REPORT_ACTIONS.RENAME, { name });
      onClose();
      if (notice) onShareDone?.(notice);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };
  const trimmed = name.trim();
  return (
    <Modal
      title="Rename report" onClose={onClose} busy={busy} width={440}
      footer={<><Btn onClick={onClose} disabled={busy}>Cancel</Btn><Btn kind="primary" onClick={save} disabled={busy || !trimmed || trimmed.length > 255}>Save</Btn></>}
    >
      <input
        aria-label="Report name" value={name} maxLength={255} autoFocus disabled={busy}
        onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && trimmed) save(); }}
        style={S.input}
      />
      {ownShare(report) && <p style={S.hint}>The shared copy keeps its old name until you share an update.</p>}
      {error && <p role="alert" style={S.error}>{error}</p>}
    </Modal>
  );
}

function DeleteDialog({ report, reportsApi, onClose, onDeleted }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const removing = report.origin === "shared";
  const synced = report.origin === "synced";
  const remove = async () => {
    trackClick("MancoReporting.ReportMenu.Delete");
    setBusy(true);
    setError(null);
    try {
      const { notice } = await actSaved(reportsApi, report.id, REPORT_ACTIONS.REMOVE);
      onDeleted(notice);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };
  return (
    <Modal
      title={removing ? "Remove this report?" : synced ? "Delete this report?" : "Delete this copy?"} onClose={onClose} busy={busy}
      footer={<><Btn onClick={onClose} disabled={busy}>Cancel</Btn><Btn kind="danger" onClick={remove} disabled={busy}>{removing ? "Remove" : "Delete"}</Btn></>}
    >
      {removing
        ? "It leaves your reports for good; the person who shared it keeps theirs."
        : synced
        ? "This removes it from the hosted app for good. Your local dashboard keeps its own copy, unsynced."
        : "This removes your copy for good. It was never shared, so nobody else is affected."}
      {error && <p role="alert" style={S.error}>{error}</p>}
    </Modal>
  );
}

const S = {
  menu: {
    position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 50, minWidth: 200,
    background: "var(--card)", borderRadius: 4, boxShadow: POPOVER_SHADOW, padding: 4,
  },
  menuTip: { display: "block" },
  error: { ...sans, color: RED, fontSize: FS.body, alignSelf: "center" },
  errorPopover: {
    ...sans, position: "absolute", right: 0, top: "calc(100% + 8px)", zIndex: 60,
    width: "min(320px, calc(100vw - 32px))", background: "var(--card)",
    border: `1px solid ${LINE}`, borderRadius: 8, boxShadow: POPOVER_SHADOW,
    padding: "14px 16px", fontSize: FS.body,
  },
  errorClose: {
    position: "absolute", top: 8, right: 8, width: 24, height: 24, padding: 0,
    display: "grid", placeItems: "center", border: "none", background: "none",
    color: FAINT, cursor: "pointer", borderRadius: 4,
  },
  errorTitle: { color: RED, fontWeight: 600, marginBottom: 4, paddingRight: 20 },
  errorMsg: { color: INK, marginBottom: 6 },
  input: {
    ...sans, width: "100%", boxSizing: "border-box", fontSize: FS.bodyLg, color: INK,
    border: "1px solid var(--border-default)", borderRadius: 4, padding: "8px 10px",
  },
  hint: { margin: "8px 0 0", color: FAINT, fontSize: FS.body },
};
