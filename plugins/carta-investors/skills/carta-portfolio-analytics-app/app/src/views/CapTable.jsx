// Cap table panels: the company's capital structure with its recorded rights, and the
// firm's holdings in it (fund-admin Schedule of Investments with per-fund ownership).
import { FS, sans, mono, MICRO } from "../ui/theme.js";
import { withCommas } from "../ui/format.js";
import { StatBar, Badge, SectionHeader, HintIcon } from "../ui/components.jsx";
import { fmtVal } from "../ui/charts.jsx";
import {
  groupedClasses, capTotals, preferenceStack, totalPreference,
  overhang, isPreferred,
  soiLines, soiTotals, fundOwnership, ownershipFunds,
} from "../model/captable.js";

const POS = "var(--ink-color-global-feedback-positive-strong)";
const NEG = "var(--ink-color-global-feedback-negative-strong)";

const qty = (v) => (v == null || !Number.isFinite(v) ? "—" : Math.round(v).toLocaleString("en-US"));
const pct = (v) => (v == null || !Number.isFinite(v) ? "—" : withCommas((v * 100).toFixed(2)) + "%");
const money = (v) => (v == null || !Number.isFinite(v) ? "—" : fmtVal(v, "Dollar"));
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

/** The banner's stats: the four structure figures, then — when the company has
 *  preferred classes and a value to compare them to — the four preference figures. */
function bannerStats(t, over) {
  const stats = [
    { label: "Fully diluted", value: qty(t.fd), sub: `${t.classes} security classes` },
    { label: "Outstanding", value: qty(t.outstanding) },
    { label: "Authorized", value: qty(t.authorized) },
    { label: "Cash raised", value: money(t.cashRaised), sub: "across all classes" },
  ];
  if (over && over.base != null) {
    stats.push(
      { label: "Preference stack", value: money(over.pref) },
      { label: `Company value (${over.basis})`, value: money(over.base),
        sub: over.basisDate ? `as of ${over.basisDate}` : "" },
      { label: "Covers the stack", value: over.coverage == null ? "—" : over.coverage.toFixed(2) + "×",
        color: over.coverage >= 1 ? POS : NEG,
        hint: "Company value ÷ preference stack. Below 1.0× means a sale at today's value wouldn't cover what preferred holders are owed, and common would get nothing." },
      { label: "Left for common", value: money(over.residual), color: over.residual >= 0 ? POS : NEG,
        sub: over.residual >= 0 ? "before conversion" : "common under water" },
    );
  }
  return stats;
}

/** Preference a preferred class is owed: shares × OIP × multiple; null without an OIP. */
const classPreference = (c) => (c.outstanding != null && c.oip != null
  ? c.outstanding * c.oip * (c.multiplier == null ? 1 : c.multiplier) : null);

/** Share classes: structure columns for every class, rights columns filled for preferred. */
function ShareClassTable({ rows }) {
  return (
    <table className="ledger sheet" style={{ width: "100%", ...sans }}>
      <thead>
        <tr>
          <th style={th}>Security class</th>
          <th style={th}>Type</th>
          <th style={thR}><ThHint hint={HINT_SENIORITY} right>Rank</ThHint></th>
          <th style={thR}>Outstanding</th>
          <th style={thR}><ThHint hint={HINT_FD} right>Fully diluted</ThHint></th>
          <th style={thR}><ThHint hint={HINT_FD_PCT} right>FD %</ThHint></th>
          <th style={thR}><ThHint hint={HINT_OIP} right>OIP</ThHint></th>
          <th style={thR}>Multiple</th>
          <th style={th}><ThHint hint={HINT_PARTICIPATING}>Participating</ThHint></th>
          <th style={th}><ThHint hint={HINT_DIVIDEND}>Dividend</ThHint></th>
          <th style={thR}><ThHint hint={HINT_PREFERENCE} right>Preference</ThHint></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => {
          const pref = isPreferred(c);
          const owed = pref ? classPreference(c) : null;
          return (
            <tr key={c.id}>
              <td style={td}>{c.name}</td>
              <td style={td}>{c.kind || "—"}</td>
              <td style={tdR}>{pref && c.seniority != null ? c.seniority : "—"}</td>
              <td style={tdR}>{qty(c.outstanding)}</td>
              <td style={tdR}>{qty(c.fd)}</td>
              <td style={{ ...tdR, fontWeight: 600 }}>{pct(c.fdPct)}</td>
              {/* Common and other non-preferred classes carry no preference terms: blank, not "—". */}
              <td style={tdR}>{pref ? (c.oip == null ? "—" : fmtVal(c.oip, "Dollar")) : ""}</td>
              <td style={tdR}>{pref ? (c.multiplier == null ? "1×" : c.multiplier.toFixed(2).replace(/\.00$/, "") + "×") : ""}</td>
              <td style={td}>
                {!pref ? "" : c.participating === true
                  ? `Yes${c.preferenceCap != null ? ` · ${c.preferenceCap}× cap` : ""}`
                  : c.participating === false
                    ? "No"
                    : <span data-tip="Not recorded — this is not the same as non-participating." style={{ cursor: "help" }}>—</span>}
              </td>
              <td style={td}>{pref ? (c.dividendCoupon ? `${c.dividendCoupon}% ${c.dividendType || ""}`.trim() : "—") : ""}</td>
              <td style={tdR} data-tip={pref && owed == null ? "Needs outstanding shares and an original issue price." : undefined}>
                {pref ? money(owed) : ""}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Option plans, warrants and other non-share equity: structure columns only. */
function EquityGroupTable({ group }) {
  return (
    <table className="ledger sheet" style={{ width: "100%", ...sans }}>
      <thead>
        <tr>
          <th style={th}>Security class</th>
          <th style={th}>Type</th>
          <th style={thR}>Outstanding</th>
          <th style={thR}><ThHint hint={HINT_FD} right>Fully diluted</ThHint></th>
          <th style={thR}><ThHint hint={HINT_FD_PCT} right>FD %</ThHint></th>
        </tr>
      </thead>
      <tbody>
        {group.rows.map((c) => (
          <tr key={c.id}>
            <td style={td}>{c.name}</td>
            <td style={td}>{c.kind || "—"}</td>
            <td style={tdR}>{qty(c.outstanding)}</td>
            <td style={tdR}>{qty(c.fd)}</td>
            <td style={{ ...tdR, fontWeight: 600 }}>{pct(c.fdPct)}</td>
          </tr>
        ))}
        {group.id === "option_plan" && group.rows.some((r) => r.available != null) && (
          <tr>
            <td colSpan={5} style={{ ...td, color: MICRO, fontSize: FS.small, fontStyle: "italic" }}>
              Unallocated pool:{" "}
              {qty(group.rows.reduce((s, r) => s + (r.available || 0), 0))} shares still available to grant
              — already inside the fully-diluted count.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function LiquidationStack({ tiers, total }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <SectionHeader>Liquidation stack — paid in this order</SectionHeader>
      <div style={{ overflow: "auto" }}>
        <table className="ledger sheet" style={{ width: "100%", ...sans }}>
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
    </section>
  );
}

export function CapTable({ company }) {
  const groups = groupedClasses(company);
  const t = capTotals(company);
  // Callers gate on hasCapTable; the panel still must not throw on t.fd if used directly.
  if (!t) return null;
  const shares = groups.find((g) => g.id === "share_class");
  // Convertibles carry no fully-diluted quantity until they convert, so they get
  // their own block instead of a row of zeroes in the ownership table.
  const otherEquity = groups.filter((g) => g.id !== "share_class" && g.id !== "note_block");
  const notes = groups.find((g) => g.id === "note_block");
  const hasPreferred = !!(shares && shares.rows.some(isPreferred));
  const over = hasPreferred ? overhang(company) : null;

  return (
    // Each block — banner, one table with its heading, the stack, the notes — is its own section.
    <div style={{ display: "flex", flexDirection: "column", gap: SECTION_GAP }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {/* Four tiles per row: structure figures on the first, preference figures on the second. */}
        <StatBar style={{ marginTop: 14 }} stats={bannerStats(t, over)} gap="22px 0" itemStyle={{ flex: "1 1 22%", minWidth: "22%" }} />
        <div style={{ ...sans, fontSize: FS.small, color: MICRO, display: "flex", gap: 16, flexWrap: "wrap" }}>
          {t.asOf && <span>Cap table as of {t.asOf}</span>}
          {hasPreferred && over && over.base == null && (
            <span>No mark or last-round post-money recorded, so the preference stack can't be compared to a company value.</span>
          )}
        </div>
      </div>

      {shares && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SectionHeader>{shares.label}</SectionHeader>
          <div style={{ overflow: "auto" }}><ShareClassTable rows={shares.rows} /></div>
        </div>
      )}

      {otherEquity.map((g) => (
        <div key={g.id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SectionHeader>{g.label}</SectionHeader>
          <div style={{ overflow: "auto" }}><EquityGroupTable group={g} /></div>
        </div>
      ))}

      {notes && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SectionHeader>{notes.label}</SectionHeader>
          <div style={{ overflow: "auto" }}>
            <table className="ledger sheet" style={{ width: "100%", ...sans }}>
              <thead>
                <tr>
                  <th style={th}>Instrument</th>
                  <th style={th}>Type</th>
                  <th style={thR}>Principal</th>
                  <th style={thR}>Interest</th>
                  <th style={thR}>Cash raised</th>
                </tr>
              </thead>
              <tbody>
                {notes.rows.map((c) => (
                  <tr key={c.id}>
                    <td style={{ ...td, fontWeight: 600 }}>{c.name}</td>
                    <td style={{ ...td, color: MICRO, fontSize: FS.small }}>{c.kind || "—"}</td>
                    <td style={tdR}>{money(c.principal)}</td>
                    <td style={tdR}>{money(c.interest)}</td>
                    <td style={tdR}>{money(c.cashRaised)}</td>
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

      {hasPreferred && <LiquidationStack tiers={preferenceStack(company)} total={totalPreference(company)} />}

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
        <div style={{ overflow: "auto" }}>
          <table className="ledger sheet" style={{ width: "100%", ...sans }}>
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
                  <td style={tdR}>{l.investmentDate || "—"}</td>
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
      <div style={{ overflow: "auto" }}>
        <table className="ledger sheet" style={{ width: "100%", ...sans }}>
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
                <td style={tdR}>{f.asOf || "—"}</td>
              </tr>
            ))}
            <tr className="totrow">
              <td style={td}>Total (all funds)</td>
              <td style={tdR}>{pct(own.pct)}</td>
              <td style={tdR}>{own.asOf || "—"}</td>
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
