(() => {
  const PLUGIN = "carta-cap-table";
  const SKILL = "carta-captable-home-build";
  const CACHE_KEY = SKILL + ".bundle";
  const config = window.CAPTABLE_HOME;
  const FAILED = "Carta Home could not load. Check that the Carta connector is connected.";

  function parse(text) { try { return JSON.parse(text); } catch { return null; } }

  function isBundle(b) {
    return !!b && typeof b.build_id === "string" && ["html", "css", "js"].every(kind =>
      Array.isArray(b[kind]) && b[kind].every(part => typeof part === "string")) && b.js.length > 0;
  }

  function answerOf(res) {
    const found = [res, res?.structuredContent, res?.result];
    (Array.isArray(res?.content) ? res.content : []).forEach(c => { if (c?.type === "text") found.push(c.text); });
    for (const item of found) {
      let value = typeof item === "string" ? parse(item) : item;
      if (value && typeof value.result === "string") value = parse(value.result) ?? value;
      if (value && typeof value === "object" && "build_id" in value) return value;
    }
    return null;
  }

  // carta-mcp's build_id: the sha256 of the parts as compact JSON, [html, css, js].
  async function digest(b) {
    const bytes = new TextEncoder().encode(JSON.stringify([b.html, b.css, b.js]));
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return Array.from(hash, byte => byte.toString(16).padStart(2, "0")).join("");
  }

  async function verified(b) {
    try { return isBundle(b) && await digest(b) === b.build_id; } catch { return false; }
  }

  function readCache() { try { return parse(localStorage.getItem(CACHE_KEY)); } catch { return null; } }
  function clearCache() { try { localStorage.removeItem(CACHE_KEY); } catch {} }
  function store(b) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ version: b.version, build_id: b.build_id, html: b.html, css: b.css, js: b.js }));
    } catch {
      clearCache();
    }
  }

  async function ask(ifBuildId) {
    try {
      const mcp = await window.claude?.use?.("mcp");
      if (!mcp) return null;
      const args = { plugin: PLUGIN, skill: SKILL };
      if (ifBuildId) args.if_build_id = ifBuildId;
      return answerOf(await mcp.callTool(config.mcpServer, "read_tool", {
        name: "plugin__get__artifact_bundle",
        arguments: args,
        _instrumentation_v2: { skills: [PLUGIN + ":" + SKILL], from_ui: true },
      }));
    } catch {
      return null;
    }
  }

  // One script for every JS part, as the built page has: one scope, and the first part's
  // "use strict" covers all of them.
  function start(b) {
    config.version = b.version;
    config.buildId = b.build_id;
    status.remove();
    document.body.insertAdjacentHTML("afterbegin", b.html.join(""));
    b.css.forEach(css => {
      const style = document.createElement("style");
      style.textContent = css;
      document.head.appendChild(style);
    });
    const script = document.createElement("script");
    script.textContent = b.js.join("\n;\n");
    document.body.appendChild(script);
  }

  const look = document.createElement("style");
  look.textContent = ".shell-status{font:14px/1.5 system-ui,sans-serif;color:#3d3d3d;padding:64px 24px;text-align:center}"
    + ".shell-status button{margin-left:8px;font:inherit;padding:4px 14px;border:1px solid #8c8c8c;border-radius:4px;background:#fff;color:inherit;cursor:pointer}";
  document.head.appendChild(look);
  const status = document.createElement("div");
  status.className = "shell-status";
  status.setAttribute("role", "status");
  document.body.prepend(status);

  function show(text, retry) {
    status.replaceChildren(text);
    if (retry) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Retry";
      button.onclick = load;
      status.append(button);
    }
  }

  // Without a secure context there is no digest, so the page keeps no cache and runs the
  // answer of this call.
  async function loadUncached() {
    const b = await ask(null);
    if (!isBundle(b)) return show(FAILED, true);
    start(b);
  }

  async function load() {
    show("Loading Carta Home…");
    if (!globalThis.crypto?.subtle) return loadUncached();
    const cached = readCache();
    let b = await ask(typeof cached?.build_id === "string" ? cached.build_id : null);
    if (b?.unchanged === true) {
      const kept = { ...cached, version: b.version };
      if (b.build_id === cached?.build_id && await verified(kept)) return start(kept);
      clearCache();
      b = await ask(null);
    }
    if (!(await verified(b))) return show(FAILED, true);
    store(b);
    start(b);
  }

  load();
})();
