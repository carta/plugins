import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Budget vs Actuals reports: what the app server knows about them
// (/api/reports), changes to them, and share operations with Carta.
//
// A change is sent with the list's ETag, so one made against a stale read is
// refused (409) and the list reloads. The server rebuilds the dashboard after
// every change; `onChanged` reloads the snapshot so the page shows it.
// Share operations run in the background on the server — this starts one and
// polls /api/reports/share-status for that job until it settles. Asking by job id
// keeps a call from taking another one's result (a second tab, or a share queued
// behind the people lookup).

const POLL_MS = 700;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export class ReportError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

// A change that was saved, but the page couldn't be rebuilt to show it.
export const REBUILD_FAILED = "rebuild";

// The full action/op vocabulary a server's `actions` list draws from — the exact strings
// `act()` sends as a per-report action and `runShareOp()` sends as `op`. A server names a
// capability by one of these, never a string of its own, so `can(x)` and the call that
// sends `x` always agree.
export const REPORT_ACTIONS = Object.freeze({
  RENAME: "rename", DUPLICATE: "duplicate", HIDE: "hide", REMOVE: "remove", UNLINK: "unlink",
  SHARE: "share", PUBLISH_AS_NEW: "publish-as-new", DELETE: "delete", PULL: "pull", USERS: "users",
});

// Runs a report change. One that was saved but whose page didn't refresh counts as done:
// it resolves with the refresh message as `notice` rather than throwing, so it isn't sent twice.
export async function actSaved(reportsApi, ...args) {
  try {
    return { report: await reportsApi.act(...args), notice: null };
  } catch (e) {
    if (e.code === REBUILD_FAILED) return { report: null, notice: e.message };
    throw e;
  }
}

// Duplicates a report and opens the copy. A copy made but not yet on the page
// isn't a failed duplicate, so that error keeps its own words.
export async function duplicateReport(reportsApi, report, onOpenReport) {
  try {
    const created = await reportsApi.act(report.id, REPORT_ACTIONS.DUPLICATE);
    if (created?.id) onOpenReport(created.id);
  } catch (e) {
    throw e.code === REBUILD_FAILED ? e : new Error(`Couldn't duplicate it. ${e.message}`);
  }
}

export default function useReports({ onChanged } = {}) {
  const [listing, setListing] = useState({ reports: [], share_target: null });
  // A server may send `actions`, one of REPORT_ACTIONS' values each; when it does, only
  // the actions it names are allowed. One with none at all (the key is simply absent)
  // allows everything, so a server that doesn't send the field needs no other change here.
  const can = useCallback((action) => !Array.isArray(listing.actions) || listing.actions.includes(action), [listing.actions]);
  const [shareJob, setShareJob] = useState(null);
  // The hosted Worker answers /api/reports for real once Carta's probe allows sharing for
  // this user; a local serve.py without that route, a 404, or a network error all leave
  // this false instead — a GET that doesn't come back as {reports: [...]}
  // never flips `available`, so nothing renders a control for an action the server can't
  // perform. Once it is true, every report/share control still goes through `can()` above —
  // editable/read_only decide which controls a given report is eligible for, `actions`
  // decides which of those this server actually serves.
  const [available, setAvailable] = useState(false);
  const etagRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/reports");
      if (!res.ok) { setAvailable(false); return; }
      const data = await readJson(res);
      if (!data || !Array.isArray(data.reports)) { setAvailable(false); return; }
      etagRef.current = res.headers.get("ETag");
      setListing(data);
      setAvailable(true);
    } catch {
      // The page still renders from the snapshot; report actions just stay unavailable.
      setAvailable(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = useCallback(async (reportId, action, body = {}) => {
    const headers = { "Content-Type": "application/json" };
    if (etagRef.current) headers["If-Match"] = etagRef.current;
    const res = await fetch(`/api/reports/${encodeURIComponent(reportId)}/${action}`, {
      method: "POST", headers, body: JSON.stringify(body),
    });
    const data = await readJson(res);
    if (!res.ok) {
      if (res.status === 409) await load();
      throw new ReportError(data?.message || "Couldn't save that change.", data?.error);
    }
    etagRef.current = res.headers.get("ETag");
    if (Array.isArray(data?.reports)) setListing(l => ({ ...l, reports: data.reports }));
    await onChanged?.();
    if (data && data.rebuilt === false) {
      throw new ReportError(`Saved, but the page couldn't refresh: ${data.message}`, REBUILD_FAILED);
    }
    return data?.report;
  }, [load, onChanged]);

  const runShareOp = useCallback(async (op, params = {}) => {
    const start = () => fetch("/api/reports/share-op", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op, ...params }),
    });
    // The server runs one sharing action at a time. One already running (the
    // people list still loading, say) is waited out rather than failing this one.
    let res = await start();
    const queuedAt = Date.now();
    while (res.status === 409 && Date.now() - queuedAt < POLL_TIMEOUT_MS) {
      await new Promise(r => setTimeout(r, POLL_MS));
      let state = null;
      try {
        state = await readJson(await fetch("/api/reports/share-status"));
      } catch {
        state = null;
      }
      if (!state || state.status !== "running") res = await start();
    }
    if (res.status === 409) throw new ReportError("Another sharing action is still running — try again in a moment.", "busy");
    if (!res.ok) {
      const data = await readJson(res);
      throw new ReportError(data?.error || "Couldn't start that.", "invalid");
    }
    const job = (await readJson(res))?.job;
    if (!job) throw new ReportError("Couldn't start that.", "invalid");
    setShareJob({ status: "running", op, progress: "Checking your Carta connection…" });
    const started = Date.now();
    for (;;) {
      await new Promise(r => setTimeout(r, POLL_MS));
      let res = null;
      let state = null;
      try {
        res = await fetch(`/api/reports/share-status?job=${encodeURIComponent(job)}`);
        state = await readJson(res);
      } catch {
        state = null;
      }
      if (state?.error === "unknown_job") {
        throw new ReportError("Lost track of that sharing action — check the report, then try again.", "failed");
      }
      // A failed status read isn't the job's end; keep polling until the timeout.
      if (res && !res.ok) state = null;
      if (state) setShareJob(state);
      if (state && state.status !== "running") {
        if (state.status === "error") {
          throw new ReportError(state.error?.message || "Couldn't finish — try again.", state.error?.code);
        }
        if (op !== REPORT_ACTIONS.USERS) {
          await load();
          await onChanged?.();
        }
        return state.result;
      }
      if (Date.now() - started > POLL_TIMEOUT_MS) {
        throw new ReportError("This is taking longer than expected — check again in a minute.", "timeout");
      }
    }
  }, [load, onChanged]);

  // Who a report can be shared with, kept while the page is open. The server saves Carta's
  // answer for a day, but even asking the server makes a panel open wait on a status poll.
  const peopleRef = useRef(null);
  const loadPeople = useCallback(async ({ refresh = false } = {}) => {
    if (!refresh && peopleRef.current) return peopleRef.current;
    const result = await runShareOp(REPORT_ACTIONS.USERS, refresh ? { refresh: true } : {});
    peopleRef.current = { users: result?.users || [], fetchedAt: result?.fetched_at ?? null };
    return peopleRef.current;
  }, [runShareOp]);

  const byId = useCallback(id => listing.reports.find(r => r.id === id) || null, [listing.reports]);

  return useMemo(() => ({
    available,
    reports: listing.reports,
    shareTarget: listing.share_target,
    shareJob,
    can,
    byId,
    act,
    runShareOp,
    loadPeople,
    reload: load,
  }), [available, listing, shareJob, can, byId, act, runShareOp, loadPeople, load]);
}
