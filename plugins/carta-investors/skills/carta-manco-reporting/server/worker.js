const MCP_BASE = "https://mcp.app.carta.com";
const MCP_URL = MCP_BASE + "/mcp";
const AUTH_URL = MCP_BASE + "/authorize";
const TOKEN_URL = MCP_BASE + "/token";
const REG_URL = MCP_BASE + "/register";
const SESSION_TTL = 86400;
const DATA_TTL = 3600;

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ── Utilities ──

function getCookie(req, name) {
  const h = req.headers.get("Cookie") || "";
  const m = h.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return m ? m[1] : null;
}

function sidCookie(sid, maxAge = SESSION_TTL) {
  return `sid=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

// Tokens sit in KV only as AES-GCM ciphertext. The key is a Worker secret (SESSION_KEY,
// base64 of 32 bytes), so read access to KV alone yields nothing usable. The KV key name is
// bound in as additional data, so a blob copied under another session's key will not open.
let sessionKeyCache = null;
async function sessionCryptoKey(env) {
  if (!env.SESSION_KEY) throw new Error("SESSION_KEY is not set");
  if (sessionKeyCache?.raw === env.SESSION_KEY) return sessionKeyCache.key;
  const bytes = Uint8Array.from(atob(env.SESSION_KEY), (c) => c.charCodeAt(0));
  if (bytes.length !== 32) throw new Error("SESSION_KEY must be 32 bytes, base64-encoded");
  const key = await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
  sessionKeyCache = { raw: env.SESSION_KEY, key };
  return key;
}
const toB64 = (bytes) => btoa(String.fromCharCode(...bytes));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export async function putSession(env, sid, session) {
  const name = `session:${sid}`;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await sessionCryptoKey(env);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(name) },
    key,
    new TextEncoder().encode(JSON.stringify(session)),
  );
  await env.SESSIONS.put(name, `v1.${toB64(iv)}.${toB64(new Uint8Array(ct))}`, { expirationTtl: 86400 });
}
// A missing, tampered, or pre-encryption (plaintext) entry reads as signed out.
export async function getStoredSession(env, sid) {
  const name = `session:${sid}`;
  const raw = await env.SESSIONS.get(name);
  if (!raw) return null;
  const [version, iv, ct] = raw.split(".");
  if (version !== "v1" || !iv || !ct) return null;
  const key = await sessionCryptoKey(env);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(iv), additionalData: new TextEncoder().encode(name) },
      key,
      fromB64(ct),
    );
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return null;
  }
}
function generateId() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Base64url(plain) {
  const data = new TextEncoder().encode(plain);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function getRedirectUri(req) {
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}/auth/callback`;
}

function slugify(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

function num(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

// ── Dynamic client registration (cached in KV) ──

async function ensureClient(env, redirectUri) {
  const cacheKey = `oauth_client:${redirectUri}`;
  const cached = await env.SESSIONS.get(cacheKey, "json");
  if (cached) return cached;
  const resp = await fetch(REG_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "ManCo Reporting Worker",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Client registration failed (${resp.status}): ${txt}`);
  }
  const client = await resp.json();
  await env.SESSIONS.put(cacheKey, JSON.stringify(client), { expirationTtl: 86400 * 30 });
  return client;
}

// ── Session & auth (dual-mode: OAuth or token) ──

async function getSession(req, env) {
  if (env.AUTH_MODE === "token") {
    const token = req.headers.get("X-Dash-Token") || new URL(req.url).searchParams.get("t");
    if (!token || token !== env.DASH_TOKEN) return [null, null];
    return ["local", { access_token: env.MCP_ACCESS_TOKEN || "local", local: true }];
  }
  const sid = getCookie(req, "sid");
  if (!sid) return [null, null];
  return [sid, await getStoredSession(env, sid)];
}

async function refreshAccessToken(session, sid, env) {
  if (!session.refresh_token || !session.redirectUri) return null;
  const cached = await env.SESSIONS.get(`oauth_client:${session.redirectUri}`, "json");
  if (!cached) return null;
  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: session.refresh_token,
      client_id: cached.client_id,
    }),
  });
  if (!resp.ok) return null;
  const tokens = await resp.json();
  session.access_token = tokens.access_token;
  session.refresh_token = tokens.refresh_token || session.refresh_token;
  session.expires_at = Date.now() + (tokens.expires_in || 3600) * 1000;
  await putSession(env, sid, session);
  return tokens.access_token;
}

async function requireAuth(req, env) {
  const [sid, session] = await getSession(req, env);
  if (!sid || !session || !session.access_token) {
    return [null, null, Response.json({ error: "unauthorized" }, { status: 401 })];
  }
  let accessToken = session.access_token;
  if (session.expires_at && Date.now() > session.expires_at - 60_000) {
    const refreshed = await refreshAccessToken(session, sid, env);
    if (refreshed) accessToken = refreshed;
    else {
      await env.SESSIONS.delete(`session:${sid}`);
      return [null, null, Response.json({ error: "token_expired", action: "reauthenticate" }, { status: 401 })];
    }
  }
  return [sid, { ...session, access_token: accessToken }, null];
}

async function requireAuthThen(req, env, fn) {
  const [sid, session, err] = await requireAuth(req, env);
  if (err) return err;
  return fn(sid, session);
}

// ── MCP transport ──

async function mcpFetch(body, accessToken, sid, env) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${accessToken}`, // noqa: carta-cli-bypass — Cloudflare Worker, not a Claude session; CLI unavailable
  };
  const mcpSessionId = await env.SESSIONS.get(`mcp-session:${sid}`);
  if (mcpSessionId) headers["Mcp-Session-Id"] = mcpSessionId;
  return fetch(MCP_URL, { method: "POST", headers, body: JSON.stringify(body) });
}

function parseSseResponse(text) {
  const lines = text.split("\n");
  let last = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("data: ")) {
      try { last = JSON.parse(trimmed.slice(6)); } catch { /* skip */ }
    }
  }
  if (last) return last;
  try { return JSON.parse(text); } catch { return null; }
}

async function mcpCallTool(name, args, accessToken, sid, env) {
  const body = {
    jsonrpc: "2.0", id: generateId(), method: "tools/call",
    params: { name, arguments: args },
  };
  let resp = await mcpFetch(body, accessToken, sid, env);
  if (resp.status === 401) {
    const session = (await getStoredSession(env, sid)) || {};
    const refreshed = await refreshAccessToken(session, sid, env);
    if (refreshed) resp = await mcpFetch(body, refreshed, sid, env);
    else throw new Error("token_expired");
  }
  const msid = resp.headers.get("Mcp-Session-Id");
  if (msid) await env.SESSIONS.put(`mcp-session:${sid}`, msid, { expirationTtl: SESSION_TTL });
  if (!resp.ok) throw new Error(`MCP call failed: ${resp.status}`);
  const text = await resp.text();
  const parsed = parseSseResponse(text);
  if (!parsed) throw new Error("Failed to parse MCP response");
  return parsed.result || parsed;
}

// ── OAuth 2.1 + PKCE ──

async function handleAuthLogin(req, env) {
  const redirectUri = getRedirectUri(req);
  const client = await ensureClient(env, redirectUri);
  const sid = generateId();
  const verifier = generateId();
  const challenge = await sha256Base64url(verifier);
  const state = generateId();
  await env.SESSIONS.put(`pkce:${state}`, JSON.stringify({ verifier, sid, redirectUri }), { expirationTtl: 600 });
  const params = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    scope: "openid",
  });
  return Response.redirect(`${AUTH_URL}?${params}`, 302);
}

async function handleAuthCallback(req, env) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  if (error) return new Response(`OAuth error: ${error}`, { status: 400 });
  if (!code || !state) return new Response("Missing code or state", { status: 400 });
  const pkceRaw = await env.SESSIONS.get(`pkce:${state}`);
  if (!pkceRaw) return new Response("Invalid or expired state", { status: 400 });
  const { verifier, sid, redirectUri } = JSON.parse(pkceRaw);
  await env.SESSIONS.delete(`pkce:${state}`);
  const client = await ensureClient(env, redirectUri);
  const tokenResp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: client.client_id,
      code_verifier: verifier,
    }),
  });
  if (!tokenResp.ok) {
    const txt = await tokenResp.text();
    return new Response(`Token exchange failed: ${txt}`, { status: 502 });
  }
  const tokens = await tokenResp.json();
  const session = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + (tokens.expires_in || 3600) * 1000,
    userName: null,
    // ensureClient caches the client per redirect URI, so a refresh an hour
    // later needs the URI this session registered under.
    redirectUri,
  };
  await putSession(env, sid, session);
  try {
    const user = await mcpCallTool("get_current_user", {}, tokens.access_token, sid, env);
    if (user?.content?.[0]?.text) {
      const info = JSON.parse(user.content[0].text);
      session.userName = info.full_name || info.email || null;
      await putSession(env, sid, session);
    }
  } catch { /* non-fatal */ }
  return new Response(null, {
    status: 302,
    headers: { Location: "/", "Set-Cookie": sidCookie(sid) },
  });
}

async function handleAuthCheck(req, env) {
  const [sid, session] = await getSession(req, env);
  if (!sid || !session) return Response.json({ authenticated: false });
  return Response.json({ authenticated: true, expires_at: session.expires_at, userName: session.userName || null });
}

async function handleAuthLogout(req, env) {
  const sid = getCookie(req, "sid");
  if (sid) await env.SESSIONS.delete(`session:${sid}`);
  return new Response(null, {
    status: 302,
    headers: { Location: "/", "Set-Cookie": sidCookie("", 0) },
  });
}

// ── Login page ──

function loginPage() {
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in — Carta ManCo Reporting</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f8f8f8;color:#1a1a1a}
  .card{text-align:center;padding:48px 40px;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08);max-width:380px;width:100%}
  .mark{width:40px;height:40px;background:#1a1a1a;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px}
  .mark::after{content:"";width:8px;height:8px;background:#fff;border-radius:50%}
  h1{font-size:22px;font-weight:700;margin:0 0 8px}
  p{font-size:14px;color:#666;margin:0 0 28px}
  a{display:inline-block;padding:12px 32px;background:#1a1a1a;color:#fff;border-radius:8px;font-size:15px;font-weight:600;text-decoration:none}
  a:hover{background:#333}
</style></head><body>
<div class="card">
  <div class="mark"></div>
  <h1>ManCo Reporting</h1>
  <p>Sign in with your Carta account to continue.</p>
  <a href="/auth/login">Sign in with Carta</a>
</div>
</body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html;charset=utf-8" } });
}

// ── MCP proxy ──

async function handleMcpProxy(req, env) {
  const [sid, session, authErr] = await requireAuth(req, env);
  if (authErr) return authErr;
  const body = await req.json();
  let resp = await mcpFetch(body, session.access_token, sid, env);
  if (resp.status === 401) {
    const refreshed = await refreshAccessToken(session, sid, env);
    if (refreshed) resp = await mcpFetch(body, refreshed, sid, env);
    else {
      await env.SESSIONS.delete(`session:${getCookie(req, "sid")}`);
      return Response.json({ error: "token_expired", action: "reauthenticate" }, { status: 401 });
    }
  }
  const msid = resp.headers.get("Mcp-Session-Id");
  if (msid) await env.SESSIONS.put(`mcp-session:${sid}`, msid, { expirationTtl: SESSION_TTL });
  const responseHeaders = new Headers();
  responseHeaders.set("Content-Type", resp.headers.get("Content-Type") || "application/json");
  return new Response(resp.body, { status: resp.status, headers: responseHeaders });
}

async function handleMcpCall(req, env) {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const [sid, session, authErr] = await requireAuth(req, env);
  if (authErr) return authErr;
  const body = await req.json();
  const { tool, args } = body;
  if (!tool) return Response.json({ error: "missing tool" }, { status: 400 });
  try {
    const result = await mcpCallTool(tool, args || {}, session.access_token, sid, env);
    return Response.json({ ok: true, result });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 502 });
  }
}

// ── Tenants ──

const TENANT_ZONE = ".carta.cloud";

// {app}.{customer}.carta.cloud — the customer label picks the one firm UUID this
// hostname may read. An unmapped label gets a null UUID and is denied.
export function tenantOf(req, env) {
  const host = new URL(req.url).hostname;
  if (!host.endsWith(TENANT_ZONE)) return null;
  const labels = host.slice(0, -TENANT_ZONE.length).split(".");
  let tenants = {};
  try {
    tenants = JSON.parse(env.TENANTS || "{}");
  } catch {
    // an unparseable map denies every firm, which is the safe direction
  }
  const label = labels.length === 2 ? labels[1] : "";
  const uuid = Object.prototype.hasOwnProperty.call(tenants, label) ? tenants[label] : null;
  return { label, firmUuid: typeof uuid === "string" && uuid ? uuid.toLowerCase() : null };
}

function toolText(result) {
  const sc = result?.structuredContent;
  if (typeof sc?.result === "string") return sc.result;
  const text = (result?.content || []).filter((b) => b.type === "text").map((b) => b.text || "").join("\n");
  try {
    const j = JSON.parse(text);
    if (typeof j?.result === "string") return j.result;
  } catch {
    // plain text
  }
  return text;
}

// Carta keeps the active firm per user, so another session signed in as the same user can
// switch it while this request is fetching. Call this right before caching what was
// fetched: data pulled under another firm must never land under this firm's key.
function activeFirmId(result) {
  const sc = result?.structuredContent;
  if (sc?.active_firm_id) return sc.active_firm_id;
  for (const b of result?.content || []) {
    try {
      const v = JSON.parse(b.text);
      if (v?.active_firm_id) return v.active_firm_id;
    } catch {
      // plain text
    }
  }
  return parseFirms(result).find((f) => f.active)?.firmUuid || null;
}

export async function assertActiveFirm(firmUuid, session, sid, env) {
  const result = await mcpCallTool("list_contexts", {}, session.access_token, sid, env);
  if (String(activeFirmId(result) || "").toLowerCase() !== String(firmUuid).toLowerCase()) {
    throw new Error("The active firm changed while loading (another session switched it). Nothing was saved; reload to retry.");
  }
}

async function firmNameByUuid(firmUuid, session, sid, env) {
  const result = await mcpCallTool("list_contexts", { firm_uuid: firmUuid }, session.access_token, sid, env).catch(() => null);
  return parseFirms(result).find((f) => f.firmUuid?.toLowerCase() === firmUuid)?.name || "";
}

// A hostname's one firm. set_context is Carta's own access check: it switches to the
// firm for a user who holds it (or a staff user) and returns an ordinary "not found or
// not authorized" result, not an error, for anyone else. Allow and deny are cached per
// session, so one user's result never widens another's. A failed call is not cached.
export async function tenantFirm(tenant, sid, session, env) {
  if (!tenant?.firmUuid) return null;
  const key = `tenant-firm:${sid}:${tenant.firmUuid}`;
  const cached = await env.SESSIONS.get(key, "json");
  if (cached) return cached.denied ? null : cached;
  let result;
  try {
    result = await mcpCallTool("set_context", { firm_id: tenant.firmUuid }, session.access_token, sid, env);
  } catch {
    return null;
  }
  const m = /^Context set to firm:[ \t]*(.+)$/m.exec(toolText(result));
  let name = m ? m[1].trim() : "";
  // A staff user gets the id echoed back instead of the firm's name. The slug must
  // come from the name, so look it up.
  if (name.toLowerCase() === tenant.firmUuid) name = (await firmNameByUuid(tenant.firmUuid, session, sid, env)) || name;
  const firm = name
    ? { slug: slugify(name), name, firmUuid: tenant.firmUuid, firmId: null, active: true, funds: 0, navAsOf: null }
    : null;
  await env.SESSIONS.put(key, JSON.stringify(firm || { denied: true }), { expirationTtl: DATA_TTL });
  return firm;
}

export function parseFirms(result) {
  const firms = [];
  if (result?.structuredContent?.firms) {
    for (const f of result.structuredContent.firms) {
      firms.push({
        slug: slugify(f.firm_name || f.name),
        name: f.firm_name || f.name,
        firmId: f.carta_id || null,
        firmUuid: f.firm_id || f.firm_uuid,
        active: !!f.is_active,
      });
    }
  } else if (result?.content) {
    for (const block of result.content) {
      if (block.type !== "text") continue;
      const text = block.text || "";
      const matches = [...text.matchAll(/- (.+?) \(([0-9a-f-]{36})\)/g)];
      for (const m of matches) {
        firms.push({ slug: slugify(m[1]), name: m[1].replace(/\s*\(active\)\s*$/i, ""), firmUuid: m[2] });
      }
    }
  }
  return firms;
}

// The only way a firm gets read. Both the allow and the deny are cached per
// session, so one user's lookup can never widen another's access.
export async function authorizedFirm(req, slug, sid, session, env) {
  if (!slug) return null;
  const tenant = tenantOf(req, env);
  if (tenant) {
    const firm = await tenantFirm(tenant, sid, session, env);
    return firm && firm.slug === slug ? firm : null;
  }
  const key = `allowed-firm:${sid}:${slug}`;
  const cached = await env.SESSIONS.get(key, "json");
  if (cached) return cached.denied ? null : cached;
  let match = null;
  for (const args of [{}, { firm_name: slug.replace(/-/g, " ") }]) {
    const result = await mcpCallTool("list_contexts", args, session.access_token, sid, env).catch(() => null);
    match = parseFirms(result).find((f) => f.slug === slug && f.firmUuid) || null;
    if (match) break;
  }
  await env.SESSIONS.put(key, JSON.stringify(match || { denied: true }), { expirationTtl: DATA_TTL });
  return match;
}

function forbiddenFirm(slug) {
  return Response.json({ error: "forbidden", message: `No access to firm "${slug}".` }, { status: 403 });
}

async function handleAppConfig(req, env) {
  const tenant = tenantOf(req, env);
  if (!tenant) return Response.json({ defaultFirm: null });
  const [sid, session] = await getSession(req, env);
  if (!sid || !session?.access_token) return Response.json({ defaultFirm: null });
  const firm = await tenantFirm(tenant, sid, session, env);
  return Response.json({ defaultFirm: firm?.slug || null });
}

// ── Firms ──

async function handleFirms(req, env) {
  const [sid, session, authErr] = await requireAuth(req, env);
  if (authErr) return authErr;

  const tenant = tenantOf(req, env);
  if (tenant) {
    const firm = await tenantFirm(tenant, sid, session, env);
    return Response.json(firm ? [firm] : []);
  }

  const url = new URL(req.url);
  const query = url.searchParams.get("q") || "";

  const firmsKey = `firms:${sid}`;
  if (!query) {
    const cached = await env.SESSIONS.get(firmsKey, "json");
    if (cached) return Response.json(cached);
  }

  const args = query ? { firm_name: query } : {};
  try {
    const result = await mcpCallTool("list_contexts", args, session.access_token, sid, env);
    const firms = parseFirms(result);
    if (firms.length && !query) {
      await env.SESSIONS.put(firmsKey, JSON.stringify(firms), { expirationTtl: DATA_TTL });
    }
    return Response.json(firms);
  } catch (e) {
    console.error("list_contexts error:", e.message);
    return Response.json([]);
  }
}

// ── KV data helpers ──

function dataKey(prefix, sid, firm, suffix, env) {
  if (firm) return suffix ? `${prefix}:${firm}:${suffix}` : `${prefix}:${firm}`;
  return suffix ? `${prefix}:${sid}:${firm}:${suffix}` : `${prefix}:${sid}${firm ? `:${firm}` : ""}`;
}

async function handleDataKey(req, env, key) {
  const [sid, session, authErr] = await requireAuth(req, env);
  if (authErr) return authErr;
  const url = new URL(req.url);
  let firm = url.searchParams.get("firm") || "";
  if (!firm) {
    firm = await env.SESSIONS.get(`active-firm:${sid}`) || "";
  }
  if (firm && !await authorizedFirm(req, firm, sid, session, env)) return forbiddenFirm(firm);
  const kvKey = dataKey("data", sid, firm, key, env);
  const stored = await env.SESSIONS.get(kvKey);
  if (!stored) return Response.json({ error: "not_ready" });
  const raw = key === "snapshot" && firm ? await withUploadedBudget(stored, firm, env) : stored;
  const etag = `"${await sha256Base64url(raw)}"`;
  return new Response(req.method === "HEAD" ? null : raw, {
    headers: { "Content-Type": "application/json", ETag: etag, "Cache-Control": "no-store" },
  });
}

async function handleReport(req, env, path) {
  const [sid, session, authErr] = await requireAuth(req, env);
  if (authErr) return authErr;
  const match = path.match(/^\/api\/report\/([a-zA-Z0-9_-]+)\.json$/);
  if (!match) return Response.json({ error: "invalid report name" }, { status: 400 });
  const url = new URL(req.url);
  let firm = url.searchParams.get("firm") || "";
  if (!firm) {
    firm = await env.SESSIONS.get(`active-firm:${sid}`) || "";
  }
  if (firm && !await authorizedFirm(req, firm, sid, session, env)) return forbiddenFirm(firm);
  const kvKey = dataKey("data", sid, firm, `report-${match[1]}`, env);
  const data = await env.SESSIONS.get(kvKey, "json");
  if (data) return Response.json(data);
  return Response.json({ error: "not_ready" });
}

// ── Client budget upload ──
//
// A budget built locally from the client's own workbook (export_budget_bundle.py),
// uploaded as one JSON file. The Worker never parses a workbook: it checks the file
// belongs to this firm, stores it without a TTL, and lays it over the snapshot it serves.

// Not exported: the Workers runtime rejects any non-function export from the entry module.
const BUDGET_BUNDLE_SCHEMA = 1;
const MAX_BUNDLE_BYTES = 4 * 1024 * 1024;
const bundleKey = (firm) => `budget-bundle:${firm}`;
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

// Returns an error message, or null when the bundle may be stored for this firm.
export function validateBudgetBundle(b, firmUuid) {
  if (!isObj(b)) return "The file is not a budget bundle.";
  if (b.schema_version !== BUDGET_BUNDLE_SCHEMA) return `Unsupported schema_version ${JSON.stringify(b.schema_version)}; expected ${BUDGET_BUNDLE_SCHEMA}.`;
  if (String(b.firm_uuid || "").toLowerCase() !== String(firmUuid || "").toLowerCase()) return "This bundle was exported for a different firm.";
  if (!/^[A-Z]{3}$/.test(String(b.currency || ""))) return "The bundle has no currency.";
  if (typeof b.as_of !== "string" || !b.as_of) return "The bundle has no as_of date.";
  const budgets = b.budget?.budgets;
  if (!isObj(b.budget) || !Array.isArray(budgets) || !budgets.length) return "The bundle has no budgets.";
  for (const x of budgets) {
    if (!isObj(x) || typeof x.id !== "string" || !x.id || !Array.isArray(x.rows)) return "A budget in the bundle has no id or rows.";
  }
  if (b.varianceByCategory != null && !isObj(b.varianceByCategory)) return "varianceByCategory must be an object.";
  return null;
}

const uploadMeta = (rec) => ({
  uploadedAt: rec.uploadedAt, uploadedBy: rec.uploadedBy, exportedAt: rec.bundle.exported_at || null,
  asOf: rec.bundle.as_of, currency: rec.bundle.currency, workbook: rec.bundle.workbook || null,
});

// Replaces the snapshot's budget with the uploaded one. A bundle in another currency than
// the snapshot is left out: the two would sit side by side under one symbol.
async function withUploadedBudget(raw, firm, env) {
  const rec = await env.SESSIONS.get(bundleKey(firm), "json");
  if (!rec?.bundle) return raw;
  let snap;
  try { snap = JSON.parse(raw); } catch { return raw; }
  const meta = uploadMeta(rec);
  if (snap.currency && snap.currency !== rec.bundle.currency) {
    snap.budgetUpload = { ...meta, status: "currency_mismatch", snapshotCurrency: snap.currency };
  } else {
    snap.budget = rec.bundle.budget;
    snap.varianceByCategory = rec.bundle.varianceByCategory ?? null;
    snap.budgetUpload = { ...meta, status: "applied" };
  }
  return JSON.stringify(snap);
}

async function handleBudgetUpload(req, env) {
  const [sid, session, authErr] = await requireAuth(req, env);
  if (authErr) return authErr;
  const slug = new URL(req.url).searchParams.get("firm") || await env.SESSIONS.get(`active-firm:${sid}`) || "";
  const firm = await authorizedFirm(req, slug, sid, session, env);
  if (!firm) return forbiddenFirm(slug);
  const key = bundleKey(slug);

  if (req.method === "GET") {
    const rec = await env.SESSIONS.get(key, "json");
    return Response.json(rec?.bundle ? uploadMeta(rec) : null);
  }
  if (req.method === "DELETE") {
    await env.SESSIONS.delete(key);
    return Response.json({ ok: true });
  }
  if (req.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });

  // JSON content type makes a cross-site form post impossible without a CORS preflight.
  if (!String(req.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "bad_request", message: "Send the bundle as application/json." }, { status: 415 });
  }
  const text = await req.text();
  if (text.length > MAX_BUNDLE_BYTES) {
    return Response.json({ error: "too_large", message: "The bundle is over 4 MB." }, { status: 413 });
  }
  let bundle;
  try { bundle = JSON.parse(text); } catch {
    return Response.json({ error: "bad_request", message: "The file is not valid JSON." }, { status: 400 });
  }
  const problem = validateBudgetBundle(bundle, firm.firmUuid);
  if (problem) return Response.json({ error: "invalid_bundle", message: problem }, { status: 422 });

  const rec = { bundle, uploadedAt: new Date().toISOString(), uploadedBy: session.userName || null };
  await env.SESSIONS.put(key, JSON.stringify(rec));
  return Response.json({ ok: true, ...uploadMeta(rec) });
}

// ── DWH query helpers ──

function parseQueryRows(result) {
  const rows = [];
  if (!result?.content || result.isError) return rows;
  for (const block of result.content) {
    const text = (block.type === "text" ? block.text : block.resource?.text || "").trim();
    if (!text) continue;
    if (text.startsWith("[")) { try { return JSON.parse(text); } catch { /* fall through */ } }
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (t.startsWith("{")) { try { rows.push(JSON.parse(t)); } catch { /* skip */ } }
    }
  }
  return rows;
}

function col(row, name) {
  return row[name] ?? row[name.toLowerCase()] ?? row[name.toUpperCase()] ?? null;
}

// ── ManCo entity resolution ──

function isMancoEntity(e) {
  const check = (v) => String(v || "").toLowerCase();
  if (check(e.entity_type).includes("management")) return true;
  if (check(e.entity_type_string).includes("management")) return true;
  if (e.entity_type_enum === 4) return true;
  if (check(e.entity_classification?.value).includes("manco")) return true;
  if ((e.entity_types || []).some(t => check(t).includes("management"))) return true;
  return false;
}

// fa__list__entities returns its list as a JSON array, but the MCP layer can carry it as
// bare text, as {"result": "<array as a string>"} text, or in structuredContent.
export function entityRows(result) {
  const sc = result?.structuredContent;
  if (Array.isArray(sc?.entities)) return sc.entities;
  if (Array.isArray(sc?.result)) return sc.result;
  const texts = [];
  if (typeof sc?.result === "string") texts.push(sc.result);
  for (const b of result?.content || []) if (b.type === "text") texts.push(b.text || "");
  for (const text of texts) {
    let v;
    try { v = JSON.parse(text); } catch { continue; }
    if (typeof v?.result === "string") {
      try { v = JSON.parse(v.result); } catch { continue; }
    } else if (v?.result) {
      v = v.result;
    }
    if (Array.isArray(v)) return v;
    if (Array.isArray(v?.entities)) return v.entities;
  }
  return [];
}

export async function resolveMancoEntity(firmUuid, accessToken, sid, env) {
  // Never unfiltered: a firm with many funds and SPVs exceeds the tool's 40,000-character
  // response cap and the whole call fails. entity_types is a comma-separated string.
  const result = await mcpCallTool("fa__list__entities", { entity_types: "management_co" }, accessToken, sid, env);
  if (result?.isError) {
    // Carta refused the call. Say why, rather than reporting the firm as having no ManCo.
    const reason = (result.content || []).map((b) => b.text || "").join(" ").trim().slice(0, 300);
    throw new Error(`Carta could not list this firm's entities: ${reason || "no reason given"}`);
  }
  // The tool lists the caller's active firm, which Carta keeps per user, not per request:
  // another tab or app signed in as the same user can switch it between our set_context
  // and this call. Keep only this hostname's firm, and refuse another firm's entities.
  const all = entityRows(result);
  const listed = all.filter((e) => String(e.firm_id || "").toLowerCase() === String(firmUuid).toLowerCase());
  if (all.length && !listed.length) {
    throw new Error("Carta returned another firm's entities. The active firm was switched by another session; reload to retry.");
  }
  const hit = (listed.length ? listed.find(isMancoEntity) : mancoFromRows(result)) || null;
  if (!hit) {
    // Structure only, never entity names: this goes to the Worker log.
    const text = String(result?.content?.[0]?.text || "");
    console.error("no ManCo entity", JSON.stringify({
      listed: listed.length,
      types: [...new Set(listed.map((e) => e.entity_type_string ?? e.entity_type))],
      resultKeys: Object.keys(result || {}),
      isError: !!result?.isError,
      textStart: text.slice(0, 1),
      textLength: text.length,
    }));
  }
  return hit;
}

function mancoFromRows(result) {
  const rows = parseQueryRows(result);
  if (!rows.length && result?.content) {
    for (const block of result.content) {
      if (block.type !== "text") continue;
      try {
        const parsed = JSON.parse(block.text);
        if (Array.isArray(parsed)) return parsed.find(isMancoEntity) || null;
      } catch { /* try structuredContent */ }
    }
  }
  if (result?.structuredContent?.entities) {
    return result.structuredContent.entities.find(isMancoEntity) || null;
  }
  return rows.find(r => {
    const proxy = {
      entity_type: col(r, "ENTITY_TYPE"),
      entity_type_string: col(r, "ENTITY_TYPE_STRING"),
      entity_type_enum: col(r, "ENTITY_TYPE_ENUM"),
      entity_classification: { value: col(r, "ENTITY_CLASSIFICATION") },
      entity_types: col(r, "ENTITY_TYPES") || [],
    };
    return isMancoEntity(proxy);
  }) || null;
}

// ── Load firm data (SSE) ──

// Column list matches references/data-fetch.md Query A exactly, so normalizeRow
// and build_manco_datadir.py's norm_je_row read the same fields off the same names.
const EXPENSE_SQL = (mancoUuid, year, maxMo) => `SELECT
  JOURNAL_ENTRY_LINE_ID AS id, JOURNAL_ENTRY_GLUUID AS gluuid,
  EFFECTIVE_DATE AS date, MONTH(EFFECTIVE_DATE) AS mo,
  ACCOUNT_NAME AS account, ACCOUNT_TYPE AS acct_type,
  COALESCE(SUB_ACCOUNT_NAME, '') AS sub,
  COALESCE(SUB_ACCOUNT_TYPE, '') AS sub_code,
  AMOUNT AS amt,
  COALESCE(JOURNAL_ENTRY_DESCRIPTION, '') AS descr,
  COALESCE(VENDOR_NAME, '') AS vendor,
  COALESCE(VENDOR_TYPE, '') AS vendor_type,
  COALESCE(PARTNER_NAME, '') AS partner,
  COALESCE(EVENT_TYPE, '') AS event_type,
  COALESCE(REPORTING_TAGS, '') AS tags,
  COALESCE(TO_VARCHAR(REPORTING_TAGS_JSON), '') AS tags_json
FROM JOURNAL_ENTRIES
WHERE FUND_UUID = '${mancoUuid}'
  AND YEAR(EFFECTIVE_DATE) = ${year}
  AND MONTH(EFFECTIVE_DATE) <= ${maxMo}
  AND ACCOUNT_TYPE >= 5000
ORDER BY EFFECTIVE_DATE, ACCOUNT_TYPE, JOURNAL_ENTRY_LINE_ID
LIMIT 1000`;

// Same SELECT as Query A (see EXPENSE_SQL) with the income sign and band.
const INCOME_SQL = (mancoUuid, year, maxMo) => `SELECT
  JOURNAL_ENTRY_LINE_ID AS id, JOURNAL_ENTRY_GLUUID AS gluuid,
  EFFECTIVE_DATE AS date, MONTH(EFFECTIVE_DATE) AS mo,
  ACCOUNT_NAME AS account, ACCOUNT_TYPE AS acct_type,
  COALESCE(SUB_ACCOUNT_NAME, '') AS sub,
  COALESCE(SUB_ACCOUNT_TYPE, '') AS sub_code,
  -AMOUNT AS amt,
  COALESCE(JOURNAL_ENTRY_DESCRIPTION, '') AS descr,
  COALESCE(VENDOR_NAME, '') AS vendor,
  COALESCE(VENDOR_TYPE, '') AS vendor_type,
  COALESCE(PARTNER_NAME, '') AS partner,
  COALESCE(EVENT_TYPE, '') AS event_type,
  COALESCE(REPORTING_TAGS, '') AS tags,
  COALESCE(TO_VARCHAR(REPORTING_TAGS_JSON), '') AS tags_json
FROM JOURNAL_ENTRIES
WHERE FUND_UUID = '${mancoUuid}'
  AND YEAR(EFFECTIVE_DATE) = ${year}
  AND MONTH(EFFECTIVE_DATE) <= ${maxMo}
  AND ACCOUNT_TYPE >= 4000 AND ACCOUNT_TYPE < 5000
ORDER BY EFFECTIVE_DATE, ACCOUNT_TYPE, JOURNAL_ENTRY_LINE_ID
LIMIT 1000`;

const FUND_FEE_SQL = (firmUuid, mancoUuid, year, maxMo) => `SELECT
  JOURNAL_ENTRY_LINE_ID AS id, JOURNAL_ENTRY_GLUUID AS gluuid,
  FUND_NAME AS fund, FUND_UUID AS fund_uuid,
  EFFECTIVE_DATE AS date, YEAR(EFFECTIVE_DATE) AS yr, MONTH(EFFECTIVE_DATE) AS mo,
  ACCOUNT_NAME AS account, ACCOUNT_TYPE AS acct_type,
  COALESCE(SUB_ACCOUNT_NAME, '') AS sub,
  COALESCE(SUB_ACCOUNT_TYPE, '') AS sub_code,
  AMOUNT AS amt,
  COALESCE(JOURNAL_ENTRY_DESCRIPTION, '') AS descr,
  COALESCE(VENDOR_NAME, '') AS vendor,
  COALESCE(VENDOR_TYPE, '') AS vendor_type,
  COALESCE(PARTNER_NAME, '') AS partner,
  COALESCE(EVENT_TYPE, '') AS event_type,
  COALESCE(REPORTING_TAGS, '') AS tags,
  COALESCE(TO_VARCHAR(REPORTING_TAGS_JSON), '') AS tags_json
FROM JOURNAL_ENTRIES
WHERE FIRM_ID = '${firmUuid}'
  AND FUND_UUID != '${mancoUuid}'
  AND YEAR(EFFECTIVE_DATE) BETWEEN ${year - 5} AND ${year}
  AND MONTH(EFFECTIVE_DATE) <= ${maxMo}
  AND ACCOUNT_TYPE >= 5000
  AND (LOWER(ACCOUNT_NAME) LIKE '%management fee%' OR LOWER(ACCOUNT_NAME) LIKE '%mgmt fee%')
ORDER BY yr DESC, EFFECTIVE_DATE, JOURNAL_ENTRY_LINE_ID
LIMIT 1000`;

const CURRENCY_SQL = (mancoUuid) => `SELECT fund_reporting_currency AS currency
FROM FUND_ADMIN.AGGREGATE_FUND_METRICS
WHERE fund_uuid = '${mancoUuid}'
QUALIFY ROW_NUMBER() OVER (PARTITION BY fund_uuid ORDER BY month_end_date DESC, last_refreshed_at DESC) = 1`;

async function handleLoadFirm(req, env) {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const [sid, session, authErr] = await requireAuth(req, env);
  if (authErr) return authErr;

  const { slug } = await req.json();
  if (!slug) return Response.json({ error: "missing slug" }, { status: 400 });

  const meta = await authorizedFirm(req, slug, sid, session, env);
  if (!meta?.firmUuid) return forbiddenFirm(slug);

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const send = (data) => writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

  const run = async () => {
    try {
      await send({ step: "Setting firm context" });
      await mcpCallTool("set_context", { firm_id: meta.firmUuid }, session.access_token, sid, env);

      // Resolve ManCo entity
      await send({ step: "Finding ManCo entity" });
      const mancoEntity = await resolveMancoEntity(meta.firmUuid, session.access_token, sid, env);
      const mancoUuid = mancoEntity?.fund_uuid || mancoEntity?.uuid || mancoEntity?.FUND_UUID || null;
      const mancoName = mancoEntity?.fund_name || mancoEntity?.name || mancoEntity?.FUND_NAME || meta.name;
      const mancoFundId = mancoEntity?.id || mancoEntity?.fund_id || null;

      if (!mancoUuid) {
        await send({ step: "Error", error: "No ManCo entity found for this firm." });
        await writer.close();
        return;
      }

      const now = new Date();
      const year = now.getFullYear();
      const maxMo = now.getMonth() + 1;
      const asOf = now.toISOString().slice(0, 10);

      // Query expenses
      await send({ step: "Querying ManCo expenses" });
      const expenseResult = await mcpCallTool("dwh__execute__query", {
        sql: EXPENSE_SQL(mancoUuid, year, maxMo), limit: 1000, format: "ndjson",
      }, session.access_token, sid, env).catch(e => { console.error("Expense query error:", e.message); return null; });

      // Query income
      await send({ step: "Querying ManCo income" });
      const incomeResult = await mcpCallTool("dwh__execute__query", {
        sql: INCOME_SQL(mancoUuid, year, maxMo), limit: 1000, format: "ndjson",
      }, session.access_token, sid, env).catch(e => { console.error("Income query error:", e.message); return null; });

      // Query fund fees
      await send({ step: "Querying fund fee data" });
      const fundFeeResult = await mcpCallTool("dwh__execute__query", {
        sql: FUND_FEE_SQL(meta.firmUuid, mancoUuid, year, maxMo), limit: 1000, format: "ndjson",
      }, session.access_token, sid, env).catch(e => { console.error("Fund fee query error:", e.message); return null; });

      // Query currency
      await send({ step: "Resolving currency" });
      const currencyResult = await mcpCallTool("dwh__execute__query", {
        sql: CURRENCY_SQL(mancoUuid), limit: 1, format: "ndjson",
      }, session.access_token, sid, env).catch(() => null);

      // Cash balance. firm_uuid, as_of_date and entity_ids are all required —
      // an empty or partial call fails Pydantic validation (references/data-fetch.md).
      await send({ step: "Fetching cash balance" });
      let cashData = null;
      try {
        cashData = await mcpCallTool("fa__get__cash-balance", {
          firm_uuid: meta.firmUuid, as_of_date: asOf, entity_ids: [mancoFundId],
        }, session.access_token, sid, env);
      } catch (e) { console.error("Cash balance error:", e.message); }

      // fa__list__budgets takes one month per call. Twelve round trips in
      // series spend seconds of the Worker's 30s budget waiting on I/O.
      await send({ step: "Loading budget data" });
      const budgetByAccount = {};
      const budgetMonths = await Promise.all(
        Array.from({ length: 12 }, (_, i) => {
          const mo = i + 1;
          const mm = String(mo).padStart(2, "0");
          const lastDay = new Date(year, mo, 0).getDate();
          return mcpCallTool(
            "fa__list__budgets",
            { fund_uuid: mancoUuid, start_date: `${year}-${mm}-01`, end_date: `${year}-${mm}-${String(lastDay).padStart(2, "0")}` },
            session.access_token, sid, env,
          ).catch((e) => { console.error(`Budget month ${mo} error:`, e.message); return null; });
        }),
      );
      for (let mo = 1; mo <= 12; mo++) {
        try {
          const result = budgetMonths[mo - 1];
          if (!result) continue;
          const budgets = result?.structuredContent?.budgets || [];
          if (!budgets.length && result?.content) {
            for (const block of result.content) {
              if (block.type !== "text") continue;
              try {
                const parsed = JSON.parse(block.text);
                const rows = parsed?.budgets || (Array.isArray(parsed) ? parsed : []);
                for (const r of rows) {
                  const name = r.account_name || r.ACCOUNT_NAME;
                  if (!name) continue;
                  if (!budgetByAccount[name]) budgetByAccount[name] = { monthly: new Array(12).fill(0), type: r.account_type || r.ACCOUNT_TYPE || null };
                  budgetByAccount[name].monthly[mo - 1] += num(r.amount || r.AMOUNT);
                }
              } catch { /* skip */ }
            }
          } else {
            for (const r of budgets) {
              const name = r.account_name || r.ACCOUNT_NAME;
              if (!name) continue;
              if (!budgetByAccount[name]) budgetByAccount[name] = { monthly: new Array(12).fill(0), type: r.account_type || r.ACCOUNT_TYPE || null };
              budgetByAccount[name].monthly[mo - 1] += num(r.amount || r.AMOUNT);
            }
          }
        } catch (e) { console.error(`Budget month ${mo} error:`, e.message); }
      }

      await send({ step: "Building snapshot" });
      const expenseRows = parseQueryRows(expenseResult);
      const incomeRows = parseQueryRows(incomeResult);
      const fundFeeRows = parseQueryRows(fundFeeResult);
      const currencyRows = parseQueryRows(currencyResult);

      // Null when the lookup found nothing. Naming a currency we did not read
      // mislabels every figure for a ManCo reporting in another one.
      const currency = currencyRows[0]?.currency || currencyRows[0]?.CURRENCY || null;
      const monthLabels = MONTH_LABELS.slice(0, maxMo);

      const { snapshot, accounts } = buildData({
        meta, mancoName, mancoUuid, mancoFundId, asOf, year, maxMo,
        monthLabels, currency, expenseRows, incomeRows, fundFeeRows, cashData,
        budgetByAccount,
      });

      await assertActiveFirm(meta.firmUuid, session, sid, env);
      await send({ step: "Storing data" });
      const snapshotKey = dataKey("data", sid, slug, "snapshot", env);
      const accountsKey = dataKey("data", sid, slug, "accounts", env);
      await env.SESSIONS.put(snapshotKey, JSON.stringify(snapshot), { expirationTtl: DATA_TTL });
      await env.SESSIONS.put(accountsKey, JSON.stringify(accounts), { expirationTtl: DATA_TTL });
      await env.SESSIONS.put(`active-firm:${sid}`, slug, { expirationTtl: DATA_TTL });

      await send({ step: "Done", done: true });
    } catch (e) {
      console.error("load-firm error:", e.message);
      await send({ step: "Error", error: e.message });
    } finally {
      await writer.close();
    }
  };
  run();

  return new Response(readable, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" },
  });
}

// ── Data assembly (JS port of essential build_manco_datadir.py logic) ──

export function normalizeRow(r) {
  return {
    id: col(r, "ID") || col(r, "id"),
    gluuid: col(r, "GLUUID") || col(r, "gluuid") || "",
    date: String(col(r, "DATE") || col(r, "date") || ""),
    mo: num(col(r, "MO") || col(r, "mo")),
    account: col(r, "ACCOUNT") || col(r, "account") || "",
    acctType: num(col(r, "ACCT_TYPE") || col(r, "acct_type")),
    sub: col(r, "SUB") || col(r, "sub") || "",
    subCode: col(r, "SUB_CODE") || col(r, "sub_code") || "",
    amount: num(col(r, "AMT") || col(r, "amt")),
    descr: col(r, "DESCR") || col(r, "descr") || "",
    vendor: col(r, "VENDOR") || col(r, "vendor") || "",
    vendorType: col(r, "VENDOR_TYPE") || col(r, "vendor_type") || "",
    partner: col(r, "PARTNER") || col(r, "partner") || "",
    eventType: col(r, "EVENT_TYPE") || col(r, "event_type") || "",
    tags: col(r, "TAGS") || col(r, "tags") || "",
    tagsJson: col(r, "TAGS_JSON") || col(r, "tags_json") || "",
  };
}

export function normalizeFeeRow(r) {
  return {
    id: col(r, "ID") || col(r, "id"),
    gluuid: col(r, "GLUUID") || col(r, "gluuid") || "",
    fund: col(r, "FUND") || col(r, "fund") || "",
    fundUuid: col(r, "FUND_UUID") || col(r, "fund_uuid") || "",
    date: String(col(r, "DATE") || col(r, "date") || ""),
    yr: num(col(r, "YR") || col(r, "yr")),
    mo: num(col(r, "MO") || col(r, "mo")),
    account: col(r, "ACCOUNT") || col(r, "account") || "",
    acctType: num(col(r, "ACCT_TYPE") || col(r, "acct_type")),
    sub: col(r, "SUB") || col(r, "sub") || "",
    subCode: col(r, "SUB_CODE") || col(r, "sub_code") || "",
    amount: num(col(r, "AMT") || col(r, "amt")),
    descr: col(r, "DESCR") || col(r, "descr") || "",
    vendor: col(r, "VENDOR") || col(r, "vendor") || "",
    vendorType: col(r, "VENDOR_TYPE") || col(r, "vendor_type") || "",
    partner: col(r, "PARTNER") || col(r, "partner") || "",
    eventType: col(r, "EVENT_TYPE") || col(r, "event_type") || "",
    tags: col(r, "TAGS") || col(r, "tags") || "",
    tagsJson: col(r, "TAGS_JSON") || col(r, "tags_json") || "",
  };
}

// Port of build_manco_datadir.py's _parse_tags: prefers the structured
// REPORTING_TAGS_JSON column, falls back to the flat comma-separated string.
export function parseTags(row) {
  const rawJson = String(row.tagsJson || "").trim();
  if (rawJson && !["null", "{}", "[]"].includes(rawJson)) {
    try {
      const obj = JSON.parse(rawJson);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        const pairs = [];
        for (const [cat, val] of Object.entries(obj)) {
          if (val == null) continue;
          if (Array.isArray(val)) {
            for (const v of val) {
              if (v != null && String(v).trim()) pairs.push({ category: String(cat), value: String(v) });
            }
          } else {
            const s = String(val).trim();
            if (s) pairs.push({ category: String(cat), value: s });
          }
        }
        if (pairs.length) return pairs;
      }
    } catch { /* fall through to flat parsing */ }
  }
  const flat = String(row.tags || "").trim();
  if (!flat) return [];
  return flat.split(",").map(v => v.trim()).filter(Boolean).map(value => ({ category: "", value }));
}

function buildBudget(budgetByAccount, maxMo, year) {
  if (!budgetByAccount || !Object.keys(budgetByAccount).length) return null;
  const mo = Math.max(1, Math.min(12, maxMo));
  let incomeYtd = 0, expensesYtd = 0, incomeAnn = 0, expensesAnn = 0;
  const rows = [];
  for (const [name, a] of Object.entries(budgetByAccount).sort((x, y) => x[0].localeCompare(y[0]))) {
    if (!a.monthly.some(v => v !== 0)) continue;
    const annual = round2(a.monthly.reduce((s, v) => s + v, 0));
    const ytd = round2(a.monthly.slice(0, mo).reduce((s, v) => s + v, 0));
    const isIncome = String(a.type || "").startsWith("4");
    if (isIncome) { incomeYtd += ytd; incomeAnn += annual; }
    else { expensesYtd += ytd; expensesAnn += annual; }
    rows.push({
      label: name, account_type: a.type,
      gl_codes: a.type != null ? [a.type] : [],
      annual: round2(annual), budget_ytd: round2(ytd),
      monthly: a.monthly.map(round2),
    });
  }
  const netYtd = round2(incomeYtd - expensesYtd);
  const netAnn = round2(incomeAnn - expensesAnn);
  const budget = {
    income_ytd: round2(incomeYtd), expenses_ytd: round2(expensesYtd),
    income_annual: round2(incomeAnn), expenses_annual: round2(expensesAnn),
    per_account: Object.fromEntries(rows.map(r => [r.label, r.budget_ytd])),
    rows, source: "carta-fa-list-budgets",
    view_kinds: ["by-account"], by_tag_value: null,
    id: "primary", label: `Budget FY${year}`,
  };
  return {
    income:   { annual: round2(incomeAnn),   ytd: round2(incomeYtd) },
    expenses: { annual: round2(expensesAnn), ytd: round2(expensesYtd) },
    net:      { annual: netAnn,              ytd: netYtd },
    budgets: [budget],
  };
}

// One journal-entry line, in the shape build_manco_datadir.py's norm_je_row
// writes to accounts.json entries — the app reads e.mo/e.sub/e.tags directly.
function toEntry(r, kind) {
  return {
    id: r.id,
    gluuid: r.gluuid || null,
    date: r.date,
    mo: r.mo,
    account: r.account,
    acct_type: r.acctType,
    sub: r.sub || null,
    sub_code: r.subCode || null,
    amount: round2(r.amount),
    vendor: r.vendor || null,
    vendor_type: r.vendorType || null,
    partner: r.partner || null,
    description: r.descr,
    event_type: r.eventType || null,
    tags: parseTags(r),
    kind,
  };
}

// Fund-side management fee line, matching build_manco_datadir.py's
// fund_fee_entries (`yr`/`mo`/`sub`, not `year`/`month`/`sub_account`).
function toFeeEntry(r) {
  return {
    id: r.id,
    gluuid: r.gluuid || null,
    fund: r.fund,
    fund_uuid: r.fundUuid,
    date: r.date,
    yr: r.yr,
    mo: r.mo,
    account: r.account,
    acct_type: r.acctType,
    sub: r.sub || null,
    sub_code: r.subCode || null,
    amount: round2(r.amount),
    description: r.descr,
    vendor: r.vendor || null,
    vendor_type: r.vendorType || null,
    partner: r.partner || null,
    event_type: r.eventType || null,
    tags: parseTags(r),
  };
}

// The cash block when there is no balance to report. `balance` is null, never
// 0 — the app renders null as "—", and data Carta doesn't have is not a ManCo
// holding nothing.
function cashUnavailable(reason, currency) {
  return { balance: null, currency: currency ?? null, by_currency: [], accounts: [], stale_account_count: 0, unavailable_reason: reason };
}

function extractCashPayload(cashData) {
  if (Array.isArray(cashData?.structuredContent?.entities)) return cashData.structuredContent;
  for (const block of cashData?.content || []) {
    if (block.type !== "text") continue;
    try {
      const parsed = JSON.parse(block.text);
      if (Array.isArray(parsed?.entities)) return parsed;
    } catch { /* try the next block */ }
  }
  return null;
}

// Port of build_manco_datadir.py's read_cash_balance: picks the ManCo entity
// out of fa__get__cash-balance's response and shapes it the app expects.
// Never sums across currencies (this repo's CLAUDE.md Currencies rule).
export function buildCashBalance(cashData, mancoEntityId, currency) {
  if (!cashData) return cashUnavailable("not-fetched", currency);
  const data = extractCashPayload(cashData);
  if (!data) return cashUnavailable("unreadable", currency);

  const entities = data.entities || [];
  let entity = entities.find(e => mancoEntityId != null && e.entity_id === mancoEntityId) || null;
  // mancoEntityId is optional, and the fetch filters to the ManCo, so a
  // response holding exactly one entity is unambiguous without it.
  if (!entity && mancoEntityId == null && entities.length === 1) entity = entities[0];
  if (!entity) return cashUnavailable("entity-not-in-response", currency);

  const byCurrency = [];
  for (const t of entity.totals_by_currency || []) {
    const code = String(t.currency_code || "").trim().toUpperCase();
    const amount = Number(t.total_balance);
    if (code && Number.isFinite(amount)) byCurrency.push({ currency_code: code, total_balance: round2(amount) });
  }

  const accounts = [];
  let staleCount = 0;
  for (const a of entity.bank_accounts || []) {
    const balance = Number(a.balance);
    const isStale = !!a.is_stale;
    if (isStale) staleCount++;
    accounts.push({
      bank_name: a.bank_name ?? null,
      account_name: a.account_name ?? null,
      balance: Number.isFinite(balance) ? round2(balance) : null,
      currency_code: String(a.currency_code || "").trim().toUpperCase() || null,
      is_manual: !!a.is_manual,
      is_stale: isStale,
      staleness_days: a.staleness_days ?? null,
      as_of_date: a.as_of_date ?? null,
    });
  }

  if (!byCurrency.length) return cashUnavailable("no-bank-accounts", currency);

  // With no reporting currency to match against, a single-currency ManCo is
  // unambiguous — its one total is the answer, and it names its own currency.
  if (currency == null && byCurrency.length === 1) {
    const only = byCurrency[0];
    return { balance: only.total_balance, currency: only.currency_code, by_currency: byCurrency, accounts, stale_account_count: staleCount, unavailable_reason: null };
  }

  const match = byCurrency.find(t => t.currency_code === currency) || null;
  if (!match) {
    return { balance: null, currency, by_currency: byCurrency, accounts, stale_account_count: staleCount, unavailable_reason: "currency-mismatch" };
  }
  return { balance: match.total_balance, currency, by_currency: byCurrency, accounts, stale_account_count: staleCount, unavailable_reason: null };
}

export function buildData({ meta, mancoName, mancoUuid, mancoFundId, asOf, year, maxMo, monthLabels, currency, expenseRows, incomeRows, fundFeeRows, cashData, budgetByAccount }) {
  const expenses = expenseRows.map(normalizeRow);
  const income = incomeRows.map(normalizeRow);
  const allRows = [...expenses, ...income];
  const months = maxMo;

  // Per-account rollup
  const acctMap = {};
  for (const r of allRows) {
    if (!acctMap[r.account]) {
      acctMap[r.account] = { monthly: new Array(months).fill(0), total: 0, count: 0, type: r.acctType, glGroup: r.acctType >= 5000 ? "expense" : "income" };
    }
    const a = acctMap[r.account];
    if (r.mo >= 1 && r.mo <= months) a.monthly[r.mo - 1] += r.amount;
    a.total += r.amount;
    a.count++;
  }

  const accountsList = Object.entries(acctMap).map(([name, a]) => ({
    name, type: a.type, gl_group: a.glGroup,
    ytd_total: round2(a.total),
    monthly: a.monthly.map(round2),
    entry_count: a.count,
    top_vendors: [], top_tags: [], top_partners: [],
  }));
  accountsList.sort((a, b) => (a.gl_group !== "expense" ? 1 : 0) - (b.gl_group !== "expense" ? 1 : 0) || b.ytd_total - a.ytd_total);

  // Top 8 expense categories + Other
  const expenseAccounts = accountsList.filter(a => a.gl_group === "expense");
  const top8 = expenseAccounts.slice(0, 8);
  const categories = top8.map(a => ({ name: a.name, data: a.monthly }));
  const otherMonthly = new Array(months).fill(0);
  for (const a of expenseAccounts.slice(8)) {
    for (let i = 0; i < months; i++) otherMonthly[i] += a.monthly[i];
  }
  if (otherMonthly.some(v => v !== 0)) {
    categories.push({ name: "Other", data: otherMonthly.map(round2) });
  }

  // Monthly cashflow
  const mIncome = new Array(months).fill(0);
  const mExpense = new Array(months).fill(0);
  for (const r of income) if (r.mo >= 1 && r.mo <= months) mIncome[r.mo - 1] += r.amount;
  for (const r of expenses) if (r.mo >= 1 && r.mo <= months) mExpense[r.mo - 1] += r.amount;

  // YTD totals
  const ytdIncome = round2(income.reduce((s, r) => s + r.amount, 0));
  const ytdExpense = round2(expenses.reduce((s, r) => s + r.amount, 0));

  // Spend by GL (for drill-down links)
  const spendByGL = {};
  for (const r of expenses) {
    if (!spendByGL[r.account]) spendByGL[r.account] = { ytd: 0 };
    spendByGL[r.account].ytd += r.amount;
  }
  for (const k of Object.keys(spendByGL)) spendByGL[k].ytd = round2(spendByGL[k].ytd);

  // Fee schedule (fund fees)
  const fees = fundFeeRows.map(normalizeFeeRow);
  const fundTotals = {};
  const fundNames = {};
  const fundMonthly = {};
  for (const r of fees) {
    if (!fundTotals[r.fundUuid]) {
      fundTotals[r.fundUuid] = 0;
      fundNames[r.fundUuid] = r.fund;
      fundMonthly[r.fundUuid] = new Array(months).fill(0);
    }
    fundTotals[r.fundUuid] += r.amount;
    if (r.yr === year && r.mo >= 1 && r.mo <= months) {
      fundMonthly[r.fundUuid][r.mo - 1] += r.amount;
    }
  }
  const fundEntries = Object.entries(fundTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([uuid, total]) => ({
      name: fundNames[uuid], uuid,
      ytdFees: round2(total),
      data: (fundMonthly[uuid] || []).map(round2),
    }));

  // Cash balance. Query D (currency, above) is empty for a ManCo not in
  // AGGREGATE_FUND_METRICS; cash then names the currency only when it holds
  // exactly one (never assumed USD — this repo's CLAUDE.md Currencies rule).
  const cash = buildCashBalance(cashData, mancoFundId, currency);
  if (currency == null) currency = cash.currency;

  // Entries for drill-downs — same key set and types as norm_je_row in
  // build_manco_datadir.py, so the app's e.mo/e.sub/e.tags reads work hosted too.
  const entries = [
    ...expenses.map(r => toEntry(r, "expense")),
    ...income.map(r => toEntry(r, "income")),
  ];

  const fundFeeEntries = fees.map(toFeeEntry);

  const snapshot = {
    firmName: meta.name,
    cartaIds: {
      firm: meta.firmId,
      manco_fund: mancoFundId,
    },
    asOf,
    currency,
    ops: {
      total_income: ytdIncome,
      total_expenses: ytdExpense,
      net: round2(ytdIncome - ytdExpense),
    },
    monthlyCashflow: {
      labels: monthLabels,
      income: mIncome.map(round2),
      expenses: mExpense.map(round2),
    },
    spendByGL,
    feeSchedule: {
      labels: monthLabels,
      funds: fundEntries,
    },
    cash,
    budget: buildBudget(budgetByAccount, maxMo, year),
  };

  const accountsData = {
    accounts: accountsList,
    monthly_categories: { labels: monthLabels, categories },
    entries,
    fund_fee_entries: fundFeeEntries,
    manco_fee_entries: [],
    fee_schedule_terms: [],
  };

  return { snapshot, accounts: accountsData };
}

// ── Main fetch handler ──

export default {
  async fetch(req, env) {
    try {
      const url = new URL(req.url);
      const path = url.pathname;

      // Auth routes (disabled in token mode)
      if (env.AUTH_MODE !== "token") {
        if (path === "/auth/login") return handleAuthLogin(req, env);
        if (path === "/auth/callback") return handleAuthCallback(req, env);
        if (path === "/auth/check") return handleAuthCheck(req, env);
        if (path === "/auth/logout") return handleAuthLogout(req, env);
      }

      // API routes
      if (path === "/api/mcp" && req.method === "POST") return handleMcpProxy(req, env);
      if (path === "/api/mcp/call") return handleMcpCall(req, env);
      if (path === "/api/app-config") return handleAppConfig(req, env);
      if (path === "/api/firms") return handleFirms(req, env);
      if (path === "/api/snapshot") return handleDataKey(req, env, "snapshot");
      if (path === "/api/accounts") return handleDataKey(req, env, "accounts");
      if (path === "/api/heartbeat") return requireAuthThen(req, env, () => Response.json({ ok: true }));
      if (path === "/api/telemetry-context") return requireAuthThen(req, env, (_s, session) =>
        Response.json({ environment: "production", firmId: session.firmId || null, userId: null }));
      if (path.startsWith("/api/report/")) return handleReport(req, env, path);
      if (path === "/api/budget-upload") return handleBudgetUpload(req, env);
      if (path === "/api/load-firm") return handleLoadFirm(req, env);

      // Page requests: gate behind auth
      const isPage = !path.includes(".") || path.startsWith("/firm/");
      if (isPage && env.AUTH_MODE !== "token") {
        const [sid, session] = await getSession(req, env);
        if (!sid || !session) return loginPage();
      }

      // Serve static assets
      const assetResp = await env.ASSETS.fetch(req);
      if (isPage) {
        const resp = new Response(assetResp.body, assetResp);
        resp.headers.set("Cache-Control", "no-store");
        return resp;
      }
      return assetResp;
    } catch (e) {
      return Response.json({ error: e.message }, { status: 500 });
    }
  },
};
