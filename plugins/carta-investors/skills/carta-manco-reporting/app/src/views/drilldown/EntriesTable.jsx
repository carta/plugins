import { useEffect, useMemo, useRef, useState } from "react";
import { sans, INK, PAPER, LINE, FAINT, MICRO, BORDER_DEFAULT, BLUE, FS } from "../../ui/theme.js";
import { Tag } from "../../ui/components.jsx";
import { fmtCurrencyExact } from "../../charts/chartTheme.js";
import { normalizeTags } from "./util.js";
import { trackClick } from "../../analytics.js";

// Rendered up front, and again each time the reader reaches the end. A
// drill can hold hundreds of entries and almost nobody reads past the
// first screen, so the rest is built as it is asked for.
const CHUNK = 25;

function formatDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y.slice(2)}`;
}

// Ink's "open-in-new" glyph (maps to lucide's external-link icon).
export function ExternalLinkIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
         style={{ flexShrink: 0 }}>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

// Grid per entry: date left, amount + View right, account/tags/description
// stack in between.
export default function EntriesTable({ entries, buildJournalUrl }) {
  const [shown, setShown] = useState(CHUNK);
  const endRef = useRef(null);

  // Back to the top whenever the list itself changes — a filter that left
  // the reader 300 rows down would read as the drawer jumping. Keyed on
  // what the list HOLDS, not on the array's identity: one caller rebuilding
  // its props each render would otherwise pin this at the first chunk.
  const listKey = `${entries.length}:${entries[0]?.id ?? ""}:${entries[entries.length - 1]?.id ?? ""}`;
  useEffect(() => { setShown(CHUNK); }, [listKey]);

  const total = entries.length;
  const slice = entries.slice(0, shown);

  // Grow as the reader approaches the end. A scroll listener rather than an
  // IntersectionObserver: the drawer is a scroll container inside a fixed
  // panel, and an observer there is at the mercy of the host browser — one
  // this was checked in never delivered a single callback.
  useEffect(() => {
    const node = endRef.current;
    if (!node || shown >= total) return undefined;
    let box = node.parentElement;
    while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) {
      box = box.parentElement;
    }
    if (!box) return undefined;
    // Ahead of the end, so the next rows exist before they are reached.
    const NEAR = 400;
    const grow = () => {
      if (box.scrollHeight - box.scrollTop - box.clientHeight <= NEAR) {
        setShown(n => Math.min(total, n + CHUNK));
      }
    };
    grow();          // a list shorter than the panel never fires a scroll
    box.addEventListener("scroll", grow, { passive: true });
    return () => box.removeEventListener("scroll", grow);
  }, [shown, total]);

  if (!total) {
    return (
      <p style={{ ...sans, fontSize: FS.body, color: MICRO, marginTop: 12 }}>
        No journal entries in this slice.
      </p>
    );
  }

  return (
    <div>
      <ul style={S.list}>
        {slice.map((e) => {
          const url = buildJournalUrl?.(e);
          // e.fund (fund-fee entries) is the paying fund; vendor on those
          // rows is the ManCo itself, so fund wins when both are present.
          const hasAttribution = e.fund || e.vendor || e.partner;
          const isLast = e === slice[slice.length - 1] && shown >= total;
          return (
            <li key={e.id} style={isLast ? { ...S.row, borderBottom: "none", paddingBottom: 0 } : S.row}>
              <span style={S.date}>{formatDate(e.date)}</span>
              <div style={S.mid}>
                {(() => {
                  // Every tag the entry carries, whether or not a filter or
                  // the header already implies it. An entry's details do not
                  // change with what is filtered — the date, the account and
                  // the vendor all stay put, and a tag that vanished when it
                  // was selected read as an entry that had lost it.
                  const tagPairs = normalizeTags(e).slice(0, 3);
                  // Every row says which account it is, by number and by
                  // name. The number is what a reader reconciling a line
                  // against the ledger copies out; the name is what makes
                  // the number legible without looking it up.
                  //
                  // A sub-account stands in for both. Carta files one under
                  // its parent (7070.001), so its code already carries the
                  // account's, and its name is the specific thing the entry
                  // was booked to — printing "Taxes · California Franchise
                  // Tax" alongside says the general thing twice.
                  const code = (e.sub && e.sub_code) || (
                    typeof e.acct_type === "number" ? e.acct_type : null
                  );
                  const name = e.sub || e.account;
                  const left = code != null || name ? (
                    <span style={S.acct}>
                      {code != null && <span style={S.acctNum}>{code}</span>}
                      {name || ""}
                    </span>
                  ) : null;
                  if (!left && !tagPairs.length) return null;
                  return (
                    <span style={S.acctLine}>
                      {left}
                      {tagPairs.length > 0 && (
                        <span style={S.tagsWrap}>
                          {tagPairs.map((t, i) => (
                            // Ink's documented "mini" tag size (20px/11px/0 8px)
                            // for dense tables, not an ad hoc shrink.
                            <Tag key={i} tone="info" style={{ height: 20, fontSize: FS.small, padding: "0 8px" }}>
                              {t.value}
                            </Tag>
                          ))}
                        </span>
                      )}
                    </span>
                  );
                })()}
                {hasAttribution && (
                  <span style={S.attribution}>
                    {e.fund
                      ? <span style={S.vendor}>{e.fund}</span>
                      : e.vendor && (
                          // A vendor read off the description, not one Carta
                          // recorded — flagged inline where it was judged.
                          <span style={S.vendor}>
                            {e.vendor}
                            {/* Who was repaid — the chart groups these, but
                                the entry itself should still say whose. */}
                            {e.reimbursed_to && (
                              <span style={S.inferred}
                                    title="A reimbursement: this names who was repaid, not the merchant the money was spent with.">
                                {" "}{e.reimbursed_to}
                              </span>
                            )}
                            {e.vendor_inferred && (
                              <span style={S.inferred}
                                    title="Read from this entry's description and approved during setup — not recorded as a vendor in Carta.">
                                {" "}inferred
                              </span>
                            )}
                          </span>
                        )}
                    {e.partner && <span style={S.partner}>{e.partner}</span>}
                  </span>
                )}
                {e.description && (
                  <div style={S.description}>{e.description}</div>
                )}
              </div>
              <div style={S.right}>
                <span style={S.amount}>{fmtCurrencyExact(e.amount)}</span>
                {url && (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={S.viewLink}
                    title="Open this journal entry in Carta"
                    onClick={() => trackClick("MancoReporting.Drilldown.OpenJournalEntry")}
                  >
                    View
                    <ExternalLinkIcon />
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {/* Watched rather than clicked. Kept in the tree at all times so the
          observer has something to attach to on the first pass. */}
      <div ref={endRef} aria-hidden="true" style={{ height: 1 }} />
    </div>
  );
}

const S = {
  list: {
    ...sans,
    listStyle: "none",
    margin: 0,
    padding: 0,
    background: PAPER,
    borderTop: `1px solid ${BORDER_DEFAULT}`,
  },
  // 52px date column, flexible middle, fixed-width right column for
  // amount + View — both line up vertically down the list.
  row: {
    display: "grid",
    gridTemplateColumns: "52px 1fr 96px",
    gap: 14,
    alignItems: "start",
    padding: "14px 4px",
    borderBottom: `1px solid ${LINE}`,
    fontSize: FS.body,
  },
  date: {
    color: FAINT,
    fontVariantNumeric: "tabular-nums",
    marginTop: 1,
  },
  mid: {
    display: "flex",
    flexDirection: "column",
    gap: 5,
    minWidth: 0,
  },
  // Account name and its reporting tag(s) share one line, wrapping together
  // if the row gets too narrow rather than the tags dropping to their own row.
  acctLine: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  acct: {
    fontSize: FS.bodyLg,
    color: INK,
  },
  acctNum: {
    color: FAINT,
    fontVariantNumeric: "tabular-nums",
    marginRight: 6,
  },
  attribution: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    flexWrap: "wrap",
  },
  vendor: {
    color: INK,
    fontWeight: 400,
  },
  // Quiet: it qualifies the name beside it rather than competing with it.
  inferred: {
    color: MICRO,
    fontSize: FS.micro,
    fontStyle: "italic",
  },
  partner: {
    color: FAINT,
    fontStyle: "italic",
  },
  // Same treatment as partner — a secondary, firm-defined attribute
  // (SUB_ACCOUNT_NAME: office/location/sub-ledger, meaning varies by firm).
  sub: {
    color: FAINT,
    fontStyle: "italic",
  },
  tagsWrap: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
  },
  right: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 5,
  },
  amount: {
    fontSize: FS.bodyLg,
    color: INK,
    fontWeight: 500,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  viewLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    color: BLUE,
    fontSize: FS.body,
    fontWeight: 500,
    textDecoration: "none",
    whiteSpace: "nowrap",
  },
  description: {
    fontSize: FS.body,
    color: FAINT,
    lineHeight: 1.45,
    // Wrap long descriptions naturally; break-word for very long unbroken tokens
    wordBreak: "break-word",
  },
};
