// Snowplow UI events through the page's own MCP connector; no-ops when the tracker bundle is absent.
// Call initUiTracker once window.claude is ready: "bridge" never falls back to the CSP-blocked collector.
function initUiTracker(interfaceId, server) {
  if (!window.mcpUiTracker) return;
  window.mcpUiTracker.initTracker({
    interface: { interfaceType: "artifact", interfaceId: interfaceId },
    mcpServerId: server,
    transport: "bridge",
  });
}
function trackUi(action, elementId, options) {
  if (window.mcpUiTracker && window.mcpUiTracker.getTransport()) {
    window.mcpUiTracker.trackUiEvent(action, elementId, options);
  }
}
