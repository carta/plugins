// "Create a view for each <category>" link with its inline confirm, shared by the Filters panels.
import { useState } from "react";
import { FS, sans, MICRO } from "./theme.js";
import { Btn } from "./components.jsx";

const MAX_NAMES = 3;

/** `plan` comes from planViewsPerTag; `onCreate(views)` saves them. Confirms
 *  inline, since one click can add dozens of views. */
export default function ViewsPerTagButton({ cat, plan, onCreate }) {
  const [confirming, setConfirming] = useState(false);
  const [added, setAdded] = useState(null);
  const label = cat.toLowerCase();
  const n = plan.views.length;
  const note = { ...sans, fontSize: FS.small, color: MICRO, margin: 0 };

  if (added != null) {
    return <p style={{ ...note, marginBottom: 12 }}>Added {added} view{added === 1 ? "" : "s"} — pick one from the View menu.</p>;
  }
  if (n === 0) {
    return plan.skipped.length > 0 ? <p style={{ ...note, marginBottom: 12 }}>Every {label} already has a saved view.</p> : null;
  }
  if (!confirming) {
    return (
      <div style={{ marginBottom: 12 }}>
        <Btn kind="link" style={{ fontSize: FS.small }} onClick={() => setConfirming(true)}>
          Create a view for each {label} ({n})
        </Btn>
      </div>
    );
  }
  const names = plan.views.slice(0, MAX_NAMES).map((v) => v.name).join(", ") + (n > MAX_NAMES ? ", …" : "");
  return (
    <div role="group" aria-label={`Create a view for each ${label}`} style={{ marginBottom: 12, padding: 10, borderRadius: 6,
      border: "1px solid var(--ink-color-global-border-subtle)", background: "var(--ink-color-global-surface-lightgray-default)" }}>
      <p style={{ ...sans, fontSize: FS.small, margin: "0 0 4px", color: "var(--ink-color-global-text-default)" }}>
        Adds {n} saved view{n === 1 ? "" : "s"}: {names}
      </p>
      <p style={{ ...note, marginBottom: 8 }}>
        Each keeps this page's current settings, filtered to one {label}.
        {plan.skipped.length > 0 && ` ${plan.skipped.length} already exist and are skipped.`}
      </p>
      <span style={{ display: "flex", gap: 8 }}>
        <Btn kind="primary" onClick={() => { onCreate(plan.views); setConfirming(false); setAdded(n); }}>Create views</Btn>
        <Btn onClick={() => setConfirming(false)}>Cancel</Btn>
      </span>
    </div>
  );
}
