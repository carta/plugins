// What a finished share job means for the person who started it: a decision only
// they can make (the shared copy changed on Carta, or was deleted), a share whose
// page didn't refresh, or done.
export const UPDATED = "Shared report updated.";

export function shareOutcome(result) {
  if (result?.status === "stale" || result?.status === "deleted") return { kind: "decide", status: result.status };
  if (result?.rebuilt === false) {
    return { kind: "partial", message: `Shared, but the page couldn't refresh: ${result.rebuild_error}` };
  }
  return { kind: "done" };
}
