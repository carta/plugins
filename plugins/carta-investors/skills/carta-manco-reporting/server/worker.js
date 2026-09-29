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
  const raw = await env.SESSIONS.get(`session:${sid}`);
  if (!raw) return [sid, null];
  return [sid, JSON.parse(raw)];
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
  await env.SESSIONS.put(`session:${sid}`, JSON.stringify(session), { expirationTtl: SESSION_TTL });
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
    const session = JSON.parse(await env.SESSIONS.get(`session:${sid}`) || "{}");
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
  await env.SESSIONS.put(`session:${sid}`, JSON.stringify(session), { expirationTtl: SESSION_TTL });
  try {
    const user = await mcpCallTool("get_current_user", {}, tokens.access_token, sid, env);
    if (user?.content?.[0]?.text) {
      const info = JSON.parse(user.content[0].text);
      session.userName = info.full_name || info.email || null;
      await env.SESSIONS.put(`session:${sid}`, JSON.stringify(session), { expirationTtl: SESSION_TTL });
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

// {app}.{customer}.carta.cloud — the customer label picks the firm prefix this
// hostname may read. An unmapped label gets a null prefix and is denied.
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
  return { label, prefix: Object.prototype.hasOwnProperty.call(tenants, label) ? tenants[label] : null };
}

export function tenantAllows(tenant, slug) {
  if (!tenant) return true;
  return !!tenant.prefix && (slug === tenant.prefix || slug.startsWith(`${tenant.prefix}-`));
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
  if (!tenantAllows(tenantOf(req, env), slug)) return null;
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
  const cached = await env.SESSIONS.get(`firms:${sid}`, "json");
  const firm = (cached || []).find((f) => tenantAllows(tenant, f.slug));
  return Response.json({ defaultFirm: firm?.slug || null });
}

// ── Firms ──

async function handleFirms(req, env) {
  const [sid, session, authErr] = await requireAuth(req, env);
  if (authErr) return authErr;

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
    const tenant = tenantOf(req, env);
    return Response.json(tenant ? firms.filter((f) => tenantAllows(tenant, f.slug)) : firms);
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
  const raw = await env.SESSIONS.get(kvKey);
  if (!raw) return Response.json({ error: "not_ready" });
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

async function resolveMancoEntity(firmUuid, accessToken, sid, env) {
  const result = await mcpCallTool("fa__list__entities", {}, accessToken, sid, env);
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

const EXPENSE_SQL = (mancoUuid, year, maxMo) => `SELECT
  JOURNAL_ENTRY_LINE_ID AS id, JOURNAL_ENTRY_GLUUID AS gluuid,
  EFFECTIVE_DATE AS date, MONTH(EFFECTIVE_DATE) AS mo,
  ACCOUNT_NAME AS account, ACCOUNT_TYPE AS acct_type,
  COALESCE(SUB_ACCOUNT_NAME, '') AS sub,
  AMOUNT AS amt,
  COALESCE(JOURNAL_ENTRY_DESCRIPTION, '') AS descr,
  COALESCE(VENDOR_NAME, '') AS vendor,
  COALESCE(PARTNER_NAME, '') AS partner,
  COALESCE(EVENT_TYPE, '') AS event_type,
  COALESCE(REPORTING_TAGS, '') AS tags
FROM JOURNAL_ENTRIES
WHERE FUND_UUID = '${mancoUuid}'
  AND YEAR(EFFECTIVE_DATE) = ${year}
  AND MONTH(EFFECTIVE_DATE) <= ${maxMo}
  AND ACCOUNT_TYPE >= 5000
ORDER BY EFFECTIVE_DATE, ACCOUNT_TYPE, JOURNAL_ENTRY_LINE_ID
LIMIT 1000`;

const INCOME_SQL = (mancoUuid, year, maxMo) => `SELECT
  JOURNAL_ENTRY_LINE_ID AS id, JOURNAL_ENTRY_GLUUID AS gluuid,
  EFFECTIVE_DATE AS date, MONTH(EFFECTIVE_DATE) AS mo,
  ACCOUNT_NAME AS account, ACCOUNT_TYPE AS acct_type,
  COALESCE(SUB_ACCOUNT_NAME, '') AS sub,
  -AMOUNT AS amt,
  COALESCE(JOURNAL_ENTRY_DESCRIPTION, '') AS descr,
  COALESCE(VENDOR_NAME, '') AS vendor,
  COALESCE(PARTNER_NAME, '') AS partner,
  COALESCE(EVENT_TYPE, '') AS event_type,
  COALESCE(REPORTING_TAGS, '') AS tags
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
  AMOUNT AS amt,
  COALESCE(JOURNAL_ENTRY_DESCRIPTION, '') AS descr,
  COALESCE(VENDOR_NAME, '') AS vendor
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

      // Cash balance
      await send({ step: "Fetching cash balance" });
      let cashData = null;
      try {
        cashData = await mcpCallTool("fa__get__cash-balance", {}, session.access_token, sid, env);
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

function normalizeRow(r) {
  return {
    id: col(r, "ID") || col(r, "id"),
    gluuid: col(r, "GLUUID") || col(r, "gluuid") || "",
    date: String(col(r, "DATE") || col(r, "date") || ""),
    mo: num(col(r, "MO") || col(r, "mo")),
    account: col(r, "ACCOUNT") || col(r, "account") || "",
    acctType: num(col(r, "ACCT_TYPE") || col(r, "acct_type")),
    sub: col(r, "SUB") || col(r, "sub") || "",
    amount: num(col(r, "AMT") || col(r, "amt")),
    descr: col(r, "DESCR") || col(r, "descr") || "",
    vendor: col(r, "VENDOR") || col(r, "vendor") || "",
    partner: col(r, "PARTNER") || col(r, "partner") || "",
    eventType: col(r, "EVENT_TYPE") || col(r, "event_type") || "",
    tags: col(r, "TAGS") || col(r, "tags") || "",
  };
}

function normalizeFeeRow(r) {
  return {
    id: col(r, "ID") || col(r, "id"),
    gluuid: col(r, "GLUUID") || col(r, "gluuid") || "",
    fund: col(r, "FUND") || col(r, "fund") || "",
    fundUuid: col(r, "FUND_UUID") || col(r, "fund_uuid") || "",
    date: String(col(r, "DATE") || col(r, "date") || ""),
    yr: num(col(r, "YR") || col(r, "yr")),
    mo: num(col(r, "MO") || col(r, "mo")),
    account: col(r, "ACCOUNT") || col(r, "account") || "",
    amount: num(col(r, "AMT") || col(r, "amt")),
    descr: col(r, "DESCR") || col(r, "descr") || "",
    vendor: col(r, "VENDOR") || col(r, "vendor") || "",
  };
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

function buildData({ meta, mancoName, mancoUuid, mancoFundId, asOf, year, maxMo, monthLabels, currency, expenseRows, incomeRows, fundFeeRows, cashData, budgetByAccount }) {
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

  // Cash balance
  let cash = null;
  if (cashData?.content) {
    for (const block of cashData.content) {
      if (block.type !== "text") continue;
      try {
        const parsed = JSON.parse(block.text);
        if (parsed?.entities || parsed?.balance || parsed?.cash_balance) {
          cash = parsed;
          break;
        }
      } catch { /* skip */ }
    }
  }

  // Entries for drill-downs
  const entries = allRows.map(r => ({
    id: r.id,
    gluuid: r.gluuid,
    date: r.date,
    month: r.mo,
    account: r.account,
    acct_type: r.acctType,
    sub_account: r.sub,
    amount: round2(r.amount),
    description: r.descr,
    vendor: r.vendor,
    partner: r.partner,
    event_type: r.eventType,
    tags: r.tags,
    gl_group: r.acctType >= 5000 ? "expense" : "income",
    kind: r.acctType >= 5000 ? "expense" : "income",
  }));

  const fundFeeEntries = fees.map(r => ({
    id: r.id,
    gluuid: r.gluuid,
    fund: r.fund,
    fund_uuid: r.fundUuid,
    date: r.date,
    year: r.yr,
    month: r.mo,
    account: r.account,
    amount: round2(r.amount),
    description: r.descr,
    vendor: r.vendor,
  }));

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
