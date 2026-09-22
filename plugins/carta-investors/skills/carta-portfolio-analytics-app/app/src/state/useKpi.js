// Loads the firm's KPI dataset (read-only) written by build_kpi_datadir.py and
// served at /api/report/kpi.json. The browser never calls Carta — it only reads
// this JSON. Shape: { source, branding?, metrics[], companies[], dimensions }.
import { useEffect, useState } from "react";
import { setTrackingFirm } from "../analytics.js";

export default function useKpi(firm) {
  const q = firm ? `?firm=${encodeURIComponent(firm)}` : "";
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    fetch(`/api/report/kpi.json${q}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => {
        if (!live) return;
        if (!d || d.error) setError(d?.error || "not_ready");
        else { setData(d); setTrackingFirm(d.source?.firmId); }
      })
      .catch((e) => live && setError(String(e)));
    return () => { live = false; };
  }, [q]);

  return { data, error };
}
