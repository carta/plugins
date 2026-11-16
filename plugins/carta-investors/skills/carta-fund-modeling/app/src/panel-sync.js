// Panel mode: the new-scenario form and Claude's company edits change the portfolio from outside
// the panel, which nothing tells it about. The Carta MCP counts the user's writes to their
// portfolio at the firm, so the panel waits there for one (a wait costs the Worker nothing), and
// checks the Worker itself now and then for saves that never pass through the Carta MCP. A check
// reloads when the stored portfolio's ETag has moved past the last one the app itself read or
// wrote. The app's own saves update the ETag it remembers, and a check that a save of the app's is
// in flight for, or starts during, is skipped, so the app's own saves never trigger a reload.
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

/** What one check did. `skipped` and `failed` leave the change unread: `skipped` is checked again once the panel is
 *  free, `failed` by the interval check. */
export const CHECK = Object.freeze({ skipped: "skipped", unchanged: "unchanged", reloaded: "reloaded", failed: "failed" });

/** Whether a check can compare ETags now: the app has read the firm's portfolio and no save of its own is in flight. */
export const canCheck = ({ query, seen, writes }) => !!query && !!seen.get(query) && !writes.inFlight;

/** Check once: reload when the server's ETag for `query` differs from the app's latest and no
 *  write of the app's overlapped the check. The reload's own read records the ETag it got, so a
 *  failed reload leaves the old one and the next check retries. */
export async function checkForOutsideChanges({ query, seen, writes, fetchEtag, reload }) {
  if (!canCheck({ query, seen, writes })) return CHECK.skipped;
  const started = writes.started;
  const current = await fetchEtag(query);
  if (!current) return CHECK.failed;
  if (writes.started !== started) return CHECK.skipped;
  if (current === seen.get(query)) return CHECK.unchanged;
  await reload();
  return CHECK.reloaded;
}

// KV can hide a just-queued item from the Worker's listing for up to about a minute, so a change
// the Carta MCP reported but the ETag does not show yet is checked again this long after the first check.
export const RECHECK_AT_MS = [2000, 5000, 15000, 60000];
const NULL_BACKOFF_MS = [2000, 10000];
const MAX_NULLS = 3;
const FREE_POLL_MS = 500;

/** Wait on the Carta MCP for the user's next write at the firm and check when one lands; check every `intervalMs`
 *  while the panel is visible, and when it regains focus or comes back into view. Without
 *  `waitForChange` only the interval runs; after MAX_NULLS failed waits in a row, the wait retries
 *  every `intervalMs`, so a panel recovers from a Carta MCP outage without a reopen. */
export function watchForOutsideChanges({ currentQuery, currentFirm = () => "", seen, writes, untracked, reload, waitForChange, intervalMs = 180_000 }) {
  // A plain GET: the Carta connection relays GET, POST and PUT only.
  const fetchEtag = async (query) => {
    const res = await untracked(PORTFOLIO + query).catch(() => null);
    return res?.ok ? res.headers.get("etag") : null;
  };
  let stopped = false;
  let running = null;
  const hidden = () => document.visibilityState === "hidden";
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (ready) => {
    while (!stopped && !ready()) await sleep(FREE_POLL_MS);
  };
  const free = () => !running && !hidden() && canCheck({ query: currentQuery(), seen, writes });
  const check = async () => {
    if (stopped || !free()) return CHECK.skipped;
    const query = currentQuery();
    // A failed reload records no new ETag, so the next check retries it.
    running = checkForOutsideChanges({ query, seen, writes, fetchEtag, reload }).catch(() => CHECK.failed);
    try {
      return await running;
    } finally {
      running = null;
    }
  };
  const recheck = async () => {
    let waited = 0;
    for (const at of RECHECK_AT_MS) {
      await sleep(at - waited);
      waited = at;
      if (stopped || (await check()) === CHECK.reloaded) return;
    }
  };
  const waitLoop = async () => {
    let since = null;
    let sinceFirm = null;
    let nulls = 0;
    let writesAtLastAnswer = writes.started;
    while (!stopped) {
      // An empty firm would wait on the server's active firm, which can differ from the panel's.
      await until(() => !hidden() && !!currentFirm());
      if (stopped) return;
      const firm = currentFirm();
      // A revision belongs to one firm, so a switched firm starts over as a first answer.
      if (firm !== sinceFirm) {
        since = null;
        sinceFirm = firm;
      }
      // A switched firm abandons this wait: the old firm's answer would hold up the new firm's wait, and checking the
      // new firm on the old firm's change would only probe the wrong portfolio.
      let settled = false;
      const switched = until(() => settled || currentFirm() !== firm).then(() => null);
      const answer = await Promise.race([waitForChange({ firm, since }).catch(() => null), switched]);
      settled = true;
      if (stopped) return;
      if (currentFirm() !== firm) continue;
      if (!answer) {
        nulls += 1;
        await sleep(nulls < MAX_NULLS ? NULL_BACKOFF_MS[nulls - 1] : intervalMs);
        continue;
      }
      nulls = 0;
      // The first answer checks too: a write may have landed between the first load and it.
      if (answer.changed || since === null) {
        const outcome = await check();
        if (stopped) return;
        if (outcome === CHECK.skipped) {
          await until(free);
          continue;
        }
        // An unchanged ETag right after the app's own save is that save; anything else may be lagging.
        if (outcome === CHECK.unchanged && answer.changed && writes.started === writesAtLastAnswer) await recheck();
      }
      since = answer.rev;
      writesAtLastAnswer = writes.started;
    }
  };
  const onVisible = () => {
    if (!hidden()) check();
  };
  const timer = setInterval(check, intervalMs);
  window.addEventListener("focus", check);
  document.addEventListener("visibilitychange", onVisible);
  if (waitForChange) waitLoop();
  return () => {
    stopped = true;
    clearInterval(timer);
    window.removeEventListener("focus", check);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

/** The one scenario `after` has that `before` lacks, or null when there are none or several (a
 *  scenario from another tab arriving with it would make "the new one" a guess). */
export function newScenarioId(before, after) {
  const had = new Set(before);
  const added = after.filter((id) => !had.has(id));
  return added.length === 1 ? added[0] : null;
}
