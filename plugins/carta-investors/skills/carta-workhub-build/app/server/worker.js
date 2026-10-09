// Carta Workhub as a hosted micro-app: one Worker serving workhub.<label>.carta.cloud for
// every mapped firm. It serves the artifact's own resources/ — assembled the way
// scripts/build_artifact.py assembles the artifact — and stands in for the artifact
// runtime: the page's Carta calls arrive at /api/tool and leave from here, signed in as
// the visitor and held to the hostname's firm.
import { getBuild } from "./assemble.js";
import { getSession, handleAuthCallback, handleAuthLogin, handleAuthLogout, requireAuth, TokenExpired } from "./auth.js";
import { loginPage, noAccessPage, unavailablePage } from "./pages.js";
import { tenantFirm, tenantOf } from "./tenancy.js";
import { handleTool } from "./tools.js";

// The artifact runs under a CSP that blocks every host but Google Fonts; this keeps that.
// 'unsafe-inline' is for the template's onclick handlers. No 'unsafe-eval': the vendored
// pdf.js renders without it, and refusing eval closes its font-loading eval path.
const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");

const BUNDLE = /^\/b\/([0-9a-f]{8})\/(app|pdf)\.js$/;
const notFound = () => new Response("Not found", { status: 404 });

async function handlePage(req, env, tenant) {
  const [sid, session] = await getSession(req, env);
  if (!sid || !session) {
    return env.AUTH_MODE === "token" ? new Response("Open with ?t=<DASH_TOKEN>", { status: 401 }) : loginPage();
  }
  let firm;
  try {
    firm = await tenantFirm(tenant, sid, session, env);
  } catch (e) {
    return e instanceof TokenExpired ? loginPage() : unavailablePage();
  }
  if (!firm) return noAccessPage();
  const { page } = await getBuild(env);
  return new Response(page, {
    headers: {
      "Content-Type": "text/html;charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": PAGE_CSP,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
    },
  });
}

// Source the page loads, addressed by its content hash so a deploy never mixes two builds
// and the browser keeps the ~1.5 MB pdf.js between visits. The same files are public in the
// published plugin, so they need no session.
async function handleBundle(env, id, kind) {
  const bundle = (await getBuild(env)).bundles[kind];
  if (id !== bundle.id) return notFound();
  return new Response(bundle.body, {
    headers: {
      "Content-Type": "text/javascript;charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export default {
  async fetch(req, env) {
    try {
      const tenant = tenantOf(req, env);
      // A host with no firm (unmapped label, workers.dev, a bare IP) gets nothing, not
      // even the sign-in page.
      if (!tenant?.firmUuid) return notFound();
      const path = new URL(req.url).pathname;
      if (env.AUTH_MODE !== "token") {
        if (path === "/auth/login") return handleAuthLogin(req, env);
        if (path === "/auth/callback") return handleAuthCallback(req, env);
        if (path === "/auth/logout") return handleAuthLogout(req, env);
      }
      if (path === "/api/heartbeat") {
        const [, , authErr] = await requireAuth(req, env);
        return authErr || Response.json({ ok: true });
      }
      if (path === "/api/tool") return handleTool(req, env, tenant);
      const bundle = BUNDLE.exec(path);
      if (bundle) return handleBundle(env, bundle[1], bundle[2]);
      if (path === "/") return handlePage(req, env, tenant);
      return notFound();
    } catch (e) {
      console.error("[workhub] request failed:", e?.message);
      return Response.json({ error: "internal error" }, { status: 500 });
    }
  },
};
