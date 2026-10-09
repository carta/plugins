// Shared stand-ins for the Worker's bindings and for Carta MCP.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";

export const RESOURCES = fileURLToPath(new URL("../../resources/", import.meta.url));
export const SKILL_DIR = fileURLToPath(new URL("../../", import.meta.url));

export const ACME = "11111111-1111-1111-1111-111111111111";
export const GLOBEX = "22222222-2222-2222-2222-222222222222";
export const HOST = "https://workhub.acme.carta.cloud";

// 32 zero bytes, base64. Test-only; real keys are Worker secrets.
export const SESSION_KEY = btoa(String.fromCharCode(...new Uint8Array(32)));

export function fakeKV(seed = {}) {
  const store = new Map(Object.entries(seed));
  const puts = [];
  return {
    store,
    puts,
    get: async (k, type) => {
      const v = store.get(k);
      if (v == null) return null;
      return type === "json" ? JSON.parse(v) : v;
    },
    put: async (k, v) => { puts.push(k); store.set(k, v); },
    delete: async (k) => { store.delete(k); },
  };
}

// The Worker's ASSETS binding, serving the real resources/ directory.
export const fakeAssets = () => ({
  fetch: async (req) => {
    try {
      return new Response(await readFile(RESOURCES + new URL(req.url).pathname.slice(1), "utf8"));
    } catch {
      return new Response("", { status: 404 });
    }
  },
});

export const makeEnv = (overrides = {}) => ({
  TENANTS: JSON.stringify({ acme: ACME, globex: GLOBEX }),
  SESSION_KEY,
  SESSIONS: fakeKV(),
  ASSETS: fakeAssets(),
  ...overrides,
});

const rpc = (result, headers = {}) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id: "1", result }), {
    headers: { "Content-Type": "application/json", ...headers },
  });

export const text = (t) => ({ content: [{ type: "text", text: t }] });

// Stand-in for Carta MCP. `held` maps firm UUID -> name for the firms the user may use;
// set_context answers the way Carta does. `tools` answers any other tool by name, as a
// result object or a Response (for transport failures). Every call is recorded.
export function mockMcp({ held = { [ACME]: "Acme Capital" }, tools = {}, headers = {} } = {}) {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    const { params } = JSON.parse(init.body);
    calls.push({ url: String(url), tool: params.name, args: params.arguments });
    if (params.name === "set_context") {
      const name = held[params.arguments.firm_id];
      return rpc(text(name ? `Context set to firm: ${name}\n\nYou are operating as a firm user.`
        : `Firm '${params.arguments.firm_id}' not found or not authorized.`), headers);
    }
    const answer = tools[params.name];
    if (answer instanceof Response) return answer;
    if (typeof answer === "function") return rpc(answer(params.arguments), headers);
    return rpc(answer ?? text("ok"), headers);
  }));
  return calls;
}

// Token mode is the Worker's local run: no OAuth, the one firm comes from LOCAL_FIRM_UUID.
export const tokenEnv = (overrides = {}) =>
  makeEnv({ AUTH_MODE: "token", DASH_TOKEN: "dev", LOCAL_FIRM_UUID: ACME, ...overrides });

export function toolRequest(tool, args, { origin = "http://localhost", host = "http://localhost", type = "application/json" } = {}) {
  return new Request(`${host}/api/tool?t=dev`, {
    method: "POST",
    headers: { "Content-Type": type, Origin: origin },
    body: JSON.stringify({ tool, args }),
  });
}
