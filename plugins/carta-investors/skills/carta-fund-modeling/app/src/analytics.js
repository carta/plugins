// Snowplow UI-event tracking for the fund-modeling console via @carta/mcp-ui-tracker
// (vendored at webapp/vendor/mcp-ui-tracker.global.js). A full React micro-app, not a
// skill-produced artifact — hence interfaceType "micro_app" with no app.connect()
// handshake to await.
//
// The envelope (environment + firm + user) comes from GET /api/telemetry-context: server-sourced,
// so no one can retarget the firm by editing a URL and no bookmark can drop it. mountWithAuth awaits
// it before rendering, so no event fires ahead of it — in either document.
//
// Only an explicit "nonprod" environment counts; anything else — missing, garbled, or an
// unreachable endpoint — defaults to "production", since an unclassified launch of a
// customer-facing plugin is far more likely real prod use than a test session.

// Lets telemetry join on the real Carta id instead of slugifying the firm name from PAGE_URL_PATH.
const FIRM_CONTEXT_SCHEMA = "iglu:com.carta/firm/jsonschema/1-1-0";

// Stays null when the id didn't resolve — a wrong or placeholder id pollutes the firm dimension.
let firmContexts = null;

// Integers only — both callers pass a JSON number from the server; anything else is an upstream bug.
function toFirmContexts(firmId) {
  if (!Number.isInteger(firmId) || firmId <= 0) return null;
  return [{ schema: FIRM_CONTEXT_SCHEMA, data: { firmId } }];
}

/** Authoritative id from the loaded snapshot — follows a refresh that rewrites the firm mid-session. */
export function setTrackingFirm(firmId) {
  firmContexts = toFirmContexts(firmId);
}

async function telemetryContext() {
  try {
    const r = await fetch("/api/telemetry-context");
    return r.ok ? await r.json() : {};
  } catch {
    return {}; // a blip costs us the envelope, not every event
  }
}

// Snowplow's user_id is a string column; the server sends the integer.
function toTrackerUserId(userId) {
  return Number.isInteger(userId) && userId > 0 ? String(userId) : undefined;
}

export async function initFundModelingTracker() {
  if (typeof window === "undefined" || !window.mcpUiTracker) return;
  const { environment, firmId, userId } = await telemetryContext();
  firmContexts = toFirmContexts(firmId);
  // The vendored tracker exposes no post-init setUserId — the id has to be known here.
  window.mcpUiTracker.initTracker({
    interface: { interfaceType: "micro_app", interfaceId: "carta-fund-modeling" },
    environment: environment === "nonprod" ? "nonprod" : "production",
    userId: toTrackerUserId(userId),
  });
}

function track(action, elementId) {
  if (typeof window === "undefined" || !window.mcpUiTracker || !window.mcpUiTracker.getTransport()) return;
  window.mcpUiTracker.trackUiEvent(action, elementId, firmContexts ? { contexts: firmContexts } : {});
}

export const trackClick = (elementId) => track("click", elementId);
export const trackRender = (elementId) => track("render", elementId);
