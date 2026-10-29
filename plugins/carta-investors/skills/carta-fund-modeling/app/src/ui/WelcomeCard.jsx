// First-run guide at the top of Firm Overview: how to model a scenario, with
// Baseline's figures beside it. It goes for good at that firm, in this browser, once
// the user closes it or adds a scenario of their own.

import { useEffect, useState } from "react";
import { FS, sans, serif } from "./theme.js";
import { Btn, CloseIcon } from "./components.jsx";
import { SCENARIO_TILE_STYLE, TileContent } from "./ScenarioMenu.jsx";
import { isShared, isOwnShared } from "../model/slices.js";
import { firmBaseRollup } from "../model/funds.js";
import { trackClick } from "../analytics.js";

// Dismissal is per firm: a user new to a firm sees the card there even after closing it elsewhere.
export const welcomeDismissedKey = (firm) => `welcomeDismissed:${firm}`;

function readDismissed(firm) {
  try { return localStorage.getItem(welcomeDismissedKey(firm)) === "1"; } catch { return false; }
}

function rememberDismissed(firm) {
  try { localStorage.setItem(welcomeDismissedKey(firm), "1"); } catch { /* private mode */ }
}

/** One step: a numbered ornament (Ink Status, medium, on the primary fill) and its headline. */
function Step({ n, children }) {
  return (
    <li className="welcome-step">
      <span className="welcome-step-orn" aria-hidden>{n}</span>
      <span className="welcome-step-title">{children}</span>
    </li>
  );
}

/** Baseline (Carta's marks) at a glance, drawn as the scenario switcher's Baseline tile.
 *  It only previews, so it has no radio and doesn't react to the pointer. */
function BaselineSummary({ baseline, fundStates, mixedCurrency }) {
  const firm = { ...firmBaseRollup(fundStates), mixedCurrency };
  return (
    <div className="card welcome-baseline" data-testid="welcome-baseline" style={{ ...SCENARIO_TILE_STYLE, cursor: "default" }}>
      <TileContent slice={baseline} firm={firm} />
    </div>
  );
}

/** The card's own call to action adds a scenario; `slices` tells it when the user has one. */
export default function WelcomeCard({ firm, slices, userId, fundStates, mixedCurrency, onNew, onOpenCompanies }) {
  const [dismissed, setDismissed] = useState(() => readDismissed(firm));
  // A scenario of the user's own (not Baseline, not one another user shared) means they
  // have started, so the card stays gone even if they later delete it. One they published
  // counts once userId loads.
  const hasOwnScenario = slices.some((s) => !s.locked && (!isShared(s) || isOwnShared(s, userId)));
  useEffect(() => { if (hasOwnScenario) rememberDismissed(firm); }, [hasOwnScenario, firm]);
  if (dismissed || hasOwnScenario) return null;
  const dismiss = () => {
    trackClick("FundModeling.Welcome.Dismiss");
    rememberDismissed(firm);
    setDismissed(true);
  };
  const addScenario = () => { trackClick("FundModeling.Welcome.AddScenario"); onNew(); };
  return (
    <section aria-label="Welcome" data-testid="welcome-card" className="welcome-card ov-span-12">
      <button type="button" onClick={dismiss} aria-label="Dismiss welcome"
        style={{ position: "absolute", top: 6, right: 6, display: "inline-flex", background: "none", border: "none", cursor: "pointer", padding: 8, color: "var(--ink-color-global-text-subtle)" }}>
        <CloseIcon size={18} strokeWidth={1.6} />
      </button>
      <div className="welcome-index">
        <span className="welcome-chip">Get started</span>
        <ol className="welcome-steps" style={sans}>
          <Step n={1}>Add a new scenario</Step>
          <Step n={2}>
            Change your investments' marks on the{" "}
            <Btn kind="link" onClick={onOpenCompanies} style={{ fontSize: FS.value }}>Companies</Btn> tab
          </Step>
          <Step n={3}>See how it impacts your LP returns, GP economics, and more.</Step>
        </ol>
      </div>
      <div className="welcome-pitch">
        <h2 style={{ ...serif, margin: 0, maxWidth: "22ch", fontSize: FS.display, fontWeight: 400, lineHeight: 1.12, color: "var(--ink-color-global-text-default)" }}>
          Model your first scenario
        </h2>
        <p style={{ ...sans, margin: 0, maxWidth: "42ch", fontSize: FS.value, lineHeight: 1.6, color: "var(--ink-color-global-text-subtle)" }}>
          Start with the latest from Carta, mark companies up or down, and see how that scenario affects your funds.
        </p>
        <Btn kind="primary" onClick={addScenario} style={{ marginTop: 4 }}>Add scenario</Btn>
      </div>
      <div className="welcome-preview">
        <BaselineSummary baseline={slices.find((s) => s.locked)} fundStates={fundStates} mixedCurrency={mixedCurrency} />
      </div>
    </section>
  );
}
