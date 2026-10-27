import { useHostedApp } from "./hostedApp.js";

// Chat + Pinpoint needs the local server's `claude` CLI; the hosted Worker
// has none, so this is false for "hosted" in every build that ships.
export const FEATURES = { local: { askClaude: false }, hosted: { askClaude: false } };

export function useChatFeatureFlag() {
  const hosted = useHostedApp();
  // useHostedApp() starts `null` (not yet known, see its own comment) before
  // settling to a confirmed true/false. Reading FEATURES.local while it's
  // still pending would be wrong the moment FEATURES.local.askClaude is ever
  // true: a hosted user's first paint, before the probe resolves, would show
  // Chat and could even start a turn against a Worker with no `claude` CLI.
  return hosted !== null && FEATURES[hosted ? "hosted" : "local"].askClaude;
}
