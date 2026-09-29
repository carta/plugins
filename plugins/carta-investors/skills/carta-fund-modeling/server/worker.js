var MCP_BASE = "https://mcp.app.carta.com";
var MCP_URL = MCP_BASE + "/mcp";
var AUTH_URL = MCP_BASE + "/authorize";
var TOKEN_URL = MCP_BASE + "/token";
var REG_URL = MCP_BASE + "/register";
var SESSION_TTL = 86400;
var DATA_TTL = 3600;
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
async function putSession(env, sid, session) {
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
async function getStoredSession(env, sid) {
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
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function sha256Base64url(plain) {
  const data = new TextEncoder().encode(plain);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(hash))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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
function toBool(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.toLowerCase() === "true" || v === "1";
  return !!v;
}
async function ensureClient(env, redirectUri) {
  const cacheKey = `oauth_client:${redirectUri}`;
  const cached = await env.SESSIONS.get(cacheKey, "json");
  if (cached) return cached;
  const resp = await fetch(REG_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Fund Modeling Worker",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none"
    })
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Client registration failed (${resp.status}): ${txt}`);
  }
  const client = await resp.json();
  await env.SESSIONS.put(cacheKey, JSON.stringify(client), { expirationTtl: 86400 * 30 });
  return client;
}
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
      client_id: cached.client_id
    })
  });
  if (!resp.ok) return null;
  const tokens = await resp.json();
  session.access_token = tokens.access_token;
  session.refresh_token = tokens.refresh_token || session.refresh_token;
  session.expires_at = Date.now() + (tokens.expires_in || 3600) * 1e3;
  await putSession(env, sid, session);
  return tokens.access_token;
}
async function requireAuth(req, env) {
  const [sid, session] = await getSession(req, env);
  if (!sid || !session || !session.access_token) {
    return [null, null, Response.json({ error: "unauthorized" }, { status: 401 })];
  }
  let accessToken = session.access_token;
  if (session.expires_at && Date.now() > session.expires_at - 6e4) {
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
async function mcpFetch(body, accessToken, sid, env) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${accessToken}` // noqa: carta-cli-bypass — Cloudflare Worker, not a Claude session; CLI unavailable
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
      try {
        last = JSON.parse(trimmed.slice(6));
      } catch {
      }
    }
  }
  if (last) return last;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
async function mcpCallTool(name, args, accessToken, sid, env) {
  const body = {
    jsonrpc: "2.0",
    id: generateId(),
    method: "tools/call",
    params: { name, arguments: args }
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
    scope: "openid"
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
      code_verifier: verifier
    })
  });
  if (!tokenResp.ok) {
    const txt = await tokenResp.text();
    return new Response(`Token exchange failed: ${txt}`, { status: 502 });
  }
  const tokens = await tokenResp.json();
  const session = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + (tokens.expires_in || 3600) * 1e3,
    redirectUri,
    userName: null
  };
  await putSession(env, sid, session);
  try {
    const user = await mcpCallTool("get_current_user", {}, tokens.access_token, sid, env);
    if (user?.content?.[0]?.text) {
      const info = JSON.parse(user.content[0].text);
      session.userName = info.full_name || info.email || null;
      await putSession(env, sid, session);
    }
  } catch {
  }
  return new Response(null, {
    status: 302,
    headers: { Location: "/", "Set-Cookie": sidCookie(sid) }
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
    headers: { Location: "/", "Set-Cookie": sidCookie("", 0) }
  });
}
function loginPage() {
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in \u2014 Carta Fund Modeling</title>
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
  <h1>Fund Modeling</h1>
  <p>Sign in with your Carta account to continue.</p>
  <a href="/auth/login">Sign in with Carta</a>
</div>
</body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html;charset=utf-8" } });
}
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
var TENANT_ZONE = ".carta.cloud";
function tenantOf(req, env) {
  const host = new URL(req.url).hostname;
  if (!host.endsWith(TENANT_ZONE)) return null;
  const labels = host.slice(0, -TENANT_ZONE.length).split(".");
  let tenants = {};
  try {
    tenants = JSON.parse(env.TENANTS || "{}");
  } catch {
  }
  const label = labels.length === 2 ? labels[1] : "";
  const uuid = Object.prototype.hasOwnProperty.call(tenants, label) ? tenants[label] : null;
  return { label, firmUuid: typeof uuid === "string" && uuid ? uuid.toLowerCase() : null };
}
async function handleAppConfig(req, env) {
  const tenant = tenantOf(req, env);
  if (!tenant) return Response.json({ defaultFirm: env.DEFAULT_FIRM || null });
  const [sid, session] = await getSession(req, env);
  if (!sid || !session?.access_token) return Response.json({ defaultFirm: null });
  const firm = await tenantFirm(tenant, sid, session, env);
  return Response.json({ defaultFirm: firm?.slug || null });
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

async function assertActiveFirm(firmUuid, session, sid, env) {
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
async function tenantFirm(tenant, sid, session, env) {
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
function parseFirms(result) {
  const firms = [];
  if (result?.structuredContent?.firms) {
    for (const f of result.structuredContent.firms) {
      firms.push({
        slug: slugify(f.firm_name || f.name),
        name: f.firm_name || f.name,
        firmId: f.carta_id || null,
        firmUuid: f.firm_id || f.firm_uuid,
        active: !!f.is_active,
        funds: f.fund_count || 0,
        navAsOf: null
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
async function authorizedFirm(req, slug, sid, session, env) {
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
function dataKey(prefix, sid, firm, suffix, env) {
  if (firm) return suffix ? `${prefix}:${firm}:${suffix}` : `${prefix}:${firm}`;
  return suffix ? `${prefix}:${sid}:${firm}:${suffix}` : `${prefix}:${sid}${firm ? `:${firm}` : ""}`;
}
async function handleDataKey(req, env, key) {
  const [sid, session, authErr] = await requireAuth(req, env);
  if (authErr) return authErr;
  const url = new URL(req.url);
  const firm = url.searchParams.get("firm") || "";
  if (firm && !await authorizedFirm(req, firm, sid, session, env)) return forbiddenFirm(firm);
  const kvKey = dataKey("data", sid, firm, key, env);
  const data = await env.SESSIONS.get(kvKey, "json");
  if (data) return Response.json(data);
  return Response.json({ error: "not_ready" });
}
async function handleReport(req, env, path) {
  const [sid, session, authErr] = await requireAuth(req, env);
  if (authErr) return authErr;
  const name = path.slice("/api/report/".length);
  if (!/^[a-z0-9_-]+\.json$/.test(name)) return Response.json({ error: "not_found" }, { status: 404 });
  const url = new URL(req.url);
  const firm = url.searchParams.get("firm") || "";
  if (firm && !await authorizedFirm(req, firm, sid, session, env)) return forbiddenFirm(firm);
  const kvKey = dataKey("data", sid, firm, `report:${name}`, env);
  const data = await env.SESSIONS.get(kvKey, "json");
  if (data) return Response.json(data);
  return Response.json({ error: "not_ready" });
}
async function handlePortfolio(req, env) {
  const [sid, session, authErr] = await requireAuth(req, env);
  if (authErr) return authErr;
  const url = new URL(req.url);
  const firm = url.searchParams.get("firm") || "";
  if (firm && !await authorizedFirm(req, firm, sid, session, env)) return forbiddenFirm(firm);
  const kvKey = dataKey("portfolio", sid, firm, "", env);
  if (req.method === "GET" || req.method === "HEAD") {
    let raw = await env.SESSIONS.get(kvKey);
    if (!raw) return Response.json({ error: "not_ready" });
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.slices)) {
      const snapKey = dataKey("data", sid, firm, "snapshot", env);
      const snap = await env.SESSIONS.get(snapKey, "json");
      if (!snap?.companies) return Response.json({ error: "not_ready" });
      const migrated = buildInitialPortfolio(snap);
      raw = JSON.stringify(migrated);
      await env.SESSIONS.put(kvKey, raw, { expirationTtl: SESSION_TTL });
    }
    const etag = `"${await sha256Base64url(raw)}"`;
    return new Response(req.method === "HEAD" ? null : raw, {
      headers: { "Content-Type": "application/json", ETag: etag, "Cache-Control": "no-store" }
    });
  }
  if (req.method === "PUT") {
    const body = await req.text();
    try {
      JSON.parse(body);
    } catch {
      return Response.json({ error: "bad_json" }, { status: 400 });
    }
    const ifMatch = req.headers.get("If-Match");
    if (ifMatch) {
      const current = await env.SESSIONS.get(kvKey);
      if (current) {
        const currentEtag = `"${await sha256Base64url(current)}"`;
        if (ifMatch.trim().replace(/^W\//, "") !== currentEtag) {
          return Response.json({ error: "conflict" }, { status: 409 });
        }
      }
    }
    await env.SESSIONS.put(kvKey, body, { expirationTtl: SESSION_TTL });
    const newEtag = `"${await sha256Base64url(body)}"`;
    return Response.json({ ok: true }, { headers: { ETag: newEtag } });
  }
  return new Response("Method not allowed", { status: 405 });
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
async function handleConfigureFirm(req, env) {
  const [sid, session, authErr] = await requireAuth(req, env);
  if (authErr) return authErr;
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const body = await req.json().catch(() => null);
  if (!body || !body.slug || !body.firmUuid) {
    return Response.json({ error: "missing_fields", message: "Required: slug, firmUuid. Optional: name, firmId." }, { status: 400 });
  }
  const config = { slug: body.slug, name: body.name || body.slug, firmUuid: body.firmUuid, firmId: body.firmId || null };
  await env.SESSIONS.put(`firm-config:${config.slug}`, JSON.stringify(config), { expirationTtl: 86400 * 365 });
  try {
    await mcpCallTool("set_context", { firm_id: config.firmUuid }, session.access_token, sid, env);
    const meta = { ...config, active: true };
    await env.SESSIONS.put(`firm-meta:${config.slug}`, JSON.stringify(meta), { expirationTtl: SESSION_TTL });
    return Response.json({ ok: true, message: `Configured ${config.slug} \u2192 ${config.firmUuid}`, meta });
  } catch (e) {
    return Response.json({ ok: false, message: `Saved config but set_context failed: ${e.message}` }, { status: 200 });
  }
}
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
  const send = (data) => writer.write(encoder.encode(`data: ${JSON.stringify(data)}

`));
  const run = async () => {
    try {
      const snapshot = await buildSnapshot(meta, session.access_token, sid, env, send);
      await assertActiveFirm(meta.firmUuid, session, sid, env);
      await send({ step: "Storing snapshot" });
      const snapshotKey = dataKey("data", sid, slug, "snapshot", env);
      await env.SESSIONS.put(snapshotKey, JSON.stringify(snapshot), { expirationTtl: DATA_TTL });
      const firms = [{
        slug,
        name: meta.name,
        funds: snapshot.funds?.length || 0,
        navAsOf: snapshot.source?.navAsOf || null,
        mark: null
      }];
      await env.SESSIONS.put(dataKey("data", sid, slug, "firms.json", env), JSON.stringify(firms), { expirationTtl: DATA_TTL });
      const pacing = { investments: [], summary: {} };
      await env.SESSIONS.put(dataKey("data", sid, slug, "pacing", env), JSON.stringify(pacing), { expirationTtl: DATA_TTL });
      await send({ step: "Building portfolio" });
      const portfolio = buildInitialPortfolio(snapshot);
      const portfolioKey = dataKey("portfolio", sid, slug, "", env);
      const existing = await env.SESSIONS.get(portfolioKey);
      const parsed = existing ? JSON.parse(existing) : null;
      if (!parsed || !Array.isArray(parsed.slices)) {
        await env.SESSIONS.put(portfolioKey, JSON.stringify(portfolio), { expirationTtl: SESSION_TTL });
      }
      await send({ step: "Done", done: true, funds: snapshot.funds?.length || 0 });
    } catch (e) {
      console.error("load-firm error:", e.message);
      await send({ step: "Error", error: e.message });
    } finally {
      await writer.close();
    }
  };
  run();
  return new Response(readable, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" }
  });
}
var NAV_SQL = `SELECT fund_uuid, fund_name,
  cumulative_commitment_amount, cumulative_lp_contributions, cumulative_lp_distributions,
  ending_lp_nav, ending_gp_nav, lp_dpi, lp_rvpi, lp_tvpi
FROM FUND_ADMIN.MONTHLY_NAV_CALCULATIONS
WHERE is_firm_rollup = FALSE AND entity_type_name NOT ILIKE '%SPV%'
QUALIFY ROW_NUMBER() OVER (PARTITION BY fund_uuid ORDER BY month_end_date DESC) = 1
ORDER BY fund_name`;
var INVEST_SQL = `SELECT issuer_name, fund_uuid, asset_name, asset_class_type,
  count_remaining_shares, remaining_value, remaining_value_per_share,
  total_cost, total_proceeds, total_unrealized_gain_loss, investment_date,
  is_active_investment, is_public_asset
FROM FUND_ADMIN.AGGREGATE_INVESTMENTS
WHERE fund_uuid IN (SELECT DISTINCT fund_uuid FROM FUND_ADMIN.MONTHLY_NAV_CALCULATIONS
                    WHERE is_firm_rollup = FALSE AND entity_type_name NOT ILIKE '%SPV%')
ORDER BY issuer_name, fund_uuid`;
function parseQueryRows(result) {
  const rows = [];
  if (!result?.content || result.isError) return rows;
  for (const block of result.content) {
    const text = (block.type === "text" ? block.text : block.resource?.text || "").trim();
    if (!text) continue;
    if (text.startsWith("[")) {
      try {
        return JSON.parse(text);
      } catch {
      }
    }
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (t.startsWith("{")) {
        try {
          rows.push(JSON.parse(t));
        } catch {
        }
      }
    }
  }
  return rows;
}
async function buildSnapshot(meta, accessToken, sid, env, send) {
  const firmUuid = meta.firmUuid;
  await send({ step: "Setting firm context" });
  await mcpCallTool("set_context", { firm_id: firmUuid }, accessToken, sid, env);
  await send({ step: "Querying fund NAV data" });
  const navResult = await mcpCallTool("dwh__execute__query", {
    sql: NAV_SQL,
    limit: 1e4,
    format: "ndjson"
  }, accessToken, sid, env).catch((e) => {
    console.error("NAV query error:", e.message);
    return null;
  });
  await send({ step: "Querying investment data" });
  const investResult = await mcpCallTool("dwh__execute__query", {
    sql: INVEST_SQL,
    limit: 1e4,
    format: "ndjson"
  }, accessToken, sid, env).catch((e) => {
    console.error("Invest query error:", e.message);
    return null;
  });
  await send({ step: "Building snapshot" });
  const navRows = parseQueryRows(navResult);
  const investRows = parseQueryRows(investResult);
  const funds = [];
  const baseLpNav = {};
  const baseAccruedCarry = {};
  for (const row of navRows) {
    const id = row.FUND_UUID || row.fund_uuid;
    funds.push({
      id,
      name: row.FUND_NAME || row.fund_name,
      vintage: null,
      committed: num(row.CUMULATIVE_COMMITMENT_AMOUNT || row.cumulative_commitment_amount),
      lpPaidIn: num(row.CUMULATIVE_LP_CONTRIBUTIONS || row.cumulative_lp_contributions),
      lpDistributed: num(row.CUMULATIVE_LP_DISTRIBUTIONS || row.cumulative_lp_distributions),
      gpCapitalNav: num(row.ENDING_GP_NAV || row.ending_gp_nav),
      gpCommit: num(row.CUMULATIVE_GP_CONTRIBUTIONS || row.cumulative_gp_contributions),
      waterfall: null,
      netLpIrr: null,
      grossMoic: null,
      // NAV_SQL selects no currency column, so none was read. Naming one
      // mislabels every figure for a fund reporting in another.
      currency: null,
      cohortStanding: null
    });
    baseLpNav[id] = num(row.ENDING_LP_NAV || row.ending_lp_nav);
    baseAccruedCarry[id] = 0;
  }
  const cashflows = {};
  const windDownYear = {};
  for (const f of funds) {
    cashflows[f.id] = { paidInTotal: f.lpPaidIn, flows: [], terminalDate: null };
    windDownYear[f.id] = null;
  }
  const companyMap = {};
  for (const row of investRows) {
    const issuer = row.ISSUER_NAME || row.issuer_name || "Unknown";
    const fundId = row.FUND_UUID || row.fund_uuid;
    if (!companyMap[issuer]) {
      companyMap[issuer] = {
        id: slugify(issuer),
        name: issuer,
        positions: [],
        includeInNav: false,
        archived: false,
        defunct: false,
        exited: false,
        realized: false,
        markMultiple: 1,
        futureDilution: 0,
        valuationB: null,
        defaultValuationB: null,
        waterfallMode: false,
        secondaries: [],
        notes: ""
      };
    }
    companyMap[issuer].positions.push({
      fundId,
      cartaFv: num(row.REMAINING_VALUE || row.remaining_value),
      cost: num(row.TOTAL_COST || row.total_cost),
      markBasisB: null,
      markDate: null,
      asset: row.ASSET_NAME || row.asset_name,
      assetClass: row.ASSET_CLASS_TYPE || row.asset_class_type,
      shares: num(row.COUNT_REMAINING_SHARES || row.count_remaining_shares),
      pricePerShare: num(row.REMAINING_VALUE_PER_SHARE || row.remaining_value_per_share),
      isPublic: toBool(row.IS_PUBLIC_ASSET || row.is_public_asset)
    });
  }
  const companies = Object.values(companyMap);
  return {
    source: {
      firm: meta.name,
      firmId: meta.firmId || null,
      firmUuid,
      navAsOf: new Date().toISOString().slice(0, 10),
      currency: null
    },
    branding: { firmName: meta.name },
    funds,
    companies,
    baseLpNav,
    baseAccruedCarry,
    benchmarks: {},
    cashflows,
    windDownYear
  };
}
function buildInitialPortfolio(snapshot) {
  const companies = (snapshot.companies || []).map((c) => ({
    ...c,
    includeInNav: false,
    exited: false,
    markMultiple: 1,
    futureDilution: 0,
    waterfallMode: false,
    secondaries: []
  }));
  const baseline = {
    id: "baseline",
    name: "Baseline \xB7 Carta",
    locked: true,
    createdAt: new Date().toISOString(),
    assumptions: {},
    companies
  };
  return {
    firm: snapshot.source.firm,
    slices: [baseline],
    activeSliceId: "baseline"
  };
}
export default {
  async fetch(req, env) {
    try {
      const url = new URL(req.url);
      const path = url.pathname;
      const tenant = tenantOf(req, env);
      if (tenant && !tenant.firmUuid) return new Response("Not found", { status: 404 });
      if (env.AUTH_MODE !== "token") {
        if (path === "/auth/login") return handleAuthLogin(req, env);
        if (path === "/auth/callback") return handleAuthCallback(req, env);
        if (path === "/auth/check") return handleAuthCheck(req, env);
        if (path === "/auth/logout") return handleAuthLogout(req, env);
      }
      if (path === "/api/mcp" && req.method === "POST") return handleMcpProxy(req, env);
      if (path === "/api/mcp/call") return handleMcpCall(req, env);
      if (path === "/api/app-config") return handleAppConfig(req, env);
      if (path === "/api/firms") return handleFirms(req, env);
      if (path === "/api/configure-firm" && env.AUTH_MODE === "token") return handleConfigureFirm(req, env);
      if (path === "/api/snapshot") return handleDataKey(req, env, "snapshot");
      if (path === "/api/portfolio") return handlePortfolio(req, env);
      if (path === "/api/pacing") return handleDataKey(req, env, "pacing");
      if (path === "/api/heartbeat") return requireAuthThen(req, env, () => Response.json({ ok: true }));
      if (path === "/api/telemetry-context") return requireAuthThen(req, env, (_s, session) => Response.json({ environment: "production", firmId: session.firmId || null, userId: null }));
      if (path.startsWith("/api/report/")) return handleReport(req, env, path);
      if (path === "/api/refresh/status") return requireAuthThen(req, env, () => Response.json({ status: "idle" }));
      if (path === "/api/scenarios/share-status") return requireAuthThen(req, env, () => Response.json({ status: "idle" }));
      if (path.startsWith("/api/scenarios/")) return requireAuthThen(req, env, () => Response.json({ error: "Scenario sharing is not yet available in this deployment." }, { status: 501 }));
      if (path === "/api/load-firm") return handleLoadFirm(req, env);
      const isPage = !path.includes(".") || path.startsWith("/firm/");
      if (isPage && env.AUTH_MODE !== "token") {
        const [sid, session] = await getSession(req, env);
        if (!sid || !session) return loginPage();
      }
      if (url.searchParams.get("frame") === "1") {
        const assetReq = new Request(`https://dummy/app.html`);
        const resp = new Response((await env.ASSETS.fetch(assetReq)).body, { headers: { "Content-Type": "text/html;charset=utf-8", "Cache-Control": "no-store" } });
        return resp;
      }
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
  }
};
