# Vendored files

Third-party libraries are checked in as minified bundles so the dashboard runs with no network and no install step. The minified code is not hand-written; `app/build.mjs` produces it from the npm packages pinned in `app/package-lock.json`.

| File | What it is | Version | Upstream | Used for |
| --- | --- | --- | --- | --- |
| `react.esm.js` | React and ReactDOM in one ES module | 18.3.1 | [`react`](https://www.npmjs.com/package/react), [`react-dom`](https://www.npmjs.com/package/react-dom) on npm (MIT) | Rendering the UI. The import map in `index.html` points `react`, `react-dom`, `react-dom/client` and `react/jsx-runtime` here. |
| `sucrase.esm.js` | JSX transpiler | 3.35.1 | [`sucrase`](https://www.npmjs.com/package/sucrase) on npm (MIT) | `sw.js` uses it to turn the JSX in `src/` into JavaScript inside the browser. |
| `lucide-react.esm.js` | Icon components | 0.462.0 | [`lucide-react`](https://www.npmjs.com/package/lucide-react) on npm (ISC) | The sidebar and export icons. Only the icons the app imports are included. |
| `package.json` | Carta's own, one setting | n/a | n/a | Marks this folder as ES modules for Node, so the unit tests can import the bundles. |
| `mcp-ui-tracker.global.js` | Carta's UI event tracker | 0.2.0, plus the local edit below | Carta's `@carta/mcp-ui-tracker` package, maintained in Carta's internal frontend platform repository | Sets `window.mcpUiTracker`, which `app/src/analytics.js` uses to report UI events. |

`react.esm.js`, `sucrase.esm.js` and `lucide-react.esm.js` are unmodified upstream code, bundled and minified with esbuild 0.25.12 (`npm run build` in `app/`).

`mcp-ui-tracker.global.js` is Carta's own code, not third-party. It is the package's browser build, with one local edit: its MCP tool calls add `from_ui: true` to `_instrumentation_v2` so Carta can tell calls made by the UI from calls made by the model. `npm run build` keeps this file in place because it is not generated there.
