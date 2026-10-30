// The build's own sweep (scripts/own_sync.py) already mirrors a workbook budget privately
// to its owner's own hosted session — and can fail to, on a refused push. Colleagues see a
// budget only through Share or this firm-wide manual upload, which is off by default. Flip
// to true (a code change + deploy) to show it.
export const IMPORT_BUDGET_ENABLED = false;
