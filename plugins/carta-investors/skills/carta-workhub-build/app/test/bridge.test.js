// The artifact's own code, loaded with the bridge and talking to the real Worker over a
// stand-in for Carta: proof that resources/ runs unchanged on the hosted page.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../server/worker.js";
import { BRIDGE_JS } from "../server/bridge.js";
import { RESOURCES, mockMcp, text, tokenEnv } from "./helpers.js";

afterEach(() => vi.unstubAllGlobals());

function fakeDocument() {
  const nodes = new Map();
  const element = (id) => ({
    id, style: {}, children: [], textContent: "",
    setAttribute() {}, append(...kids) { this.children.push(...kids); }, prepend(kid) { nodes.set(kid.id, kid); },
    classList: { add() {}, remove() {} },
  });
  return {
    nodes,
    getElementById: (id) => nodes.get(id) || null,
    createElement: () => element(""),
    body: { prepend: (el) => nodes.set(el.id, el) },
  };
}

// Loads the page's scripts in the order the app bundle has them, with the browser's fetch
// pointed at the Worker. Returns the page's global scope.
function loadPage(env = tokenEnv()) {
  const firmNames = [];
  const page = vm.createContext({
    console: { log() {}, error() {}, warn() {} },
    setTimeout, clearTimeout, URLSearchParams, Promise, JSON,
    location: { search: "?t=dev" },
    document: fakeDocument(),
    // Defined by app/fund-admin-requests.js on the real page; boot calls them.
    farSetFirmName: (name) => firmNames.push(name),
    farFetchRequests: async () => {},
    _farRows: null,
    renderFarSection: () => {},
    fetch: (path, init) => worker.fetch(new Request(`http://localhost${path}`, {
      ...init, headers: { ...init.headers, Origin: "http://localhost" },
    }), env),
  });
  page.window = page;
  page.globalThis = page;
  for (const code of [
    BRIDGE_JS,
    readFileSync(RESOURCES + "carta-workhub.tracker.js", "utf8"),
    readFileSync(RESOURCES + "carta-workhub.app.js", "utf8").replace("{{CARTA_MCP_SERVER}}", "Carta"),
  ]) vm.runInContext(code, page);
  return { page, firmNames };
}

const settle = () => new Promise((r) => setTimeout(r, 50));

describe("the artifact's code on the hosted page", () => {
  it("boots onto the hostname's firm without asking Carta for the user's firm list", async () => {
    const calls = mockMcp();
    const { firmNames } = loadPage();
    await settle();
    expect(firmNames).toEqual(["Acme Capital"]);
    expect(calls.map((c) => c.tool)).not.toContain("list_contexts");
  });

  it("gets a tool failure back from _mcp as an isError envelope, so one section degrades", async () => {
    mockMcp({ tools: { "fa__list__workflow-message": { isError: true, ...text("Not found") } } });
    const { page } = loadPage();
    const res = await page._mcp("fetch", { command: "fa:list:workflow-message", params: { workflow_id: 1 } });
    expect(res).toMatchObject({ isError: true, code: "tool_error", content: [{ text: "Not found" }] });
  });

  it("rethrows a lost connection from _mcp rather than reporting the tool as failed", async () => {
    mockMcp({ tools: { "fa__mutate__approve-capital-activity": new Response("", { status: 524 }) } });
    const { page } = loadPage();
    await expect(page._mcp("mutate", { command: "fa:mutate:approve-capital-activity", params: {} }))
      .rejects.toMatchObject({ code: "server_error" });
  });

  it("shows a sign-in banner, without navigating away, when the session has lapsed", async () => {
    mockMcp();
    const { page } = loadPage(tokenEnv({ DASH_TOKEN: "rotated" }));
    await expect(page._mcp("get_current_user", {})).rejects.toMatchObject({ code: "needs_reauth" });
    expect(page.document.getElementById("workhub-signin")).not.toBeNull();
    expect(page.location).toEqual({ search: "?t=dev" });
  });

  it("delivers tracker events to Carta as micro-app traffic", async () => {
    const calls = mockMcp();
    const { page } = loadPage();
    page.trackWorkhub("click", "CartaWorkhub.Compose.Open");
    await settle();
    const event = calls.find((c) => c.tool === "track_ui_event");
    expect(event.args.contexts.find((c) => c.data?.interfaceType).data.interfaceType).toBe("micro_app");
  });
});
