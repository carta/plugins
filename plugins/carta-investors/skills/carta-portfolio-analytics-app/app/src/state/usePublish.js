import { useState, useEffect, useRef, useCallback } from "react";
import { trackClick } from "../analytics.js";

const PUBLISH_POLL_MS = 2000;
// cur rides along for additions (no cached point to read a currency from); the
// server treats it as optional so an older tab's payload still publishes.
const WIRE_FIELDS = ["id", "companyId", "metricKey", "period", "freq", "fromDate", "appliesTo", "value", "cur"];

const newRunId = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `run-${Date.now()}-${Math.random().toString(16).slice(2)}`);

/** Just the capability bit — the app's feature-flag stand-in. Components that only decide
 *  whether to SHOW editing affordances use this instead of the full hook, so they don't
 *  join the status polling. */
export function useCanPublish() {
  const [can, setCan] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/capabilities").then((r) => r.json())
      .then((c) => { if (alive) setCan(!!c?.publish); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return can;
}

/** Publish lifecycle for staged KPI corrections, polled from /api/publish/status.
 *  publish(edits) POSTs the wire fields of each edit under a fresh runId and returns that
 *  runId; the caller stamps it onto the edits (model/pendingEdits.markPublishing) and folds
 *  `results` back in once status is "done" (applyPublishResults). canPublish reflects
 *  /api/capabilities.publish. */
export default function usePublish() {
  const [st, setSt] = useState({ status: "idle" });
  const [canPublish, setCanPublish] = useState(false);
  const pollRef = useRef(null);
  const genRef = useRef(0);
  const failedRunIdRef = useRef(null);

  const stopPolling = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };

  const applyStatus = useCallback((s) => {
    if (!s || s.status === "running") {
      setSt({ status: "running", runId: s?.runId, progress: s?.progress, startedAt: s?.startedAt });
      return;
    }
    stopPolling();
    if (s.status === "done") {
      setSt({ status: "done", runId: s.runId, results: s.results || [], warnings: s.warnings || [] });
    } else if (s.status === "error") {
      if (failedRunIdRef.current !== s.runId) {
        trackClick("PortfolioAnalytics.Corrections.PublishFailed");
        failedRunIdRef.current = s.runId;
      }
      setSt({ status: "error", runId: s.runId, message: s.message, detail: s.detail, needsHuman: !!s.needs_human });
    } else {
      setSt({ status: "idle" });
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    const tick = async () => {
      let s;
      try { s = await fetch("/api/publish/status").then((r) => r.json()); }
      catch (e) { return; }  // transient blip — keep polling
      applyStatus(s);
    };
    pollRef.current = setInterval(tick, PUBLISH_POLL_MS);
    tick();
  }, [applyStatus]);

  useEffect(() => {
    let alive = true;
    const gen = genRef.current;
    fetch("/api/capabilities").then((r) => r.json())
      .then((c) => { if (alive) setCanPublish(!!c?.publish); }).catch(() => {});
    fetch("/api/publish/status").then((r) => r.json()).then((s) => {
      if (!alive || !s || genRef.current !== gen) return;
      if (s.status === "running") startPolling();
      else applyStatus(s);
    }).catch(() => {});
    return () => { alive = false; stopPolling(); };
  }, [startPolling, applyStatus]);

  const publish = useCallback(async (edits) => {
    if (st.status === "running") return null;
    genRef.current += 1;
    const runId = newRunId();
    trackClick("PortfolioAnalytics.Corrections.PublishStart");
    setSt({ status: "running", runId, progress: "Starting…" });
    try {
      const res = await fetch("/api/publish-edits", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, edits: edits.map((e) => Object.fromEntries(WIRE_FIELDS.map((k) => [k, e[k]]))) }),
      });
      // 409 = another tab already started one; adopt and follow its progress.
      if (res.status === 409) { startPolling(); return null; }
      if (res.ok) { startPolling(); return runId; }
      let body = {};
      try { body = await res.json(); } catch (e) { /**/ }
      setSt({ status: "error", runId, message: body.error === "bad_edit" ? "One of the corrections is malformed." : `Couldn't start the publish (${res.status}).` });
      return null;
    } catch (e) {
      setSt({ status: "error", runId, message: e.message || "Couldn't start the publish." });
      return null;
    }
  }, [st.status, startPolling]);

  const reset = useCallback(() => { genRef.current += 1; stopPolling(); setSt({ status: "idle" }); }, []);

  return { ...st, canPublish, publish, reset };
}
