// Chart-amount formatting, shared by every chart and ledger table. The
// display currency is DATA-DRIVEN — never a
// hardcoded USD: set once at load from the ManCo's reporting currency
// (snapshot.currency) via setDisplayCurrency(). Every chart/table that
// renders a dollar figure should go through fmtCurrencyShort/fmtCurrencyExact
// below rather than hardcoding "$", so a non-USD firm renders correctly
// everywhere at once.
const SYMBOLS = {
  USD: "$", CAD: "C$", AUD: "A$", NZD: "NZ$", HKD: "HK$", SGD: "S$", MXN: "MX$",
  EUR: "€", GBP: "£", JPY: "¥", CNY: "¥", INR: "₹", BRL: "R$", ZAR: "R",
  CHF: "CHF ", SEK: "kr ", NOK: "kr ", DKK: "kr ", ILS: "₪",
};
let CURRENCY_CODE = "USD";
let SYMBOL = "$";

/** Set the ManCo's display currency (ISO code). Symbol is looked up, falling
 *  back to a "<CODE> " prefix so an unmapped currency is still labeled, never
 *  silently shown as USD. Idempotent; safe to call on every render. */
export function setDisplayCurrency(code) {
  if (!code) return;
  CURRENCY_CODE = String(code).toUpperCase();
  SYMBOL = SYMBOLS[CURRENCY_CODE] || CURRENCY_CODE + " ";
}
export const displayCurrency = () => CURRENCY_CODE;

// Whole currency: $1,234,568 / $456,000 / -$789. For Budget vs Actuals,
// where a reader ties a figure back to a workbook cell and $1.2M does not.
export function fmtCurrencyWhole(v) {
  if (v == null || Number.isNaN(v)) return "—";
  const n = Number(v);
  if (Number.isNaN(n)) return "—";
  // Round before reading the sign: a rounded-away cent is zero, and "-$0"
  // states a direction the figure itself denies.
  const whole = Math.round(Math.abs(n));
  return (n < 0 && whole ? "-" : "") + SYMBOL + whole.toLocaleString("en-US");
}

// Compact currency: $1.23M / $456K / $789
export function fmtCurrencyShort(v, decimals = 1) {
  if (v == null || Number.isNaN(v)) return "—";
  const n = Number(v);
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return sign + SYMBOL + (abs / 1e9).toFixed(decimals) + "B";
  if (abs >= 1e6) return sign + SYMBOL + (abs / 1e6).toFixed(decimals) + "M";
  if (abs >= 1e3) return sign + SYMBOL + (abs / 1e3).toFixed(0) + "K";
  return sign + SYMBOL + Math.round(abs).toLocaleString();
}

// Exact currency to the cent: $1,234,567.89 (negatives in parentheses).
// Use for per-line-item amounts in the JE detail table.
export function fmtCurrencyExact(v) {
  if (v == null || Number.isNaN(v)) return "—";
  const n = Number(v);
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? "(" + SYMBOL + abs + ")" : SYMBOL + abs;
}

// Same exact-to-the-cent formatting as fmtCurrencyExact, but for a value in
// an EXPLICIT currency rather than the ManCo's global display currency set
// via setDisplayCurrency(). A fund's own reporting currency is not
// guaranteed to match its ManCo's, so a per-fund figure (e.g. a management
// fee schedule's minimum/fixed fee amount) must carry its own currency
// rather than borrow whatever the ManCo happens to report in. Returns null
// (never a bare, unlabeled number) when currencyCode is missing — callers
// should render nothing rather than an amount with no currency marker.
export function fmtCurrencyExactFor(v, currencyCode) {
  if (v == null || Number.isNaN(v) || !currencyCode) return null;
  const code = String(currencyCode).toUpperCase();
  const symbol = SYMBOLS[code] || code + " ";
  const n = Number(v);
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? "(" + symbol + abs + ")" : symbol + abs;
}

// Whether an "as of"/range-end date falls short of its month's last day —
// that month is still accruing, and a chart must mark it as provisional.
export function isPartialPeriod(endIso) {
  if (!endIso) return false;
  const [y, m, d] = endIso.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return d < lastDay;
}
