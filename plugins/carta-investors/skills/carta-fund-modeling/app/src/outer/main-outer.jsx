import React from "react";
import OuterShell from "./OuterShell.jsx";
import { installThemeSync } from "./theme-sync.js";
import { mountWithAuth } from "../mount.jsx";
import { initFundModelingTracker } from "../analytics.js";

// A separate document/frame from main.jsx (index.html's top-level shell vs.
// app.html's iframed app) — each needs its own init call. ?env= (see
// main.jsx) survives mountWithAuth's ?t= scrub below and is still present
// when OuterShell freezes the iframe src further down.
initFundModelingTracker(new URLSearchParams(window.location.search).get("env"));

// Sync light/dark before the auth round-trip (and first paint), so the chat rail
// can't flash the wrong scheme.
installThemeSync();

// Resolve before OuterShell freezes the iframe src from location.href, so the
// iframe inherits the scrubbed, token-free URL.
await mountWithAuth((root) => {
  root.render(
    <React.StrictMode>
      <OuterShell />
    </React.StrictMode>
  );
});
