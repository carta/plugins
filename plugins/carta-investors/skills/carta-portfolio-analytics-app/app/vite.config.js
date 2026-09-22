import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev + test config only — the shipped app runs via scripts/serve.py + webapp/sw.js.
// `npm run dev` is the sandbox-safe fallback when a browser can't register that
// service worker. See docs/sandbox-safe-sw-fallback.md and app/README.md.
const SERVE_PORT = process.env.SERVE_PORT || "8787";

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.PORT) || 5174,
    // Every /api/* route is token-gated and reads a data dir, so proxy to a
    // running serve.py instance rather than reimplementing it here.
    proxy: {
      "/api": { target: `http://127.0.0.1:${SERVE_PORT}`, changeOrigin: true },
    },
  },
});
