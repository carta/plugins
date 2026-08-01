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
export const displayCurrency = () => CURRENCY_CODE;

export const fmt$ = (n) =>
  n == null || !Number.isFinite(n)
    ? "—"
    : (n < 0 ? "(" : "") + SYMBOL + Math.abs(Math.round(n)).toLocaleString("en-US") + (n < 0 ? ")" : "");

// Amount in millions, rolling up to billions past $1000M so the string stays
// ≤ "$999.9B" and can't overflow the fixed-width FV column (Companies.jsx).
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

export const fmtB = (n) => {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  if (v >= 1) return SYMBOL + v.toFixed(v < 10 ? 2 : 1) + "B";
  if (v >= 0.0995) return SYMBOL + (v * 1000).toFixed(0) + "M"; // $650M, not $0.65B
  if (v > 0) return SYMBOL + (v * 1000).toFixed(1) + "M"; // $4.8M, not $0.00B
  return SYMBOL + "0";
};

export const fmtX = (n, d = 2) => (n == null || !Number.isFinite(n) ? "—" : n.toFixed(d) + "×");

export const fmtPct = (n, d = 1) => (n == null || !Number.isFinite(n) ? "n/m" : (n * 100).toFixed(d) + "%");

// Fully-diluted ownership fraction → "4.5%", with an extra digit for sub-1%
// stakes ("0.42%") so small positions don't collapse to "0.0%". Null-safe.
export const fmtOwn = (p) => (p == null || !Number.isFinite(p) ? "—" : (p * 100).toFixed(p >= 0.01 ? 1 : 2) + "%");

/** ISO date (YYYY-MM-DD) → US "MM-DD-YYYY". The one date format the UI shows,
 *  always as "Data as of <fmtAsOf(...)>". Tolerates already-formatted or blank. */
export const fmtAsOf = (iso) => {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  return m ? `${m[2]}-${m[3]}-${m[1]}` : String(iso);
};
