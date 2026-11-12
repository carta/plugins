// Snowplow UI-event tracking for the fund-modeling console via @carta/mcp-ui-tracker
// (vendored at webapp/vendor/mcp-ui-tracker.global.js). A full React micro-app, not a
// skill-produced artifact — hence interfaceType "micro_app" with no app.connect()
// handshake to await.
//
// The envelope (environment + firm + user) comes from GET /api/telemetry-context: server-sourced,
// so no one can retarget the firm by editing a URL and no bookmark can drop it. mountWithAuth awaits
// it before rendering, so no event fires ahead of it — in either document. On the hosted app a second
// request names the route's firm, and the server answers its ID only after its own access check.
//
// Only an explicit "nonprod" environment counts; anything else — missing, garbled, or an
// unreachable endpoint — defaults to "production", since an unclassified launch of a
// customer-facing plugin is far more likely real prod use than a test session.

import { isFirmId, parseRoute, subscribeNav } from "./route.js";

// Lets telemetry join on the real Carta id instead of slugifying the firm name from PAGE_URL_PATH.
const FIRM_CONTEXT_SCHEMA = "iglu:com.carta/firm/jsonschema/1-1-0";

export const FIRM_WAIT_MS = 1500;

// Stays null when the id didn't resolve — a wrong or placeholder id pollutes the firm dimension.
let firmContexts = null;
let routeFirm = null;
let snapshotSetFirm = false;
let pending = null; // { queue, timer } while the route firm's reply is awaited
let unfollowRoute = null;

// Integers only — both callers pass a JSON number from the server; anything else is an upstream bug.
function toFirmContexts(firmId) {
  if (!Number.isInteger(firmId) || firmId <= 0) return null;
  return [{ schema: FIRM_CONTEXT_SCHEMA, data: { firmId } }];
}

/** Authoritative id from the snapshot loaded for route firm `forFirm` — follows a refresh that rewrites the firm
 *  mid-session. Ignored once the route names another firm, since a load can finish after the user has left it. */
export function setTrackingFirm(firmId, forFirm) {
  if (parseRoute().firm !== forFirm) return;
  firmContexts = toFirmContexts(firmId);
  snapshotSetFirm = true;
  flush();
}

async function telemetryContext(firm) {
  try {
    const r = await fetch(firm ? `/api/telemetry-context?firm=${encodeURIComponent(firm)}` : "/api/telemetry-context");
    return r.ok ? await r.json() : {};
  } catch {
    return {}; // a blip costs us the envelope, not every event
  }
}

// Snowplow's user_id is a string column; the server sends the integer.
function toTrackerUserId(userId) {
  return Number.isInteger(userId) && userId > 0 ? String(userId) : undefined;
}

// Local routes are name slugs and the local server answers the firm in the envelope, so only hosted IDs are sent.
function currentRouteFirm() {
  const { firm } = parseRoute();
  return isFirmId(firm) ? firm : null;
}

function flush() {
  if (!pending) return;
  clearTimeout(pending.timer);
  const { queue } = pending;
  pending = null;
  for (const [action, elementId] of queue) send(action, elementId);
}

async function resolveRouteFirm(firm) {
  const own = { queue: [], timer: setTimeout(flush, FIRM_WAIT_MS) };
  pending = own;
  const { firmId } = await telemetryContext(firm);
  if (routeFirm !== firm || snapshotSetFirm) return;
  firmContexts = toFirmContexts(firmId);
  if (pending === own) flush();
}

function followRoute() {
  const firm = currentRouteFirm();
  if (firm === routeFirm) return;
  flush();
  routeFirm = firm;
  firmContexts = null;
  snapshotSetFirm = false;
  if (firm) resolveRouteFirm(firm);
}

export async function initFundModelingTracker() {
  if (typeof window === "undefined" || !window.mcpUiTracker) return;
  // Awaited alone: on page open it may refresh the Carta token, and refresh tokens are single-use, so the
  // firm request (and every request after render) must start once it has finished.
  const { environment, firmId, userId } = await telemetryContext();
  firmContexts = toFirmContexts(firmId);
  routeFirm = null;
  snapshotSetFirm = false;
  // The vendored tracker exposes no post-init setUserId — the id has to be known here.
  window.mcpUiTracker.initTracker({
    interface: { interfaceType: "micro_app", interfaceId: "carta-fund-modeling" },
    environment: environment === "nonprod" ? "nonprod" : "production",
    userId: toTrackerUserId(userId),
  });
  unfollowRoute?.();
  unfollowRoute = subscribeNav(followRoute);
  followRoute();
}

function send(action, elementId) {
  if (typeof window === "undefined" || !window.mcpUiTracker || !window.mcpUiTracker.getTransport()) return;
  window.mcpUiTracker.trackUiEvent(action, elementId, firmContexts ? { contexts: firmContexts } : {});
}

// The tracker stamps an event when it is sent, so a queued event is stamped up to FIRM_WAIT_MS late; order is kept.
function track(action, elementId) {
  if (pending) pending.queue.push([action, elementId]);
  else send(action, elementId);
}

export const trackClick = (elementId) => track("click", elementId);
export const trackRender = (elementId) => track("render", elementId);
