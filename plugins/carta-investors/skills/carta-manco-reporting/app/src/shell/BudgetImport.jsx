import { useEffect, useRef, useState } from "react";
import { sans, FS, FAINT, RED, LINE, INK } from "../ui/theme.js";
import { trackClick } from "../analytics.js";
import { fetchUploadState, uploadBudget, removeBudget, describeUpload, attempt } from "./budgetUpload.js";

// Sidebar control for the hosted app: import the budget file exported from the local flow.
export default function BudgetImport({ budgetUpload, onChanged }) {
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const input = useRef(null);

  useEffect(() => { fetchUploadState().then((s) => setAvailable(Boolean(s))); }, []);
  if (!available) return null;

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
      {note && <div style={{ color: note.warn ? RED : FAINT }}>{note.text}</div>}
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
