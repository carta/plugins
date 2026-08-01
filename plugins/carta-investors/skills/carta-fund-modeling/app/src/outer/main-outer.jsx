import React from "react";
import { createRoot } from "react-dom/client";
import OuterShell from "./OuterShell.jsx";
import { installThemeSync } from "./theme-sync.js";

// Sync the outer shell's light/dark appearance to the app's theme toggle
// (shared same-origin localStorage + storage events) before the first
// paint, so the chat rail never flashes the wrong scheme.
installThemeSync();

// Security: serve.py gates every /api/* request with a per-launch token carried
// in the URL (?t=...). Inject it as a header on all same-origin /api fetches so
// the chat panel's /api/chat calls, which now run from this outer frame, stay
// authenticated the same way the app's own /api calls do (see main.jsx).
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
    <OuterShell />
  </React.StrictMode>
);
