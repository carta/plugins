/** Per-account detail behind a cash total, for the hover cards. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Carta sends MM/DD/YYYY. Beside the dashboard's ISO as-of date, 06/02 reads
// as either 2 June or 6 February depending on the reader.
export function formatAsOf(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  if (!m) return raw;
  const month = MONTHS[Number(m[1]) - 1];
  return month ? `${month} ${Number(m[2])}, ${m[3]}` : raw;
}

// A manual balance is only as current as the last person to type it in.
export function accountNote(account) {
  const notes = [];
  if (account.is_manual) notes.push("manual");
  if (account.is_stale) {
    const days = account.staleness_days;
    notes.push(typeof days === "number" ? `not updated in ${days} days` : "out of date");
  }
  return notes.length ? notes.join(" · ") : null;
}

/** Whether a cash block has anything worth hovering over. */
export function hasCashDetail(cash) {
  return cashDetail(cash) !== null;
}

/** Rows for a cash hover card, or null when there is nothing to show.
 *
 *  `totals` stays per currency — summing across them is never valid, and it
 *  is dropped entirely when it would just restate a single account.
 */
export function cashDetail(cash) {
  if (!cash) return null;
  const accounts = (cash.accounts || []).map((a) => ({
    bank: a.bank_name || null,
    name: a.account_name || null,
    number: a.account_number || null,
    balance: a.balance,
    currency: a.currency_code || null,
    asOf: formatAsOf(a.as_of_date),
    note: accountNote(a),
  }));
  const totals = (cash.by_currency || []).map((t) => ({
    currency: t.currency_code,
    balance: t.total_balance,
  }));
  if (!accounts.length && !totals.length) return null;
  const restatesOneAccount = totals.length <= 1 && accounts.length <= 1;
  return { accounts, totals: restatesOneAccount ? [] : totals };
}
