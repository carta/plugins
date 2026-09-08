import { sans, inkNum, INK, FAINT, MICRO, LINE, FS } from "../ui/theme.js";
import { fmtCurrencyExact } from "../charts/chartTheme.js";
import { cashDetail } from "../ui/cashDetail.js";

/** What sits behind a cash total: each account, its balance, and its date.
 *
 *  Amounts are exact here. The headline rounds to keep the tile readable, and
 *  this is where a reader comes to see the actual figure.
 */
export default function CashDetailCard({ cash }) {
  const detail = cashDetail(cash);
  if (!detail) return null;
  const { accounts, totals } = detail;
  return (
    <span style={S.wrap}>
      <span style={S.heading}>Cash by account</span>
      {accounts.map((a, i) => (
        <span key={`${a.name}-${a.number}-${i}`} style={S.row}>
          <span style={S.rowTop}>
            <span style={S.name}>{a.bank || a.name || "Account"}</span>
            <span style={S.amount}>{fmtCurrencyExact(a.balance)}{a.currency ? ` ${a.currency}` : ""}</span>
          </span>
          <span style={S.rowSub}>
            {[a.bank && a.name, a.number].filter(Boolean).join(" · ")}
          </span>
          <span style={S.rowMeta}>
            {a.asOf ? `as of ${a.asOf}` : "no balance date from Carta"}
            {a.note ? ` · ${a.note}` : ""}
          </span>
        </span>
      ))}
      {totals.length > 0 && (
        <span style={S.totals}>
          {totals.map((t) => (
            <span key={t.currency} style={S.totalRow}>
              <span style={S.name}>Total {t.currency}</span>
              <span style={S.amount}>{fmtCurrencyExact(t.balance)}</span>
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

const S = {
  wrap: { ...sans, display: "block", fontSize: FS.body, color: INK },
  heading: {
    display: "block", fontSize: FS.micro, color: MICRO,
    textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6,
  },
  row: { display: "block", marginBottom: 8 },
  rowTop: { display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" },
  rowSub: { display: "block", fontSize: FS.micro, color: FAINT },
  rowMeta: { display: "block", fontSize: FS.micro, color: MICRO },
  name: { fontWeight: 500 },
  amount: { ...inkNum, whiteSpace: "nowrap" },
  totals: { display: "block", borderTop: `1px solid ${LINE}`, paddingTop: 6, marginTop: 2 },
  totalRow: { display: "flex", justifyContent: "space-between", gap: 12 },
};
