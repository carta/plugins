# Vendored files

Third-party libraries are checked in as minified bundles so the app runs with no network and no install step. The minified code is not hand-written; `app/build.mjs` produces it from the npm packages pinned in `app/package-lock.json`.

| File | What it is | Version | Upstream | Used for |
| --- | --- | --- | --- | --- |
| `react.esm.js` | React and ReactDOM in one ES module | 18.3.1 | [`react`](https://www.npmjs.com/package/react), [`react-dom`](https://www.npmjs.com/package/react-dom) on npm (MIT) | Rendering the UI. The import map in `index.html` points `react`, `react-dom`, `react-dom/client` and `react/jsx-runtime` here. |
| `sucrase.esm.js` | JSX transpiler | 3.35.1 | [`sucrase`](https://www.npmjs.com/package/sucrase) on npm (MIT) | `sw.js` uses it to turn the JSX in `src/` into JavaScript inside the browser. |

Both files are unmodified upstream code, bundled and minified with esbuild 0.28.1 (`npm run build` in `app/`).
