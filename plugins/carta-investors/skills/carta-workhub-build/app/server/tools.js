// POST /api/tool — the page's only way to reach Carta. Every call is checked against a
// closed allowlist and against the hostname's firm before it leaves the Worker.
import COMMANDS from "./commands.json";
import { mcpCallTool, requireAuth, TokenExpired, unauthorized } from "./auth.js";
import { pinTenant, pinTenantForRead, tenantFirm } from "./tenancy.js";

const PASS_THROUGH = new Set(["welcome", "discover", "get_current_user"]);
const READ_VERBS = new Set(["get", "list"]);

const sameFirm = (a, b) => typeof a === "string" && a.toLowerCase() === b;

// Carta MCP serves each gateway command as its own tool: fa:list:firm-workflow is fa__list__firm-workflow.
export const commandTool = (command) => command.replaceAll(":", "__");

// The tracker stamps the interface the artifact declares; hosted traffic is a micro-app.
function asMicroApp(args) {
  const contexts = Array.isArray(args?.contexts)
    ? args.contexts.map((c) => (c?.data?.interfaceType ? { ...c, data: { ...c.data, interfaceType: "micro_app" } } : c))
    : args?.contexts;
  return { ...args, contexts };
}

function firmsAnswer(firm) {
  const firms = [{ firm_id: firm.firmUuid, firm_name: firm.name, is_active: true }];
  return { structuredContent: { firms }, content: [{ type: "text", text: JSON.stringify({ firms }) }] };
}

// What one page call becomes, decided before anything is sent:
//   { refuse }                     — not allowed here
//   { answer }                     — answered by the Worker itself
//   { name, arguments, pin }       — the Carta tool to call; pin = switch Carta back to the
//                                    hostname's firm first: "write" every time, "read" for a
//                                    list that follows the active firm, else false
export function routeTool(tool, args, firm) {
  const { _instrumentation_v2, ...rest } = args && typeof args === "object" ? args : {};
  const stamp = _instrumentation_v2 ? { _instrumentation_v2 } : {};
  switch (tool) {
    case "list_contexts":
      return { answer: firmsAnswer(firm) };
    case "set_context":
      return sameFirm(rest.firm_id, firm.firmUuid)
        ? { name: tool, arguments: { firm_id: firm.firmUuid, ...stamp }, pin: false }
        : { refuse: "This Workhub belongs to another firm." };
    case "track_ui_event":
      return { name: tool, arguments: asMicroApp(args), pin: false };
    case "fetch":
    case "mutate": {
      const { command } = rest;
      const scope = typeof command === "string" && Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : null;
      if (!scope) return { refuse: `${command} is not available in the hosted Workhub.` };
      const params = rest.params && typeof rest.params === "object" ? rest.params : {};
      if (scope === "firm-param" && !sameFirm(params.firm_uuid, firm.firmUuid)) {
        return { refuse: "This Workhub belongs to another firm." };
      }
      const writes = tool === "mutate" || !READ_VERBS.has(command.split(":")[1]);
      const pin = writes ? "write" : scope === "active-firm" ? "read" : false;
      return { name: commandTool(command), arguments: { ...params, ...stamp }, pin };
    }
    default:
      return PASS_THROUGH.has(tool) ? { name: tool, arguments: args || {}, pin: false } : { refuse: `${tool} is not available in the hosted Workhub.` };
  }
}

// A refusal reads like a tool that ran and failed (200, isError): the page already handles
// that per section, and the artifact's version check expects exactly this when the
// hosted app declines plugin:get:version.
const refusal = (text) => Response.json({ isError: true, content: [{ type: "text", text }] });
const unreachable = () => Response.json({ error: "Carta could not be reached" }, { status: 502 });

// *.carta.cloud hosts are same-site with each other and the session is a cookie, so a
// write must prove it came from this page: JSON body, own Origin.
function fromOwnPage(req) {
  const type = req.headers.get("Content-Type") || "";
  return type.split(";")[0].trim() === "application/json" && req.headers.get("Origin") === new URL(req.url).origin;
}

export async function handleTool(req, env, tenant) {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  if (!fromOwnPage(req)) return Response.json({ error: "forbidden" }, { status: 403 });
  const [sid, session, authErr] = await requireAuth(req, env);
  if (authErr) return authErr;
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  try {
    const firm = await tenantFirm(tenant, sid, session, env);
    if (!firm) return refusal("You do not have access to this firm in Carta.");
    const route = routeTool(body?.tool, body?.args, firm);
    if (route.refuse) return refusal(route.refuse);
    if (route.answer) return Response.json(route.answer);
    const switchFirm = route.pin === "read" ? pinTenantForRead : pinTenant;
    if (route.pin && !(await switchFirm(tenant, sid, session, env))) {
      return refusal("Carta could not switch to this firm. Nothing was sent.");
    }
    // A tool that ran and failed answers 200 with isError; the bridge tells it apart from
    // a transport failure (502), which the page must not read as "nothing happened".
    return Response.json(await mcpCallTool(route.name, route.arguments, session.access_token, sid, env));
  } catch (e) {
    return e instanceof TokenExpired ? unauthorized("token_expired") : unreachable();
  }
}
