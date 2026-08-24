// Module service worker: transpiles same-origin .jsx modules with Sucrase on the
// fly. Everything else (/api/*, .js, /vendor/**, cross-origin) passes through.

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
// No "datasrc" here (fund-modeling's token includes it): this app does not do the
// jsx-runtime shim rewrite, so its transpiled output differs and must not share a
// cache entry with an app that does.
const CONFIG_TOKEN = "jsx-auto-prod";
// Namespaced `ctc-` (not `fm-`): both this app and fund-modeling serve from
// 127.0.0.1, so the Cache API storage is shared across ports on the same origin.
// A shared cache name would make each app's activate() handler delete the
// other's transpiled modules on every launch.
const CACHE_NAME = `ctc-transpile-${SUCRASE_VERSION}-${CONFIG_TOKEN}`;

// `self` only exists in a browser/SW context, so the top-level
// self.addEventListener(...) registrations are guarded — that keeps this
// module importable from a plain node/vitest environment. Runtime behavior
// in the actual service worker is unchanged.
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
            names
              .filter((n) => n !== CACHE_NAME)
              .map((n) => caches.delete(n)),
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
    outputCode = `export default null;\nthrow new SyntaxError(${JSON.stringify(url.pathname + ": " + msg)});`;
  }

  // No jsx-runtime rewrite here. fund-modeling redirects this import to a
  // per-file shim that stamps data-source onto every host element for its
  // "pinpoint" click-to-source feature; this app has no such feature, so the
  // bare "react/jsx-runtime" specifier resolves straight through index.html's
  // import map to the vendored React. Adding the shim back would only put
  // unused data-source attributes on every DOM node.

  // no-cache so the browser re-consults the SW on reload instead of serving its own
  // HTTP-cached copy (which would skip the SW and miss edits).
  const response = new Response(outputCode, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
  await cache.put(cacheUrl.href, response.clone());
  return response;
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
