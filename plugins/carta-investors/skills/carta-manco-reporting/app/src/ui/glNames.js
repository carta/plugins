// Carta GL account names for the budget tables' GL chips.

// Names come from the entries themselves, so a budgeted account with no
// activity in the window has none.
export function glNameMap(entries) {
  const m = new Map();
  for (const e of entries || []) {
    if (e.acct_type != null && e.account && !m.has(e.acct_type)) {
      m.set(e.acct_type, e.account);
    }
  }
  return m;
}

// Null rather than "" — an empty title renders as a blank tooltip, which
// reads as broken rather than absent.
const SCOPE_LABEL = { sub_account: "Sub-account", vendor: "Vendor",
                      account: "GL account" };

// What a scope is called in the reader's terms. A reporting tag is named
// by its own category, which is the firm's word, not ours.
export function scopeLines(scopes, subCodes) {
  return (scopes || [])
    .map(sc => {
      const label = sc.source === "reporting_tag"
        ? (sc.category || "Reporting tag") : SCOPE_LABEL[sc.source];
      if (!label) return null;
      // Carta numbers a sub-account under its account (7120.001). That is
      // what a reader reconciling against the ledger searches for.
      const code = sc.source === "sub_account" ? subCodes?.get(sc.value) : null;
      return `${label}: ${code ? `${code} — ` : ""}${sc.value}`;
    })
    .filter(Boolean);
}

/** Sub-account name → the code Carta files it under. */
export function subCodeMap(entries) {
  const m = new Map();
  for (const e of entries || []) {
    if (e.sub && e.sub_code && !m.has(e.sub)) m.set(e.sub, e.sub_code);
  }
  return m;
}

/** The sub-account part of a breakout child's label, or null.
 *
 *  The account breakout names a child "<account> · <sub>" so two accounts'
 *  sub-accounts stay apart. The row already says which account it is, so
 *  the reader wants the half they don't have.
 */
export function subOfChildLabel(label) {
  const i = String(label ?? "").indexOf(" · ");
  return i === -1 ? null : label.slice(i + 3);
}

export function glTooltip(codes, names, scopes, subCodes, subs) {
  const list = (codes || []).filter(c => c != null);
  if (!list.length) return null;
  // Unnamed codes stay listed: a reader checking a join needs to see the
  // code they came for, named or not.
  const named = list.map(c => {
    const n = names?.get(c) ?? names?.get(Number(c)) ?? names?.get(String(c));
    return n ? `${c} — ${n}` : `${c} — no entries this period`;
  });
  // One account per line: a line covering nine of them ran to three
  // wrapped lines of middot-separated text, which is a paragraph to parse
  // rather than a list to scan.
  const head = `Carta GL account${list.length > 1 ? "s" : ""}`;
  // Every scope the row carries, reporting tags included. They were held
  // back as internal plumbing, which meant a line quietly reporting one
  // value of an account looked identical to one reporting all of it —
  // and on one firm it took the wrong nine entries of ten for months.
  // The sub-accounts the row is broken out into, under the accounts they
  // belong to. The rows below state the names; this states the codes, which
  // is what a reader reconciling against the ledger came for and the one
  // thing the breakout itself cannot show them.
  const subLines = [];
  for (const sub of subs || []) {
    if (!sub) continue;
    const code = subCodes?.get(sub);
    subLines.push(code ? `${code} — ${sub}` : sub);
  }
  const subHead = subLines.length
    ? [`Sub-account${subLines.length > 1 ? "s" : ""} broken out below`] : [];

  return [head, ...named, ...subHead, ...subLines,
          ...scopeLines(scopes, subCodes)].join("\n");
}
