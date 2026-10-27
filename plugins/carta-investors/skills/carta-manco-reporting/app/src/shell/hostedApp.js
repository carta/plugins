import { useEffect, useState } from "react";

// Whether this bundle is running as the hosted Worker app rather than the local
// `scripts/serve.py` server: probes /api/app-config, which the Worker answers 200 before
// any auth or firm check (server/worker.js's handleAppConfig), and the local server 404s
// (serve.py has no such route). Unlike /api/budget-upload, this never depends on a
// session having an active firm yet, so it answers the same on a session's first load as
// on every later one.
//
// Starts `null` (not yet known) until the probe settles. A truthy check reads
// `null` as not hosted; chatFeature.js's useChatFeatureFlag() compares against
// `null` to tell "still probing" apart from "confirmed local".
export function useHostedApp() {
  const [hosted, setHosted] = useState(null);
  useEffect(() => {
    fetch("/api/app-config").then((r) => setHosted(r.ok)).catch(() => setHosted(false));
  }, []);
  return hosted;
}
