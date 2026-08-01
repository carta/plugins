export function fmContext({ firm, tab, sliceId, sliceName, fundScope, currency } = {}) {
  const n = (v) => (v == null ? null : v);
  return {
    firm: n(firm), tab: n(tab), sliceId: n(sliceId),
    sliceName: n(sliceName), fundScope: n(fundScope), currency: n(currency),
  };
}
