import React from "react";
import OuterShell from "./OuterShell.jsx";
import { installThemeSync } from "./theme-sync.js";
import { mountWithAuth } from "../mount.jsx";

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
