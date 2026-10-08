import { FS, sans } from "../../ui/theme.js";

const subtle = { color: "var(--ink-color-global-text-subtle)" };

/** `options` are the [low, typical, high] names; `base` is where the chosen market sits, and moving off it shows a reset. */
export default function DialSlider({ id, label, options, value, onChange, base = 0, baseLabel }) {
  const [low, mid, high] = options;
  const names = { "-2": `Much ${low.toLowerCase()}`, "-1": low, 0: mid, 1: high, 2: `Much ${high.toLowerCase()}` };
  const at = (i) => `${((i + 2) / 4) * 100}%`;
  return (
    <div data-testid={`dial-slider-${id}`}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
        <span data-testid={`dial-level-${id}`} style={{ ...sans, fontSize: FS.bodyLg, fontWeight: 600 }}>{names[value]}</span>
        {value !== base && <button type="button" onClick={() => onChange(base)} data-testid={`dial-reset-${id}`}
          style={{ ...sans, fontSize: FS.micro, cursor: "pointer", border: "none", background: "none", padding: 0, color: "var(--ink-color-global-link-default)" }}>
          {baseLabel ? `Back to ${baseLabel}` : "Reset"}</button>}
      </div>
      <input type="range" min={-2} max={2} step={1} value={value} data-testid={`dial-${id}`} aria-label={label}
        aria-valuetext={names[value]} onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: "100%", margin: 0, cursor: "pointer", accentColor: "var(--ink-button-background-color-primary-base-default)" }} />
      <div aria-hidden="true" style={{ position: "relative", height: 18, marginTop: 2 }}>
        {[-2, -1, 0, 1, 2].map((i) => (
          <span key={i} title={i === base && baseLabel ? `${baseLabel} sits here` : undefined}
            style={{ position: "absolute", left: at(i), top: 0, width: i === base ? 2 : 1, height: i === base ? 8 : 5, background: i === base ? "var(--ink-color-global-text-default)" : "var(--ink-color-global-border-default)" }} />
        ))}
        {[[-1, low], [0, mid], [1, high]].map(([i, t]) => (
          <span key={i} style={{ ...sans, position: "absolute", left: at(i), top: 6, transform: "translateX(-50%)", fontSize: FS.micro, whiteSpace: "nowrap",
            fontWeight: value === i ? 700 : 400, color: value === i ? "var(--ink-color-global-text-default)" : subtle.color }}>{t}</span>
        ))}
      </div>
    </div>
  );
}
