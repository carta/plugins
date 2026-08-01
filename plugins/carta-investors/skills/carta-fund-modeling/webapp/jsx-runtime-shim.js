// Per-file jsx-runtime shim: sw.js rewrites each transpiled .jsx's
// `react/jsx-runtime` import to `/jsx-runtime-shim.js?src=<appRelativePath>`.
// Because module identity includes the query string, every importing file
// gets its own instance of this module — each with a distinct
// `import.meta.url` — so SRC below is that file's own source path, not a
// shared global.
//
// This module is served as a static .js (never transpiled by the SW) and
// imports the REAL jsx/jsxs/Fragment from the bare "react/jsx-runtime"
// specifier, which webapp/index.html's import map resolves to
// /vendor/react.esm.js. No loop: the SW only rewrites the specifier inside
// transpiled .jsx output, never inside this file.

import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";

const SRC = new URL(import.meta.url).searchParams.get("src") || "";

// Pure — exported for unit tests. Stamps data-source on host (string-typed)
// elements only; component-typed calls (type is a function/class) pass
// through untouched so data-source is never forwarded into a function
// component's props. Never mutates the input props object.
export function stampProps(type, props, src) {
  if (typeof type !== "string") return props;
  if (props && props["data-source"] != null) return props;
  return { ...props, "data-source": src };
}

export function jsx(type, props, key) {
  return _jsx(type, stampProps(type, props, SRC), key);
}

export function jsxs(type, props, key) {
  return _jsxs(type, stampProps(type, props, SRC), key);
}

export const Fragment = _Fragment;
