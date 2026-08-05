import React from "react";
import Root from "./Root.jsx";
import { installPinpoint } from "./bridge-client.js";
import { mountWithAuth } from "./mount.jsx";
import { initFundModelingTracker } from "./analytics.js";

// serve.py appends ?env=<production|nonprod> to the launch URL (from this
// firm's cached snapshot.source.cartaEnvironment) — read synchronously here,
// independent of the async token/mount flow below, so init never races an
// async fetch. dash-token.js's ?t= scrub only deletes "t", so this is
// unaffected by it.
initFundModelingTracker(new URLSearchParams(window.location.search).get("env"));

await mountWithAuth((root) => {
  root.render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>
  );
  installPinpoint();
});
