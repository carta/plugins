// /api/tool is the page's only path to Carta: these pin what it lets through, what it
// refuses, and how it keeps every call on the hostname's firm.
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../server/worker.js";
import { routeTool } from "../server/tools.js";
import { tenantFirmKey } from "../server/tenancy.js";
import { ACME, GLOBEX, mockMcp, text, tokenEnv, toolRequest } from "./helpers.js";

afterEach(() => vi.unstubAllGlobals());

const FIRM = { firmUuid: ACME, name: "Acme Capital" };
const STAMP = { _instrumentation_v2: { skills: ["carta-investors:carta-workhub-build"], from_ui: true } };

describe("routeTool", () => {
  it("translates a gateway command into Carta's own tool name, keeping the UI stamp", () => {
    const route = routeTool("fetch", { command: "fa:list:workflow-message", params: { workflow_id: 7 }, ...STAMP }, FIRM);
    expect(route).toEqual({ name: "fa__list__workflow-message", arguments: { workflow_id: 7, ...STAMP }, pin: false });
  });

  it.each([
    ["a tool outside the allowlist", "dwh__execute__query", {}],
    ["a command outside the allowlist", "fetch", { command: "fa:list:entities" }],
    ["the artifact's version check, which has nothing to compare on a hosted page", "fetch", { command: "plugin:get:version" }],
    ["a command smuggled as an inherited property", "fetch", { command: "constructor" }],
  ])("refuses %s", (_case, tool, args) => {
    expect(routeTool(tool, args, FIRM).refuse).toBeTruthy();
  });

  it("answers list_contexts with only the hostname's firm, so the page's firm detection lands on it", () => {
    const { answer } = routeTool("list_contexts", {}, FIRM);
    expect(answer.structuredContent.firms).toEqual([{ firm_id: ACME, firm_name: "Acme Capital", is_active: true }]);
  });

  it.each([
    ["set_context to another firm", "set_context", { firm_id: GLOBEX }],
    ["a tracker read for another firm", "fetch", { command: "fa:get:reporting-status", params: { firm_uuid: GLOBEX } }],
  ])("refuses %s", (_case, tool, args) => {
    expect(routeTool(tool, args, FIRM).refuse).toMatch(/another firm/);
  });

  it("accepts the hostname's own firm whatever its letter case", () => {
    const route = routeTool("fetch", { command: "fa:get:reporting-status", params: { firm_uuid: ACME.toUpperCase() } }, FIRM);
    expect(route.name).toBe("fa__get__reporting-status");
  });

  it.each([
    ["a list that follows the active firm", "fetch", "fa:list:gp-workhub-active-task"],
    ["a new request, which carries no firm", "mutate", "fa:create:fund-admin-message"],
    ["a write scoped by id", "mutate", "fa:mutate:approve-capital-activity"],
  ])("switches Carta to the hostname's firm first for %s", (_case, tool, command) => {
    expect(routeTool(tool, { command, params: {} }, FIRM).pin).toBe(true);
  });

  it.each([
    ["a read scoped by id", "fa:get:capital-activity-review-summary"],
    ["a read naming its firm", "fa:get:reporting-status"],
  ])("leaves Carta's active firm alone for %s", (_case, command) => {
    expect(routeTool("fetch", { command, params: { firm_uuid: ACME } }, FIRM).pin).toBe(false);
  });

  it("relabels tracker events as micro-app traffic", () => {
    const contexts = [{ schema: "iglu:interface", data: { interfaceType: "artifact", interfaceId: "carta-workhub" } }, { schema: "iglu:product", data: { name: "CartaWorkhub" } }];
    const route = routeTool("track_ui_event", { event: { elementId: "CartaWorkhub.Compose.Open" }, contexts }, FIRM);
    expect(route.arguments.contexts[0].data).toEqual({ interfaceType: "micro_app", interfaceId: "carta-workhub" });
    expect(route.arguments.contexts[1]).toEqual(contexts[1]);
  });
});

describe("POST /api/tool", () => {
  const call = (tool, args, opts) => worker.fetch(toolRequest(tool, args, opts), tokenEnv());

  it.each([
    ["another site's Origin", { origin: "https://evil.example" }],
    ["a form post", { type: "text/plain" }],
  ])("rejects %s before any Carta call", async (_case, opts) => {
    const calls = mockMcp();
    expect((await call("get_current_user", {}, opts)).status).toBe(403);
    expect(calls).toEqual([]);
  });

  it("refuses a call outside the allowlist as a tool error and sends nothing to Carta", async () => {
    const calls = mockMcp();
    const resp = await call("fetch", { command: "fa:list:entities", params: {} });
    expect(resp.status).toBe(200);
    expect((await resp.json()).isError).toBe(true);
    expect(calls.map((c) => c.tool)).not.toContain("fa__list__entities");
  });

  it("switches Carta back to the hostname's firm right before a write", async () => {
    const calls = mockMcp();
    const env = tokenEnv();
    // A warm access-check cache, so the only set_context left is the pin.
    await env.SESSIONS.put(tenantFirmKey("local", ACME), JSON.stringify(FIRM));
    await worker.fetch(toolRequest("mutate", { command: "fa:create:fund-admin-message", params: { message: "hi" } }), env);
    expect(calls.map((c) => [c.tool, c.args.firm_id])).toEqual([
      ["set_context", ACME],
      ["fa__create__fund-admin-message", undefined],
    ]);
  });

  it("sends nothing when Carta will not switch to the hostname's firm", async () => {
    let switches = 0;
    const calls = mockMcp();
    fetch.mockImplementation(async (_url, init) => {
      const { params } = JSON.parse(init.body);
      calls.push({ tool: params.name });
      // The first switch (the access check) succeeds; the pin before the write does not.
      const ok = params.name === "set_context" && switches++ === 0;
      return Response.json({ jsonrpc: "2.0", id: "1", result: text(ok ? "Context set to firm: Acme Capital" : "not authorized") });
    });
    const body = await (await call("mutate", { command: "fa:create:fund-admin-message", params: { message: "hi" } })).json();
    expect(body.isError).toBe(true);
    expect(calls.map((c) => c.tool)).not.toContain("fa__create__fund-admin-message");
  });

  it("passes a tool that ran and failed through as isError", async () => {
    mockMcp({ tools: { "fa__get__capital-activity-review-summary": { isError: true, ...text("Not found") } } });
    const body = await (await call("fetch", { command: "fa:get:capital-activity-review-summary", params: {} })).json();
    expect(body).toMatchObject({ isError: true, content: [{ text: "Not found" }] });
  });

  it("turns a JSON-RPC error into isError, the shape the page reads per section", async () => {
    mockMcp({ tools: { get_current_user: new Response(JSON.stringify({ jsonrpc: "2.0", id: "1", error: { code: -32602, message: "Unknown tool" } })) } });
    expect(await (await call("get_current_user", {})).json()).toMatchObject({ isError: true, content: [{ text: "Unknown tool" }] });
  });

  // The release panel reads isError as "nothing was sent to investors" and a rejection as
  // "still running": an upstream timeout during approve must never read as the former.
  it("answers 502, not isError, when Carta times out during a release", async () => {
    mockMcp({ tools: { "fa__mutate__approve-capital-activity": new Response("upstream timeout", { status: 524 }) } });
    const resp = await call("mutate", { command: "fa:mutate:approve-capital-activity", params: {} });
    expect(resp.status).toBe(502);
    expect((await resp.json()).isError).toBeUndefined();
  });

  it("answers 502, not a refusal, when Carta does not answer the access check", async () => {
    mockMcp();
    fetch.mockImplementationOnce(async () => new Response("", { status: 503 }));
    expect((await call("get_current_user", {})).status).toBe(502);
  });

  it("answers 401 without a session", async () => {
    mockMcp();
    const req = new Request("http://localhost/api/tool", {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost" }, body: "{}",
    });
    expect((await worker.fetch(req, tokenEnv())).status).toBe(401);
  });
});
