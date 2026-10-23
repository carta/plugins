// The step sequence server/worker.js's handleLoadFirm sends, in the order it sends them
// (excluding "Error" and "Done", which never reach this list). Unlike
// carta-portfolio-analytics-app's per-stem steps — whose count varies by firm, since each
// stem is its own DWH query — this sequence is the same length on every load, which is
// what makes a numbered progress indicator meaningful here. Kept in sync with
// server/worker.js's `send({ step: ... })` calls by
// app/src/__tests__/workerSnapshotShape.test.js's "streams the load-firm steps in the
// exact order LOAD_FIRM_STEPS expects" — it drives the real worker and fails on a rename,
// insert or reorder there.
export const LOAD_FIRM_STEPS = [
  "Setting firm context",
  "Finding ManCo entity",
  "Querying ManCo financial data",
  "Loading budget data",
  "Building snapshot",
  "Storing data",
];

// Returns null for a label this list doesn't recognize (the server sent a step this list
// hasn't been updated for, or there's no step yet), so the caller falls back to an
// unnumbered status line instead of showing wrong progress.
export function loadFirmStepProgress(label) {
  const index = LOAD_FIRM_STEPS.indexOf(label);
  return index === -1 ? null : { index, total: LOAD_FIRM_STEPS.length };
}
