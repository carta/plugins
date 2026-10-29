import { useState, useEffect, useRef, useCallback } from "react";
import { trackClick } from "../analytics.js";
import { WIRE_FIELDS } from "../model/pendingEdits.js";
import { firmQuery } from "./firmQuery.js";
import useCapabilities from "./useCapabilities.js";

const PUBLISH_POLL_MS = 2000;
const SIGNED_OUT = "Your Carta session ended, so this tab can't see how the publish finished. Sign in again to see its results.";
// The user's publish status for the firm. A 401 is a final answer for this tab: it can read
// nothing until the user signs in again. The run's status is kept per user and firm, not per
// session, so it reads as "signed_out" — never as the run's outcome — and the stamped edits wait
// for a signed-in read.
// Null for any other error answer; rejects when no answer came. Callers ask again only on null
// or a rejection.
const readPublishStatus = (firm) => fetch(`/api/publish/status${firmQuery(firm)}`)
  .then((r) => (r.ok ? r.json() : r.status === 401 ? { status: "signed_out" } : null));
const BUSY = "Another publish is already running. Publish again once it finishes.";

export const newRunId = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `run-${Date.now()}-${Math.random().toString(16).slice(2)}`);

/** Just the capability bit — the app's feature-flag stand-in. Components that only decide
 *  whether to SHOW editing affordances use this instead of the full hook, so they don't
 *  join the status polling. */
export function useCanPublish() {
  return !!useCapabilities()?.publish;
}

/** Publish lifecycle for staged KPI corrections, polled from /api/publish/status.
 *  publish(edits, runId) POSTs the wire fields of each edit under the caller's runId and
 *  returns null once the run has started, or why it didn't. The caller stamps runId onto the edits
 *  (model/pendingEdits.markPublishing) before calling — the Worker answers only once the
 *  whole run is done — and folds `results` back in once status is "done" (applyPublishResults). canPublish reflects
 *  /api/capabilities.publish. `firm` is the dashboard's slug; the Worker serves many firms
 *  and needs it, the local server (one firm per launch) ignores it. */
export default function usePublish(firm) {
  const [st, setSt] = useState({ status: "idle" });
  const canPublish = useCanPublish();
  const pollRef = useRef(null);
  const genRef = useRef(0);

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
      setSt({ status: "error", runId: s.runId, message: s.message, detail: s.detail, needsHuman: !!s.needs_human });
    } else if (s.status === "signed_out") {
      // No runId: the button settles no edits on it, so the stamps wait for a signed-in read.
      setSt({ status: "error", message: SIGNED_OUT });
    } else {
      setSt({ status: "idle" });
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    const tick = async () => {
      let s;
      try { s = await readPublishStatus(firm); }
      catch (e) { return; }  // transient blip — keep polling
      if (s) applyStatus(s);
    };
    pollRef.current = setInterval(tick, PUBLISH_POLL_MS);
    tick();
  }, [applyStatus, firm]);

  useEffect(() => {
    let alive = true;
    const gen = genRef.current;
    readPublishStatus(firm).then((s) => {
      if (!alive || !s || genRef.current !== gen) return;
      if (s.status === "running") startPolling();
      else applyStatus(s);
    }).catch(() => {});
    return () => { alive = false; genRef.current += 1; stopPolling(); };
  }, [startPolling, applyStatus, firm]);

  const publish = useCallback(async (edits, runId) => {
    if (st.status === "running") return BUSY;
    genRef.current += 1;
    trackClick("PortfolioAnalytics.Corrections.PublishStart");
    setSt({ status: "running", runId, progress: "Starting…" });
    // A 4xx is a refusal before the run was claimed. A 5xx or a dropped connection can come
    // after the Worker claimed it, so follow the run when its status names it: once stamped,
    // an edit leaves publishing only through a status naming its run, or a refusal. Only a
    // status the server returned settles that, and a read with no answer, or another error, is
    // tried again. A 401 settles nothing: the tab can't read until the user signs in, so the
    // stamp stays and the run's per-firm status settles it on a signed-in read. So do a reset
    // and an unmount: the next mount's status read takes over.
    const claimed = async () => {
      const gen = genRef.current;
      for (;;) {
        const s = await readPublishStatus(firm).catch(() => null);
        if (genRef.current !== gen) return true;
        if (s?.status === "signed_out") { applyStatus(s); return true; }
        if (s) {
          if (s.runId !== runId) return false;
          startPolling();
          return true;
        }
        await new Promise((r) => setTimeout(r, PUBLISH_POLL_MS));
      }
    };
    try {
      const res = await fetch("/api/publish-edits", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId, firm, edits: edits.map((e) => Object.fromEntries(WIRE_FIELDS.map((k) => [k, e[k]]))) }),
      });
      // 409 = another tab already started one; adopt and follow its progress.
      if (res.status === 409) { startPolling(); return BUSY; }
      if (res.ok) { startPolling(); return null; }
      if (res.status >= 500 && await claimed()) return null;
      let body = {};
      try { body = await res.json(); } catch (e) { /**/ }
      const message = body.error === "bad_edit" ? "One of the corrections is malformed." : `Couldn't start the publish (${res.status}).`;
      setSt({ status: "error", runId, message });
      return message;
    } catch (e) {
      if (await claimed()) return null;
      const message = e.message || "Couldn't start the publish.";
      setSt({ status: "error", runId, message });
      return message;
    }
  }, [st.status, startPolling, firm]);

  const reset = useCallback(() => { genRef.current += 1; stopPolling(); setSt({ status: "idle" }); }, []);

  return { ...st, canPublish, publish, reset };
}
