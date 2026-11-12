// Panel mode: the new-scenario form and Claude's company edits change the portfolio from outside
// the panel, which nothing tells it about. So the panel asks Fund Modeling now and then whether the
// stored portfolio's ETag has moved past the last one the app itself read or wrote, and reloads
// when it has. The app's own saves update the ETag it remembers, and a check that a save of the
// app's is in flight for, or starts during, is skipped, so the app's own saves never trigger a reload.
import { requestMethod, requestUrl } from "./mcp-fetch.js";

const PORTFOLIO = "/api/portfolio";

/** Remember every portfolio ETag the app reads or writes, by firm query, and count its writes.
 *  `untracked` is the fetch underneath, for the check's own probe, which must not count as a read. */
export function trackPortfolioEtags(seen = new Map()) {
  const inner = window.fetch;
  const writes = { started: 0, inFlight: 0 };
  window.fetch = async (input, init = {}) => {
    const url = requestUrl(input);
    const method = requestMethod(input, init);
    const mine = url.startsWith(PORTFOLIO);
    const write = mine && method !== "GET";
    if (write) {
      writes.started++;
      writes.inFlight++;
    }
    try {
      const res = await inner(input, init);
      const etag = res.headers.get("etag");
      if (mine && etag) seen.set(url.slice(PORTFOLIO.length), etag);
      return res;
    } finally {
      if (write) writes.inFlight--;
    }
  };
  return { seen, writes, untracked: inner };
}

/** Check once: reload when the server's ETag for `query` differs from the app's latest and no
 *  write of the app's overlapped the check. The reload's own read records the ETag it got, so a
 *  failed reload leaves the old one and the next check retries. */
export async function checkForOutsideChanges({ query, seen, writes, fetchEtag, reload }) {
  if (!seen.get(query) || writes.inFlight) return false;
  const started = writes.started;
  const current = await fetchEtag(query);
  if (!current || writes.started !== started || current === seen.get(query)) return false;
  await reload();
  return true;
}

/** Check every `intervalMs` while the panel is visible, and when it regains focus. */
export function watchForOutsideChanges({ currentQuery, seen, writes, untracked, reload, intervalMs = 2000 }) {
  // A plain GET: the Carta connection relays GET, POST and PUT only.
  const fetchEtag = async (query) => {
    const res = await untracked(PORTFOLIO + query).catch(() => null);
    return res?.ok ? res.headers.get("etag") : null;
  };
  let busy = false;
  const check = async () => {
    if (busy || document.visibilityState === "hidden") return;
    const query = currentQuery();
    if (!query) return;
    busy = true;
    try {
      await checkForOutsideChanges({ query, seen, writes, fetchEtag, reload });
    } catch {
      // A failed reload records no new ETag, so the next check retries it.
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(check, intervalMs);
  window.addEventListener("focus", check);
  return () => {
    clearInterval(timer);
    window.removeEventListener("focus", check);
  };
}

/** The one scenario `after` has that `before` lacks, or null when there are none or several (a
 *  scenario from another tab arriving with it would make "the new one" a guess). */
export function newScenarioId(before, after) {
  const had = new Set(before);
  const added = after.filter((id) => !had.has(id));
  return added.length === 1 ? added[0] : null;
}
