import { sans, INK, FAINT, FS } from "../ui/theme.js";

// One line beneath a Budget-vs-Actuals table naming where the Budget side
// of the comparison came from — the Actual side is always Carta journal
// entries, already marked per-column by the table's own sub-headers.
// `fallback` names the budget side when no workbook backs it — a
// Carta-sourced budget has no file or tab to cite.
export default function BudgetSourceLine({ meta, fallback = "the source workbook" }) {
  return (
    <p style={S.line}>
      Budget — {meta?.filename ? (
        <>
          <span style={S.workbookName}>{meta.filename}</span>
          {meta.sheet && <> · <span style={S.workbookSheet}>{meta.sheet}</span></>}
        </>
      ) : fallback}
    </p>
  );
}

const S = {
  line: {
    ...sans,
    fontSize: FS.small,
    lineHeight: 1.5,
    color: FAINT,
    marginTop: 8,
    marginBottom: 20,
  },
  workbookName: { color: INK, fontWeight: 500 },
  workbookSheet: { color: INK, fontStyle: "italic" },
};
