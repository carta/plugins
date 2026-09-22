// Top-level shell: resolve the firm (from the URL path, else last-used, else the
// single firm this launch shipped) and mount the KPI console. The app loads its
// own KPI dataset (useKpi) — Root only picks the firm.
import { useCallback, useEffect, useSyncExternalStore } from "react";
import App from "./App.jsx";
import FirmChooser from "./FirmChooser.jsx";
import { parseRoute, navigate, subscribeNav } from "./route.js";
import { lsGet, lsSet, lsRemove } from "./state/storage.js";

export default function Root() {
  const firm = useSyncExternalStore(subscribeNav, () => parseRoute().firm, () => null);

  const choose = useCallback((slug) => {
    if (slug) lsSet("firm", slug); else lsRemove("firm");
    navigate({ firm: slug, tab: slug ? "overview" : null }, { replace: true });
  }, []);

  useEffect(() => {
    if (firm) return;
    const stored = lsGet("firm");
    if (stored) { navigate({ firm: stored, tab: "overview" }, { replace: true }); return; }
    let live = true;
    fetch("/api/firms").then((r) => r.json()).then((list) => {
      if (live && Array.isArray(list) && list.length === 1 && list[0]?.slug) choose(list[0].slug);
    }).catch(() => {});
    return () => { live = false; };
  }, [firm, choose]);

  if (!firm) return <FirmChooser onPick={choose} />;
  return <App key={firm} firm={firm} />;
}
