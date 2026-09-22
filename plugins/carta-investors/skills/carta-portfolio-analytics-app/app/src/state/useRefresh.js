import { useState, useEffect, useRef, useCallback } from "react";
import { trackClick } from "../analytics.js";

// Fetch phases turn over every tens of seconds, so a 5s poll stays current cheaply.
const REFRESH_POLL_MS = 5000;

/** Update-data lifecycle, polled from /api/refresh/status. runRefresh(datasets) starts a
 *  background fetch (all datasets when omitted) that writes only raw files, so the app stays
 *  usable throughout; loadNewData() rebuilds kpi.json then reloads. canRefresh reflects
 *  /api/capabilities (a claude binary + a firm-id'd cache). `target` is the dataset keys the
 *  running fetch covers (null = all). */
export default function useRefresh() {
  const [st, setSt] = useState({ status: "idle", warnings: [] });
  const [elapsed, setElapsed] = useState(0);
  const [canRefresh, setCanRefresh] = useState(false);
  const pollRef = useRef(null);
  // True only for the tab that clicked Update — it alone surfaces a fetch error it started.
  const initiatedRef = useRef(false);
  const running = st.status === "running";
  const startedAt = st.startedAt;  // server epoch, comparable to Date.now()/1000

  useEffect(() => {
    if (!running) return;
    const t0 = Date.now();
    const tick = () => setElapsed(startedAt
      ? Math.max(0, Math.floor(Date.now() / 1000 - startedAt))
      : Math.floor((Date.now() - t0) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [running, startedAt]);

  const stopPolling = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };

  const applyStatus = useCallback((s) => {
    if (!s || s.status === "running") {
      setSt({ status: "running", phase: s?.phase || "preflight", progress: s?.progress,
              startedAt: s?.startedAt, target: s?.target ?? null,
              activeStems: s?.activeStems || [], doneStems: s?.doneStems || [],
              fetchStep: s?.step, fetchTotal: s?.total, warnings: s?.warnings || [] });
      return;
    }
    stopPolling();
    if (s.status === "fetched") {
      if (initiatedRef.current) trackClick("PortfolioAnalytics.UpdateData.Fetched");
      setSt({ status: "fetched", warnings: s.warnings || [] });
    } else if (s.status === "error" && initiatedRef.current) {
      setSt({ status: "error", message: s.message, detail: s.detail, needsHuman: !!s.needs_human, retry: "fetch" });
    } else setSt({ status: "idle", warnings: [] });
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    const tick = async () => {
      let s;
      try { s = await fetch("/api/refresh/status").then((r) => r.json()); }
      catch (e) { return; }  // transient network blip — keep polling
      applyStatus(s);
    };
    pollRef.current = setInterval(tick, REFRESH_POLL_MS);
    tick();
  }, [applyStatus]);

  // On mount: learn whether refresh is supported, and resume an in-flight/staged fetch.
  useEffect(() => {
    let alive = true;
    fetch("/api/capabilities").then((r) => r.json())
      .then((c) => { if (alive) setCanRefresh(!!c?.refresh); }).catch(() => {});
    fetch("/api/refresh/status").then((r) => r.json()).then((s) => {
      if (!alive || !s) return;
      if (s.status === "running") startPolling();
      else applyStatus(s);
    }).catch(() => {});
    return () => { alive = false; stopPolling(); };
  }, [startPolling, applyStatus]);

  const runRefresh = useCallback(async (datasets) => {
    if (running) return;
    trackClick("PortfolioAnalytics.UpdateData.Start");
    initiatedRef.current = true;
    setSt({ status: "running", phase: "preflight", target: datasets ?? null, warnings: [] });
    try {
      const res = await fetch("/api/refresh", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(datasets ? { datasets } : {}),
      });
      // 409 = another tab already started one; adopt and follow its progress.
      if (res.status === 409 || res.ok) { startPolling(); return; }
      throw new Error(`Couldn't start the update (${res.status}).`);
    } catch (e) {
      setSt({ status: "error", message: e.message || "Update failed.", warnings: [], retry: "fetch" });
    }
  }, [running, startPolling]);

  const loadNewData = useCallback(async () => {
    trackClick("PortfolioAnalytics.UpdateData.Load");
    const warnings = st.warnings || [];
    setSt({ status: "applying", warnings });
    try {
      const res = await fetch("/api/refresh/apply", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      if (!res.ok) {
        let body = {};
        try { body = await res.json(); } catch (e) { /**/ }
        setSt({ status: "error", message: body.message || "Couldn't load the new data.",
                detail: body.detail, warnings, retry: "apply" });
        return;
      }
      window.location.reload();  // re-read every data file (build already swapped them in)
    } catch (e) {
      setSt({ status: "error", message: "Couldn't load the new data.", detail: e.message, warnings, retry: "apply" });
    }
  }, [st.warnings]);

  return { ...st, elapsed, canRefresh, runRefresh, loadNewData };
}
