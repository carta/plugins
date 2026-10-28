import { useRef, useState } from "react";
import { Download } from "lucide-react";
import { sans, FS, FAINT, RED, LINE, INK } from "../ui/theme.js";
import { trackClick } from "../analytics.js";
import { uploadBudget, removeBudget, describeUpload, attempt, budgetDownloadUrl } from "./budgetUpload.js";

// Sidebar control for the hosted app: import the budget file exported from the local flow.
// `hosted` (App.jsx's useHostedApp()) hides it on the local server, which never implements
// /api/budget-upload — the route this control itself calls through budgetUpload.js.
export default function BudgetImport({ hosted, budgetUpload, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const input = useRef(null);

  if (!hosted) return null;

  const run = async (action) => {
    setBusy(true);
    setError(null);
    try {
      const result = await attempt(action);
      if (result.ok) onChanged(); else setError(result.message);
    } finally {
      setBusy(false);
    }
  };
  const onFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) run(() => uploadBudget(file));
  };
  const note = describeUpload(budgetUpload);

  return (
    <div style={{ ...sans, fontSize: FS.small, color: FAINT, lineHeight: 1.4, display: "grid", gap: 6, marginBottom: 10 }}>
      {note && (
        // The uploaded workbook's filename is one long, underscore-heavy token with no
        // natural break point, so it overflows this column — invisibly on a wide screen
        // where there's a gap before the dashboard's own content, but painting straight
        // into it on a narrow one. Same wordBreak the sidebar's own firm name uses
        // (Sidebar.jsx's firmName style), in the same column, for the same reason.
        <div style={{ color: note.warn ? RED : FAINT, wordBreak: "break-word" }}>
          {note.text}{" "}
          <a
            href={budgetDownloadUrl()} download
            aria-label="Download the uploaded budget file" title="Download the uploaded budget file"
            style={{ color: FAINT, verticalAlign: "middle" }}
            onClick={() => trackClick("MancoReporting.App.DownloadBudget")}
          >
            <Download size={12} aria-hidden="true" />
          </a>
        </div>
      )}
      {error && <div role="alert" style={{ color: RED }}>{error}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button" disabled={busy}
          style={{ ...sans, fontSize: FS.small, color: INK, background: "none", border: `1px solid ${LINE}`, padding: "4px 8px", cursor: "pointer" }}
          onClick={() => { trackClick("MancoReporting.App.ImportBudget"); input.current?.click(); }}
        >
          {busy ? "Working…" : "Import budget"}
        </button>
        {budgetUpload && (
          <button
            type="button" disabled={busy}
            style={{ ...sans, fontSize: FS.small, color: FAINT, background: "none", border: "none", padding: "4px 0", cursor: "pointer", textDecoration: "underline" }}
            onClick={() => { trackClick("MancoReporting.App.RemoveBudget"); run(removeBudget); }}
          >
            Remove
          </button>
        )}
      </div>
      <input ref={input} type="file" accept="application/json,.json" hidden onChange={onFile} />
    </div>
  );
}
