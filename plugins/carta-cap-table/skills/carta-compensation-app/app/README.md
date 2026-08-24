# ctc-dashboard — app source & build

The React app for the **`carta-compensation-app` skill**. This `app/` directory holds
the frontend source and its build tooling; the skill glue (`SKILL.md`, `scripts/serve.py`,
`references/`) and the committed runtime shell (`../webapp/`) live one level up.

Source in `src/` is served **directly** at runtime — `serve.py` serves it at `/src/*` and a
service worker transpiles the JSX in-browser. There is no build step for source edits: edit a
file in `src/`, refresh, done.

**Do NOT run `npm run build` after editing source** — there is no build step for source edits.
`npm run build` rebuilds only the vendored ESM bundles (`../webapp/vendor/react.esm.js`,
`sucrase.esm.js`), so it is needed **only to update deps** (a React or Sucrase version bump).

## Layout

- `app/src/` — canonical source. Served directly.
  - `model/` — pure functions (taxonomy, formatting) + unit tests. No React imports.
  - `views/` — one file per tab.
  - `ui/` — theme tokens.
  - `state/` — data loading against the local server.
- `app/` — build tooling (`package.json`, `vite.config.js`, `build.mjs`, `node_modules`).
  Dev-only; never served at runtime.
- `../webapp/` — committed runtime shell: `index.html` (import map + SW bootstrap), `sw.js`
  (the transpiler), `favicon.ico`, `vendor/` (built ESM). Served by `serve.py`.
- `../scripts/serve.py` — runtime server (stdlib only); also `build_datadir.py`, `ctc_paths.py`.

## Develop

```bash
cd plugins/carta-cap-table/skills/carta-compensation-app/app
npm ci

# Dev server (Vite + HMR). /api is proxied to a running serve.py — start that first,
# pointed at a built data dir:
#   PORT=8788 python3 ../scripts/serve.py --data-dir <datadir> --no-open
npm run dev

npm test          # model unit tests (vitest)

# Only after bumping React/Sucrase: rebuild ../webapp/vendor and commit it.
npm run build
```

**Node ≥ 20.19 is required** (Vite 8 / Vitest 4). On an older Node the install fails with
`EBADENGINE` and vitest dies with a `styleText` import error from rolldown.

## Conventions worth knowing

**Casing.** UPPER_SNAKE_CASE (`ENGINEER`, `SENIOR1`) is for machine handoff only. Anything a
user reads goes through `model/taxonomy.js` (`jobLabel`, `levelLabel`) to become Title Case.

**Missing vs zero.** `model/format.js` renders absent values as an em dash, never `0`, and
never assumes USD when the API didn't supply a currency. `$0` is a claim about the market;
`—` is the truth when there is no data.

**Ladder vs track.** The API returns `ladder: IC | LEADER`. The product UI shows three tracks,
so `trackOf()` splits LEADER into Manager/Executive on level rank. Keep display derived from
that helper — a VP shown under "Manager" is a real bug users report.

**Table layout.** `MetricTable` relies on `tableLayout: fixed` + a `minWidth` floor + the
`Section` wrapper's `overflowX`. All three cooperate; dropping one reintroduces either
overlapping columns or mashed-together currency values. The three-column grid collapses to one
below 1400px for the same reason.
