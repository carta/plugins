import { createReadStream, existsSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// long-comment-ok: this app has three serving paths; picking the wrong one verifies a page no user loads
// DEV + TEST CONFIG for the carta-investors:carta-manco-reporting skill. Vite never builds
// the shipped app. It does two things only:
//   1. lets vitest resolve and transform the .jsx modules the unit tests import;
//   2. serves app/src over `npm run dev`, for browsers where webapp/sw.js cannot
//      register — Claude's sandboxed Browser pane fails there with an opaque
//      "unknown error occurred when fetching the script".
//
// Users load neither. scripts/serve.py serves webapp/ plus app/src/**.jsx at /src/*,
// which webapp/sw.js transpiles in-browser with Sucrase — so an app-source edit needs
// no build, and cannot render stale. `npm run dev` is a verification path with no
// service worker: it uses app/index.html, so the import map, the SW cold-start gate
// and the error overlay stay verifiable only through serve.py. See README.md.
//
// `npm run build` runs build.mjs, which emits ONLY webapp/vendor/*.esm.js (React,
// Sucrase, Chart.js). Run it when bumping one of those deps — not for app edits.

// serve.py's default first-launch port (references/serve-and-update.md, Step 5b).
// It binds elsewhere when 8787 is taken: SERVE_PORT=8788 npm run dev.
const SERVE_PORT = process.env.SERVE_PORT || "8787";
const DEV_PORT = Number(process.env.PORT) || 5174;

const WEBAPP_DIR = fileURLToPath(new URL("../webapp/", import.meta.url));

// theme.js and AuthError.jsx @font-face the display font from /fonts/; both shells
// link /favicon.ico. serve.py serves both out of webapp/.
const RUNTIME_ASSET_PREFIXES = ["/fonts/", "/favicon.ico"];
const RUNTIME_ASSET_TYPES = {
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ico": "image/x-icon",
};

// Reads the runtime's own bytes, so a font swapped in webapp/fonts cannot leave this
// server rendering the old one — a typography check here would then verify no user's page.
// Not `publicDir: "../webapp"`: Vite would serve webapp/index.html at /, which is the
// service-worker shell this path exists to avoid.
function serveRuntimeAssets() {
  return {
    name: "manco-serve-runtime-assets",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // Match on the normalized path, not the raw one: `new URL` collapses dot
        // segments, so /fonts/../sw.js is tested as /sw.js and falls through to Vite.
        const { pathname } = new URL(req.url || "/", "http://localhost");
        if (!RUNTIME_ASSET_PREFIXES.some((p) => pathname.startsWith(p))) return next();

        const file = resolve(WEBAPP_DIR, "." + pathname);
        if (!file.startsWith(WEBAPP_DIR) || !existsSync(file)) return next();

        res.setHeader(
          "Content-Type",
          RUNTIME_ASSET_TYPES[extname(file).toLowerCase()] || "application/octet-stream",
        );
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), serveRuntimeAssets()],
  server: {
    port: DEV_PORT,
    // Every /api/* route is token-gated and reads a data dir, so proxy to a running
    // serve.py. dash-token.js's X-Dash-Token header passes through unchanged.
    proxy: {
      "/api": { target: `http://127.0.0.1:${SERVE_PORT}`, changeOrigin: true },
    },
  },
});
