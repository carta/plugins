import { buildKpi, slugify } from "./kpi-builder.js";
import { STEMS } from "./queries.js";

var MCP_BASE = "https://mcp.app.carta.com";
var MCP_URL = MCP_BASE + "/mcp";
var AUTH_BASE = MCP_BASE;
var WELL_KNOWN = AUTH_BASE + "/.well-known/oauth-authorization-server";
var REG_URL = AUTH_BASE + "/register";
var AUTH_URL = AUTH_BASE + "/authorize";
var TOKEN_URL = AUTH_BASE + "/token";
function getCookie(req, name) {
  const h = req.headers.get("Cookie") || "";
  const m = h.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return m ? m[1] : null;
}
function sidCookie(sid, maxAge = 86400) {
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
async function ensureClient(env, redirectUri) {
  const cacheKey = `oauth_client:${redirectUri}`;
  const cached = await env.SESSIONS.get(cacheKey, "json");
  if (cached) return cached;
  const resp = await fetch(REG_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Portfolio Analytics Worker",
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
async function requireAuth(req, env) {
  const [sid, session] = await getSession(req, env);
  if (!sid || !session || !session.access_token) return [null, null, Response.json({ error: "unauthorized" }, { status: 401 })];
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
async function mcpCallTool(toolName, args, accessToken, sid, env) {
  const body = {
    jsonrpc: "2.0",
    id: generateId(),
    method: "tools/call",
    params: { name: toolName, arguments: args }
  };
  let resp = await mcpFetch(body, accessToken, sid, env);
  if (resp.status === 401) {
    const session = (await getStoredSession(env, sid)) || {};
    const refreshed = await refreshAccessToken(session, sid, env);
    if (refreshed) resp = await mcpFetch(body, refreshed, sid, env);
    else throw new Error("token_expired");
  }
  const msid = resp.headers.get("Mcp-Session-Id");
  if (msid) await env.SESSIONS.put(`mcp-session:${sid}`, msid, { expirationTtl: 86400 });
  if (!resp.ok) throw new Error(`MCP call failed: ${resp.status}`);
  const text = await resp.text();
  const parsed = parseSseResponse(text);
  if (!parsed) throw new Error("Failed to parse MCP response");
  return parsed.result || parsed;
}
function parseQueryResult(result) {
  if (!result || !result.content) return [];
  const rows = [];
  for (const block of result.content) {
    if (block.type === "text" && block.text) {
      const text = block.text.trim();
      if (text.startsWith("[")) {
        try {
          return JSON.parse(text);
        } catch {
        }
      }
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("{")) {
          try {
            rows.push(JSON.parse(trimmed));
          } catch {
          }
        }
      }
      if (!rows.length && text.includes("|")) {
        const lines = text.split("\n").filter((l) => l.trim() && !l.trim().match(/^[-|]+$/));
        if (lines.length >= 2) {
          const headers = lines[0].split("|").map((h) => h.trim()).filter(Boolean);
          for (let i = 1; i < lines.length; i++) {
            const vals = lines[i].split("|").map((v) => v.trim()).filter(Boolean);
            if (vals.length === headers.length) {
              const obj = {};
              headers.forEach((h, j) => {
                obj[h] = vals[j] === "NULL" ? null : vals[j];
              });
              rows.push(obj);
            }
          }
        }
      }
    }
    if (block.type === "resource" && block.resource?.text) {
      const text = block.resource.text.trim();
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("{")) {
          try {
            rows.push(JSON.parse(trimmed));
          } catch {
          }
        }
      }
      if (!rows.length && text.startsWith("[")) {
        try {
          return JSON.parse(text);
        } catch {
        }
      }
    }
  }
  return rows;
}
async function runStemQuery(stem, sql, accessToken, sid, env, limit = 1e4) {
  const allRows = [];
  let offset = 0;
  while (true) {
    const result = await mcpCallTool("dwh__execute__query", { sql, limit, offset, format: "ndjson" }, accessToken, sid, env);
    const rows = parseQueryResult(result);
    allRows.push(...rows);
    if (rows.length < limit) break;
    offset += limit;
  }
  return allRows;
}
var STEM_ORDER = ["funds", "financials", "forecasts", "holdings", "holdings_history", "deal_irr", "fdshares", "capstack"];
var STEM_LABELS = {
  funds: "Loading funds",
  financials: "Loading financials",
  forecasts: "Loading forecasts",
  holdings: "Loading holdings",
  holdings_history: "Loading holdings history",
  deal_irr: "Loading deal IRR",
  fdshares: "Loading share data",
  capstack: "Loading capital structure"
};
async function buildKpiData(firmUuid, firmName, firmSlug, accessToken, sid, env, onStep) {
  onStep?.({ step: "set_context", label: "Connecting to firm", index: 0, total: STEM_ORDER.length + 1 });
  await mcpCallTool("set_context", { firm_id: firmUuid }, accessToken, sid, env);
  const stemData = {};
  for (let i = 0; i < STEM_ORDER.length; i++) {
    const stem = STEM_ORDER[i];
    onStep?.({ step: stem, label: STEM_LABELS[stem], index: i + 1, total: STEM_ORDER.length + 1 });
    try {
      stemData[stem] = await runStemQuery(stem, STEMS[stem], accessToken, sid, env);
    } catch (e) {
      console.error(`Query failed for ${stem}: ${e.message}`);
      stemData[stem] = [];
    }
  }
  onStep?.({ step: "build", label: "Building report", index: STEM_ORDER.length + 1, total: STEM_ORDER.length + 1 });
  const meta = { name: firmName, slug: firmSlug, firmUuid, cartaEnvironment: "production" };
  return buildKpi(stemData, meta);
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
function loginPage() {
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in \u2014 Carta Portfolio Analytics</title>
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
  <h1>Portfolio Analytics</h1>
  <p>Sign in with your Carta account to continue.</p>
  <a href="/auth/login">Sign in with Carta</a>
</div>
</body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html;charset=utf-8" } });
}
async function handleAuthLogout(req, env) {
  const sid = getCookie(req, "sid");
  if (sid) await env.SESSIONS.delete(`session:${sid}`);
  return new Response(null, {
    status: 302,
    headers: { Location: "/", "Set-Cookie": sidCookie("", 0) }
  });
}
async function handleMcpProxy(req, env) {
  const [sid, session, authErr] = await requireAuth(req, env);
  if (authErr) return authErr;
  const body = await req.json();
  let resp = await mcpFetch(body, session.access_token, sid, env);
  if (resp.status === 401) {
    let isInvalidToken = false;
    try {
      const errBody = await resp.clone().text();
      isInvalidToken = JSON.parse(errBody).error === "invalid_token";
    } catch {
    }
    if (isInvalidToken) {
      const refreshed = await refreshAccessToken(session, sid, env);
      if (refreshed) resp = await mcpFetch(body, refreshed, sid, env);
      else {
        await env.SESSIONS.delete(`session:${sid}`);
        return Response.json({ error: "token_expired", action: "reauthenticate" }, { status: 401 });
      }
    } else {
      await env.SESSIONS.delete(`session:${sid}`);
      return Response.json({ error: "token_expired", action: "reauthenticate" }, { status: 401 });
    }
  }
  const msid = resp.headers.get("Mcp-Session-Id");
  if (msid) await env.SESSIONS.put(`mcp-session:${sid}`, msid, { expirationTtl: 86400 });
  const responseHeaders = new Headers();
  responseHeaders.set("Content-Type", resp.headers.get("Content-Type") || "application/json");
  return new Response(resp.body, { status: resp.status, headers: responseHeaders });
}
async function handleKpiJson(req, env) {
  const [sid, session, authErr] = await requireAuth(req, env);
  if (authErr) return authErr;
  const url = new URL(req.url);
  const firm = url.searchParams.get("firm") || "default";
  const nocache = url.searchParams.get("nocache");
  const wantStream = req.headers.get("Accept") === "text/event-stream";
  const firmMeta = await authorizedFirm(req, firm, sid, session, env);
  if (!firmMeta) {
    const errPayload = { error: "forbidden", message: `No access to firm "${firm}".` };
    if (wantStream) {
      const body = `data: ${JSON.stringify({ type: "error", ...errPayload })}

`;
      return new Response(body, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
    }
    return Response.json(errPayload, { status: 403 });
  }
  if (!nocache) {
    const cached = await env.SESSIONS.get(`kpi:${firm}`, "text");
    if (cached) {
      if (wantStream) {
        const body = `data: ${JSON.stringify({ type: "complete", data: JSON.parse(cached) })}

`;
        return new Response(body, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
      }
      return new Response(cached, { headers: { "Content-Type": "application/json" } });
    }
  }
  if (!wantStream) {
    try {
      const kpi = await buildKpiData(firmMeta.firmUuid, firmMeta.name, firm, session.access_token, sid, env);
      await assertActiveFirm(firmMeta.firmUuid, session, sid, env);
      const json = JSON.stringify(kpi);
      await env.SESSIONS.put(`kpi:${firm}`, json, { expirationTtl: 3600 });
      return new Response(json, { headers: { "Content-Type": "application/json" } });
    } catch (e) {
      return Response.json({ error: "build_failed", message: e.message }, { status: 500 });
    }
  }
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const send = (obj) => writer.write(enc.encode(`data: ${JSON.stringify(obj)}

`));
  (async () => {
    try {
      const kpi = await buildKpiData(
        firmMeta.firmUuid,
        firmMeta.name,
        firm,
        session.access_token,
        sid,
        env,
        (step) => send({ type: "step", ...step })
      );
      await assertActiveFirm(firmMeta.firmUuid, session, sid, env);
      const json = JSON.stringify(kpi);
      await env.SESSIONS.put(`kpi:${firm}`, json, { expirationTtl: 3600 });
      await send({ type: "complete", data: kpi });
    } catch (e) {
      await send({ type: "error", error: "build_failed", message: e.message });
    } finally {
      await writer.close();
    }
  })();
  return new Response(readable, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
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
    const firmList = parseFirms(result);
    if (firmList.length && !query) {
      await env.SESSIONS.put(firmsKey, JSON.stringify(firmList), { expirationTtl: 3600 });
    }
    return Response.json(firmList);
  } catch (e) {
    return Response.json([], { status: 200 });
  }
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
  await env.SESSIONS.put(key, JSON.stringify(firm || { denied: true }), { expirationTtl: 3600 });
  return firm;
}
function parseFirms(result) {
  const firmList = [];
  if (result?.structuredContent?.firms) {
    for (const f of result.structuredContent.firms) {
      firmList.push({
        slug: slugify(f.firm_name || f.name),
        name: f.firm_name || f.name,
        firmUuid: f.firm_id || f.firm_uuid,
        firmId: f.carta_id || null,
        active: !!f.is_active
      });
    }
  } else if (result?.content) {
    for (const block of result.content) {
      if (block.type !== "text") continue;
      const text = block.text || "";
      const matches = [...text.matchAll(/- (.+?) \(([0-9a-f-]{36})\)/g)];
      for (const m of matches) {
        firmList.push({ slug: slugify(m[1]), name: m[1].replace(/\s*\(active\)\s*$/i, ""), firmUuid: m[2] });
      }
    }
  }
  return firmList;
}
async function authorizedFirm(req, slug, sid, session, env) {
  if (!slug || slug === "default") return null;
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
  await env.SESSIONS.put(key, JSON.stringify(match || { denied: true }), { expirationTtl: 3600 });
  return match;
}
async function handleConfigureFirm(req, env) {
  const [sid, session, authErr] = await requireAuth(req, env);
  if (authErr) return authErr;
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const body = await req.json().catch(() => null);
  if (!body || !body.slug || !body.firmUuid) {
    return Response.json({ error: "missing_fields", message: "Required: slug, firmUuid. Optional: name, firmId." }, { status: 400 });
  }
  const config = { slug: body.slug, name: body.name || body.slug, firmUuid: body.firmUuid, firmId: body.firmId || null };
  await env.SESSIONS.put(`firm-config:${config.slug}`, JSON.stringify(config), { expirationTtl: 86400 * 365 });
  try {
    await mcpCallTool("set_context", { firm_id: config.firmUuid }, session.access_token, sid, env);
    const meta = { ...config, active: true };
    await env.SESSIONS.put(`firm-meta:${config.slug}`, JSON.stringify(meta), { expirationTtl: 86400 });
    return Response.json({ ok: true, message: `Configured ${config.slug} \u2192 ${config.firmUuid}`, meta });
  } catch (e) {
    return Response.json({ ok: false, message: `Saved config but set_context failed: ${e.message}. The firm UUID may be wrong or you lack access.` }, { status: 200 });
  }
}
async function handlePortfolio(req, env) {
  const [sid, session, authErr] = await requireAuth(req, env);
  if (authErr) return authErr;
  const url = new URL(req.url);
  const firm = url.searchParams.get("firm") || "default";
  if (firm !== "default" && !await authorizedFirm(req, firm, sid, session, env)) {
    return Response.json({ error: "forbidden", message: `No access to firm "${firm}".` }, { status: 403 });
  }
  const key = firm !== "default" ? `portfolio:${firm}` : `portfolio:${sid}:${firm}`;
  if (req.method === "GET") {
    const doc = await env.SESSIONS.get(key, "text");
    if (!doc) return Response.json({ error: "not_ready" });
    const etag = `"${await sha256Base64url(doc)}"`;
    return new Response(doc, { headers: { "Content-Type": "application/json", ETag: etag } });
  }
  if (req.method === "PUT") {
    const body = await req.text();
    const ifMatch = req.headers.get("If-Match");
    if (ifMatch) {
      const existing = await env.SESSIONS.get(key, "text");
      if (existing) {
        const existingEtag = `"${await sha256Base64url(existing)}"`;
        if (ifMatch.trim().replace(/^W\//, "") !== existingEtag) return Response.json({ error: "conflict" }, { status: 409 });
      }
    }
    await env.SESSIONS.put(key, body, { expirationTtl: 86400 * 30 });
    const etag = `"${await sha256Base64url(body)}"`;
    return new Response(null, { status: 200, headers: { ETag: etag } });
  }
  return new Response("Method not allowed", { status: 405 });
}
async function handleCapabilities(req, env) {
  const [, , authErr] = await requireAuth(req, env);
  if (authErr) return authErr;
  return Response.json({ refresh: true, worker: true });
}
async function handleTelemetryContext(req, env) {
  const [sid, session] = await getSession(req, env);
  if (!session) return Response.json({});
  const url = new URL(req.url);
  const firm = url.searchParams.get("firm");
  let firmId = null;
  if (firm) {
    const meta = await env.SESSIONS.get(`allowed-firm:${sid}:${firm}`, "json");
    if (meta) firmId = meta.firmId;
  }
  return Response.json({ environment: "production", firmId, userId: null });
}
async function handleRefresh(req, env) {
  const [sid, session, authErr] = await requireAuth(req, env);
  if (authErr) return authErr;
  const url = new URL(req.url);
  const path = url.pathname;
  if (path === "/api/refresh/status") {
    const status = await env.SESSIONS.get(`refresh-status:${sid}`, "json");
    return Response.json(status || { status: "idle" });
  }
  if (path === "/api/refresh" && req.method === "POST") {
    const existing = await env.SESSIONS.get(`refresh-status:${sid}`, "json");
    if (existing && existing.status === "running") return new Response(null, { status: 409 });
    const body = await req.json().catch(() => ({}));
    const firmSlug = body.firm || "default";
    const firmMeta = await authorizedFirm(req, firmSlug, sid, session, env);
    if (!firmMeta) return Response.json({ error: "forbidden", message: `No access to firm "${firmSlug}".` }, { status: 403 });
    await env.SESSIONS.put(`refresh-status:${sid}`, JSON.stringify({
      status: "running",
      phase: "querying",
      startedAt: Math.floor(Date.now() / 1e3),
      target: body.datasets || null
    }), { expirationTtl: 600 });
    try {
      const kpi = await buildKpiData(firmMeta.firmUuid, firmMeta.name, firmSlug, session.access_token, sid, env);
      await assertActiveFirm(firmMeta.firmUuid, session, sid, env);
      const json = JSON.stringify(kpi);
      await env.SESSIONS.put(`kpi:${firmSlug}`, json, { expirationTtl: 3600 });
      await env.SESSIONS.put(`refresh-status:${sid}`, JSON.stringify({ status: "fetched" }), { expirationTtl: 600 });
    } catch (e) {
      await env.SESSIONS.put(`refresh-status:${sid}`, JSON.stringify({
        status: "error",
        message: e.message
      }), { expirationTtl: 600 });
    }
    return Response.json({ ok: true });
  }
  if (path === "/api/refresh/apply" && req.method === "POST") {
    await env.SESSIONS.put(`refresh-status:${sid}`, JSON.stringify({ status: "idle" }), { expirationTtl: 60 });
    return Response.json({ ok: true });
  }
  return new Response("Not found", { status: 404 });
}
async function handleHeartbeat() {
  return Response.json({ ok: true, ts: Date.now() });
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
      if (path === "/api/app-config") return handleAppConfig(req, env);
      if (path === "/api/report/kpi.json") return handleKpiJson(req, env);
      if (path === "/api/firms") return handleFirms(req, env);
      if (path === "/api/configure-firm" && env.AUTH_MODE === "token") return handleConfigureFirm(req, env);
      if (path === "/api/portfolio") return handlePortfolio(req, env);
      if (path === "/api/capabilities") return handleCapabilities(req, env);
      if (path === "/api/telemetry-context") return handleTelemetryContext(req, env);
      if (path === "/api/heartbeat") return handleHeartbeat();
      if (path.startsWith("/api/refresh")) return handleRefresh(req, env);
      const isPage = !path.includes(".") || path.startsWith("/firm/");
      if (isPage && env.AUTH_MODE !== "token") {
        const [sid, session] = await getSession(req, env);
        if (!sid || !session) return loginPage();
      }
      const assetResp = await env.ASSETS.fetch(req);
      if (isPage) {
        const resp = new Response(assetResp.body, assetResp);
        resp.headers.set("Cache-Control", "no-store");
        return resp;
      }
      return assetResp;
    } catch (e) {
      console.error("Unhandled Worker error:", e);
      return Response.json({ error: e.message }, { status: 500 });
    }
  }
};
