// A hostname maps to one firm UUID and Carta's set_context decides whether the signed-in
// user may use it. The allow/deny cache is keyed by session: one user's result must
// never widen another's. Sessions sit in KV encrypted.
import { afterEach, describe, expect, it, vi } from "vitest";
import { getStoredSession, mcpCallTool, putSession } from "../server/auth.js";
import { tenantFirm, tenantFirmKey, tenantOf } from "../server/tenancy.js";
import { ACME, GLOBEX, SESSION_KEY, fakeKV, makeEnv, mockMcp } from "./helpers.js";

afterEach(() => vi.unstubAllGlobals());

const firmFor = (url, env = makeEnv()) => tenantOf(new Request(url), env)?.firmUuid ?? null;

describe("tenantOf", () => {
  it("maps a label to its firm UUID, lowercased", () => {
    const env = makeEnv({ TENANTS: JSON.stringify({ acme: ACME.toUpperCase() }) });
    expect(firmFor("https://workhub.acme.carta.cloud/", env)).toBe(ACME);
  });

  it.each([
    ["an unmapped label", "https://workhub.initech.carta.cloud/"],
    ["an inherited property name", "https://workhub.constructor.carta.cloud/"],
    ["a deeper hostname", "https://a.workhub.acme.carta.cloud/"],
  ])("gives %s no firm", (_case, url) => {
    expect(firmFor(url)).toBeNull();
  });

  it("denies everything when the map does not parse", () => {
    expect(firmFor("https://workhub.acme.carta.cloud/", makeEnv({ TENANTS: "{not json" }))).toBeNull();
  });

  it("serves no host off the carta.cloud zone, such as workers.dev", () => {
    expect(tenantOf(new Request("https://workhub.example.workers.dev/"), makeEnv())).toBeNull();
  });

  it("takes the one firm from LOCAL_FIRM_UUID in token mode", () => {
    expect(firmFor("http://localhost:8787/", makeEnv({ AUTH_MODE: "token", LOCAL_FIRM_UUID: ACME }))).toBe(ACME);
  });
});

describe("tenantFirm", () => {
  const session = (sid) => ({ access_token: `tok-${sid}` });

  it("admits a user who holds the hostname's firm, by Carta's name for it", async () => {
    mockMcp();
    expect(await tenantFirm({ firmUuid: ACME }, "s1", session("s1"), makeEnv())).toEqual({ firmUuid: ACME, name: "Acme Capital" });
  });

  it("denies a user Carta will not switch to the firm", async () => {
    mockMcp({ held: {} });
    expect(await tenantFirm({ firmUuid: ACME }, "s1", session("s1"), makeEnv())).toBeNull();
  });

  it("keeps one session's answer from deciding another's", async () => {
    const env = makeEnv();
    mockMcp();
    await tenantFirm({ firmUuid: ACME }, "allowed", session("allowed"), env);
    mockMcp({ held: {} });
    expect(await tenantFirm({ firmUuid: ACME }, "other", session("other"), env)).toBeNull();
  });

  it("throws on a failed lookup instead of reading it as a denial, and caches nothing", async () => {
    const env = makeEnv();
    mockMcp();
    fetch.mockImplementationOnce(async () => new Response("", { status: 500 }));
    await expect(tenantFirm({ firmUuid: ACME }, "s1", session("s1"), env)).rejects.toThrow();
    expect(await tenantFirm({ firmUuid: ACME }, "s1", session("s1"), env)).toEqual({ firmUuid: ACME, name: "Acme Capital" });
  });

  it("throws on a tool error from set_context, which is never Carta's denial, and caches nothing", async () => {
    const env = makeEnv();
    mockMcp();
    fetch.mockImplementationOnce(async () =>
      Response.json({ jsonrpc: "2.0", id: "1", error: { code: -32603, message: "Internal error" } }));
    await expect(tenantFirm({ firmUuid: ACME }, "s1", session("s1"), env)).rejects.toThrow("Internal error");
    expect(env.SESSIONS.store.has(tenantFirmKey("s1", ACME))).toBe(false);
  });

  it("looks a staff user's firm name up when Carta echoes the UUID back", async () => {
    mockMcp({
      held: { [ACME]: ACME },
      tools: { list_contexts: { structuredContent: { firms: [{ firm_id: ACME, firm_name: "Acme Capital" }] } } },
    });
    expect((await tenantFirm({ firmUuid: ACME }, "s1", session("s1"), makeEnv()))?.name).toBe("Acme Capital");
  });

  it("never asks Carta about a firm other than the hostname's", async () => {
    const calls = mockMcp({ held: { [ACME]: "Acme Capital", [GLOBEX]: "Globex" } });
    await tenantFirm({ firmUuid: ACME }, "s1", session("s1"), makeEnv());
    expect(calls.map((c) => c.args.firm_id)).toEqual([ACME]);
  });
});

describe("MCP transport", () => {
  it("stores Carta's MCP session id only when it changes, since the page calls in bursts", async () => {
    const env = makeEnv();
    mockMcp({ headers: { "Mcp-Session-Id": "m-1" } });
    for (let i = 0; i < 3; i++) await mcpCallTool("get_current_user", {}, "tok", "s1", env);
    expect(env.SESSIONS.puts.filter((k) => k === "mcp-session:s1")).toHaveLength(1);
  });

  it("sends a signed-in user's token only to Carta, whatever MCP_BASE says", async () => {
    const calls = mockMcp();
    await mcpCallTool("get_current_user", {}, "tok", "s1", makeEnv({ MCP_BASE: "https://fixtures.example" }));
    expect(calls[0].url).toBe("https://mcp.app.carta.com/mcp");
  });

  it("points at MCP_BASE in token mode, for the local fixture run", async () => {
    const calls = mockMcp();
    await mcpCallTool("get_current_user", {}, "tok", "s1", makeEnv({ AUTH_MODE: "token", MCP_BASE: "http://127.0.0.1:8790" }));
    expect(calls[0].url).toBe("http://127.0.0.1:8790/mcp");
  });
});

describe("session encryption at rest", () => {
  const env = () => ({ SESSION_KEY, SESSIONS: fakeKV() });
  const tokens = { access_token: "access-secret", refresh_token: "refresh-secret" };

  it("round-trips a session and stores no token in the clear", async () => {
    const e = env();
    await putSession(e, "sid1", tokens);
    expect(await getStoredSession(e, "sid1")).toEqual(tokens);
    for (const secret of Object.values(tokens)) expect(e.SESSIONS.store.get("session:sid1")).not.toContain(secret);
  });

  it("will not open a blob copied under another session's key", async () => {
    const e = env();
    await putSession(e, "victim", tokens);
    e.SESSIONS.store.set("session:attacker", e.SESSIONS.store.get("session:victim"));
    expect(await getStoredSession(e, "attacker")).toBeNull();
  });

  it("reads a tampered or plaintext entry as signed out", async () => {
    const e = env();
    await putSession(e, "sid1", tokens);
    const [v, iv, ct] = e.SESSIONS.store.get("session:sid1").split(".");
    e.SESSIONS.store.set("session:sid1", [v, iv, ct.replace(/^./, ct[0] === "A" ? "B" : "A")].join("."));
    e.SESSIONS.store.set("session:old", JSON.stringify(tokens));
    expect(await getStoredSession(e, "sid1")).toBeNull();
    expect(await getStoredSession(e, "old")).toBeNull();
  });

  it("refuses to run without a key, rather than store plaintext", async () => {
    const e = { SESSIONS: fakeKV() };
    await expect(putSession(e, "sid1", tokens)).rejects.toThrow("SESSION_KEY is not set");
    expect(e.SESSIONS.store.size).toBe(0);
  });
});
