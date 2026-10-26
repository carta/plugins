export const CONNECTING_STEP = "Connecting to Carta…";
export const STORING_SNAPSHOT_STEP = "Storing snapshot";

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
