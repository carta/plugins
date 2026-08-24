// Data loading for the CTC dashboard.
//
// The browser NEVER calls the Carta MCP. Every fetch here hits the local serve.py,
// which reads JSON the skill already produced. That is what makes the app fast,
// offline-capable, and free of per-interaction API round trips.

import { useEffect, useState } from "react";

/** The launch URL carries ?t=<token>; serve.py gates /api/* on it. */
export function apiToken() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("t") || "";
}

export async function apiGet(path) {
  const res = await fetch(path, { headers: { "X-Dash-Token": apiToken() } });
  if (res.status === 401) throw new Error("Unauthorized — relaunch the dashboard to get a fresh link.");
  if (!res.ok) throw new Error(`${path} failed (${res.status})`);
  const body = await res.json();
  // serve.py answers 200 {"error":"not_ready"} for a stem the build hasn't
  // published. That is an empty state, not a failure — surface it as null.
  if (body && body.error === "not_ready") return null;
  return body;
}

/** apiGet for a stem that legitimately may not exist. Resolves null instead of throwing.
 *
 * A benchmarks-only data dir is a valid build — a corporation can have benchmark
 * data and no swept roster — so roster.json's absence must not take the whole
 * dashboard down with it. Inside Promise.all a single rejection discards every
 * sibling result, so this has to swallow rather than throw.
 *
 * Deliberately narrow: only a missing file resolves null. A 401 still propagates,
 * because "your link expired" is a real error the user must see rather than a tab
 * quietly vanishing.
 */
export async function apiGetOptional(path) {
  try {
    return await apiGet(path);
  } catch (e) {
    if (/\(404\)/.test(e.message || "")) return null;
    throw e;
  }
}

/** Load the snapshot + benchmarks the Benchmarks tab needs, plus the roster if built. */
export function useDashboardData() {
  const [state, setState] = useState({
    loading: true, error: null, snapshot: null, benchmarks: null, roster: null,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [snapshot, benchmarks, roster] = await Promise.all([
          apiGet("/api/snapshot"),
          apiGet("/api/benchmarks"),
          apiGetOptional("/api/roster"),
        ]);
        if (cancelled) return;
        setState({ loading: false, error: null, snapshot, benchmarks, roster });
      } catch (e) {
        if (cancelled) return;
        setState({
          loading: false, error: e.message || String(e),
          snapshot: null, benchmarks: null, roster: null,
        });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return state;
}
