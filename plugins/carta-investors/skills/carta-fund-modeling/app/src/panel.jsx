import React from "react";
import { createRoot } from "react-dom/client";
import Root from "./Root.jsx";
import { FEATURES } from "./app-config.js";
import { installMcpFetch } from "./mcp-fetch.js";
import { parseRoute, useMemoryRoute } from "./route.js";
import { portfolioQuery } from "./state/usePortfolio.js";
import { newScenarioId, trackPortfolioEtags, watchForOutsideChanges } from "./panel-sync.js";

// Entry for the MCP App panel. The shell page sets window.__fmHost = { callTool } before this
// bundle loads; sign-in is the Carta connection's, so there is no token gate.
installMcpFetch(window.__fmHost.callTool);
const portfolioEtags = trackPortfolioEtags();
useMemoryRoute("/");
installMemoryStorage();
createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Root features={FEATURES.hosted} />
  </React.StrictMode>
);
// Show scenarios and edits made from Claude without a reopen: flush the app's own pending edit,
// then re-read the portfolio when its stored copy changed elsewhere.
watchForOutsideChanges({
  ...portfolioEtags,
  currentQuery: () => portfolioQuery(parseRoute().firm),
  // A scenario the new-scenario form just made is selected once it arrives.
  reload: async () => {
    const ctl = window.__fmPortfolioCtl;
    const before = ctl?.sliceIds?.() || [];
    await ctl?.flush?.();
    await ctl?.reload?.({ keepSelection: true });
    const added = newScenarioId(before, await settledSliceIds(before));
    if (added) window.__fmPortfolioCtl?.selectSlice?.(added);
  },
});

// reload() sets the new document in React state, so its IDs show after a render; wait briefly for it.
async function settledSliceIds(before, tries = 20) {
  for (let i = 0; i < tries; i++) {
    const ids = window.__fmPortfolioCtl?.sliceIds?.() || [];
    if (ids.join() !== before.join()) return ids;
    await new Promise((r) => setTimeout(r, 50));
  }
  return before;
}

// A host may sandbox the panel without same-origin access, where touching localStorage throws.
// The app reads it unguarded in places, so stand in an in-memory store for the panel's lifetime.
function installMemoryStorage() {
  try {
    window.localStorage.getItem("probe");
  } catch {
    const items = new Map();
    const store = {
      getItem: (k) => (items.has(k) ? items.get(k) : null),
      setItem: (k, v) => items.set(k, String(v)),
      removeItem: (k) => items.delete(k),
      clear: () => items.clear(),
    };
    Object.defineProperty(window, "localStorage", { value: store, configurable: true });
  }
}
