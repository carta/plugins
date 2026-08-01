import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev-only Vite config — `npm run dev` starts a fast HMR server with JSX
// support and proxies /api to a running serve.py instance.
//
// The shipped artifact is built by `npm run build` (app/build.mjs),
// not by `vite build`.  Vite is dev-loop only.
const SERVE_PORT = process.env.SERVE_PORT || "8787";

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.PORT) || 5173,
    proxy: {
      "/api": { target: `http://127.0.0.1:${SERVE_PORT}`, changeOrigin: true },
    },
  },
});
