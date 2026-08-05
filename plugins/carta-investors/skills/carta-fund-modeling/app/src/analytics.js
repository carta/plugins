// Snowplow UI-event tracking for the fund-modeling console via
// @carta/mcp-ui-tracker (vendored at webapp/vendor/mcp-ui-tracker.global.js).
// This is a full running React micro-app (routing, own server, outer-shell
// iframe) rather than a single skill-produced artifact — interfaceType is
// "micro_app". No MCP-host app.connect() handshake here, so init fires as
// early as possible.
//
// `env` is the Carta environment the skill's build resolved the data from
// (threaded via the launch URL's ?env= param, set by serve.py from
// snapshot.source.cartaEnvironment, which itself defaults to "production" —
// see serve.py/build_datadir.py). "nonprod" must be explicit; anything else
// (including a missing/garbled param, e.g. a stale bookmarked URL) resolves
// to "production" — this is a customer-facing plugin, so an unclassified
// launch is far more likely real production usage than a staff test session.
export function initFundModelingTracker(env) {
  if (typeof window === "undefined" || !window.mcpUiTracker) return;
  window.mcpUiTracker.initTracker({
    interface: { interfaceType: "micro_app", interfaceId: "carta-fund-modeling" },
    environment: env === "nonprod" ? "nonprod" : "production",
  });
}

export function trackFundModeling(action, elementId, options) {
  if (typeof window === "undefined" || !window.mcpUiTracker || !window.mcpUiTracker.getTransport()) return;
  window.mcpUiTracker.trackUiEvent(action, elementId, options);
}
