// Builds the hosted page from resources/, following scripts/build_artifact.py: the same
// template, the same parts in the same order (scripts/artifact_parts.json), the same
// build id. Two differences, both about delivery: the two script blocks are served as
// cacheable files instead of inlined, and the app bundle starts with the bridge that
// stands in for the artifact runtime.
import PARTS from "../../scripts/artifact_parts.json";
import { BRIDGE_JS } from "./bridge.js";
import { FAVICON } from "./pages.js";

const ASSET_ORIGIN = "https://assets.invalid";
const MARKER_TOKENS = [...Object.values(PARTS.markers), PARTS.app_js_marker, PARTS.pdfjs_marker];
// This surface's value for each placeholder artifact_parts.json lists; build_artifact.py
// keeps the artifact's.
const VALUES = {
  "{{CARTA_MCP_SERVER}}": "Carta",
  "{{CCR_FUND_UUID}}": "",
  "{{CCR_ACTIVITY_ID}}": "",
  "{{FRT_SEED_PERIOD}}": "",
  // Carta deploys every firm the same build, so there is no per-user version to compare.
  "{{ARTIFACT_VERSION}}": "hosted",
};
const PLACEHOLDER_RE = /\{\{[A-Z_]+\}\}/;
const markerRe = (token) => new RegExp(String.raw`/\*\s*${token}\s*\*/`);

async function readAsset(env, name) {
  const resp = await env.ASSETS.fetch(new Request(`${ASSET_ORIGIN}/${name}`));
  if (!resp.ok) throw new Error(`asset ${name} answered ${resp.status}`);
  return resp.text();
}

async function shortHash(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 8);
}

// Same digest as build_artifact.py's compute_build_id, so one source shows one build id
// on both surfaces.
export function computeBuildId(template, parts) {
  const chunks = [template];
  for (const name of Object.keys(parts).sort()) chunks.push(name, parts[name]);
  return shortHash(chunks.join(""));
}

function substitute(text, buildId) {
  const values = { ...VALUES, "{{BUILD_ID}}": buildId };
  return PARTS.placeholders.reduce((out, placeholder) => {
    if (!Object.hasOwn(values, placeholder)) throw new Error(`no value for ${placeholder} (listed in artifact_parts.json)`);
    return out.replaceAll(placeholder, values[placeholder]);
  }, text);
}

export async function assemble(env) {
  const names = [...Object.keys(PARTS.markers), ...PARTS.app_js_parts, ...PARTS.pdfjs_parts];
  const [template, ...texts] = await Promise.all([PARTS.template, ...names].map((n) => readAsset(env, n)));
  const parts = Object.fromEntries(names.map((n, i) => [n, texts[i]]));
  const buildId = await computeBuildId(template, parts);

  const content = {
    ...Object.fromEntries(Object.entries(PARTS.markers).map(([name, token]) => [token, parts[name]])),
    [PARTS.app_js_marker]: PARTS.app_js_parts.map((n) => parts[n]).join("\n\n"),
    [PARTS.pdfjs_marker]: PARTS.pdfjs_parts.map((n) => parts[n]).join("\n"),
  };
  // A function replacement keeps `$` sequences in the sources literal.
  const fill = (text) => MARKER_TOKENS.reduce((out, token) => out.replace(markerRe(token), () => content[token]), text);

  let app = null;
  let pdf = null;
  let page = template.replace(/<script>([\s\S]*?)<\/script>/g, (block, body) => {
    if (markerRe(PARTS.pdfjs_marker).test(body)) {
      pdf = fill(body);
      return "<!--pdf.js-->";
    }
    if (markerRe(PARTS.app_js_marker).test(body)) {
      app = substitute(`${BRIDGE_JS}\n${fill(body)}`, buildId);
      return "<!--app.js-->";
    }
    return block;
  });
  if (app === null || pdf === null) throw new Error("template is missing a script marker");
  // Each bundle is addressed by its own content, so a change to the bridge alone still
  // reaches browsers that cache the previous bundle for good.
  const bundles = { app: { id: await shortHash(app), body: app }, pdf: { id: await shortHash(pdf), body: pdf } };
  page = fill(page)
    .replace("<!--pdf.js-->", `<script src="/b/${bundles.pdf.id}/pdf.js"></script>`)
    .replace("<!--app.js-->", `<script src="/b/${bundles.app.id}/app.js"></script>`)
    .replace("</head>", `${FAVICON}\n</head>`);

  const built = { buildId, page: substitute(page, buildId), bundles };
  for (const text of [built.page, app, pdf]) {
    const left = MARKER_TOKENS.find((t) => text.includes(t)) || PLACEHOLDER_RE.exec(text)?.[0];
    if (left) throw new Error(`unresolved ${left} after assembly`);
  }
  return built;
}

// resources/ only changes with a deploy, so one assembly serves the Worker's lifetime.
const builds = new WeakMap();
export function getBuild(env) {
  if (!builds.has(env.ASSETS)) {
    const pending = assemble(env);
    pending.catch(() => builds.delete(env.ASSETS));
    builds.set(env.ASSETS, pending);
  }
  return builds.get(env.ASSETS);
}
