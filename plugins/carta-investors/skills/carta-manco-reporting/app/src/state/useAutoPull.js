import { useEffect, useRef } from "react";
import { trackRender } from "../analytics.js";
import { resurfaceDue } from "./resurface.js";
import { pullChanged, REPORT_ACTIONS } from "./useReports.js";

// Loads reports shared with the signed-in user without being asked: once the firm's data
// is in (`enabled`), and again when the tab comes back into view (resurfaceDue: a burst of
// tab switches starts one run), so a new one shows
// up on its own. The Worker throttles these runs too (`auto`), so reloads and several open
// tabs don't each ask Carta. Hosted only: a local pull runs a headless Claude session, which the
// user starts on purpose with "Load shared reports".
//
// `onPulled(result)` runs only when the pull changed something. A failed run stays quiet —
// the sidebar's "Load shared reports" is still there to retry, and says why.
export default function useAutoPull({ enabled, reportsApi, onPulled }) {
  // The latest callbacks, read when a run starts, so a re-render never restarts the hook.
  const latest = useRef({ reportsApi, onPulled });
  latest.current = { reportsApi, onPulled };

  const lastRunRef = useRef(0);
  useEffect(() => {
    if (!enabled) return undefined;
    const run = async () => {
      lastRunRef.current = Date.now();
      try {
        const result = await latest.current.reportsApi.runShareOp(REPORT_ACTIONS.PULL, { auto: true }, { background: true });
        if (pullChanged(result)) latest.current.onPulled(result);
      } catch {
        trackRender("MancoReporting.Nav.AutoLoadSharedReportsFailed");
      }
    };
    run();
    const onVisible = () => { if (resurfaceDue(lastRunRef.current)) run(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [enabled]);
}
