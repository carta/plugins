import { useCallback, useEffect, useRef, useState } from "react";
import { sans, INK, FAINT, RED, FS } from "../ui/theme.js";
import { Btn, MenuItem, POPOVER_SHADOW } from "../ui/components.jsx";
import { trackClick } from "../analytics.js";
import { actSaved, duplicateReport } from "../state/useReports.js";
import Modal from "./Modal.jsx";
import ShareDialog from "./ShareDialog.jsx";
import HoverTip from "../ui/HoverTip.jsx";
import { MoreIcon, ShareIcon, UnsharedDot } from "./icons.jsx";
import { ownShare } from "./reportState.js";

const UNSHARED_TIP = "Changes not shared yet. Open Share to update.";

// Whether a report gets the Share panel, which also holds Export: yours, or one shared
// with you (the panel then says why you can't share it).
export const hasSharePanel = (report) => !!(report?.editable || report?.read_only);

// The Budget vs Actuals header's report controls: Share, which also holds Export, and a menu
// for renaming, duplicating, hiding and deleting.
export default function ReportActions({ report, reportsApi, firmName, entityName, exportProps, onOpenReport, onShareDone }) {
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

  useEffect(() => {
    if (!menu) return undefined;
    const onDoc = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenu(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menu]);

  if (!report) return null;
  const own = ownShare(report);
  const dirty = !!own?.dirty;
  // A report you are sharing can't go until you stop sharing it.
  const canDelete = !own && (report.origin === "copy" || report.origin === "shared");

  const act = (fn) => async (...args) => {
    setMenu(false);
    setError(null);
    try {
      await fn(...args);
    } catch (e) {
      setError(e.message);
    }
  };

  const duplicate = act(async () => {
    trackClick("MancoReporting.ReportMenu.Duplicate");
    await duplicateReport(reportsApi, report, onOpenReport);
  });
  const hide = act(async () => {
    trackClick("MancoReporting.ReportMenu.Hide");
    const { notice } = await actSaved(reportsApi, report.id, "hide", { hidden: true });
    if (notice) onShareDone?.(notice);
    onOpenReport(null);
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
              exportProps={exportProps} anchorRef={shareRef} onClose={() => setOpen(null)} onDone={onShareDone}
              onBusyChange={onShareBusy} />
          )}
        </div>
      )}
      <div ref={menuRef} style={{ position: "relative" }}>
        <Btn onClick={() => setMenu(m => !m)} disabled={shareBusy} aria-haspopup="menu" aria-expanded={menu} aria-label="Report actions">
          <MoreIcon />
        </Btn>
        {menu && (
          <div role="menu" style={S.menu}>
            {report.editable && (
              <MenuItem small onClick={() => { setMenu(false); setOpen("rename"); }}>Rename</MenuItem>
            )}
            <MenuItem small onClick={duplicate}>Duplicate</MenuItem>
            <MenuItem small onClick={hide}>Hide</MenuItem>
            {canDelete && (
              <MenuItem small onClick={() => { setMenu(false); setOpen("confirm-delete"); }} style={{ color: RED }}>
                {report.origin === "shared" ? "Remove from my reports" : "Delete this copy"}
              </MenuItem>
            )}
          </div>
        )}
      </div>
      {error && <span role="alert" style={S.error}>{error}</span>}

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
      const { notice } = await actSaved(reportsApi, report.id, "rename", { name });
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
  const remove = async () => {
    trackClick("MancoReporting.ReportMenu.Delete");
    setBusy(true);
    setError(null);
    try {
      const { notice } = await actSaved(reportsApi, report.id, "remove");
      onDeleted(notice);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };
  return (
    <Modal
      title={removing ? "Remove this report?" : "Delete this copy?"} onClose={onClose} busy={busy}
      footer={<><Btn onClick={onClose} disabled={busy}>Cancel</Btn><Btn kind="danger" onClick={remove} disabled={busy}>{removing ? "Remove" : "Delete"}</Btn></>}
    >
      {removing
        ? "It leaves your reports for good; the person who shared it keeps theirs."
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
  error: { ...sans, color: RED, fontSize: FS.body, alignSelf: "center" },
  input: {
    ...sans, width: "100%", boxSizing: "border-box", fontSize: FS.bodyLg, color: INK,
    border: "1px solid var(--border-default)", borderRadius: 4, padding: "8px 10px",
  },
  hint: { margin: "8px 0 0", color: FAINT, fontSize: FS.body },
};
