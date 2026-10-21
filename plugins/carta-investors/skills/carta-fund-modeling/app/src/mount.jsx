import React from "react";
import { createRoot } from "react-dom/client";
import { resolveDashToken, installApiAuth } from "./dash-token.js";
import { initFundModelingTracker } from "./analytics.js";
import AuthError from "./AuthError.jsx";
import { loadFeatures } from "./app-config.js";

// Shared launch gate for both entrypoints: AuthError when there is no valid token, else render
// with what this server supports.
export async function mountWithAuth(render) {
  const root = createRoot(document.getElementById("root"));
  const token = await resolveDashToken();
  if (!token) {
    root.render(<AuthError />);
    return;
  }
  installApiAuth(token);
  // Before render, so the first view-render event already carries the envelope. Needs the
  // token gate above: /api/telemetry-context is token-gated like every other /api route.
  await initFundModelingTracker();
  render(root, await loadFeatures());
}
