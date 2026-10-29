import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import App from "./App.jsx";
import FirmChooser from "./FirmChooser.jsx";
import { parseRoute, navigate, subscribeNav } from "./route.js";
import { leftFirm, leaveFirm, clearLeftFirm } from "./state/leftFirm.js";
import useCapabilities from "./state/useCapabilities.js";
import { FirmAccess } from "./firm-access.js";

export default function Root() {
  const firm = useSyncExternalStore(subscribeNav, () => parseRoute().firm, () => null);
  const [defaultFirm, setDefaultFirm] = useState(null);
  const [canSwitchFirm, setCanSwitchFirm] = useState(false);
  const switchable = !!useCapabilities()?.switchFirm;

  useEffect(() => {
    fetch("/api/app-config").then((r) => r.json()).then((c) => setDefaultFirm(c.defaultFirm || "")).catch(() => setDefaultFirm(""));
  }, []);

  // Only the hosted app serves more than one firm. If the access check fails, offer Switch firm:
  // the chooser still lists what the user can open.
  useEffect(() => {
    if (!switchable) return;
    FirmAccess.load().then((access) => setCanSwitchFirm(!access.pinnedFirm)).catch(() => setCanSwitchFirm(true));
  }, [switchable]);

  const choose = useCallback((slug) => {
    navigate({ firm: slug, tab: slug ? "overview" : null }, { replace: true });
  }, []);

  // A pick from the chooser is the user's own, so it ends the skip on the firm they left.
  const pick = useCallback((slug) => { clearLeftFirm(); choose(slug); }, [choose]);

  // No firm in the URL: open the configured firm, else stay on the chooser, which opens a pinned
  // customer's one firm itself. The root path never reopens the last firm viewed: going to / is
  // how a user gets back to the chooser.
  useEffect(() => {
    if (firm || defaultFirm === null) return;
    // Skips the firm the user just left.
    if (defaultFirm && defaultFirm !== leftFirm()) choose(defaultFirm);
  }, [firm, choose, defaultFirm]);

  // App titles the tab with the firm's name, so the chooser takes it back after Switch firm.
  useEffect(() => {
    if (!firm) document.title = "Carta Portfolio Analytics";
  }, [firm]);

  // The configured default firm wins, so the chooser opens a firm itself only once that is known.
  if (!firm) return <FirmChooser onPick={pick} leftFirm={leftFirm()} autoOpen={defaultFirm !== null} />;
  return <App key={firm} firm={firm} canSwitchFirm={canSwitchFirm} onChooseFirm={() => leaveFirm(firm)} />;
}
