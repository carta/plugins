import { FS, sans } from "../../ui/theme.js";

const subtle = { color: "var(--ink-color-global-text-subtle)" };

export const MC_DISCLAIMER = "Results and suggested strategies come entirely from the assumptions entered in this plan. They are illustrative, not a forecast or guarantee, and not investment, legal or tax advice. Carta is not responsible for the assumptions used, the results, or any decisions made from these suggestions.";

export function MonteCarloDisclaimer({ style }) {
  return <div data-testid="mc-disclaimer" style={{ ...sans, fontSize: FS.micro, ...subtle, lineHeight: 1.5, maxWidth: "90ch", ...style }}>{MC_DISCLAIMER}</div>;
}

export function MonteCarloAbout({ style }) {
  return (
    <details data-testid="mc-about" className="card" style={{ ...sans, padding: "12px 16px", marginBottom: 14, ...style }}>
      <summary style={{ cursor: "pointer", fontSize: FS.body, fontWeight: 600 }}>What is a Monte Carlo simulation?</summary>
      <div style={{ fontSize: FS.small, lineHeight: 1.55, maxWidth: "80ch", marginTop: 8, display: "grid", gap: 8 }}>
        <p style={{ margin: 0 }}>
          A Monte Carlo simulation runs your plan thousands of times with chance built in. In each simulated fund, every company's outcome
          (written off, a modest exit or a big winner) is drawn at random from the odds in your Market and Strategy assumptions.
        </p>
        <p style={{ margin: 0 }}>
          Lining up all those funds shows the range of results instead of the single expected case: how often the fund does well, how often it
          falls short, and what a typical result looks like. P10 is a bad case that 90% of simulated funds beat, P50 is the middle, and P90 is a
          good case that only 10% beat.
        </p>
        <p style={{ margin: 0 }}>
          It shows what your assumptions imply, not what will happen. Change the assumptions and the results change with them.
        </p>
        <MonteCarloDisclaimer style={{ marginTop: 2 }} />
      </div>
    </details>
  );
}
