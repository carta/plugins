import { useHostedApp } from "./hostedApp.js";

// Chat + Pinpoint needs the local server's `claude` CLI; the hosted Worker
// has none, so this is false for "hosted" in every build that ships.
export const FEATURES = { local: { askClaude: true }, hosted: { askClaude: false } };

export function useChatFeatureFlag() {
  const hosted = useHostedApp();
  // useHostedApp() starts null (still probing). Treating that as local would
  // show Chat on a hosted user's first paint, against a Worker with no
  // `claude` CLI.
  return hosted !== null && FEATURES[hosted ? "hosted" : "local"].askClaude;
}
