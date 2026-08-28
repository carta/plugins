# Vendored third-party sources

## pdf.js

| | |
|---|---|
| Package | [`pdfjs-dist`](https://www.npmjs.com/package/pdfjs-dist) 3.11.174 |
| Files | `legacy/build/pdf.min.js`, `legacy/build/pdf.worker.min.js` |
| Upstream | https://github.com/mozilla/pdf.js |
| Licence | Apache-2.0 — full text in `pdfjs-LICENSE` |
| Unmodified | Yes. Copied verbatim from the published tarball. |

`build_artifact.py` inlines both files into the artifact as plain `<script>` blocks.

**Why vendored rather than loaded from a CDN.** A published artifact runs under a CSP
that blocks every external host, so nothing can be fetched at runtime. Everything the
page needs has to be inside it.

**Why 3.11.174 rather than the current release.** It is the last version shipping a UMD
bundle. UMD is what makes the CSP-safe setup possible: both files assign
`globalThis.pdfjsLib` / `globalThis.pdfjsWorker`, and pdf.js then runs its parser on the
main thread instead of reaching for a worker it cannot load. From 4.x the builds are
ESM-only and the fake-worker path goes through a dynamic `import()`, which the sandbox
refuses. Do not bump this pin without re-testing a real notice inside a published
artifact.

**Why a PDF renderer at all.** The browser's own viewer is blocked in the artifact
sandbox — `<object>`, `<iframe src="data:application/pdf">` and `<embed src="blob:">`
all render nothing — so the page has to rasterise the document itself.
