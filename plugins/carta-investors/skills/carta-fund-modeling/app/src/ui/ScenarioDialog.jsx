// Styled create/rename-scenario dialog — replaces the browser prompt(). Lets the
// user type a name and tag the scenario with a color that then shows beside it in
// the nav. Enter submits; Escape or a backdrop click cancels.
import { useState, useEffect, useRef } from "react";
import { FS, sans, MICRO } from "./theme.js";
import { Btn } from "./components.jsx";
import { trackClick, trackRender } from "../analytics.js";

// A small, distinct palette for tagging scenarios. Literal hex — these are
// user-chosen semantic labels, stable across light/dark. `null` = no color.
export const SCENARIO_COLORS = [
  "#285DA3", // blue
  "#2D9E90", // teal
  "#C68A1A", // amber
  "#C0405A", // red
  "#7C5CFC", // violet
  "#C452A0", // magenta
  "#3E9B57", // green
  "#5B6472", // slate
];

export default function ScenarioDialog({ mode, initialName = "", initialColor = null, fromName, onSubmit, onCancel }) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(initialColor);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);
  useEffect(() => {
    trackRender("FundModeling.ScenarioDialog.View");
  }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const trimmed = name.trim();
  const submit = () => { if (trimmed) { trackClick("FundModeling.ScenarioDialog.Submit"); onSubmit(trimmed, color); } };
  const title = mode === "rename" ? "Rename scenario" : "New scenario";
  const label = { ...sans, fontSize: FS.micro, fontWeight: 600, letterSpacing: "0.09em",
    textTransform: "uppercase", color: MICRO, display: "block" };

  return (
    <div role="dialog" aria-modal="true" aria-label={title} onMouseDown={onCancel}
      style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(16,24,40,.34)",
        backdropFilter: "blur(2px)", display: "grid", placeItems: "center", padding: 20 }}>
      <div onMouseDown={(e) => e.stopPropagation()}
        style={{ width: "min(420px, 100%)", background: "var(--ink-color-global-surface-background-default)", border: `1px solid var(--ink-color-global-border-subtle)`, borderRadius: 12,
          boxShadow: "0 18px 50px rgba(16,24,40,.28)", padding: "22px 24px 20px" }}>
        <div style={{ ...sans, fontSize: FS.h3, fontWeight: 700, color: "var(--ink-color-global-text-default)" }}>{title}</div>
        {mode !== "rename" && fromName && (
          <div style={{ ...sans, fontSize: FS.body, color: "var(--ink-color-global-text-subtle)", marginTop: 4 }}>
            Copied from <strong style={{ color: "var(--ink-color-global-text-default)", fontWeight: 600 }}>{fromName}</strong>.
          </div>
        )}

        <label style={{ ...label, margin: "18px 0 7px" }}>Scenario name</label>
        <input ref={inputRef} value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }} placeholder="e.g. Upside case"
          style={{ ...sans, fontSize: FS.value, width: "100%", boxSizing: "border-box", padding: "9px 12px",
            border: `1px solid var(--ink-color-global-border-subtle)`, borderRadius: 6, background: "var(--ink-color-global-surface-background-default)", color: "var(--ink-color-global-text-default)", outline: "none" }} />

        <label style={{ ...label, margin: "18px 0 9px" }}>Color</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 9 }}>
          {[null, ...SCENARIO_COLORS].map((c) => {
            const on = color === c;
            const isNone = c === null;
            return (
              <button key={c ?? "none"} type="button" aria-label={isNone ? "No color" : `Color ${c}`}
                aria-pressed={on} title={isNone ? "No color" : c} onClick={() => setColor(c)}
                style={{ width: 26, height: 26, borderRadius: "50%", cursor: "pointer", padding: 0, position: "relative",
                  background: isNone ? "var(--ink-color-global-surface-background-default)" : c, border: isNone ? `1px solid var(--ink-color-global-border-subtle)` : "1px solid transparent",
                  boxShadow: on ? `0 0 0 2px var(--ink-color-global-surface-background-default), 0 0 0 4px var(--ink-color-global-text-default)` : "none" }}>
                {isNone && <span aria-hidden style={{ position: "absolute", left: "50%", top: 3, bottom: 3, width: 1.5,
                  background: MICRO, transform: "translateX(-50%) rotate(45deg)" }} />}
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 24 }}>
          <Btn size="comfortable" onClick={() => { trackClick("FundModeling.ScenarioDialog.Cancel"); onCancel(); }}>Cancel</Btn>
          <Btn size="comfortable" kind="primary" onClick={submit} disabled={!trimmed}>{mode === "rename" ? "Save" : "Create scenario"}</Btn>
        </div>
      </div>
    </div>
  );
}
