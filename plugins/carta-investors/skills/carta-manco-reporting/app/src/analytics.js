// Snowplow UI-event tracking for the ManCo reporting dashboard via @carta/mcp-ui-tracker
// (vendored at webapp/vendor/mcp-ui-tracker.global.js, copied verbatim from
// carta-fund-modeling's webapp/vendor/ — same generic bundle, no fund-modeling-specific
// code baked in). Mirrors carta-fund-modeling's app/src/analytics.js: same tracker, same
// firm-context contract, same no-op-when-untracked guards.
//
// GET /api/telemetry-context (scripts/serve.py) returns `{firmId, environment, userId}` —
// `userId` is the launching user's integer Carta id, written via serve.py's `--user-id`
// flag (mirrors carta-fund-modeling's --user-id plumbing). Only an explicit "nonprod"
// counts; anything else — missing, garbled, or an unreachable endpoint — defaults to
// "production", same rationale carta-fund-modeling uses for its own unclassified case.
//
// Ids are literals at the call site; a lookup map lives beside its use, as in
// carta-fund-modeling. Never interpolate customer data into one — see references/analytics.md.

// Lets telemetry join on the real Carta id instead of slugifying the firm name.
const FIRM_CONTEXT_SCHEMA = "iglu:com.carta/firm/jsonschema/1-1-0";

// Stays null when the id didn't resolve — a wrong or placeholder id pollutes the firm dimension.
let firmContexts = null;

// Integers only — serve.py sends a JSON number or null; anything else is an upstream bug.
export function toFirmContexts(firmId) {
  if (!Number.isInteger(firmId) || firmId <= 0) return null;
  return [{ schema: FIRM_CONTEXT_SCHEMA, data: { firmId } }];
}

async function telemetryContext() {
  try {
    const r = await fetch("/api/telemetry-context");
    return r.ok ? await r.json() : {};
  } catch {
    return {}; // a blip costs us the firm envelope, not the mount
  }
}

// Snowplow's user_id is a string column; the server sends the integer.
function toTrackerUserId(userId) {
  return Number.isInteger(userId) && userId > 0 ? String(userId) : undefined;
}

export async function initMancoTracker() {
  if (typeof window === "undefined" || !window.mcpUiTracker) return;
  const { environment, firmId, userId } = await telemetryContext();
  firmContexts = toFirmContexts(firmId);
  window.mcpUiTracker.initTracker({
    interface: { interfaceType: "micro_app", interfaceId: "carta-manco-reporting" },
    environment: environment === "nonprod" ? "nonprod" : "production",
    userId: toTrackerUserId(userId),
  });
}

// The guard below stays non-throwing, so a dead transport is otherwise invisible — which
// is how this app once shipped with no telemetry and a green test suite.
let warnedNoTransport = false;
function warnOnce() {
  if (warnedNoTransport) return;
  warnedNoTransport = true;
  console.warn("[manco-reporting] no Snowplow transport — UI events are being dropped");
}

function track(action, elementId) {
  if (typeof window === "undefined" || !window.mcpUiTracker || !window.mcpUiTracker.getTransport()) {
    return warnOnce();
  }
  window.mcpUiTracker.trackUiEvent(action, elementId, firmContexts ? { contexts: firmContexts } : {});
}

export const trackClick = (elementId) => track("click", elementId);
export const trackRender = (elementId) => track("render", elementId);
