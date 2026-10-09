// What a visitor's browser gets from each route, including the contract the microapps
// deploy smoke-tests on every hostname: / is 200, /auth/login redirects to Carta's
// authorize URL, /api/heartbeat is 401 without a session.
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../server/worker.js";
import { getBuild } from "../server/assemble.js";
import { putSession } from "../server/auth.js";
import { HOST, makeEnv, mockMcp, tokenEnv } from "./helpers.js";

afterEach(() => vi.unstubAllGlobals());

const get = (url, env = makeEnv()) => worker.fetch(new Request(url), env);

describe("smoke contract", () => {
  it("serves the sign-in page at / without a session", async () => {
    const resp = await get(`${HOST}/`);
    expect(resp.status).toBe(200);
    expect(await resp.text()).toContain('href="/auth/login"');
  });

  // The Worker serves no /favicon.ico; without an inline icon the browser logs a 404.
  it("gives the sign-in page an inline favicon", async () => {
    expect(await (await get(`${HOST}/`)).text()).toContain('<link rel="icon" href="data:image/svg+xml,');
  });

  it("sends /auth/login to Carta's authorize URL", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ client_id: "c1" })));
    const resp = await get(`${HOST}/auth/login`);
    expect(resp.status).toBe(302);
    expect(resp.headers.get("Location")).toMatch(/^https:\/\/mcp\.app\.carta\.com\/authorize\?/);
  });

  it("answers /api/heartbeat with 401 without a session", async () => {
    expect((await get(`${HOST}/api/heartbeat`)).status).toBe(401);
  });
});

describe("hosts", () => {
  it.each([
    ["an unmapped label", "https://workhub.initech.carta.cloud/"],
    ["a host off the carta.cloud zone", "https://workhub.example.workers.dev/"],
  ])("gives %s a 404 and calls nothing", async (_case, url) => {
    const calls = mockMcp();
    expect((await get(url)).status).toBe(404);
    expect(calls).toEqual([]);
  });
});

describe("the Workhub page", () => {
  it("is served with a CSP that allows only this origin and Google Fonts", async () => {
    mockMcp();
    const resp = await get("http://localhost/?t=dev", tokenEnv());
    expect(resp.status).toBe(200);
    const csp = resp.headers.get("Content-Security-Policy");
    const external = csp.split(";").flatMap((d) => d.trim().split(/\s+/).slice(1)).filter((s) => /^https?:/.test(s));
    expect(new Set(external)).toEqual(new Set(["https://fonts.googleapis.com", "https://fonts.gstatic.com"]));
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("explains a missing firm instead of loading a page that cannot work", async () => {
    mockMcp({ held: {} });
    const resp = await get("http://localhost/?t=dev", tokenEnv());
    expect(resp.status).toBe(403);
    expect(await resp.text()).toContain("No access to this firm");
  });

  // Carta not answering says nothing about access: "No access" would send a legitimate
  // user off to switch accounts.
  it('says Carta could not be reached, not "no access", when the access check fails', async () => {
    mockMcp();
    fetch.mockImplementationOnce(async () => new Response("", { status: 503 }));
    const resp = await get("http://localhost/?t=dev", tokenEnv());
    expect(resp.status).toBe(502);
    expect(await resp.text()).toContain("Carta could not be reached");
  });

  it("sends a user whose Carta sign-in has lapsed to the sign-in page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    const env = makeEnv();
    await putSession(env, "s1", { access_token: "stale", refresh_token: "gone", redirectUri: `${HOST}/auth/callback` });
    const resp = await worker.fetch(new Request(`${HOST}/`, { headers: { Cookie: "sid=s1" } }), env);
    expect(resp.status).toBe(200);
    expect(await resp.text()).toContain('href="/auth/login"');
  });

  it("serves the current build's scripts, cacheable for good", async () => {
    const env = tokenEnv();
    const { app } = (await getBuild(env)).bundles;
    const resp = await get(`http://localhost/b/${app.id}/app.js`, env);
    expect(resp.headers.get("Cache-Control")).toContain("immutable");
    expect(await resp.text()).toBe(app.body);
  });

  it("does not serve another build's scripts", async () => {
    expect((await get("http://localhost/b/00000000/app.js", tokenEnv())).status).toBe(404);
  });

  it("never serves the raw source files", async () => {
    expect((await get("http://localhost/carta-workhub.template.html?t=dev", tokenEnv())).status).toBe(404);
  });
});
