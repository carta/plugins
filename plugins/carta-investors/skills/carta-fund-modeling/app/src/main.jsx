import React from "react";
import { createRoot } from "react-dom/client";
import Root from "./Root.jsx";
import { installPinpoint } from "./bridge-client.js";

// Security: serve.py gates every /api/* request with a per-launch token carried
// in the URL (?t=...). Inject it as a header on all same-origin /api fetches so
// the ported data layer stays unchanged.
const TOKEN = new URLSearchParams(window.location.search).get("t") || "";
if (TOKEN) {
  const orig = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    if (url.startsWith("/api")) {
      init = { ...init, headers: { ...(init.headers || {}), "X-Dash-Token": TOKEN } };
    }
    return orig(input, init);
  };
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);

installPinpoint();
