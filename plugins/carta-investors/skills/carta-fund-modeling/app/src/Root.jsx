// Top-level shell: pick a firm (FundChooser), then mount the console for it.
// The selected firm lives in the URL PATH (/firm/<slug>/…, see route.js) plus
// localStorage, so a reload or shared link reopens the same firm. Firm "extras"
// (pacing + company ownership) are fetched here and handed to the views via
// FirmDataContext.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import App from "./App.jsx";
import FundChooser from "./FundChooser.jsx";
import { FirmDataContext } from "./state/FirmData.jsx";
import { FS, sans } from "./ui/theme.js";
import { parseRoute, navigate, subscribeNav } from "./route.js";
import { postToOuter } from "./bridge-client.js";
import { FirmAccess } from "./firm-access.js";

export default function Root({ features }) {
  // The URL path is the source of truth for the selected firm.
  const firm = useSyncExternalStore(subscribeNav, () => parseRoute().firm, () => null);
  const [extras, setExtras] = useState(null); // { slug, pacing, ownership, lpBase, gpBase, feeHistory, expenseHistory, opsBenchmarks } for `firm`
  const [error, setError] = useState(null);
  const [loadingStep, setLoadingStep] = useState(null); // SSE step from /api/load-firm
  const [autoOpen, setAutoOpen] = useState(true); // false once the user leaves a firm, so the chooser doesn't reopen it
  const [canSwitchFirm, setCanSwitchFirm] = useState(false);

  // If the access check fails, offer Switch firm: the chooser still lists what the user can open.
  useEffect(() => {
    if (!features.switchFirm) return;
    FirmAccess.load().then((access) => setCanSwitchFirm(!access.pinnedFirm)).catch(() => setCanSwitchFirm(true));
  }, [features]);

  // Pick / clear the firm by navigating the path; also remember it for next launch.
  const choose = useCallback((slug) => {
    if (slug) localStorage.setItem("firm", slug);
    else {
      localStorage.removeItem("firm");
      setAutoOpen(false);
    }
    navigate({ firm: slug, tab: slug ? "overview" : null }, { replace: true });
  }, []);

  // No firm in the URL: reopen the last-used firm from storage, else show the chooser.
  // A firm is never picked for the user from /api/firms: for Carta staff that list holds
  // only their active context, so auto-selecting it would open the same firm every time.
  useEffect(() => {
    if (firm) return;
    const stored = localStorage.getItem("firm");
    if (stored) navigate({ firm: stored, tab: "overview" }, { replace: true });
  }, [firm]);

  // Load the firm's extras whenever the firm changes. If snapshot data isn't
  // ready yet (fresh OAuth session), trigger /api/load-firm to fetch from MCP.
  useEffect(() => {
    if (!firm) return;
    let live = true;
    setExtras(null);
    setError(null);
    setLoadingStep(null);
    const q = `?firm=${encodeURIComponent(firm)}`;

    async function loadExtras() {
      // Check if snapshot data exists for this session
      const snap = await fetch(`/api/snapshot${q}`).then((r) => r.json());
      if (snap?.error === "not_ready") {
        // No data yet — fetch from MCP via SSE stream
        setLoadingStep("Connecting to Carta…");
        const res = await fetch("/api/load-firm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug: firm }),
        });
        // 401/403/400 come back as JSON, not SSE. The frame parser finds no
        // "data: " line in those bytes, so the failure would pass silently.
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          if (live) {
            setLoadingStep(null);
            setError(body?.message || body?.error || `Load failed (${res.status})`);
          }
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop();
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const evt = JSON.parse(line.slice(6));
              if (!live) return;
              if (evt.error) { setError(evt.error); return; }
              if (evt.step && !evt.done) setLoadingStep(evt.step);
            } catch {}
          }
        }
        if (!live) return;
        setLoadingStep(null);
      }

      // Now load extras (snapshot is ready)
      // A report the build didn't write comes back as an error body, not a 404.
      const report = (name, missing = null) => fetch(`/api/report/${name}.json${q}`)
        .then((r) => r.json()).then((d) => (d && !d.error ? d : missing)).catch(() => missing);
      const [pacing, own, lp, gp, fees, expenses, ops] = await Promise.all([
        fetch(`/api/pacing${q}`).then((r) => r.json()),
        report("company-ownership", {}), report("lp-base"), report("gp-base"),
        report("fee-history"), report("expense-history"), report("ops-benchmarks"),
      ]);
      if (live) setExtras({ slug: firm, pacing, ownership: own, lpBase: lp, gpBase: gp, feeHistory: fees, expenseHistory: expenses, opsBenchmarks: ops });
    }

    loadExtras().catch((e) => { if (live) setError(String(e)); });
    return () => { live = false; };
  }, [firm]);

  // On the chooser, clear the firm from the outer shell's browser bar and tab title too, so a
  // reload stays on the chooser.
  useEffect(() => {
    if (firm) return;
    document.title = "Carta Fund Modeling";
    postToOuter("route", {});
    postToOuter("title", {});
  }, [firm]);

  if (!firm) return <FundChooser onPick={choose} autoOpen={autoOpen} />;

  if (error) {
    return (
      <div style={{ ...sans, minHeight: "100vh", background: "var(--ink-color-global-surface-background-default)", color: "var(--ink-color-global-text-subtle)", display: "grid", placeItems: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: FS.bodyLg }}>Couldn’t load “{firm}”: {error}</div>
          <button onClick={() => choose(null)} style={{ ...sans, marginTop: 12, cursor: "pointer" }}>← Back to firms</button>
        </div>
      </div>
    );
  }

  if (!extras) {
    return (
      <div style={{ ...sans, minHeight: "100vh", background: "var(--ink-color-global-surface-background-default)", color: "var(--ink-color-global-text-subtle)", display: "grid", placeItems: "center" }}>
        <div style={{ fontSize: FS.bodyLg }}>{loadingStep || `Loading ${firm}…`}</div>
      </div>
    );
  }

  return (
    <FirmDataContext.Provider value={extras}>
      <App key={firm} firm={firm} features={features} canSwitchFirm={canSwitchFirm} onChooseFirm={() => choose(null)} />
    </FirmDataContext.Provider>
  );
}
