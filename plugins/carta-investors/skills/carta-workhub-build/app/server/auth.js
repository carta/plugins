// Carta sign-in, sessions and the MCP transport. Hand-copied from
// carta-manco-reporting/server/worker.js: each Worker deploys from its own skill
// directory, so there is no shared module to import. Keep the two behaviourally identical.

const CARTA_MCP_BASE = "https://mcp.app.carta.com";
const SESSION_TTL = 86400;

// Token mode is the local run (wrangler dev): no OAuth, and the MCP host may point at a
// fixture server. A signed-in user's token only ever goes to Carta.
function mcpBase(env) {
  return env.AUTH_MODE === "token" && env.MCP_BASE ? env.MCP_BASE : CARTA_MCP_BASE;
}

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
  await env.SESSIONS.put(name, `v1.${toB64(iv)}.${toB64(new Uint8Array(ct))}`, { expirationTtl: SESSION_TTL });
}

// A missing, tampered, or plaintext entry reads as signed out.
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
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Base64url(plain) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(plain));
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function getRedirectUri(req) {
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}/auth/callback`;
}

async function ensureClient(env, redirectUri) {
  const cacheKey = `oauth_client:${redirectUri}`;
  const cached = await env.SESSIONS.get(cacheKey, "json");
  if (cached) return cached;
  const resp = await fetch(`${mcpBase(env)}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Carta Workhub Worker",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (!resp.ok) throw new Error(`Client registration failed (${resp.status}): ${await resp.text()}`);
  const client = await resp.json();
  await env.SESSIONS.put(cacheKey, JSON.stringify(client), { expirationTtl: SESSION_TTL * 30 });
  return client;
}

export async function getSession(req, env) {
  if (env.AUTH_MODE === "token") {
    const token = req.headers.get("X-Dash-Token") || new URL(req.url).searchParams.get("t");
    if (!env.DASH_TOKEN || token !== env.DASH_TOKEN) return [null, null];
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
  const resp = await fetch(`${mcpBase(env)}/token`, {
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

export const unauthorized = (error = "unauthorized") =>
  Response.json({ error, action: "reauthenticate" }, { status: 401 });

// [sid, session, null] for a signed-in request, else [null, null, 401 response].
export async function requireAuth(req, env) {
  const [sid, session] = await getSession(req, env);
  if (!sid || !session?.access_token) return [null, null, unauthorized()];
  let accessToken = session.access_token;
  if (session.expires_at && Date.now() > session.expires_at - 60_000) {
    const refreshed = await refreshAccessToken(session, sid, env);
    if (!refreshed) {
      await env.SESSIONS.delete(`session:${sid}`);
      return [null, null, unauthorized("token_expired")];
    }
    accessToken = refreshed;
  }
  return [sid, { ...session, access_token: accessToken }, null];
}

async function mcpFetch(body, accessToken, mcpSessionId, env) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${accessToken}`, // noqa: carta-cli-bypass — Cloudflare Worker, not a Claude session; CLI unavailable
  };
  if (mcpSessionId) headers["Mcp-Session-Id"] = mcpSessionId;
  return fetch(`${mcpBase(env)}/mcp`, { method: "POST", headers, body: JSON.stringify(body) });
}

function parseSseResponse(text) {
  let last = null;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("data: ")) {
      try { last = JSON.parse(trimmed.slice(6)); } catch { /* skip */ }
    }
  }
  if (last) return last;
  try { return JSON.parse(text); } catch { return null; }
}

export class TokenExpired extends Error {}

// Resolves with the tool's result. A JSON-RPC error comes back as an isError result, the
// same shape as a tool that ran and failed; transport failures throw.
export async function mcpCallTool(name, args, accessToken, sid, env) {
  const body = { jsonrpc: "2.0", id: generateId(), method: "tools/call", params: { name, arguments: args } };
  const sessionKey = `mcp-session:${sid}`;
  const knownSessionId = await env.SESSIONS.get(sessionKey);
  let resp = await mcpFetch(body, accessToken, knownSessionId, env);
  if (resp.status === 401) {
    const session = (await getStoredSession(env, sid)) || {};
    const refreshed = await refreshAccessToken(session, sid, env);
    if (!refreshed) throw new TokenExpired("token_expired");
    resp = await mcpFetch(body, refreshed, knownSessionId, env);
  }
  // The page fires calls in parallel bursts and KV takes one write per key per second,
  // so write only when Carta hands out a new id.
  const msid = resp.headers.get("Mcp-Session-Id");
  if (msid && msid !== knownSessionId) await env.SESSIONS.put(sessionKey, msid, { expirationTtl: SESSION_TTL });
  if (!resp.ok) throw new Error(`MCP call failed: ${resp.status}`);
  const parsed = parseSseResponse(await resp.text());
  if (!parsed) throw new Error("Failed to parse MCP response");
  if (parsed.error) {
    return { isError: true, content: [{ type: "text", text: parsed.error.message || "tool error" }] };
  }
  return parsed.result || parsed;
}

export async function handleAuthLogin(req, env) {
  const redirectUri = getRedirectUri(req);
  const client = await ensureClient(env, redirectUri);
  const sid = generateId();
  const verifier = generateId();
  const state = generateId();
  await env.SESSIONS.put(`pkce:${state}`, JSON.stringify({ verifier, sid, redirectUri }), { expirationTtl: 600 });
  const params = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: redirectUri,
    code_challenge: await sha256Base64url(verifier),
    code_challenge_method: "S256",
    state,
    scope: "openid",
  });
  return Response.redirect(`${mcpBase(env)}/authorize?${params}`, 302);
}

export async function handleAuthCallback(req, env) {
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
  const tokenResp = await fetch(`${mcpBase(env)}/token`, {
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
  if (!tokenResp.ok) return new Response(`Token exchange failed: ${await tokenResp.text()}`, { status: 502 });
  const tokens = await tokenResp.json();
  await putSession(env, sid, {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + (tokens.expires_in || 3600) * 1000,
    // ensureClient caches the client per redirect URI, so a refresh an hour
    // later needs the URI this session registered under.
    redirectUri,
  });
  return new Response(null, { status: 302, headers: { Location: "/", "Set-Cookie": sidCookie(sid) } });
}

export async function handleAuthLogout(req, env) {
  const sid = getCookie(req, "sid");
  if (sid) await env.SESSIONS.delete(`session:${sid}`);
  return new Response(null, { status: 302, headers: { Location: "/", "Set-Cookie": sidCookie("", 0) } });
}
