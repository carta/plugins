// Cap table panels: the company's capital structure with its recorded rights, and the
// firm's holdings in it (fund-admin Schedule of Investments with per-fund ownership).
import { FS, sans, mono, MICRO } from "../ui/theme.js";
import { withCommas, currencySymbol } from "../ui/format.js";
import { StatBar, Badge, SectionHeader, HintIcon } from "../ui/components.jsx";
import { fmtVal } from "../ui/charts.jsx";
import {
  groupedClasses, capTotals, preferenceStack, totalPreference,
  overhang, isPreferred, summarySections, breakEvenValuation, companyValue,
  soiLines, soiTotals, fundOwnership, ownershipFunds,
} from "../model/captable.js";

const POS = "var(--ink-color-global-feedback-positive-strong)";
const NEG = "var(--ink-color-global-feedback-negative-strong)";

const qty = (v) => (v == null || !Number.isFinite(v) ? "—" : Math.round(v).toLocaleString("en-US"));
const pct = (v) => (v == null || !Number.isFinite(v) ? "—" : withCommas((v * 100).toFixed(2)) + "%");
const money = (v) => (v == null || !Number.isFinite(v) ? "—" : fmtVal(v, "Dollar"));
// Carta records cash raised in USD (SUMMARY_CAP_TABLE's cash_raised:USD), whatever
// the firm's own currency — so it is labelled and formatted as USD, in full.
const usd = (v) => (v == null || !Number.isFinite(v) ? "—" : fmtVal(v, "Dollar", null, "USD"));
// Blank rather than "—" in the summary grid: an empty cell is how Carta's export
// shows a figure that doesn't apply to the row.
const qtyOrBlank = (v) => (v == null || !Number.isFinite(v) ? "" : qty(v));
const pctOrBlank = (v) => (v == null || !Number.isFinite(v) ? "" : pct(v));
// Full amount in the firm's display currency — the same basis as the liquidation stack.
const moneyFullOrBlank = (v) => (v == null || !Number.isFinite(v) ? ""
  : (v < 0 ? "−" : "") + currencySymbol() + Math.round(Math.abs(v)).toLocaleString("en-US"));
// SOI asset class enum ("PREFERRED_EQUITY") -> display label ("Preferred equity").
const assetClassLabel = (v) => v ? v.toLowerCase().split("_").map((w, i) => i === 0 ? w[0].toUpperCase() + w.slice(1) : w).join(" ") : "—";
// Per-line MOIC — same formula as soiTotals' aggregate: (value + proceeds) / cost.
const lineMoic = (l) => (l.cost > 0 ? (l.value + l.proceeds) / l.cost : null);
const th = { padding: "10px 14px", textAlign: "left", whiteSpace: "nowrap" };
const thR = { ...th, textAlign: "right" };
// A column header with a (?) tooltip defining it, right-aligned to match thR headers.
const ThHint = ({ children, hint, right }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: right ? "flex-end" : "flex-start" }}>
    {right ? <><HintIcon hint={hint} />{children}</> : <>{children} <HintIcon hint={hint} /></>}
  </span>
);
const HINT_SENIORITY = "Rank 1 is paid first. Classes sharing a rank are pari passu — paid together, sharing pro rata if the money runs out.";
const HINT_FD = "Outstanding shares plus every option, warrant and convertible that could become a share.";
const HINT_FD_PCT = "Ownership percentages here are fully diluted, which is the conservative basis — your percentage on an outstanding-only basis is higher.";
const HINT_OIP = "Original issue price — the per-share price this class was sold at.";
const HINT_PARTICIPATING = "A non-participating holder chooses either the preference or converting to common. A participating holder takes the preference and then shares the remainder alongside common — much better for the investor. A preference cap limits how far that double-dip goes. Blank means the term isn't recorded, which is not the same as “no”.";
const HINT_DIVIDEND = "Cumulative dividends build up over time and are added to the liquidation preference at exit, so they quietly grow what sits ahead of common. Non-cumulative dividends mostly just stop the company paying common a dividend first.";
const HINT_PREFERENCE = "Shares × original issue price × the multiple. A 1× preference returns the money invested; a 2× returns twice it. Shown per class and totalled in the stack. Computed from recorded terms — where a class has no original issue price on file it is left blank rather than assumed.";
const HINT_FUND_OWN = "This fund's fully-diluted ownership of the company, from the Carta cap table.";
// Vertical space between the panel's blocks; heading-to-table stays at 8px so a
// heading reads with its own table, not the one above.
export const SECTION_GAP = 40;
const td = { padding: "10px 14px", whiteSpace: "nowrap" };
const tdR = { ...td, textAlign: "right", ...mono };

// A panel library for the Company page's Cap table sub-tab: no default export,
// CapTable and Holdings are the public surface.

/* ---------- 1. the cap table: structure, rights & preferences, liquidation stack ---------- */

const HINT_BREAK_EVEN = "Common stock equivalent: the company sale price at which the firm gets back what it put in (1×) if every share — preferred included — is treated as converted to common. Cost not yet returned ÷ the firm's fully-diluted ownership. Liquidation preferences are left out; they pay preferred holders first, so where the firm holds preferred its real break-even is usually lower.";

/** The break-even tile. Green when today's company value clears it, red when it
 *  doesn't; the comparison itself sits in the hint so the tile stays one figure. */
function breakEvenStat(company) {
  const label = "Break-even";
  const be = breakEvenValuation(company);
  if (!be) return { label, value: "—", hint: `${HINT_BREAK_EVEN} Needs cost and ownership on file.` };
  if (be.recovered) return { label, value: "Reached", color: POS, hint: `${HINT_BREAK_EVEN} Proceeds already cover cost.` };
  const now = companyValue(company);
  return {
    label, value: money(be.value),
    hint: now ? `${HINT_BREAK_EVEN} Today: ${money(now.value)} (${now.basis}).` : HINT_BREAK_EVEN,
    color: now ? (now.value >= be.value ? POS : NEG) : undefined,
  };
}

/** The banner: the firm's position in the company — its ownership, then the
 *  Schedule-of-Investments totals when it has fund-admin holdings. One figure per
 *  tile, detail in the hints. Empty when the firm holds nothing recorded here. */
function holdingsStats(company) {
  const own = company.ownership || {};
  const funds = ownershipFunds(company);
  const tot = soiTotals(company);
  const stats = [];
  if (own.pct != null) {
    stats.push({ label: "Ownership", value: pct(own.pct),
      hint: `The firm's fully-diluted ownership${funds.length > 1 ? `, summed across its ${funds.length} funds` : ""}.` });
  }
  if (tot) {
    stats.push(
      { label: "Cost", value: money(tot.cost) },
      { label: "Value", value: money(tot.value) },
      { label: "Unrealized", value: money(tot.unrealized), color: tot.unrealized >= 0 ? POS : NEG },
      breakEvenStat(company),
      { label: "Multiple", value: tot.moic == null ? "—" : tot.moic.toFixed(2) + "×", hint: "(Value + proceeds) ÷ cost." },
    );
  }
  return stats;
}

/** One line under the liquidation stack: how the company's value compares to it. */
function StackCoverage({ over }) {
  if (!over) return null;
  const note = { ...sans, fontSize: FS.small, color: MICRO, lineHeight: 1.5 };
  if (over.base == null) {
    return <div style={note}>No mark or last-round post-money recorded, so the preference stack can't be compared to a company value.</div>;
  }
  const covered = over.coverage >= 1;
  return (
    <div style={note}>
      Company value ({over.basis}{over.basisDate ? `, as of ${over.basisDate}` : ""}) of {money(over.base)} covers the stack{" "}
      <strong style={{ color: covered ? POS : NEG }}>{over.coverage.toFixed(2)}×</strong>, leaving{" "}
      <strong style={{ color: over.residual >= 0 ? POS : NEG }}>{money(over.residual)}</strong>{" "}
      {over.residual >= 0 ? "for common before conversion" : "— common is under water"}.
    </div>
  );
}

/** Preference a preferred class is owed: shares × OIP × multiple; null without an OIP. */
const classPreference = (c) => (c.outstanding != null && c.oip != null
  ? c.outstanding * c.oip * (c.multiplier == null ? 1 : c.multiplier) : null);

/** "(converting at 1 to 1.0526)" — Carta's own suffix for a class that doesn't convert 1:1. */
const conversionNote = (c) => {
  const cr = c.conversionRatio;
  if (c.type !== "share_class" || cr == null || !Number.isFinite(cr) || Math.abs(cr - 1) < 1e-9) return null;
  return `converting at 1 to ${Number(cr.toFixed(6))}`;
};

// Names stay on one line on screen, as in Carta's export; the print rules let them wrap to fit the page.
const tdLabel = td;
// Two-line figure headers, as in the export ("Shares issued / and outstanding"), keep the grid narrow.
const thWrap = { ...thR, whiteSpace: "normal", verticalAlign: "bottom", width: "13%" };

/** One subtotal or total line of the summary grid. */
function SummaryTotalRow({ t, grand }) {
  return (
    <tr className={grand ? "cap-grand-total no-row-hover" : "cap-subtotal no-row-hover"}>
      <td style={tdLabel}>{t.label}</td>
      <td style={tdR}>{qtyOrBlank(t.authorized)}</td>
      <td style={tdR}>{qtyOrBlank(t.outstanding)}</td>
      <td style={tdR}>{qtyOrBlank(t.fd)}</td>
      <td style={tdR}>{pctOrBlank(t.fdPct)}</td>
      <td style={tdR}>{moneyFullOrBlank(t.preference)}</td>
    </tr>
  );
}

/** The cap table in the layout of Carta's Summary Cap Table export. */
function SummaryCapTable({ company }) {
  const { sections, plans, total } = summarySections(company);
  const groupRow = (key, label, authorized) => (
    <tr key={key} className="cap-group no-row-hover">
      <td style={tdLabel}>{label}</td>
      <td style={tdR}>{qtyOrBlank(authorized)}</td>
      <td style={tdR} colSpan={4} />
    </tr>
  );
  return (
    <table className="ledger sheet captable-summary print-fit" style={{ width: "100%", ...sans }}>
      <thead>
        <tr>
          <th style={th}>Security class</th>
          <th style={thWrap}>Shares authorized</th>
          <th style={thWrap}>Issued and outstanding</th>
          <th style={thWrap}><ThHint hint={HINT_FD} right>Fully diluted shares</ThHint></th>
          <th style={thWrap}><ThHint hint={HINT_FD_PCT} right>Fully diluted ownership</ThHint></th>
          <th style={thWrap}><ThHint hint={HINT_PREFERENCE} right>Liquidation preference</ThHint></th>
        </tr>
      </thead>
      <tbody>
        {sections.map((s) => [
          groupRow(`${s.id}-h`, s.label),
          ...s.rows.map((c) => {
            const note = conversionNote(c);
            return (
              <tr key={c.id}>
                <td className="cap-indent" style={tdLabel}>
                  {c.name}
                  {note && <span style={{ color: MICRO, fontSize: FS.small }}> ({note})</span>}
                </td>
                <td style={tdR}>{qtyOrBlank(c.authorized)}</td>
                <td style={tdR}>{qtyOrBlank(c.outstanding)}</td>
                <td style={tdR}>{qtyOrBlank(c.fd)}</td>
                <td style={tdR}>{pctOrBlank(c.fdPct)}</td>
                {/* A preferred class without an original issue price has no computable preference: "—", not blank. */}
                <td style={tdR} data-tip={isPreferred(c) && c.preference == null ? "Needs outstanding shares and an original issue price." : undefined}>
                  {isPreferred(c) && c.preference == null ? "—" : moneyFullOrBlank(c.preference)}
                </td>
              </tr>
            );
          }),
          <SummaryTotalRow key={`${s.id}-t`} t={s.total} />,
        ])}
        {plans.map((p) => [
          groupRow(`${p.id}-h`, p.name, p.planSize),
          ...p.lines.map((l, i) => (
            <tr key={`${p.id}-${i}`} className="cap-subtotal no-row-hover">
              <td className="cap-indent" style={tdLabel}>{l.label}</td>
              <td style={tdR} colSpan={2} />
              <td style={tdR}>{qtyOrBlank(l.fd)}</td>
              <td style={tdR}>{pctOrBlank(l.fdPct)}</td>
              <td style={tdR} />
            </tr>
          )),
        ])}
        {total && <SummaryTotalRow t={total} grand />}
      </tbody>
    </table>
  );
}

/** Rights and preferences of the preferred classes, most senior first. */
function PreferredRightsTable({ rows }) {
  return (
    <table className="ledger sheet print-fit" style={{ width: "100%", ...sans }}>
      <thead>
        <tr>
          <th style={th}>Security class</th>
          <th style={thR}><ThHint hint={HINT_SENIORITY} right>Rank</ThHint></th>
          <th style={thR}><ThHint hint={HINT_OIP} right>Original issue price</ThHint></th>
          <th style={thR}>Multiple</th>
          <th style={th}><ThHint hint={HINT_PARTICIPATING}>Participating</ThHint></th>
          <th style={th}><ThHint hint={HINT_DIVIDEND}>Dividend</ThHint></th>
          <th style={thR}><ThHint hint={HINT_PREFERENCE} right>Preference</ThHint></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => {
          const owed = classPreference(c);
          return (
            <tr key={c.id}>
              <td style={tdLabel}>{c.name}</td>
              <td style={tdR}>{c.seniority != null ? c.seniority : "—"}</td>
              <td style={tdR}>{c.oip == null ? "—" : fmtVal(c.oip, "Dollar")}</td>
              <td style={tdR}>{c.multiplier == null ? "1×" : c.multiplier.toFixed(2).replace(/\.00$/, "") + "×"}</td>
              <td style={td}>
                {c.participating === true
                  ? `Yes${c.preferenceCap != null ? ` · ${c.preferenceCap}× cap` : ""}`
                  : c.participating === false
                    ? "No"
                    : <span data-tip="Not recorded — this is not the same as non-participating." style={{ cursor: "help" }}>—</span>}
              </td>
              <td style={td}>{c.dividendCoupon ? `${c.dividendCoupon}% ${c.dividendType || ""}`.trim() : "—"}</td>
              <td style={tdR} data-tip={owed == null ? "Needs outstanding shares and an original issue price." : undefined}>
                {money(owed)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function LiquidationStack({ tiers, total, over }) {
  return (
    <section className="print-block" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <SectionHeader>Liquidation stack — paid in this order</SectionHeader>
      <div className="print-scroll" style={{ overflow: "auto" }}>
        <table className="ledger sheet print-fit" style={{ width: "100%", ...sans }}>
          <thead>
            <tr>
              <th style={th}><ThHint hint={HINT_SENIORITY}>Rank</ThHint></th>
              <th style={th}>Classes</th>
              <th style={thR}>Tier</th>
              <th style={thR}>Cumulative</th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((t) => (
              <tr key={t.rank}>
                <td style={td}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
                    {t.rank === 99 ? "Unranked" : t.rank}
                    {t.pariPassu && <Badge tone="muted"
                      title="Paid together and share pro rata if proceeds fall short">pari passu</Badge>}
                  </span>
                </td>
                <td style={{ ...td, whiteSpace: "normal" }}>{t.classes.map((c) => c.name).join(", ")}</td>
                <td style={tdR}>{money(t.amount)}</td>
                <td style={tdR}>{money(t.cumulative)}</td>
              </tr>
            ))}
            <tr className="totrow">
              <td style={td} colSpan={3}>Total ahead of common</td>
              <td style={tdR}>{money(total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <StackCoverage over={over} />
    </section>
  );
}

export function CapTable({ company, holdings = null }) {
  const groups = groupedClasses(company);
  const t = capTotals(company);
  // Callers gate on hasCapTable; the panel still must not throw on t.fd if used directly.
  if (!t) return null;
  const shares = groups.find((g) => g.id === "share_class");
  const notes = groups.find((g) => g.id === "note_block");
  const preferred = shares ? shares.rows.filter(isPreferred) : [];
  const hasPreferred = preferred.length > 0;
  const over = hasPreferred ? overhang(company) : null;
  const stats = holdingsStats(company);

  return (
    // Each block — banner, the summary grid, each detail table with its heading, the stack — is its own section.
    <div style={{ display: "flex", flexDirection: "column", gap: SECTION_GAP }}>
      {stats.length > 0 && (
        // StatBar's card around its bare row: content-sized tiles spread space-between give equal
        // insets at both ends and equal gaps; equal one-line labels keep the figures level.
        <div className="card stat-bar print-block holdings-banner" style={{ marginTop: 14, padding: "18px 28px" }}>
          <StatBar bare stats={stats} gap="22px 16px" labelLines={1}
            style={{ justifyContent: "space-between" }} itemStyle={{ flex: "none", minWidth: 0, padding: 0 }} />
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: stats.length ? 0 : 14 }}>
        <div className="keep-with-next" style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
          <SectionHeader>Summary cap table</SectionHeader>
          <span style={{ ...sans, fontSize: FS.small, color: MICRO }}>
            {t.asOf ? `As of ${t.asOf} · ` : ""}{t.classes} security classes
          </span>
        </div>
        <div className="print-scroll" style={{ overflow: "auto" }}><SummaryCapTable company={company} /></div>
      </div>

      {hasPreferred && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="keep-with-next"><SectionHeader>Preferred rights &amp; preferences</SectionHeader></div>
          <div className="print-scroll" style={{ overflow: "auto" }}>
            <PreferredRightsTable rows={[...preferred].sort((a, b) =>
              (a.seniority == null ? 99 : a.seniority) - (b.seniority == null ? 99 : b.seniority))} />
          </div>
        </div>
      )}

      {notes && (
        <div className="print-block" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SectionHeader>Convertible terms</SectionHeader>
          <div className="print-scroll" style={{ overflow: "auto" }}>
            <table className="ledger sheet print-fit" style={{ width: "100%", ...sans }}>
              <thead>
                <tr>
                  <th style={th}>Instrument</th>
                  <th style={th}>Type</th>
                  <th style={thR}>Principal (USD)</th>
                  <th style={thR}>Interest (USD)</th>
                  <th style={thR}>Cash raised (USD)</th>
                </tr>
              </thead>
              <tbody>
                {notes.rows.map((c) => (
                  <tr key={c.id}>
                    <td style={{ ...tdLabel, fontWeight: 600 }}>{c.name}</td>
                    <td style={{ ...td, color: MICRO, fontSize: FS.small }}>{c.kind || "—"}</td>
                    <td style={tdR}>{usd(c.principal)}</td>
                    <td style={tdR}>{usd(c.interest)}</td>
                    <td style={tdR}>{usd(c.cashRaised)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ ...sans, fontSize: FS.small, color: MICRO }}>
            SAFEs and convertible notes carry <strong>no fully-diluted quantity</strong> until they convert,
            so they sit outside the ownership percentages above — they will dilute everyone when the next round prices.
          </div>
        </div>
      )}

      {/* Holdings (passed in by the Company page) sit just above the liquidation stack. */}
      {holdings}

      {hasPreferred && <LiquidationStack tiers={preferenceStack(company)} total={totalPreference(company)} over={over} />}

      {/* The reconciliation line and the methodology note read as one note. */}
      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ ...sans, fontSize: FS.small, color: t.reconciles ? MICRO : NEG }}>
        {t.reconciles
          ? <>Fully-diluted ownership across the {t.classes} classes sums to {pct(t.pctSum)} ✓</>
          : <>⚠ Fully-diluted ownership sums to {pct(t.pctSum)}, not 100% — Carta's recorded classes don't
             fully reconcile for this company. Treat the percentages as indicative.</>}
      </div>
      <div style={{ ...sans, fontSize: FS.small, color: MICRO, maxWidth: 920, lineHeight: 1.5 }}>
        Every figure is read from what Carta holds for the company — the classes and the terms
        <strong> recorded</strong> on each preferred one, and the arithmetic they imply. The stack is what
        preferred holders are owed before common sees a dollar: an indication, not a waterfall. A real exit
        also turns on the charter, side letters, pay-to-play provisions and accrued dividends, none of which
        are in this data. Use it to frame the question, not to answer it definitively.
      </div>
      </section>
    </div>
  );
}

/* ---------- 2. our holdings — Schedule of Investments (fund admin) + firm ownership ---------- */
export function Holdings({ data, company, src }) {
  const lines = soiLines(company);
  const tot = soiTotals(company);
  const own = company.ownership || {};
  const frozen = { ...td, position: "sticky", left: 0, zIndex: 1 };

  if (src === "soi" && lines.length) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 36 }}>
        {/* The SOI table and its closed-position footnote are one group. */}
        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div className="print-scroll" style={{ overflow: "auto" }}>
          <table className="ledger sheet print-fit" style={{ width: "100%", ...sans }}>
            <thead>
              <tr>
                <th className="frozen-col" style={{ ...th, position: "sticky", left: 0, zIndex: 2 }}>Fund</th>
                <th style={th}>Asset</th>
                <th style={th}>Type</th>
                <th style={thR}>Shares</th>
                <th style={thR}><ThHint hint={HINT_FUND_OWN} right>FD ownership</ThHint></th>
                <th style={thR}>Cost</th>
                <th style={thR}>Value</th>
                <th style={thR}>Unrealized</th>
                <th style={thR}>Proceeds</th>
                <th style={thR}>Date invested</th>
                <th style={thR}>Multiple</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className="frozen-col" style={frozen}>{l.fund || "—"}</td>
                  <td style={{ ...td, fontWeight: 600 }}>{l.asset || "—"}</td>
                  <td style={td}>{assetClassLabel(l.assetClass)}</td>
                  <td style={tdR}>{qty(l.shares)}</td>
                  <td style={tdR}>{pct(fundOwnership(company, l.fund))}</td>
                  <td style={tdR}>{money(l.cost)}</td>
                  <td style={tdR}>{money(l.value)}</td>
                  <td style={{ ...tdR, color: l.unrealized == null ? undefined : l.unrealized >= 0 ? POS : NEG }}>{money(l.unrealized)}</td>
                  <td style={tdR}>{money(l.proceeds)}</td>
                  <td className="keep-line" style={tdR}>{l.investmentDate || "—"}</td>
                  <td style={tdR}>{lineMoic(l) == null ? "—" : lineMoic(l).toFixed(2) + "×"}</td>
                </tr>
              ))}
              {tot && (
                <tr className="totrow">
                  <td className="frozen-col" style={frozen}>
                    {tot.lines} line{tot.lines === 1 ? "" : "s"}
                  </td>
                  <td style={td} colSpan={3} />
                  <td style={tdR}>{pct(own.pct)}</td>
                  <td style={tdR}>{money(tot.cost)}</td>
                  <td style={tdR}>{money(tot.value)}</td>
                  <td style={{ ...tdR, color: tot.unrealized >= 0 ? POS : NEG }}>{money(tot.unrealized)}</td>
                  <td style={tdR}>{money(tot.proceeds)}</td>
                  <td style={tdR} />
                  <td style={tdR}>{tot.moic == null ? "—" : tot.moic.toFixed(2) + "×"}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {company.soiClosed > 0 && (
          <div style={{ ...sans, fontSize: FS.small, color: MICRO, maxWidth: 900, lineHeight: 1.5 }}>
            {company.soiClosed} closed position{company.soiClosed === 1 ? "" : "s"} not listed — no remaining
            shares, cost, value or proceeds. These are almost always a SAFE or note that already converted into
            the preferred line above. Carta's Holdings tab still lists them, so its row count will be higher.
          </div>
        )}
        </section>
      </div>
    );
  }

  // No Schedule-of-Investments lines, but the cap table still says what each fund
  // owns — a cap-table-only firm reads its ownership here.
  const funds = ownershipFunds(company);
  if (funds.length) {
    return (
      <div className="print-scroll" style={{ overflow: "auto" }}>
        <table className="ledger sheet print-fit" style={{ width: "100%", ...sans }}>
          <thead>
            <tr>
              <th style={th}>Fund</th>
              <th style={thR}><ThHint hint={HINT_FUND_OWN} right>FD ownership</ThHint></th>
              <th style={thR}>As of</th>
            </tr>
          </thead>
          <tbody>
            {funds.map((f) => (
              <tr key={f.fund}>
                <td style={td}>{f.fund}</td>
                <td style={tdR}>{pct(f.pct)}</td>
                <td className="keep-line" style={tdR}>{f.asOf || "—"}</td>
              </tr>
            ))}
            <tr className="totrow">
              <td style={td}>Total (all funds)</td>
              <td style={tdR}>{pct(own.pct)}</td>
              <td className="keep-line" style={tdR}>{own.asOf || "—"}</td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 24, textAlign: "center", color: MICRO, ...sans }}>
      No holdings recorded for {company.name}.
      <div style={{ fontSize: FS.small, marginTop: 6 }}>
        {src === "soi"
          ? "This firm has fund-admin holdings elsewhere, but none against this company."
          : "This firm has no fund administration on Carta, so there are no Schedule-of-Investments holdings to show."}
      </div>
    </div>
  );
}
