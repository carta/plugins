import { useEffect, useState } from "react";

// Whether this bundle is running as the hosted Worker app rather than the local
// `scripts/serve.py` server: probes /api/app-config, which the Worker answers 200 before
// any auth or firm check (server/worker.js's handleAppConfig), and the local server 404s
// (serve.py has no such route). Unlike /api/budget-upload, this never depends on a
// session having an active firm yet, so it answers the same on a session's first load as
// on every later one.
export function useHostedApp() {
  const [hosted, setHosted] = useState(false);
  useEffect(() => {
    fetch("/api/app-config").then((r) => setHosted(r.ok)).catch(() => setHosted(false));
  }, []);
  return hosted;
}
