#!/usr/bin/env node
// Builds the carta-manco-reporting skill's webapp/ vendor bundles. The app source
// (app/src) is served directly and transpiled in-browser by webapp/sw.js, so it is
// NOT compiled or copied here — this only emits ../webapp/vendor/*.esm.js.
//
// That is the whole point of this file: `npm run build` bumps the *runtime*, not the
// app. Routine source edits need no build at all — edit app/src/**.jsx and refresh.
// Run from app/: npm run build.

import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, relative } from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { build as esbuild } from "esbuild";

const APP = fileURLToPath(new URL(".", import.meta.url)); // this file lives at app/build.mjs
const WEBAPP = resolve(APP, "../webapp");
const VENDOR_OUT = resolve(WEBAPP, "vendor");
const TRACKER = "mcp-ui-tracker.global.js";

// React is CJS-only. `export * from 'react'` drops every name — esbuild can't
// enumerate a CJS module's exports for a star re-export. So import the default
// (esbuild's CJS interop binds it to the whole module.exports) and re-export the
// named APIs explicitly. One dep-free file backs all four import-map specifiers.
const REACT_ENTRY = [
  'import React from "react";',
  'import ReactDOM from "react-dom";',
  'import ReactDOMClient from "react-dom/client";',
  'export { jsx, jsxs, Fragment as JsxFragment } from "react/jsx-runtime";',
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

  // Browsers decide module-ness from the <script type="module"> / importmap that
  // loads these, but Node decides from the nearest package.json — and there isn't
  // one above webapp/. Without this marker, verifyReactBundle()'s `import()` of a
  // .js file is parsed as CommonJS and dies on "Unexpected token 'export'".
  await writeFile(
    resolve(VENDOR_OUT, "package.json"),
    JSON.stringify({ type: "module" }, null, 2) + "\n",
  );

  const reactEntryPath = resolve(APP, "_react-entry-tmp.mjs"); // under app/ so node_modules resolves
  await writeFile(reactEntryPath, REACT_ENTRY);
  try {
    console.log("  bundling react (monobundle)…");
    await esbuild({
      ...COMMON,
      entryPoints: [reactEntryPath],
      outfile: resolve(VENDOR_OUT, "react.esm.js"),
    });
  } finally {
    await rm(reactEntryPath, { force: true }); // always clean up, even on build throw
  }

  await verifyReactBundle();

  console.log("  bundling sucrase…");
  await esbuild({
    ...COMMON,
    entryPoints: [resolve(APP, "node_modules/sucrase/dist/esm/index.js")],
    outfile: resolve(VENDOR_OUT, "sucrase.esm.js"),
  });

  // `external: react` keeps this on the app's one React instance via the importmap.
  // Add every icon actually imported from "lucide-react" in src/ — nothing else ships.
  const iconsEntryPath = resolve(APP, "_lucide-entry-tmp.mjs");
  await writeFile(iconsEntryPath, 'export { Zap, BarChart3, Download, Check, TriangleAlert } from "lucide-react";\n');
  try {
    console.log("  bundling lucide-react (sidebar + export icons)…");
    await esbuild({
      ...COMMON,
      external: ["react", "react/jsx-runtime"],
      entryPoints: [iconsEntryPath],
      outfile: resolve(VENDOR_OUT, "lucide-react.esm.js"),
    });
  } finally {
    await rm(iconsEntryPath, { force: true });
  }
}

async function verifyReactBundle() {
  const ns = await import(pathToFileURL(resolve(VENDOR_OUT, "react.esm.js")).href);
  const missing = REACT_REQUIRED_EXPORTS.filter((k) => ns[k] === undefined);
  if (missing.length) {
    throw new Error(`react.esm.js missing exports: ${missing.join(", ")}`);
  }
  if (typeof ns.createRoot !== "function" || typeof ns.useState !== "function") {
    throw new Error("react.esm.js: createRoot/useState not callable");
  }
  console.log(`  verified react.esm.js (${REACT_REQUIRED_EXPORTS.length} exports) ✓`);
}

(async () => {
  // The Snowplow tracker is hand-vendored into this directory, not generated here, so
  // the clean below would drop it and silence every UI event.
  const tracker = resolve(VENDOR_OUT, TRACKER);
  const kept = existsSync(tracker) ? await readFile(tracker) : null;

  console.log("build: cleaning webapp/vendor/…");
  await rm(VENDOR_OUT, { recursive: true, force: true });

  console.log("build: bundling vendor ESM…");
  await buildVendors();

  if (kept) {
    await writeFile(tracker, kept);
    console.log(`  preserved ${TRACKER} ✓`);
  } else {
    console.warn(`  WARNING: ${TRACKER} is missing — the dashboard will emit no telemetry.`);
    console.warn("  Copy it from ../../carta-fund-modeling/webapp/vendor/ and commit it.");
  }

  console.log("build: done ✓");
  console.log(`  webapp: ${relative(process.cwd(), WEBAPP)}`);
  console.log("  (app source is served from app/src and transpiled in-browser — not built here)");
})();
