#!/usr/bin/env node
// Builds the ctc-dashboard skill's webapp/ vendor bundles. The app source (app/src) is
// served directly and transpiled in-browser, so it is NOT copied here — this only
// emits ../webapp/vendor/*.esm.js. Run from app/: npm run build.
//
// You do NOT need this after editing a component. It exists only to refresh the
// vendored React/Sucrase bundles on a dependency bump.

import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, relative } from "node:path";
import { mkdir, rm, writeFile, copyFile } from "node:fs/promises";
import { build as esbuild } from "esbuild";

const APP = fileURLToPath(new URL(".", import.meta.url)); // this file lives at app/build.mjs
const WEBAPP = resolve(APP, "../webapp");
const VENDOR_OUT = resolve(WEBAPP, "vendor");
const FONTS_OUT = resolve(WEBAPP, "fonts");

// Inter is SELF-HOSTED, not loaded from rsms.me. sw.js deliberately passes
// cross-origin requests through untouched, so a CDN font is never cached: on an
// airgapped machine or behind a strict proxy the page stalls waiting on it
// before falling back to system sans — which defeats the point of a console
// that opens with no network at all on a warm cache.
// Only the weights the app actually uses (400 body, 600 headings/labels).
const INTER_WEIGHTS = ["400", "600"];

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

async function buildFonts() {
  await mkdir(FONTS_OUT, { recursive: true });
  for (const w of INTER_WEIGHTS) {
    const src = resolve(APP, `node_modules/@fontsource/inter/files/inter-latin-${w}-normal.woff2`);
    const dest = resolve(FONTS_OUT, `inter-latin-${w}-normal.woff2`);
    await copyFile(src, dest);
    console.log(`  vendored inter-latin-${w}-normal.woff2`);
  }
}

(async () => {
  console.log("build: cleaning webapp/vendor/ + webapp/fonts/…");
  await rm(VENDOR_OUT, { recursive: true, force: true });
  await rm(FONTS_OUT, { recursive: true, force: true });

  console.log("build: bundling vendor ESM…");
  await buildVendors();

  console.log("build: vendoring fonts…");
  await buildFonts();

  console.log("build: done ✓");
  console.log(`  webapp: ${relative(process.cwd(), WEBAPP)}`);
})();
