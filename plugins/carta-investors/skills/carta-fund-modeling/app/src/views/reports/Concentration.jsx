import { FS, inkNum, sans, MICRO } from "../../ui/theme.js";
import { fmtM, fmtPct, shortCompany } from "../../ui/format.js";
import { H3, SourceNote, Badge, MixedCurrencyNote } from "../../ui/components.jsx";
import { concentrationAcrossAll } from "../../model/concentration.js";

/** Concentration — read-only power-law of who carries the firm's value at this
 *  scenario's marks. Firm-wide; no what-if interaction. */
export default function ConcentrationCard({ snapshot, portfolio, mixed }) {
  const c = concentrationAcrossAll(snapshot, portfolio);
  if (!c) return null;
  if (mixed) return <MixedCurrencyNote title="Concentration" />;
  const irrById = Object.fromEntries((portfolio.companies || []).map((cp) => [cp.id, cp.dealIrr]));
  const top = c.holdings.slice(0, 10);
  const maxFv = top[0].fv;
  return (
    <div className="card" style={{ padding: "18px 22px 16px", marginTop: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <H3>Concentration</H3>
        <span style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)" }}>top {top.length} holdings · {(c.top5 * 100).toFixed(0)}% of firm value in the top 5</span>
        <span style={{ flex: 1 }} />
        <span style={{ ...sans, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)" }}>{c.count} companies held</span>
      </div>
      <div>
        {/* column headers — the row shows two percentages (Deal IRR and share of
            firm value) plus a fair-value figure, indistinguishable without labels */}
        {(() => {
          const ch = { ...sans, fontSize: FS.micro, fontWeight: 600, color: MICRO, whiteSpace: "nowrap" };
          return (
            <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "0 0 8px", borderBottom: `1px solid var(--ink-color-global-border-subtle)` }}>
              <span aria-hidden style={{ width: 26, flex: "none" }} />
              <span style={{ ...ch, width: 200, flex: "none" }}>Company</span>
              <span aria-hidden style={{ flex: 1 }} />
              <span style={{ ...ch, width: 52, textAlign: "right", flex: "none" }} title="Deal IRR">IRR</span>
              <span style={{ ...ch, width: 54, textAlign: "right", flex: "none" }} title="Share of firm value">Share</span>
              <span style={{ ...ch, width: 58, textAlign: "right", flex: "none" }} title="Fair value">FV</span>
            </div>
          );
        })()}
        {top.map((h, i) => {
          const last = i === top.length - 1;
          return (
            <div key={h.id} data-datum-id={h.id} data-datum-type="company" data-datum-label={h.name}
              style={{ display: "flex", alignItems: "center", gap: 14, padding: "11px 0",
              borderBottom: last ? "none" : `1px solid var(--ink-color-global-border-subtle)` }}>
              <span style={{ ...inkNum, fontSize: FS.small, fontWeight: 600, color: "var(--ink-color-global-text-subtle)", flex: "none",
                width: 26, height: 26, borderRadius: "50%", border: `1px solid var(--ink-color-global-border-subtle)`, background: "var(--ink-color-global-surface-background-default)",
                display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
              <span style={{ ...sans, fontSize: FS.bodyLg, fontWeight: i < 5 ? 600 : 500, color: h.defunct ? "var(--ink-color-global-text-subtle)" : "var(--ink-color-global-text-default)",
                width: 200, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: "none" }}>
                {shortCompany(h.name)}
                {h.exited && <Badge variant="text" tone="info" style={{ marginLeft: 5 }}>EXITED</Badge>}
              </span>
              <div style={{ flex: 1, height: 10, background: "var(--ink-color-global-surface-lightgray-default)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ width: `${Math.max(2, (h.fv / maxFv) * 100)}%`, height: "100%", borderRadius: 2,
                  background: i < 5 ? "var(--ink-button-background-color-primary-base-default)" : "var(--ink-color-global-surface-lightgray-active)" }} />
              </div>
              <span style={{ ...inkNum, fontSize: FS.small, color: irrById[h.id] == null ? "var(--ink-color-global-text-subtle)" : irrById[h.id] >= 0 ? "var(--ink-color-global-feedback-positive-strong)" : "var(--ink-color-global-feedback-negative-strong)", width: 52, textAlign: "right", flex: "none" }}
                title="Deal IRR">
                {irrById[h.id] == null ? "—" : fmtPct(irrById[h.id])}
              </span>
              <span style={{ ...inkNum, fontSize: FS.body, fontWeight: 700, color: "var(--ink-color-global-text-default)", width: 54, textAlign: "right", flex: "none" }}>
                {((h.fv / c.total) * 100).toFixed(1)}%
              </span>
              <span style={{ ...inkNum, fontSize: FS.small, color: "var(--ink-color-global-text-subtle)", width: 58, textAlign: "right", flex: "none" }}>{fmtM(h.fv)}</span>
            </div>
          );
        })}
      </div>
      <SourceNote>
        Source: Carta Fund Admin holdings — shares of firm-wide value at this scenario's marks.
      </SourceNote>
    </div>
  );
}
