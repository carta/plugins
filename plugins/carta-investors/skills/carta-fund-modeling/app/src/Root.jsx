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

export default function Root() {
  // The URL path is the source of truth for the selected firm.
  const firm = useSyncExternalStore(subscribeNav, () => parseRoute().firm, () => null);
  const [extras, setExtras] = useState(null); // { slug, pacing, ownership, lpBase } for `firm`
  const [error, setError] = useState(null);

  // Pick / clear the firm by navigating the path; also remember it for next launch.
  const choose = useCallback((slug) => {
    if (slug) localStorage.setItem("firm", slug);
    else localStorage.removeItem("firm");
    navigate({ firm: slug, tab: slug ? "overview" : null }, { replace: true });
  }, []);

  // This server's firm registry — single-server-scoped, so exactly one entry
  // once a firm is launched. Shared by the auto-select and self-heal effects
  // below; resolves to null on any fetch/parse failure.
  const fetchFirms = useCallback(() => fetch("/api/firms").then((r) => r.json()).catch(() => null), []);

  // No firm in the URL: restore the last-used firm from storage, else auto-select
  // when exactly one firm exists (the skill launches one firm per session — skip
  // the chooser in that case).
  useEffect(() => {
    if (firm) return;
    const stored = localStorage.getItem("firm");
    if (stored) { navigate({ firm: stored, tab: "overview" }, { replace: true }); return; }
    let live = true;
    fetchFirms().then((list) => {
      if (live && Array.isArray(list) && list.length === 1 && list[0]?.slug) choose(list[0].slug);
    });
    return () => { live = false; };
  }, [firm, choose, fetchFirms]);

  // Self-heal a stale/mismatched URL: the server is single-firm-per-launch and
  // ignores the `firm` query param entirely (serve.py always serves its own
  // data dir), so the URL's firm slug can drift from what this server actually
  // serves — e.g. a tab left over from browsing a different firm. Confirm the
  // slug against /api/firms (the registry for *this* server) and correct the
  // URL rather than silently rendering the real firm's data under the wrong name.
  useEffect(() => {
    if (!firm) return;
    let live = true;
    fetchFirms().then((list) => {
      if (!live) return;
      const real = Array.isArray(list) && list[0]?.slug;
      if (real && real !== firm) {
        localStorage.setItem("firm", real);
        navigate({ firm: real, tab: parseRoute().tab }, { replace: true });
      }
    });
    return () => { live = false; };
  }, [firm, fetchFirms]);

  // load the firm's extras whenever the firm changes
  useEffect(() => {
    if (!firm) return;
    let live = true;
    setExtras(null); // drop a previous firm's extras (e.g. back/forward between firms)
    setError(null);
    const q = `?firm=${encodeURIComponent(firm)}`;
    // company-ownership is optional (only present once the skill has written it);
    // tolerate a 404 / not_ready so the firm still loads without it
    const ownership = fetch(`/api/report/company-ownership.json${q}`)
      .then((r) => r.json()).then((d) => (d && !d.error ? d : {})).catch(() => ({}));
    // LP base is optional (firm-wide PARTNER_DATA); tolerate its absence. Shown on LP Returns.
    const lpBase = fetch(`/api/report/lp-base.json${q}`)
      .then((r) => r.json()).then((d) => (d && !d.error ? d : null)).catch(() => null);
    // GP base is optional: only written when the gp_carry stem was fetched (the skill
    // gates it behind an explicit opt-in), so absence is the normal case. Feeds the
    // GP Economics "GP partner carry" table.
    const gpBase = fetch(`/api/report/gp-base.json${q}`)
      .then((r) => r.json()).then((d) => (d && !d.error ? d : null)).catch(() => null);
    Promise.all([
      fetch(`/api/pacing${q}`).then((r) => r.json()),
      ownership,
      lpBase,
      gpBase,
    ])
      .then(([pacing, ownership, lpBase, gpBase]) => { if (live) setExtras({ slug: firm, pacing, ownership, lpBase, gpBase }); })
      .catch((e) => { if (live) setError(String(e)); });
    return () => { live = false; };
  }, [firm]);

  useEffect(() => {
    if (!firm) document.title = "Carta Fund Modeling";
  }, [firm]);

  if (!firm) return <FundChooser onPick={choose} />;

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
        <div style={{ fontSize: FS.bodyLg }}>Loading {firm}…</div>
      </div>
    );
  }

  return (
    <FirmDataContext.Provider value={extras}>
      <App key={firm} firm={firm} onChooseFirm={() => choose(null)} />
    </FirmDataContext.Provider>
  );
}
