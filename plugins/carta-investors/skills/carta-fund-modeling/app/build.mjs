#!/usr/bin/env node
// Builds the fund-modeling skill's webapp/ vendor bundles. The app source (app/src) is
// served directly and transpiled in-browser, so it is NOT copied here — this only
// emits ../webapp/vendor/*.esm.js, plus the Claude MCP App panel bundle webapp/panel/panel.js
// (gitignored, deployed with the webapp/ assets and served at /panel/). Run from app/: npm run build,
// or npm run build:panel for the panel alone (what a deploy runs).

import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, relative } from "node:path";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { build as esbuild } from "esbuild";

const APP = fileURLToPath(new URL(".", import.meta.url)); // this file lives at app/build.mjs
const WEBAPP = resolve(APP, "../webapp");
const VENDOR_OUT = resolve(WEBAPP, "vendor");
const PANEL_OUT = resolve(WEBAPP, "panel");

// React is CJS-only. `export * from 'react'` drops every name — esbuild can't
// enumerate a CJS module's exports for a star re-export. So import the default
// (esbuild's CJS interop binds it to the whole module.exports) and re-export the
// named APIs explicitly. One dep-free file backs all four import-map specifiers.
const REACT_ENTRY = [
  'import React from "react";',
  'import ReactDOM from "react-dom";',
  'import ReactDOMClient from "react-dom/client";',
  'export { jsx, jsxs } from "react/jsx-runtime";',
  "export default React;",
  "export const {",
  "  createElement, Fragment, StrictMode, createContext, forwardRef, memo,",
  "  useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback,",
  "  useContext, useReducer, useImperativeHandle, useSyncExternalStore,",
  "  useId, useTransition, useDeferredValue,",
  "} = React;",
  "export const { createPortal, flushSync } = ReactDOM;",
  "export const { createRoot, hydrateRoot } = ReactDOMClient;",
].join("\n");

// Exports the app imports; the build asserts these survived so a regression back
// to a name-dropping re-export fails loudly instead of shipping an empty bundle.
const REACT_REQUIRED_EXPORTS = [
  "default", "createElement", "Fragment", "StrictMode", "createContext",
  "useState", "useEffect", "useLayoutEffect", "useMemo", "useRef",
  "useCallback", "useContext", "useSyncExternalStore",
  "createPortal", "createRoot", "hydrateRoot", "jsx", "jsxs",
];

// Every file this script writes into webapp/vendor/; the clean step removes exactly these.
const OUT = { react: "react.esm.js", sucrase: "sucrase.esm.js" };

const COMMON = {
  bundle: true,
  format: "esm",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
  minify: true,
  logLevel: "warning",
};

async function buildVendors() {
  await mkdir(VENDOR_OUT, { recursive: true });

  const reactEntryPath = resolve(APP, "_react-entry-tmp.mjs"); // under app/ so node_modules resolves
  await writeFile(reactEntryPath, REACT_ENTRY);
  try {
    console.log("  bundling react (monobundle)…");
    await esbuild({
      ...COMMON,
      entryPoints: [reactEntryPath],
      outfile: resolve(VENDOR_OUT, OUT.react),
    });
  } finally {
    await rm(reactEntryPath, { force: true }); // always clean up, even on build throw
  }

  await verifyReactBundle();

  console.log("  bundling sucrase…");
  await esbuild({
    ...COMMON,
    entryPoints: [resolve(APP, "node_modules/sucrase/dist/esm/index.js")],
    outfile: resolve(VENDOR_OUT, OUT.sucrase),
  });
}

async function verifyReactBundle() {
  const ns = await import(pathToFileURL(resolve(VENDOR_OUT, OUT.react)).href);
  const missing = REACT_REQUIRED_EXPORTS.filter((k) => ns[k] === undefined);
  if (missing.length) {
    throw new Error(`${OUT.react} missing exports: ${missing.join(", ")}`);
  }
  if (typeof ns.createRoot !== "function" || typeof ns.useState !== "function") {
    throw new Error(`${OUT.react}: createRoot/useState not callable`);
  }
  console.log(`  verified ${OUT.react} (${REACT_REQUIRED_EXPORTS.length} exports) ✓`);
}

// Single-file bundle for the Claude MCP App panel (src/panel.jsx). Unlike the in-browser
// transpile above, a panel has no server to fetch source from, so everything ships as one file.
// It lands in webapp/panel/ with the stylesheet so the Worker serves both at /panel/, where
// carta-mcp fetches them.
async function buildPanel() {
  await esbuild({
    ...COMMON,
    entryPoints: [resolve(APP, "src/panel.jsx")],
    outfile: resolve(PANEL_OUT, "panel.js"),
    format: "iife",
    jsx: "automatic",
    loader: { ".js": "jsx" },
  });
  await copyFile(resolve(APP, "src/ui/tokens.css"), resolve(PANEL_OUT, "tokens.css"));
  console.log("  bundled webapp/panel/panel.js + tokens.css ✓");
}

(async () => {
  // `node build.mjs panel` builds only the panel, which is all a deploy needs: the full build
  // also rewrites webapp/vendor and removes webapp/src, the symlink to app/src.
  if (process.argv[2] === "panel") {
    await buildPanel();
    return;
  }
  // Remove only the files this script writes: webapp/vendor/ also holds hand-maintained
  // files (the tracker bundle, README.md) that a whole-folder clean would delete.
  console.log("build: cleaning generated webapp/vendor/ files (+ legacy webapp/src, webapp/assets)…");
  for (const f of Object.values(OUT)) await rm(resolve(VENDOR_OUT, f), { force: true });
  await rm(resolve(WEBAPP, "src"), { recursive: true, force: true });
  await rm(resolve(WEBAPP, "assets"), { recursive: true, force: true });

  console.log("build: bundling vendor ESM…");
  await buildVendors();
  await buildPanel();

  console.log("build: done ✓");
  console.log(`  webapp: ${relative(process.cwd(), WEBAPP)}`);
})();
