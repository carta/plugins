// Module service worker: transpiles same-origin .jsx modules with Sucrase on the
// fly. Everything else (/api/*, .js, /vendor/**, cross-origin) passes through.
//
// This is what lets app/src/*.jsx be the thing the browser actually loads. Without
// it the dashboard would need a Vite build after every source edit, and an edit
// that hadn't been rebuilt would render the previous bundle — looking correct
// while being wrong. See references/serve-and-update.md.

import { transform } from "./vendor/sucrase.esm.js";

// production:true drops StrictMode's dev double-invoke so paste-back logs stay clean.
const SUCRASE_OPTS = {
  transforms: ["jsx"],
  jsxRuntime: "automatic",
  production: true,
};

// Cache name encodes version+config; activate() deletes non-matching caches, so a
// bump or config flip forces a clean re-transpile.
const SUCRASE_VERSION = "3.35.1";
const CONFIG_TOKEN = "jsx-auto-prod-datasrc";
const CACHE_NAME = `manco-transpile-${SUCRASE_VERSION}-${CONFIG_TOKEN}`;

// Guard the top-level self.addEventListener(...) registrations: vitest imports
// this file directly to unit-test rewriteJsxRuntimeSpecifier, and `self` only
// exists in a browser/SW context.
const SW = typeof self !== "undefined" ? self : undefined;

if (SW) {
  SW.addEventListener("install", (e) => {
    e.waitUntil(SW.skipWaiting()); // take control on the same page load
  });

  SW.addEventListener("activate", (e) => {
    e.waitUntil(
      caches
        .keys()
        .then((names) =>
          Promise.all(
            names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)),
          ),
        )
        .then(() => SW.clients.claim()),
    );
  });

  SW.addEventListener("fetch", (e) => {
    const { request } = e;
    if (request.method !== "GET") return;
    if (!request.url.startsWith(SW.location.origin)) return;

    const url = new URL(request.url);
    if (!url.pathname.endsWith(".jsx")) return;
    if (url.pathname.includes("/vendor/")) return;

    e.respondWith(transpileJsx(url));
  });
}

async function transpileJsx(url) {
  const cache = await caches.open(CACHE_NAME);

  // no-store bypasses the HTTP cache so the SW hashes the on-disk source, not a
  // stale copy — edits are always visible.
  const sourceResp = await fetch(url.href, { cache: "no-store" });
  if (!sourceResp.ok) return sourceResp;

  const source = await sourceResp.text();
  const bodyHash = await hashText(source);

  // Cache API strips the fragment, so key on ?_b2=<hash> instead of #<hash>.
  const cacheUrl = new URL(url.href);
  cacheUrl.searchParams.set("_b2", bodyHash);

  const cached = await cache.match(cacheUrl.href);
  if (cached) return cached;

  let outputCode;
  try {
    outputCode = transform(source, {
      ...SUCRASE_OPTS,
      filePath: url.pathname,
    }).code;
  } catch (err) {
    // Export a default so static `import X from` links resolve, then throw with
    // file+line — the bootstrap catch renders it in the overlay.
    const msg = err.message || String(err);
    outputCode = `export default null;\nthrow new SyntaxError(${JSON.stringify(
      url.pathname + ": " + msg,
    )});`;
  }

  // Point the transpiled output's react/jsx-runtime import at this file's own
  // shim instance (carrying its source path via ?src=) instead of the shared
  // vendor runtime, so every rendered host element can be stamped with the
  // file that emitted it.
  outputCode = rewriteJsxRuntimeSpecifier(outputCode, appSrcPath(url.pathname));

  // no-cache so the browser re-consults the SW on reload instead of serving its
  // own HTTP-cached copy (which would skip the SW and miss edits).
  const response = new Response(outputCode, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
  await cache.put(cacheUrl.href, response.clone());
  return response;
}

// Pure — exported for unit tests. Sucrase's automatic JSX runtime emits
// `from "react/jsx-runtime"` (single or double quotes); redirect that to the
// per-file shim so its own ?src= carries this file's app-relative path.
export function rewriteJsxRuntimeSpecifier(code, srcPath) {
  // srcPath is the raw request pathname (appSrcPath does not decode it) —
  // the exact name serve.py resolved on disk, from a firm's own SRC_DIR,
  // which the firm's users and the chat agent can rename files in. It's
  // untrusted and must be both URL-encoded here (a "+", "&", "#" or '"' in
  // whatever escaping it already carries would otherwise corrupt the query
  // string or the emitted import statement) and substituted via a replacer
  // function rather than a template inside the replacement string (a literal
  // "$&"/"$'" in a filename would otherwise be read as a replacement
  // pattern). jsx-runtime-shim.js reads it back with
  // `new URL(import.meta.url).searchParams.get("src")`, which decodes it
  // once — matching the one encoding done here, so the round trip reproduces
  // serve.py's own raw pathname.
  return code.replace(
    /(from\s*)(["'])react\/jsx-runtime\2/g,
    (_m, from) => from + JSON.stringify("/jsx-runtime-shim.js?src=" + encodeURIComponent(srcPath)),
  );
}

// Maps a served request pathname to the repo-app-relative path pinpoint's
// change-target resolver expects. scripts/serve.py serves the canonical
// source tree (SRC_DIR, the firm's own per-firm copy — never the plugin's
// app/src) at /src/*, so /src/views/Overview.jsx is stamped as
// app/src/views/Overview.jsx: that "app/src/" is the convention chat_session.py's
// MANCO_APP_NOTE and anchor_preamble's strip_prefix expect, not a literal
// on-disk path. Anything else same-origin under .jsx falls back to the
// pathname with its leading slash stripped (webapp/ ships no .jsx).
//
// `pathname` is left exactly as the URL parser gave it (still whatever
// percent-encoding it carries), never decoded here: serve.py's do_GET also
// takes the raw request path with no unquoting (it has no SimpleHTTPRequestHandler
// decode step in its path), so the name served and the name stamped must stay
// byte-for-byte the same string, or the stamp names a file that isn't the one
// the browser actually requested.
export function appSrcPath(pathname) {
  return pathname.startsWith("/src/") ? `app${pathname}` : pathname.slice(1);
}

async function hashText(text) {
  const buf = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 12);
}
