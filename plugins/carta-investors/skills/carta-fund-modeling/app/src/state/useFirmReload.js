import { useState, useCallback } from "react";
import { trackClick } from "../analytics.js";
import { runFirmLoad, STORING_SNAPSHOT_STEP } from "./firmLoad.js";

// The Worker stores the new snapshot at its "Storing snapshot" step, so a load that fails after it
// has already replaced the data and reloads the page; an earlier failure leaves the current data.
export default function useFirmReload(firm) {
  const [st, setSt] = useState({ status: "idle" });

  const reloadFirm = useCallback(async () => {
    trackClick("FundModeling.UpdateData.Start");
    setSt({ status: "running", step: null });
    let stored = false;
    const onStep = (step) => {
      if (step === STORING_SNAPSHOT_STEP) stored = true;
      setSt({ status: "running", step });
    };
    const reloadPage = async () => {
      await window.__fmPortfolioCtl?.pauseAutosave?.();
      window.location.reload();
    };
    try {
      const done = await runFirmLoad(firm, onStep, { force: true });
      if (!done) throw new Error("The reload stopped before it finished.");
      await reloadPage();
    } catch (e) {
      if (stored) return reloadPage();
      setSt(e.code === "too_soon"
        ? { status: "tooSoon", retryAfter: e.retryAfter }
        : { status: "error", message: e.message || "The reload failed." });
    }
  }, [firm]);

  return { ...st, reloadFirm };
}
