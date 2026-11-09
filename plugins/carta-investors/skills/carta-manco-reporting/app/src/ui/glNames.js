// Carta GL account names for the budget tables' GL chips.

import { noValueLabel } from "./dimension.js";

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

const byText = (a, b) => String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true });

/** GL account code → its sub-accounts as { sub, code }, in ledger order
 *  (code, then name). The code stays beside its name because a firm can book
 *  one sub-account name under two accounts, each with its own code. Read off
 *  the entries so a row's tooltip can list them without the row being opened
 *  by account first. */
export function subAccountsByAccount(entries) {
  const seen = new Map();
  for (const e of entries || []) {
    if (e.acct_type == null || !e.sub) continue;
    if (!seen.has(e.acct_type)) seen.set(e.acct_type, new Map());
    const subs = seen.get(e.acct_type);
    if (!subs.has(e.sub)) subs.set(e.sub, e.sub_code || null);
  }
  const out = new Map();
  for (const [acct, subs] of seen) {
    out.set(acct, [...subs.entries()]
      .map(([sub, code]) => ({ sub, code }))
      .sort((a, b) => (a.code ? 0 : 1) - (b.code ? 0 : 1)
                   || byText(a.code, b.code) || byText(a.sub, b.sub)));
  }
  return out;
}

/** The sub-accounts under a row's GL accounts. One name under two accounts
 *  is two sub-accounts, so they are told apart by code. */
export function subsOfAccounts(codes, byAccount) {
  const out = [];
  const seen = new Set();
  for (const c of codes || []) {
    for (const s of byAccount?.get(Number(c)) ?? byAccount?.get(c) ?? []) {
      const key = s.code ?? s.sub;
      if (!seen.has(key)) { seen.add(key); out.push(s); }
    }
  }
  return out;
}

/** The label a breakout child displays. A sub-account reads "<sub code> -
 *  <name>" (just the name when it has no code) and the account's own spend
 *  reads "<account code> - Not Categorized", as Carta's trial balance prints
 *  them. Anything else keeps its full label so the account name is not lost.
 */
export function childDisplayLabel(child, breakout) {
  if (child.unlabelled) return noValueLabel(breakout);
  if (child.uncategorized) return `${child.acct} - Not Categorized`;
  if (child.sub == null) return child.label;
  return child.subCode ? `${child.subCode} - ${child.sub}` : child.sub;
}

// A firm's sub-accounts under one account run from a couple to a few dozen;
// past this the tooltip stops being scannable and says how many are left.
export const MAX_SUB_LINES = 5;

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
  // The sub-accounts under the row's accounts, with the codes a reader
  // reconciling against the ledger searches for. A row reporting one
  // sub-account already names it in its scopes, so listing all of them
  // would contradict the figure.
  const reportsOneSub = (scopes || []).some(sc => sc.source === "sub_account");
  const all = reportsOneSub ? [] : (subs || []).filter(Boolean);
  const shown = all.slice(0, MAX_SUB_LINES)
    .map(({ sub, code }) => code ? `${code} — ${sub}` : sub);
  const hidden = all.length - shown.length;
  const subLines = hidden > 0 ? [...shown, `+${hidden} more`] : shown;
  const subHead = shown.length ? [`Sub-account${all.length > 1 ? "s" : ""}`] : [];

  return [head, ...named, ...subHead, ...subLines,
          ...scopeLines(scopes, subCodes)].join("\n");
}
