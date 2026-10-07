// ── Config, parsing and formatting (no DOM) ──
// WF_CONFIG is baked in by scripts/build_artifact.py: the run's identity, inputs and results.
const CFG = WF_CONFIG;
// The page branches on the noun of the baked command; the two shapes differ.
const GET_NOUN = String(CFG.get_command || '').split(':').pop();
const IS_CORE = GET_NOUN === 'core_results';
// A run whose options carry no currency is USD, like llc-ui.
const CURRENCY = /^[A-Z]{3}$/.test(String(CFG.currency || '')) ? CFG.currency : 'USD';

// Values arrive as strings or numbers. Anything that is not a finite number is "no value".
function num(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const t = v.trim();
    if (!t) return null;
    const n = Number(t);
    return isFinite(n) ? n : null;
  }
  return null;
}

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

let _currencyFmt = null;
function currencyFormatter() {
  if (!_currencyFmt) {
    try {
      // Accounting sign puts negatives in parentheses: ($1,234.00).
      _currencyFmt = new Intl.NumberFormat('en-US', {
        style: 'currency', currency: CURRENCY, currencySign: 'accounting',
        minimumFractionDigits: 2, maximumFractionDigits: 2,
      });
    } catch (e) {
      _currencyFmt = { format: v => (v < 0 ? '(' : '') + Math.abs(v).toFixed(2) + (v < 0 ? ')' : '') };
    }
  }
  return _currencyFmt;
}
const _twoDp = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const _qty = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// A value that rounds to zero prints as zero, never as "($0.00)" or "-0.00".
function _tidy(n, digits) {
  return Math.abs(n) < 0.5 * Math.pow(10, -digits) ? 0 : n;
}
function fmtCurrency(v) {
  const n = num(v);
  return n === null ? '' : currencyFormatter().format(_tidy(n, 2));
}
function fmtPercent(v) {
  const n = num(v);
  return n === null ? '' : _twoDp.format(_tidy(n, 2)) + '%';
}
function fmtMoic(v) {
  const n = num(v);
  return n === null ? '' : _twoDp.format(_tidy(n, 2)) + 'x';
}
function fmtQty(v) {
  const n = num(v);
  return n === null ? '' : _qty.format(_tidy(n, 2));
}
