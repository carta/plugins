import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev-only config (npm run dev / npm test). The runtime path does NOT use Vite —
// serve.py serves app/src directly and the service worker transpiles it.
export default defineConfig({
  plugins: [react()],
  server: {
    // /api is proxied to a running serve.py so the dev server shows real data.
    // Start that first, pointed at a built data dir:
    //   PORT=8788 python3 ../scripts/serve.py --data-dir <datadir> --no-open
    proxy: {
      "/api": {
        target: process.env.API_TARGET || "http://127.0.0.1:8788",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "happy-dom",
    include: ["src/**/__tests__/**/*.test.{js,jsx}"],
  },
});
