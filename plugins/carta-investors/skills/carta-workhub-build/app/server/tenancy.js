// Hostname tenancy: workhub.<label>.carta.cloud may only ever act on the one firm its
// label maps to in TENANTS. tenantOf and tenantFirm are hand-copied from
// carta-manco-reporting/server/worker.js; keep them behaviourally identical.
import { mcpCallTool } from "./auth.js";

const TENANT_ZONE = ".carta.cloud";
const TENANT_TTL = 3600;

// The hostname's tenant, or null when this Worker must not serve the host at all. An
// unmapped label gets a null firmUuid. Token mode (the local run) has no hostname to read,
// so it takes its one firm from LOCAL_FIRM_UUID.
export function tenantOf(req, env) {
  if (env.AUTH_MODE === "token") {
    return env.LOCAL_FIRM_UUID ? { label: "local", firmUuid: env.LOCAL_FIRM_UUID.toLowerCase() } : null;
  }
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

// One session's cached answer for one firm.
export const tenantFirmKey = (sid, firmUuid) => `tenant-firm:${sid}:${firmUuid}`;

export function toolText(result) {
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

function parseFirms(result) {
  if (result?.structuredContent?.firms) {
    return result.structuredContent.firms.map((f) => ({ name: f.firm_name || f.name, firmUuid: f.firm_id || f.firm_uuid }));
  }
  const firms = [];
  for (const block of result?.content || []) {
    if (block.type !== "text") continue;
    for (const m of (block.text || "").matchAll(/- (.+?) \(([0-9a-f-]{36})\)/g)) {
      firms.push({ name: m[1].replace(/\s*\(active\)\s*$/i, ""), firmUuid: m[2] });
    }
  }
  return firms;
}

async function firmNameByUuid(firmUuid, session, sid, env) {
  const result = await mcpCallTool("list_contexts", { firm_uuid: firmUuid }, session.access_token, sid, env).catch(() => null);
  return parseFirms(result).find((f) => f.firmUuid?.toLowerCase() === firmUuid)?.name || "";
}

const contextSet = (result) => /^Context set to firm:[ \t]*(.+)$/m.exec(toolText(result));

// A hostname's one firm, as { firmUuid, name }, or null when the user may not use it.
// set_context is Carta's own access check: it switches to the firm for a user who holds it
// (or a staff user) and returns an ordinary "not found or not authorized" result, not an
// error, for anyone else. Allow and deny are cached per session, so one user's result never
// widens another's.
export async function tenantFirm(tenant, sid, session, env) {
  if (!tenant?.firmUuid) return null;
  const key = tenantFirmKey(sid, tenant.firmUuid);
  const cached = await env.SESSIONS.get(key, "json");
  if (cached) return cached.denied ? null : cached;
  // A failed call throws rather than reading as a denial, and is not cached. Carta's denial
  // is an ordinary result, so an isError result is a failure too.
  const result = await mcpCallTool("set_context", { firm_id: tenant.firmUuid }, session.access_token, sid, env);
  if (result?.isError) throw new Error(toolText(result) || "set_context failed");
  let name = contextSet(result)?.[1].trim() || "";
  // A staff user gets the id echoed back instead of the firm's name.
  if (name.toLowerCase() === tenant.firmUuid) name = (await firmNameByUuid(tenant.firmUuid, session, sid, env)) || name;
  const firm = name ? { firmUuid: tenant.firmUuid, name } : null;
  await env.SESSIONS.put(key, JSON.stringify(firm || { denied: true }), { expirationTtl: TENANT_TTL });
  return firm;
}

// Carta keeps the active firm per user, so another tab or app signed in as the same user
// can move it. Switch back to the hostname's firm before anything that acts on "the active
// firm". True when Carta confirmed the switch.
export async function pinTenant(tenant, sid, session, env) {
  const result = await mcpCallTool("set_context", { firm_id: tenant.firmUuid }, session.access_token, sid, env);
  return !result?.isError && !!contextSet(result);
}
