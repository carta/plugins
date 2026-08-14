import { useState, useEffect, useRef, useCallback } from "react";
import { trackClick } from "../analytics.js";

const SHARE_POLL_MS = 2500;

const EVENT = { publish: "FundModeling.Share.Publish", pull: "FundModeling.Share.Pull",
  delete: "FundModeling.Share.Delete" };

/** Publish / pull / delete lifecycle, polled from /api/scenarios/share-status. Each op flushes
 *  edits first, runs in the background, then soft-reloads the doc; a `stale` publish surfaces the
 *  staleness guard instead of overwriting a teammate's change. */
export default function useShare() {
  const [st, setSt] = useState({ status: "idle" });
  const pollRef = useRef(null);
  const actionRef = useRef(null); // the op in flight, for analytics + done-routing
  const publishSliceRef = useRef(null); // the slice a publish targeted, so a stale-conflict
  // "Update anyway" re-publishes THAT scenario, not whatever is selected when the user clicks.
  const staleUuidRef = useRef(null); // the shared uuid in conflict, for "load theirs" override
  const running = st.status === "running";

  const stopPolling = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };

  const finishWithReload = useCallback(async () => {
    try { await window.__fmPortfolioCtl?.reload?.(); }  // re-read portfolio.json (only file share writes)
    finally { window.__fmPortfolioCtl?.resumeAutosave?.(); }
  }, []);

  const applyStatus = useCallback((s) => {
    if (!s || s.status === "running") {
      setSt({ status: "running", action: actionRef.current, phase: s?.phase || "preflight",
              progress: s?.progress, step: s?.step, total: s?.total });
      return;
    }
    stopPolling();
    if (s.status === "error") {
      window.__fmPortfolioCtl?.resumeAutosave?.();
      setSt({ status: "error", action: actionRef.current, code: s.code,
              message: s.message, needsHuman: !!s.needs_human });
      return;
    }
    // done: publish may report a staleness conflict or an upstream deletion; else reload the doc.
    const r = s.result || {};
    if (actionRef.current === "publish" && r.status === "stale") {
      window.__fmPortfolioCtl?.resumeAutosave?.();
      staleUuidRef.current = r.scenarioUuid;
      setSt({ status: "stale", updatedBy: r.updatedBy, updatedAt: r.updatedAt });
      return;
    }
    if (actionRef.current === "publish" && r.status === "deleted") {
      window.__fmPortfolioCtl?.resumeAutosave?.();
      setSt({ status: "deleted", sliceId: publishSliceRef.current });
      return;
    }
    finishWithReload();
    setSt({ status: "done", action: actionRef.current, result: r });
  }, [finishWithReload]);

  const startPolling = useCallback(() => {
    stopPolling();
    const tick = async () => {
      let s;
      try { s = await fetch("/api/scenarios/share-status").then((r) => r.json()); }
      catch (e) { return; }  // transient blip — keep polling
      applyStatus(s);
    };
    pollRef.current = setInterval(tick, SHARE_POLL_MS);
    tick();
  }, [applyStatus]);

  useEffect(() => () => stopPolling(), []);

  // Warm the shared-session pool on load (silent — no lock, no pull, no write) so the first
  // publish/pull/delete is fast instead of paying the ~15s cold spawn. Fire-and-forget.
  useEffect(() => { fetch("/api/scenarios/share-status?warm=1").catch(() => {}); }, []);

  const start = useCallback(async (action, body) => {
    if (running) return;
    actionRef.current = action;
    trackClick(EVENT[action] || "FundModeling.Share.Op");
    setSt({ status: "running", action, phase: "preflight" });
    try {
      // Flush + pause autosave so the server reads the latest portfolio.json and no browser
      // save races its merge write (mirrors the refresh apply).
      await window.__fmPortfolioCtl?.pauseAutosave?.();
      const res = await fetch(`/api/scenarios/${action}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}),
      });
      if (res.status === 409) throw new Error("Another sharing action is already running.");
      if (!res.ok) throw new Error(`Couldn't start (${res.status}).`);
      startPolling();
    } catch (e) {
      window.__fmPortfolioCtl?.resumeAutosave?.();
      setSt({ status: "error", action, code: "failed", message: e.message || "Sharing failed." });
    }
  }, [running, startPolling]);

  // Endpoint is /publish for both create and update — the server routes on shared.uuid.
  const publish = useCallback((sliceId, { force = false, asNew = false } = {}) => {
    publishSliceRef.current = sliceId;
    return start("publish", { sliceId, force, asNew });
  }, [start]);
  // Re-publish the scenario that hit the staleness conflict (NOT the currently-selected one).
  const updateAnyway = useCallback(() => {
    if (publishSliceRef.current) start("publish", { sliceId: publishSliceRef.current, force: true });
  }, [start]);
  // The shared row was deleted upstream — publish the stranded edits as a fresh shared scenario.
  const publishAsNew = useCallback(() => {
    if (publishSliceRef.current) start("publish", { sliceId: publishSliceRef.current, asNew: true });
  }, [start]);
  const pull = useCallback(() => start("pull", {}), [start]);
  // Resolve the conflict by loading the server's version of THIS scenario, overwriting the
  // local dirty edits (a plain pull would skip a dirty scenario and leave the conflict).
  const loadTheirs = useCallback(() => {
    if (staleUuidRef.current) start("pull", { overrideUuid: staleUuidRef.current });
  }, [start]);
  const deleteShared = useCallback((sliceId) => start("delete", { sliceId }), [start]);
  const dismiss = useCallback(() => setSt({ status: "idle" }), []);

  return { ...st, running, publish, updateAnyway, publishAsNew, pull, loadTheirs, deleteShared, dismiss };
}
