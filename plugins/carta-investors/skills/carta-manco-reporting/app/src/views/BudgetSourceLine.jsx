import { sans, INK, FAINT, FS } from "../ui/theme.js";

// One line beneath a Budget-vs-Actuals table naming where each side of the
// comparison came from.
//
// The tables put two data sources side by side without saying so: Actual
// columns are Carta journal entries, Budget columns are cells out of the
// client's own spreadsheet. The column sub-headers mark that per column;
// this names both concretely, so a reader who wants to check a budget
// figure knows which file and which tab to open.
// `fallback` names the budget side when no workbook backs it — a
// Carta-sourced budget has no file or tab to cite.
export default function BudgetSourceLine({ meta, fallback = "the source workbook" }) {
  return (
    <p style={S.line}>
      Actual — Carta journal entries
      {" · "}
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
