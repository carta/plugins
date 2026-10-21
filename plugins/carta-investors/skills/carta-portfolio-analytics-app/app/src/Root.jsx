import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import App from "./App.jsx";
import FirmChooser from "./FirmChooser.jsx";
import { parseRoute, navigate, subscribeNav } from "./route.js";
import { lsGet, lsSet, lsRemove } from "./state/storage.js";

export default function Root() {
  const firm = useSyncExternalStore(subscribeNav, () => parseRoute().firm, () => null);
  const [defaultFirm, setDefaultFirm] = useState(null);

  useEffect(() => {
    fetch("/api/app-config").then((r) => r.json()).then((c) => setDefaultFirm(c.defaultFirm || "")).catch(() => setDefaultFirm(""));
  }, []);

  const choose = useCallback((slug) => {
    if (slug) lsSet("firm", slug); else lsRemove("firm");
    navigate({ firm: slug, tab: slug ? "overview" : null }, { replace: true });
  }, []);

  useEffect(() => {
    if (firm || defaultFirm === null) return;
    if (defaultFirm) { choose(defaultFirm); return; }
    let live = true;
    // The remembered firm opens only while /api/firms still lists it: a firm's URL segment can
    // change shape, and a stale one would load as "no access" with no way back to the chooser.
    fetch("/api/firms").then((r) => r.json()).then((list) => {
      if (!live || !Array.isArray(list)) return;
      const stored = lsGet("firm");
      if (stored && list.some((f) => f?.slug === stored)) navigate({ firm: stored, tab: "overview" }, { replace: true });
      else if (list.length === 1 && list[0]?.slug) choose(list[0].slug);
    }).catch(() => {});
    return () => { live = false; };
  }, [firm, choose, defaultFirm]);

  if (!firm) return <FirmChooser onPick={choose} />;
  return <App key={firm} firm={firm} />;
}
