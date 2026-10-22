/** Load `firm`'s Carta data into this session through /api/load-firm, passing each progress
 *  step to `onStep`. Resolves when the load is done; rejects with the server's message. */
export async function runFirmLoad(firm, onStep = () => {}) {
  const res = await fetch("/api/load-firm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug: firm }),
  });
  // 401/403/400 come back as JSON, not SSE. The frame parser finds no
  // "data: " line in those bytes, so the failure would pass silently.
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message || body?.error || `Load failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      let evt;
      try { evt = JSON.parse(line.slice(6)); } catch { continue; }
      if (evt.error) throw new Error(evt.error);
      if (evt.step && !evt.done) onStep(evt.step);
    }
  }
}
