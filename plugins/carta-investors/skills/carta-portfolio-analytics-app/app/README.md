# carta-portfolio-analytics-app — app source, dev server & tests

The React app for the **`carta-investors:carta-portfolio-analytics-app` skill**. This
`app/` directory holds the frontend source and its tooling; the skill glue
(`SKILL.md`, `scripts/serve.py`, `references/`) and the committed runtime shell
(`../webapp/`) live one level up.

Source in `src/` is served **directly** at runtime — `scripts/serve.py` serves it at
`/src/*` and `../webapp/sw.js` transpiles the JSX in-browser with Sucrase. There is no
build step for source edits: edit a file in `src/`, refresh, done.

## Layout

- `app/src/` — canonical source (views, model, state, unit tests). Served directly.
- `app/` — tooling: `package.json`, `vite.config.js`, dev `index.html`, `node_modules/`.
  Dev-only; never served at runtime.
- `../webapp/` — committed runtime shell: `index.html` (import map + SW bootstrap),
  `sw.js` (the transpiler), `favicon.ico`, `fonts/`, `vendor/` (vendored ESM).
- `../scripts/serve.py` — runtime server (stdlib only), plus the data-dir builders.

## Two ways to load the app

| | `serve.py` (runtime) | `npm run dev` (Vite) |
|---|---|---|
| Shell | `../webapp/index.html` | `app/index.html` |
| JSX transpiled by | `sw.js` in the browser | Vite, server-side |
| Service worker | required | none |
| What users load | yes | no |

**Default to `serve.py`** — it is the path users get, and the only one that exercises
the import map, the service-worker cold-start gate and the paste-back error overlay.

**Reach for `npm run dev` when the browser cannot register a service worker.** Claude's
sandboxed Browser pane fails at registration with:

```
TypeError: Failed to register a ServiceWorker for scope ('http://127.0.0.1:8787/')
with script ('http://127.0.0.1:8787/sw.js'): An unknown error occurred when fetching
the script.
```

That is environmental, not an app bug: `curl` and an in-page `fetch('/sw.js')` both
return 200 with the right content type, and it fails identically with and without
`{type: "module"}`. Without a service worker the runtime shell cannot transpile
anything, so nothing renders — hence this second path.

Verifying a **visual** change through Vite is sound. Verifying **shell** behaviour
(the SW cold-start gate, the error overlay) through it is not — check that on
`serve.py`.

## Develop

1. Start the real runtime: `uv run ../scripts/serve.py --data-dir <dashboard_dir>`
   (see `../SKILL.md` for how a dashboard dir is built). Note the port and token it
   prints (`http://127.0.0.1:<port>/?t=<token>`; also persisted at
   `<dashboard_dir>/.token`).
2. In another terminal, `cd app && SERVE_PORT=<that port> npm run dev` — Vite proxies
   `/api/*` to `serve.py`, so real data still loads.
3. Open the Vite URL **with the same token**: `http://localhost:5174/?t=<token>`. Every
   `/api/*` route is token-gated (`app/src/main.jsx` reads `?t=` from the page URL), so
   opening the bare Vite URL loads the shell but every data call 401s.

## Test

```
npm test
```

Pure-logic tests run in the default node environment; DOM/component tests opt in
per-file with `// @vitest-environment happy-dom`.
