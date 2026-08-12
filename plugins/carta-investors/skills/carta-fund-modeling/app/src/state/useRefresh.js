import { useState, useEffect, useRef, useCallback } from "react";
import { trackClick } from "../analytics.js";

// Fetch phases turn over every tens of seconds, so a 5s poll stays current cheaply.
const REFRESH_POLL_MS = 5000;

/** Update-data lifecycle, polled from /api/refresh/status. runRefresh() starts a background
 *  fetch that writes only raw files, so the app stays editable throughout; loadNewData()
 *  flushes edits then builds+swaps+reloads, so the served data changes only on that click. */
export default function useRefresh() {
  const [st, setSt] = useState({ status: "idle", warnings: [] });
  const [elapsed, setElapsed] = useState(0);
  const pollRef = useRef(null);
  // True only for the tab that clicked Update — it alone surfaces a fetch error it started.
  const initiatedRef = useRef(false);
  const running = st.status === "running";
  // Server epoch, comparable to Date.now() because both run on one machine; survives reload.
  const startedAt = st.startedAt;

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

  // `fetched` = raw staged, nothing swapped yet — every tab that sees it should offer to load.
  const applyStatus = useCallback((s) => {
    if (!s || s.status === "running") {
      setSt({ status: "running", phase: s?.phase || "preflight", startedAt: s?.started_at,
              fetchStep: s?.step, fetchTotal: s?.total, warnings: s?.warnings || [] });
      return;
    }
    stopPolling();
    if (s.status === "fetched") {
      if (initiatedRef.current) trackClick("FundModeling.UpdateData.Fetched");
      setSt({ status: "fetched", warnings: s.warnings || [] });
    } else if (s.status === "error" && initiatedRef.current) {
      setSt({ status: "error", message: s.message, needsHuman: !!s.needs_human, retry: "fetch" });
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

  // Resume on mount so a reopened or second tab picks up an in-flight or staged fetch.
  useEffect(() => {
    let alive = true;
    fetch("/api/refresh/status").then((r) => r.json()).then((s) => {
      if (!alive || !s) return;
      if (s.status === "running") startPolling();
      else applyStatus(s);
    }).catch(() => {});
    return () => { alive = false; stopPolling(); };
  }, [startPolling, applyStatus]);

  const runRefresh = useCallback(async () => {
    if (running) return;
    trackClick("FundModeling.UpdateData.Start");
    initiatedRef.current = true;
    setSt({ status: "running", phase: "preflight", warnings: [] });
    try {
      // No pauseAutosave: the fetch writes only raw files, so edits + autosave stay live.
      const res = await fetch("/api/refresh", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      // 409 = another tab already started one; adopt and follow its progress.
      if (res.status === 409 || res.ok) { startPolling(); return; }
      throw new Error(`Couldn't start the update (${res.status}).`);
    } catch (e) {
      setSt({ status: "error", message: e.message || "Update failed.", warnings: [], retry: "fetch" });
    }
  }, [running, startPolling]);

  const loadNewData = useCallback(async () => {
    trackClick("FundModeling.UpdateData.Load");
    const warnings = st.warnings || [];
    setSt({ status: "applying", warnings });
    try {
      // Flush edits before the build reads portfolio.json, so the reconcile picks up the
      // user's latest scenarios (pauseAutosave awaits the flush).
      await window.__fmPortfolioCtl?.pauseAutosave?.();
      const res = await fetch("/api/refresh/apply", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      if (!res.ok) {
        let msg = "Couldn't load the new data.";
        try { msg = (await res.json()).message || msg; } catch (e) { /**/ }
        throw new Error(msg);
      }
      window.location.reload();  // re-read every data file (build already swapped them in)
    } catch (e) {
      try { window.__fmPortfolioCtl?.resumeAutosave?.(); } catch (err) { /**/ }
      setSt({ status: "error", message: e.message || "Couldn't load the new data.", warnings, retry: "apply" });
    }
  }, [st.warnings]);

  return { ...st, elapsed, runRefresh, loadNewData };
}
