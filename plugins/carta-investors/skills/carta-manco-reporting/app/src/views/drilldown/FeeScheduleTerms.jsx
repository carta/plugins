import { sans, INK, PAPER, LINE, FAINT, MICRO, BORDER_DEFAULT, FS } from "../../ui/theme.js";
import { Eyebrow } from "../../ui/components.jsx";
import { fmtCurrencyExactFor } from "../../charts/chartTheme.js";

// The fund's contracted LPA fee terms (FUND_ADMIN.MANAGEMENT_FEE_SCHEDULES) —
// rate, calculation base, frequency, per period — shown alongside the fund's
// posted fee actuals in a "fund-year" drill. Distinct dataset from the
// journal entries below: this is what the LPA says should be charged, not
// what was booked. Shows every period on the fund's schedule regardless of
// which year's bar was clicked — a fund typically has only 3-5 periods for
// its whole life (Investment Period, then step-downs), so the full picture
// is compact enough to show at once and a reader comparing periods across
// years doesn't have to click every bar to piece it together.
export default function FeeScheduleTerms({ terms }) {
  if (!terms?.length) return null;

  return (
    <div>
      <div style={S.headerRow}>
        <Eyebrow>Management fee schedule</Eyebrow>
        <span style={S.headerHint}>{terms.length} period{terms.length === 1 ? "" : "s"}</span>
      </div>

      <div style={S.tableHeader}>
        <span style={S.headerPeriod}>Period</span>
        <span style={S.headerRate}>Rate</span>
        <span style={S.headerBasis}>Basis</span>
        <span style={S.headerDates}>Dates</span>
      </div>

      <ul style={S.list}>
        {terms.map((t) => (
          <li key={`${t.fund_uuid}-${t.period_name}-${t.start_date}`} style={S.itemWrap}>
            <div style={S.itemRow}>
              <span style={S.periodName}>
                <span style={S.periodNameText} title={t.period_name}>{t.period_name}</span>
                {t.waived && <Badge label="Waived" />}
                {t.uses_custom_calculation_base && <Badge label="Custom formula" />}
              </span>
              <span style={S.rate}>{formatRate(t.fee_rate)}</span>
              <span style={S.basis} title={t.calculation_base || undefined}>{t.calculation_base || "—"}</span>
              <span style={S.dates} title={formatDateRange(t.start_date, t.end_date)}>
                {formatDateRange(t.start_date, t.end_date)}
              </span>
            </div>
            {t.frequency && (
              <div style={S.frequencyRow}>Billed {t.frequency.toLowerCase()}</div>
            )}
            {feeAmountNote(t) && (
              <div style={S.amountNoteRow}>{feeAmountNote(t)}</div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// fee_rate is stored as a decimal fraction (0.02 = 2%), confirmed against a
// live preprod warehouse query on 2026-08-19 — the returned rates (0.02,
// 0.015, 0.01, 0.005 for one fund's Investment Period + Step Downs) are only
// consistent with a decimal scale, matching the convention documented on
// fundadmin_datashare_profit_allocation_waterfall_config.carry_rate
// (0.20 = 20%). Rounded to 4 decimal places to absorb float noise
// (0.015 * 100 can render as 1.4999999999999998) before display.
function formatRate(rate) {
  if (rate == null) return "—";
  const pct = Math.round(rate * 100 * 10000) / 10000;
  return `${pct}%`;
}

const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// Parses the ISO date's fields directly rather than `new Date(iso)`, which
// treats a bare "YYYY-MM-DD" as UTC midnight and can print the prior day in
// any timezone west of UTC.
function formatDateRange(startISO, endISO) {
  const start = formatDate(startISO);
  const end = endISO ? formatDate(endISO) : "open-ended";
  if (!start) return end === "open-ended" ? "—" : `through ${end}`;
  return `${start} – ${end}`;
}

function formatDate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return `${MONTH_ABBR[m - 1]} ${d}, ${y}`;
}

// A fee floor or flat-fee override, in the fund's OWN currency (fee_currency)
// — never the ManCo's, which can differ. When an amount is set but
// fee_currency is missing (an older raw dir fetched before
// carta/ds-dbt#13083 landed), say the term exists without fabricating a
// currency symbol for it, rather than silently dropping it. Returns null
// when neither amount is configured, so callers can skip rendering the row.
function feeAmountNote(t) {
  const parts = [];
  if (t.minimum_fee_amount != null) {
    const amt = fmtCurrencyExactFor(t.minimum_fee_amount, t.fee_currency);
    parts.push(amt ? `Min: ${amt}` : "Minimum fee set (currency unknown)");
  }
  if (t.fixed_fee_amount != null) {
    const amt = fmtCurrencyExactFor(t.fixed_fee_amount, t.fee_currency);
    parts.push(amt ? `Flat fee: ${amt}` : "Flat fee set (currency unknown)");
  }
  return parts.length ? parts.join(" · ") : null;
}

function Badge({ label }) {
  return <span style={S.badge}>{label}</span>;
}

const S = {
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 8,
  },
  headerHint: {
    ...sans,
    fontSize: FS.micro,
    color: MICRO,
    fontWeight: 500,
  },
  tableHeader: {
    ...sans,
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "6px 4px",
    borderBottom: `1px solid ${BORDER_DEFAULT}`,
    fontSize: FS.small,
    fontWeight: 500,
    color: INK,
  },
  headerPeriod: {
    flex: 1,
    minWidth: 0,
  },
  headerRate: {
    width: 52,
    flexShrink: 0,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
  },
  headerBasis: {
    flex: 1,
    minWidth: 0,
    textAlign: "left",
  },
  headerDates: {
    width: 180,
    flexShrink: 0,
    textAlign: "right",
  },
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    background: PAPER,
  },
  itemWrap: {
    borderBottom: `1px solid ${LINE}`,
    padding: "8px 4px",
  },
  itemRow: {
    ...sans,
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: FS.bodyLg,
    color: INK,
  },
  periodName: {
    // Just the flex container for text + badges — text-overflow: ellipsis
    // has no effect on a flex container itself (it needs a single-line text
    // box), so the actual truncation lives on periodNameText below.
    flex: 1,
    minWidth: 0,
    color: INK,
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  periodNameText: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  rate: {
    width: 52,
    flexShrink: 0,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
    fontWeight: 500,
    color: INK,
    whiteSpace: "nowrap",
  },
  basis: {
    flex: 1,
    minWidth: 0,
    textAlign: "left",
    color: FAINT,
    wordBreak: "break-word",
  },
  dates: {
    width: 180,
    flexShrink: 0,
    textAlign: "right",
    color: FAINT,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  frequencyRow: {
    ...sans,
    fontSize: FS.micro,
    color: MICRO,
    marginTop: 2,
    marginLeft: 0,
  },
  // A fee floor/override is a substantive contract term, not a quiet detail
  // like frequency — INK rather than MICRO, so it doesn't read as a footnote.
  amountNoteRow: {
    ...sans,
    fontSize: FS.micro,
    fontWeight: 500,
    color: INK,
    marginTop: 2,
  },
  badge: {
    ...sans,
    fontSize: FS.micro,
    fontWeight: 600,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: MICRO,
    background: "var(--shade)",
    borderRadius: 3,
    padding: "1px 5px",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
};
