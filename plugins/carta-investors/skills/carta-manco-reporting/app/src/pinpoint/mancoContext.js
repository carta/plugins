// Builds the context object App.jsx passes to capture.js's buildAnchor() as
// opts.context when pinning an element. Field names match chat_session.py's
// _ANCHOR_CONTEXT_KEYS exactly — add a field to both together, or
// anchor_preamble silently drops it.
//
// manco's ambient context: firm, tab, reporting period, currency.
export function mancoContext({ firm, tab, period, currency } = {}) {
  const n = (v) => (v == null ? null : v);
  return { firm: n(firm), tab: n(tab), period: n(period), currency: n(currency) };
}
