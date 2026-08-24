// CSV export — shared by every tab's Export button.
//
// Exports what is ON SCREEN, not the whole data dir: the same filters, the same
// equity representation, the same row order. A button labelled "Export" that quietly
// hands back more (or differently-shaped) data than the view is showing is a
// correctness problem, not a convenience one — someone will pivot on it and reconcile
// against the screen.
//
// Values are written RAW (unformatted numbers), not the display strings. A spreadsheet
// needs 96000, not "$96,000" — the latter imports as text and can't be summed. The
// display layer's money()/shares()/fdPct() helpers are deliberately not used here.
//
// Kept in model/ rather than a view because both tabs need it, and the reference
// implementation this follows (carta-portfolio-analytics-app) duplicates its escaper
// per view, which is exactly how two exports drift apart.

/** RFC 4180 quoting: wrap in quotes when the value contains a comma, quote or newline,
 *  and double any embedded quotes. */
export function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows of arrays -> a CSV string. CRLF line endings, which Excel handles most
 *  predictably across locales. */
export function toCsv(rows) {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

/** Trigger a browser download of `text` as `filename`.
 *
 *  Everything stays on this machine: a Blob URL is created, clicked, and revoked
 *  immediately. Nothing is uploaded, and the app makes no network call — consistent
 *  with the whole console being served offline from a local data dir.
 */
export function downloadCsv(filename, text) {
  // A BOM so Excel on Windows reads UTF-8 rather than mojibaking non-ASCII names.
  //
  // Written as an ESCAPE, not a literal U+FEFF character. The two compile to identical
  // bytes, but a literal BOM mid-file is an invisible character inside a string literal
  // — indistinguishable from an empty string on screen, and exactly the shape that
  // hidden-instruction scanners flag as a prompt-injection vector. The escape is
  // self-documenting and greppable; the literal is neither.
  const blob = new Blob(["\uFEFF" + text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** `meetly-benchmarks-2026-08-12.csv` — corp slug, what it is, and the date it left
 *  the app. The date matters: these files get mailed around and compared, and an
 *  undated compensation export is impossible to place afterwards. */
export function csvFilename(corporation, kind) {
  const slug = String(corporation || "carta")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "carta";
  const date = new Date().toISOString().slice(0, 10);
  return `${slug}-${kind}-${date}.csv`;
}
