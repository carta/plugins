# manco-reporting — app source, dev server & build

The React app for the **`carta-investors:carta-manco-reporting` skill**. This `app/` directory
holds the frontend source and its tooling; the skill glue (`SKILL.md`,
`scripts/serve.py`, `references/`) and the committed runtime shell (`../webapp/`) live
one level up.

Source in `src/` is served **directly** at runtime — `scripts/serve.py` serves it at
`/src/*` and `../webapp/sw.js` transpiles the JSX in-browser with Sucrase. There is no
build step for source edits: edit a file in `src/`, refresh, done.

**Do NOT run `npm run build` after editing source.** It rebuilds only the vendored ESM
bundles (`../webapp/vendor/{react,sucrase,lucide-react}.esm.js`), so it is needed **only**
when bumping one of those packages — never per edit.

## Layout

- `app/src/` — canonical source (views, charts, `state/`, unit tests). Served directly.
- `app/` — tooling: `package.json`, `vite.config.js`, `build.mjs`, dev `index.html`,
  `node_modules/`. Dev-only; never served at runtime.
- `../webapp/` — committed runtime shell: `index.html` (import map + SW bootstrap),
  `sw.js` (the transpiler), `favicon.ico`, `fonts/`, `vendor/` (built ESM).
- `../scripts/serve.py` — runtime server (stdlib only); also `build_manco_datadir.py`.

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
sandboxed Browser pane (the fallback when Claude in Chrome is not connected) fails at
registration with:

```
TypeError: Failed to register a ServiceWorker for scope ('http://127.0.0.1:8787/')
with script ('http://127.0.0.1:8787/sw.js'): An unknown error occurred when fetching
the script.
```

That is environmental, not an app bug: `curl` and an in-page `fetch('/sw.js')` both
return 200 with the right content type, `getRegistrations()` is empty, and it fails
identically with and without `{type: "module"}`. Without a service worker the runtime
shell cannot transpile anything, so nothing renders — hence this second path.

Verifying a **visual** change through Vite is sound. Verifying **shell** behaviour
through it is not: check that on `serve.py`.

This split is written up as a reusable pattern (for other Service-Worker-based
microapps that need the same fallback) in `docs/sandbox-safe-sw-fallback.md`
at the repo root.

## Develop

```bash
cd plugins/carta-investors/skills/carta-manco-reporting/app
npm ci

# 1. Start serve.py first, pointed at a data dir the skill already built. It owns
#    every /api/* route and the token that gates them; Vite only proxies to it.
#    Data dirs live under ~/.cache/manco-reporting/<firm-slug>/<manco-slug>/.
PORT=8787 python3 ../scripts/serve.py --data-dir <dashboard_dir> --no-open

# 2. Start Vite. SERVE_PORT must match the port serve.py actually bound (read the
#    `[serve] manco-reporting at ...` line, not the port you asked for).
SERVE_PORT=8787 npm run dev

# 3. Open the dev server WITH the token from serve.py's URL — /api/* is token-gated,
#    and no token renders AuthError instead of the dashboard:
#      http://localhost:5174/?t=<token>
#    The token is also in <dashboard_dir>/.token. dash-token.js stores it in
#    localStorage and strips it from the URL, so later reloads need no ?t=.

npm test          # unit tests (vitest)

# Only after bumping React/Sucrase/lucide-react: rebuild ../webapp/vendor and commit it.
npm run build
```

Vite bumps to the next free port when 5174 is taken — use the URL it prints. `PORT`
overrides the dev port; `SERVE_PORT` (default 8787) points the `/api` proxy.

5174, not the 5173 other Carta microapps default to: theirs and this one can then run
side by side without either being bumped.

Fonts and the favicon are served straight out of `../webapp/` by a small dev-only
middleware in `vite.config.js`, rather than copied into `app/public/`, so the dev
server always renders the runtime's own font bytes.
