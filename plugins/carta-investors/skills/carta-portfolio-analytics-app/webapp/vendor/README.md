# Vendored files

Third-party libraries are checked in as minified bundles so the console runs with no network and no install step. The minified code is not hand-written.

| File | What it is | Version | Upstream | Used for |
| --- | --- | --- | --- | --- |
| `react.esm.js` | React and ReactDOM in one ES module | 18.3.1 | [`react`](https://www.npmjs.com/package/react), [`react-dom`](https://www.npmjs.com/package/react-dom) on npm (MIT) | Rendering the UI. The import map in `index.html` points `react`, `react-dom`, `react-dom/client` and `react/jsx-runtime` here. |
| `sucrase.esm.js` | JSX transpiler | 3.35.1 | [`sucrase`](https://www.npmjs.com/package/sucrase) on npm (MIT) | `sw.js` uses it to turn the JSX in `src/` into JavaScript inside the browser. |
| `mcp-ui-tracker.global.js` | Carta's UI event tracker | 0.4.0 (waits for a host bridge that appears after the page script), plus the local edit below | Carta's `@carta/mcp-ui-tracker` package, maintained in Carta's internal frontend platform repository | Sets `window.mcpUiTracker`, which `app/src/analytics.js` uses to report UI events. |

`react.esm.js` and `sucrase.esm.js` are unmodified upstream code, minified with esbuild. They are byte-for-byte the same files as the ones in the `carta-fund-modeling` skill, which builds them from `package-lock.json` (React 18.3.1, Sucrase 3.35.1). This app's own `app/package-lock.json` pins React 18.3.1 and has no Sucrase entry.

`mcp-ui-tracker.global.js` is Carta's own code, not third-party. It is the package's browser build, with one local edit: its MCP tool calls add `_instrumentation_v2` with `from_ui: true` and this skill's name, so Carta can tell calls made by the UI from calls made by the model.
