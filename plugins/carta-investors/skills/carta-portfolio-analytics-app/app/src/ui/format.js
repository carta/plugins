// Fund-level amount formatting. The display currency is DATA-DRIVEN — never a
// hardcoded USD: set once at load from the firm's reporting currency
// (FUND_REPORTING_CURRENCY, surfaced as snapshot.source.currency) via
// setDisplayCurrency(). Company-level financials that carry their own currency
// format through fmtRev(v, ccy) instead of these fund-level helpers.

const SYMBOLS = {
  USD: "$", CAD: "C$", AUD: "A$", NZD: "NZ$", HKD: "HK$", SGD: "S$", MXN: "MX$",
  EUR: "€", GBP: "£", JPY: "¥", CNY: "¥", INR: "₹", BRL: "R$", ZAR: "R",
  CHF: "CHF ", SEK: "kr ", NOK: "kr ", DKK: "kr ", ILS: "₪",
};
let CURRENCY_CODE = "USD";
let SYMBOL = "$";

/** Set the firm's display currency (ISO code). Symbol is looked up, falling
 *  back to a "<CODE> " prefix so an unmapped currency is still labeled, never
 *  silently shown as USD. Idempotent; safe to call on every render. */
export function setDisplayCurrency(code) {
  if (!code) return;
  CURRENCY_CODE = String(code).toUpperCase();
  SYMBOL = SYMBOLS[CURRENCY_CODE] || CURRENCY_CODE + " ";
}

/** Symbol for one ISO currency code (USD → "$", GBP → "£", EUR → "€", CAD →
 *  "C$", …), falling back to a "<CODE> " prefix so an unmapped code is still
 *  labeled, never silently rendered as USD. With no code, returns the firm's
 *  current display currency symbol — an amount that carries no currency of its
 *  own inherits the fund's, per Carta's currency rules (no hardcoded "$"). */
export function currencySymbol(code) {
  if (!code) return SYMBOL;
  const c = String(code).toUpperCase();
  return SYMBOLS[c] || c + " ";
}
// Amount in millions, rolling up to billions past $1000M so the string stays
// ≤ "$999.9B" and can't overflow a fixed-width table column.
export const fmtM = (n) => {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n < 0 ? "−" : "";
  const abs = Math.abs(n);
  const millions = abs / 1e6;
  if (millions >= 999.95) { // roll up before the M-form would show a 4-digit "$1000.0M"
    const b = abs / 1e9;
    return sign + SYMBOL + b.toFixed(b < 10 ? 2 : 1) + "B";
  }
  return sign + SYMBOL + millions.toFixed(1) + "M";
};

export const fmtX = (n, d = 2) => (n == null || !Number.isFinite(n) ? "—" : n.toFixed(d) + "×");

/** Insert thousands separators into the integer part of an already-formatted
 *  number (string or number), preserving any sign and decimals: "1458.0" →
 *  "1,458.0", 1000000 → "1,000,000". Non-numeric input is returned unchanged.
 *  Keeps large percentages readable — 1,458%, 1,000,000% — without otherwise
 *  reformatting the value. Tolerates the U+2212 minus the UI uses for negatives. */
export const withCommas = (n) => {
  const m = /^([+\-−]?)(\d+)(\.\d+)?$/.exec(String(n));
  if (!m) return String(n);
  return m[1] + m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (m[3] || "");
};

export const fmtPct = (n, d = 1) => (n == null || !Number.isFinite(n) ? "n/m" : withCommas((n * 100).toFixed(d)) + "%");

/** ISO date (YYYY-MM-DD) → US "MM-DD-YYYY". The one date format the UI shows,
 *  always as "Data as of <fmtAsOf(...)>". Tolerates already-formatted or blank. */
export const fmtAsOf = (iso) => {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  return m ? `${m[2]}-${m[3]}-${m[1]}` : String(iso);
};

/** Relative age of an ISO-8601 timestamp: "just now" / "42s ago" / "5m ago" / "3h ago" /
 *  "2d ago". Empty string for a blank value so the caller can pick its own fallback text. */
export const fmtRelative = (iso) => {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 5) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

/** Oldest fetch time across the present datasets (kpi.json source.datasets) — the honest
 *  "the data is at least this fresh" floor for a single summary line. Null when none are
 *  present or none carry a fetchedAt. */
export const oldestDatasetFetch = (datasets) => {
  const stamps = (datasets || [])
    .filter((d) => d && d.present && d.fetchedAt)
    .map((d) => d.fetchedAt)
    .sort();  // ISO-8601 sorts lexicographically
  return stamps.length ? stamps[0] : null;
};
