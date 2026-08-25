// Core runtime for Carta Workhub. Mirrors the same helpers in carta-home.app.js —
// keep the two behaviourally identical.

// ── Carta MCP bridge ──
// The artifact runtime addresses a connector by display name, so {{CARTA_MCP_SERVER}} is
// the name the build script stamps in — not a UUID and not a prefixed tool name.
const CARTA_MCP_SERVER = "{{CARTA_MCP_SERVER}}";

let _mcpNsPromise = null;
// For sync render paths: null while resolving, then true/false. Unknown behaves like
// live, since each such path re-renders once the queue settles.
let _mcpLive = null;

// null means this view cannot run mcp — not granted, not served, or failed to load.
function _mcpNamespace() {
  if (!_mcpNsPromise) {
    _mcpNsPromise = Promise.resolve(window.claude?.use?.("mcp") ?? null)
      .catch(() => null)
      .then(ns => { _mcpLive = !!ns; return ns; });
  }
  return _mcpNsPromise;
}

// Gate every data path on this instead of probing window.claude members.
async function mcpAvailable() {
  return !!(await _mcpNamespace());
}

_mcpNamespace();  // start resolving at load so the sync render paths see a settled answer

// Carta MCP wrapper: injects _instrumentation_v2 required since 2026-07-27.
// The only record that a call came from the UI rather than the model — the host
// cannot tell them apart at the protocol level. One shared source per file.
async function _mcp(tool, args) {
  const mcp = await _mcpNamespace();
  if (!mcp) throw new Error("Carta connector unavailable in this view");
  try {
    return await mcp.callTool(
      CARTA_MCP_SERVER,
      tool,
      Object.assign({}, args, { _instrumentation_v2: { skills: ['carta-investors:carta-workhub-build'], from_ui: true } })
    );
  } catch (err) {
    // A failed tool belongs to the caller that asked, so return an envelope. Connector
    // codes (needs_reauth, server_not_connected) rethrow — those are page-level.
    if (err?.code === "tool_error") return { isError: true, code: err.code, result: err.result, content: [{ type: "text", text: err.message ?? "tool error" }] };
    throw err;
  }
}

// ── Snowplow UI-event tracking via @carta/mcp-ui-tracker (window.mcpUiTracker) ──
if (window.mcpUiTracker) {
  window.mcpUiTracker.initTracker({
    interface: { interfaceType: "artifact", interfaceId: "carta-workhub" },
    mcpServerId: CARTA_MCP_SERVER,
  });
}
function trackWorkhub(action, elementId, options) {
  if (window.mcpUiTracker && window.mcpUiTracker.getTransport()) {
    window.mcpUiTracker.trackUiEvent(action, elementId, options);
  }
}

function escHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function showToast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2800);
}

function tryParse(str) { try { return JSON.parse(str); } catch { return null; } }

// A tool result carries its payload in different shapes per host and server
// version, so collect every plausible one and let the caller pick.
function _mcpResultCandidates(res) {
  const cands = [];
  const add = v => {
    if (typeof v === "string") { const p = tryParse(v); if (p) cands.push(p); }
    else if (v && typeof v === "object") { cands.push(v); if (typeof v.result === "string") { const p = tryParse(v.result); if (p) cands.push(p); } }
  };
  if (res && typeof res === "object") {
    add(res.payload);
    add(res);
    add(res.structuredContent);
    add(res.result);
    if (Array.isArray(res.content)) res.content.forEach(c => { if (c && c.type === "text") add(c.text); });
  }
  return cands;
}

function extractContextsPayload(res) {
  const cands = _mcpResultCandidates(res);
  for (const c of cands) { if (c && Array.isArray(c.firms)) return c; }
  return null;
}

// ── Boot ──
// Named _benchmarkFirmId so app/fund-admin-requests.js needs no edit.
let _benchmarkFirmId = null;

// The section carries the composer, so show it even when the queue fails to load.
function farShowSection(msg) {
  const s = document.getElementById('far-section');
  if (s) s.style.display = '';
  if (msg) showToast(msg);
}

async function bootCartaWorkhub() {
  if (!(await mcpAvailable())) {
    farShowSection('Carta is not connected in this view.');
    return;
  }

  try {
    // Some servers need welcome() before list_contexts works; retry once after it.
    let ctxRes = await _mcp("list_contexts", {});
    if (ctxRes.isError) {
      try { await _mcp("welcome", {}); } catch (e) { /* absent on some servers */ }
      await new Promise(r => setTimeout(r, 500));
      ctxRes = await _mcp("list_contexts", {});
    }
    if (ctxRes.isError) throw new Error("context lookup failed");

    const payload = extractContextsPayload(ctxRes);
    const active = payload ? (payload.firms.find(f => f && f.is_active) ?? payload.firms[0]) : null;
    const firmId = active && active.firm_id != null ? String(active.firm_id) : null;
    if (!firmId) throw new Error("no firm in context");

    // The server needs an active firm even when the id is passed explicitly.
    try { await _mcp("set_context", { firm_id: firmId }); } catch (e) { /* best effort */ }
    _benchmarkFirmId = firmId;

    farSetFirmName(active.firm_name);

    await farFetchRequests();
  } catch (e) {
    console.error('[carta-workhub boot]', e);
    farShowSection('Could not load your requests. Reopen the artifact to retry.');
  }
}

bootCartaWorkhub();
