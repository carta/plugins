export const CONNECTING_STEP = "Connecting to Carta…";
export const SETTING_CONTEXT_STEP = "Setting firm context";
export const QUERYING_STEP = "Querying fund data";
export const BUILDING_SNAPSHOT_STEP = "Building snapshot";
export const STORING_SNAPSHOT_STEP = "Storing snapshot";

// The steps the server reports while it loads a firm, in order. Each owns a stretch of the loading
// bar; the long "Querying fund data" step gets the largest.
const LOAD_STEPS = [
  [CONNECTING_STEP, 0.05, 0.12],
  [SETTING_CONTEXT_STEP, 0.12, 0.2],
  [QUERYING_STEP, 0.2, 0.75],
  [BUILDING_SNAPSHOT_STEP, 0.75, 0.92],
  [STORING_SNAPSHOT_STEP, 0.92, 0.98],
];
/** The bar's `{ from, to }` for a load step, or null for one this list doesn't know. */
export function stepProgress(step) {
  const hit = LOAD_STEPS.find(([name]) => name === step);
  return hit ? { from: hit[1], to: hit[2] } : null;
}

/** Load `firm`'s Carta data into this session through /api/load-firm, passing each progress
 *  step to `onStep`. `force` marks a user-requested reload, which the server refuses with
 *  `too_soon` during its refresh cooldown. Resolves to whether the stream said Done; rejects with
 *  the server's message, plus its `code` and `retryAfter` when it sent them. */
export async function runFirmLoad(firm, onStep = () => {}, { force = false } = {}) {
  const res = await fetch("/api/load-firm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug: firm, ...(force && { force }) }),
  });
  // 401/403/400 come back as JSON, not SSE. The frame parser finds no
  // "data: " line in those bytes, so the failure would pass silently.
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw Object.assign(new Error(body?.message || body?.error || `Load failed (${res.status})`),
      { code: body?.error, retryAfter: body?.retryAfter });
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let done = false;
  while (true) {
    const { done: ended, value } = await reader.read();
    if (ended) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      let evt;
      try { evt = JSON.parse(line.slice(6)); } catch { continue; }
      if (evt.error) throw new Error(evt.error);
      if (evt.done) done = true;
      else if (evt.step) onStep(evt.step);
    }
  }
  return done;
}
