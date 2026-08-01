# fund-modeling — app source & build

The React app for the **`fund-modeling` skill**. This `app/` directory holds the frontend
source and its build tooling; the skill glue (`SKILL.md`, `scripts/serve.py`, `references/`)
and the committed runtime shell (`../dist/`) live one level up.

Source in `src/` is served **directly** at runtime — `serve.py` serves it at `/src/*` and a
service worker transpiles the JSX in-browser. There is no build step for source edits: edit a
file in `src/`, refresh, done.

**Do NOT run `npm run build` after editing source** — there is no build step for source edits.
`npm run build` rebuilds only the vendored ESM bundles (`../dist/vendor/react.esm.js`,
`../dist/vendor/sucrase.esm.js`), so it is needed **only to update deps** (a React or Sucrase
version bump), never per edit.

## Layout

- `app/src/` — canonical source (React components, `model/` logic, unit tests). Served directly.
- `app/` — build tooling (`package.json`, `vite.config.js`, `build.mjs`, dev `index.html`,
  `public/`, `node_modules/`). Dev-only; never served at runtime.
- `../dist/` — committed runtime shell: `index.html` (import map + SW bootstrap), `sw.js`
  (the transpiler), `mark.svg`, `vendor/` (built ESM). Served by `serve.py`.
- `../scripts/serve.py` — runtime server (stdlib only); also `build_datadir.py` etc.

## Develop

```bash
cd plugins/carta-investors/skills/fund-modeling/app
npm ci

# Dev server (Vite + HMR). /api is proxied to a running serve.py — start that first,
# pointed at a built data dir:
#   PORT=8787 python3 ../scripts/serve.py --data-dir <datadir> --no-open
npm run dev

npm test          # model unit tests (vitest)

# Only after bumping React/Sucrase: rebuild ../dist/vendor and commit it.
npm run build
```
