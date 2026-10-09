// The page-side half of the hosted app. The artifact's code reaches Carta only through
// the artifact runtime's `window.claude.use("mcp").callTool(server, tool, args)`; this
// defines that same API over the Worker's /api/tool, so resources/ runs unchanged. It also
// defines `window.app.callServerTool`, the relay the vendored Snowplow tracker looks for,
// which gives the hosted page the working analytics transport the artifact lacks.
//
// Kept as source text, not a stringified function: the Worker's bundler rewrites function
// bodies (it injects helpers such as __name), which would break the copy sent to the page.
export const BRIDGE_JS = `(function installBridge(win) {
  const headers = { "Content-Type": "application/json" };
  // Token mode (the local run) authenticates with ?t=; a hosted page has no such param.
  const token = new URLSearchParams(win.location.search).get("t");
  if (token) headers["X-Dash-Token"] = token;

  function failure(message, code, result) {
    const err = new Error(message);
    err.code = code;
    if (result) err.result = result;
    return err;
  }

  // A banner, not a redirect: navigating away would throw out a half-written request.
  function showSignIn() {
    const doc = win.document;
    if (doc.getElementById("workhub-signin")) return;
    const bar = doc.createElement("div");
    bar.id = "workhub-signin";
    bar.setAttribute("role", "alert");
    bar.style.cssText =
      "position:sticky;top:0;z-index:1000;padding:12px 16px;background:#fff4e5;color:#1a1a1a;" +
      "border-bottom:1px solid #f0c27a;font:14px/1.4 Inter,system-ui,sans-serif;text-align:center";
    bar.append("Your Carta session expired. ");
    const link = doc.createElement("a");
    link.href = "/auth/login";
    link.textContent = "Sign in again";
    bar.append(link);
    doc.body.prepend(bar);
  }

  // Mirrors the artifact runtime's contract, which _mcp in carta-workhub.app.js reads:
  // a tool that ran and failed rejects with code "tool_error" and _mcp turns it back
  // into an isError envelope; anything else rejects with a page-level code and rethrows.
  // The capital call release depends on the difference: a tool error means nothing was
  // sent, while a lost connection means the release may still be running.
  async function call(tool, args) {
    let resp;
    try {
      resp = await win.fetch("/api/tool", {
        method: "POST",
        headers,
        credentials: "same-origin",
        body: JSON.stringify({ tool, args }),
      });
    } catch {
      throw failure("Carta could not be reached", "server_error");
    }
    if (resp.status === 401) {
      showSignIn();
      throw failure("Your Carta session expired", "needs_reauth");
    }
    let body = null;
    try {
      body = await resp.json();
    } catch {
      // not JSON: an edge error page
    }
    if (body?.isError) {
      const text = (body.content || []).map((c) => c?.text || "").join("\\n");
      throw failure(text || "tool error", "tool_error", body);
    }
    if (!resp.ok || !body) throw failure(body?.error || "Carta answered " + resp.status, "server_error");
    return body;
  }

  const mcp = { callTool: (_server, tool, args) => call(tool, args) };
  win.claude = { use: (capability) => (capability === "mcp" ? mcp : null) };
  win.app = { callServerTool: (request) => call(request.name, request.arguments) };
})(window);
`;
