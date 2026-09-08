import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { resolveDashToken, installApiAuth } from "./dash-token.js";
import { initMancoTracker, trackRender } from "./analytics.js";
import AuthError from "./AuthError.jsx";

// Security: serve.py gates every /api/* request with a per-launch token carried in
// the URL (?t=...). resolveDashToken() persists it to localStorage and scrubs it
// from the URL once trusted, and falls back to the persisted copy on a reload with
// no ?t=. installApiAuth() then patches fetch so every same-origin /api call carries
// it, unchanged from before. No valid token (expired launch, wrong ?t=) renders
// AuthError instead of mounting the dashboard, rather than the generic inline
// "Error: unauthorized" App.jsx would otherwise show.
const root = createRoot(document.getElementById("root"));
const token = await resolveDashToken();
if (!token) {
  // Only /api/telemetry-context is token-gated, not the tracker — so this goes out
  // without the firm envelope rather than not at all.
  await initMancoTracker();
  trackRender("MancoReporting.App.AuthFailed");
  root.render(<AuthError />);
} else {
  installApiAuth(token);
  // Before render, so the app-load event already carries the firm envelope.
  // Needs installApiAuth above: /api/telemetry-context is token-gated like every
  // other /api route.
  await initMancoTracker();
  trackRender("MancoReporting.App.Load");
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
