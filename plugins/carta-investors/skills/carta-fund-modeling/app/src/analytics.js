// Snowplow UI-event tracking for the fund-modeling console via @carta/mcp-ui-tracker
// (vendored at webapp/vendor/mcp-ui-tracker.global.js). A full React micro-app, not a
// skill-produced artifact — hence interfaceType "micro_app" with no app.connect()
// handshake to await, so init fires as early as possible.
//
// env comes from the launch URL's ?env= param (serve.py/build_datadir.py set it from the
// cached snapshot's cartaEnvironment). Only an explicit "nonprod" counts; anything else —
// missing, garbled, or a stale bookmark — defaults to "production", since an unclassified
// launch of a customer-facing plugin is far more likely real prod use than a test session.
export function initFundModelingTracker(env) {
  if (typeof window === "undefined" || !window.mcpUiTracker) return;
  window.mcpUiTracker.initTracker({
    interface: { interfaceType: "micro_app", interfaceId: "carta-fund-modeling" },
    environment: env === "nonprod" ? "nonprod" : "production",
  });
}

function track(action, elementId) {
  if (typeof window === "undefined" || !window.mcpUiTracker || !window.mcpUiTracker.getTransport()) return;
  window.mcpUiTracker.trackUiEvent(action, elementId);
}

export const trackClick = (elementId) => track("click", elementId);
export const trackRender = (elementId) => track("render", elementId);
