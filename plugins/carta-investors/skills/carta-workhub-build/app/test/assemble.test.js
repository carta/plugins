// The hosted page must run exactly the code the artifact runs. These compare the Worker's
// assembly with scripts/build_artifact.py, the artifact's own build.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import PARTS from "../../scripts/artifact_parts.json";
import { assemble } from "../server/assemble.js";
import { RESOURCES, SKILL_DIR, makeEnv } from "./helpers.js";

const built = await assemble(makeEnv());
const source = (name) => readFileSync(RESOURCES + name, "utf8");

function artifactBuildId() {
  try {
    return execFileSync("python3", ["-c", [
      "import importlib.util, sys",
      `spec = importlib.util.spec_from_file_location('b', ${JSON.stringify(SKILL_DIR + "scripts/build_artifact.py")})`,
      "b = importlib.util.module_from_spec(spec); spec.loader.exec_module(b)",
      // The microapps deploy checks out only this skill, so the plugin's version registry is
      // absent; the version is not part of the build id, which hashes the template and parts.
      "b.read_version = lambda: '0.0.0'",
      "print(b.build('Carta')[1])",
    ].join("\n")], { encoding: "utf8" }).trim();
  } catch (e) {
    // Skip only when this machine has no python3; a failing artifact build must fail here.
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
const pythonBuildId = artifactBuildId();

describe("assembly", () => {
  it.skipIf(!pythonBuildId)("stamps the same build id as the artifact built from the same source", () => {
    expect(built.buildId).toBe(pythonBuildId);
  });

  it("loads the two script blocks as files, the bridge first in the app bundle", () => {
    expect(built.page).toContain(`<script src="/b/${built.bundles.pdf.id}/pdf.js"></script>`);
    expect(built.page).toContain(`<script src="/b/${built.bundles.app.id}/app.js"></script>`);
    expect(built.bundles.app.body.startsWith("(function installBridge(")).toBe(true);
  });

  // Browsers keep a bundle for good, so a bridge-only change must move its address.
  it("addresses the app bundle by its own content, which covers the bridge", async () => {
    const env = makeEnv();
    const { bundles } = await assemble(env);
    expect(bundles.app.id).toBe(built.bundles.app.id);
    const { createHash } = await import("node:crypto");
    expect(bundles.app.id).toBe(createHash("sha256").update(bundles.app.body).digest("hex").slice(0, 8));
  });

  it("concatenates the app parts in the artifact's order, in one script", () => {
    const at = PARTS.app_js_parts.map((name) => built.bundles.app.body.indexOf(source(name).slice(0, 200).replace("{{CARTA_MCP_SERVER}}", "Carta")));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("inlines the stylesheet as the artifact does", () => {
    expect(built.page).toContain(source("carta-workhub.css").slice(0, 200));
  });

  it("addresses the Carta connector as Carta and stamps the hosted version", () => {
    expect(built.bundles.app.body).toContain('const CARTA_MCP_SERVER = "Carta";');
    expect(built.page).toContain(`vhosted · build ${built.buildId}`);
  });

  // build_artifact.py fills the same list; a placeholder only one builder knows would
  // reach the hosted page as literal {{TEXT}}.
  it("refuses to serve a page with a placeholder it has no value for", async () => {
    const assets = makeEnv().ASSETS;
    const env = makeEnv({ ASSETS: { fetch: async (req) => {
      const resp = await assets.fetch(req);
      if (!req.url.endsWith(PARTS.template)) return resp;
      return new Response((await resp.text()).replace("</body>", "{{NEW_SEED}}</body>"));
    } } });
    await expect(assemble(env)).rejects.toThrow("{{NEW_SEED}}");
  });
});
