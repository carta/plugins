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
  // A null code means the data named no currency: amounts render bare, because
  // a "$" on a fund reporting in EUR is worse than no symbol.
  if (!code) {
    CURRENCY_CODE = null;
    SYMBOL = "";
    return;
  }
  CURRENCY_CODE = String(code).toUpperCase();
  SYMBOL = SYMBOLS[CURRENCY_CODE] || CURRENCY_CODE + " ";
}
export const displayCurrency = () => CURRENCY_CODE;

export const CURRENCIES = Object.keys(SYMBOLS);

const symbolFor = (code) => (!code ? "" : SYMBOLS[String(code).toUpperCase()] || String(code).toUpperCase() + " ");

/** The *In formatters take an explicit currency instead of the firm display currency. */
export const fmtMIn = (n, code) => {
  if (n == null || !Number.isFinite(n)) return "—";
  const sym = symbolFor(code);
  const m = Math.abs(n) / 1e6;
  const b = m / 1000;
  return (n < 0 ? "−" : "") + sym + (m >= 999.95 ? b.toFixed(b < 10 ? 2 : 1) + "B" : m.toFixed(1) + "M");
};

/** A check size without hiding its steps: "$675K", "$1.25M". */
export const fmtCheckIn = (n, code) => {
  if (n == null || !Number.isFinite(n)) return "—";
  const sym = symbolFor(code);
  const a = Math.abs(n);
  // Decide K vs M on the rounded thousands, so 999,600 reads "1M", not "1000K".
  const k = Math.round(a / 1e3);
  const body = k < 1000 ? `${k}K` : `${(a / 1e6).toFixed(2).replace(/\.?0+$/, "")}M`;
  return (n < 0 ? "−" : "") + sym + body;
};

export const fmtFullIn = (n, code) =>
  n == null || !Number.isFinite(n) ? "—" : (n < 0 ? "−" : "") + symbolFor(code) + Math.abs(Math.round(n)).toLocaleString("en-US");

export const fmtAmountIn = (n, code, decimals = 2) =>
  n == null || !Number.isFinite(n) ? "—" : (n < 0 ? "−" : "") + symbolFor(code) + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

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

/** The fund display name embeds an ALL-CAPS slug prefix for dense tables
 *  ("KRAKATOA-VENTURES-FUND-IV-L-P (Krakatoa Ventures Fund IV, 2021)"). The
 *  picker only needs the readable, already-title-cased part — strip the slug
 *  and surface "Krakatoa Ventures Fund IV (2021)". Falls back to the raw label
 *  (e.g. "All Funds") when there's no parenthetical. */
export function fundLabel(s) {
  if (!s) return s;
  const m = s.match(/\(([^)]+)\)\s*$/);
  if (!m) return s;
  const inner = m[1];
  const i = inner.lastIndexOf(", ");
  if (i === -1) return inner;
  const name = inner.slice(0, i), vintage = inner.slice(i + 2);
  return /^\d{4}$/.test(vintage) ? `${name} (${vintage})` : name;
}

/** fundLabel() with the trailing "(vintage)" stripped too — for views that
 *  already show vintage in its own column/line (Overview's Vintage column,
 *  CohortStanding's "2022 · 41 funds in cohort" line) and would otherwise
 *  show it twice. */
export function fundNameOnly(s) {
  return fundLabel(s)?.replace(/\s*\(\d{4}\)$/, "");
}

/** A "YYYY-MM" month as "Jan 2027"; `empty` when there's no month. */
export const fmtYm = (ym, empty = "—") => {
  if (!ym) return empty;
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
};

export const fmtYears = (n) => `${n} ${n === 1 ? "year" : "years"}`;

export const fmtCount = (n) => {
  if (n == null || !Number.isFinite(n)) return "—";
  return n >= 10 || Math.abs(n - Math.round(n)) < 0.05 ? Math.round(n).toLocaleString("en-US") : n.toFixed(1);
};
