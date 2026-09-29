#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { FileKV } from "./kv.js";
import worker from "./worker.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(__dirname, "..");
const WEBAPP_DIR = join(ROOT, "webapp");
const SRC_DIR = join(ROOT, "app", "src");
const DATA_DIR = process.env.DATA_DIR || join(ROOT, ".data");
const PORT = parseInt(process.env.PORT || "8788", 10);
const TOKEN = process.env.DASH_TOKEN || "dev";

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".jsx": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml",
  ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2",
};

const env = {
  AUTH_MODE: "token",
  DASH_TOKEN: TOKEN,
  DEFAULT_FIRM: process.env.DEFAULT_FIRM || null,
  MCP_ACCESS_TOKEN: process.env.MCP_ACCESS_TOKEN || null,
  SESSIONS: new FileKV(join(DATA_DIR, "kv")),
  ASSETS: {
    async fetch(request) {
      const url = new URL(request.url);
      let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
      if (filePath.startsWith("/src/")) {
        const srcPath = join(SRC_DIR, filePath.slice(5));
        try {
          const body = await readFile(srcPath);
          const ext = extname(srcPath);
          return new Response(body, { headers: { "Content-Type": MIME[ext] || "application/octet-stream" } });
        } catch { return new Response("Not found", { status: 404 }); }
      }
      const fullPath = join(WEBAPP_DIR, filePath);
      try {
        await stat(fullPath);
        const body = await readFile(fullPath);
        const ext = extname(fullPath);
        return new Response(body, { headers: { "Content-Type": MIME[ext] || "application/octet-stream" } });
      } catch {
        const index = await readFile(join(WEBAPP_DIR, "index.html"));
        return new Response(index, { headers: { "Content-Type": "text/html" } });
      }
    },
  },
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === "string") headers.set(k, v);
    }
    let body = null;
    if (req.method !== "GET" && req.method !== "HEAD") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      body = Buffer.concat(chunks);
    }
    const request = new Request(url.toString(), { method: req.method, headers, body });
    const response = await worker.fetch(request, env);
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    const buf = await response.arrayBuffer();
    res.end(Buffer.from(buf));
  } catch (e) {
    res.writeHead(500);
    res.end(e.message);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${PORT}/?t=${TOKEN}`;
  console.log(`Portfolio Analytics running at ${url}`);
});
