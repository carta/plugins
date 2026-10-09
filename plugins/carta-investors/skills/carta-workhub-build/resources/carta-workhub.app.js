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
  const finish = whTimingStart(tool, args);
  try {
    const res = await mcp.callTool(
      CARTA_MCP_SERVER,
      tool,
      Object.assign({}, args, { _instrumentation_v2: { skills: ['carta-investors:carta-workhub-build'], from_ui: true } })
    );
    finish(res);
    return res;
  } catch (err) {
    finish(null, err);
    // A failed tool belongs to the caller that asked, so return an envelope. Connector
    // codes (needs_reauth, server_not_connected) rethrow — those are page-level.
    if (err?.code === "tool_error") return { isError: true, code: err.code, result: err.result, content: [{ type: "text", text: err.message ?? "tool error" }] };
    throw err;
  }
}

// discover answers an exact command name only when the viewer may call it, so this
// gates a view whose reads sit behind a server-side flag the task list lacks.
const _mcpCommandProbes = {};
function mcpCommandAvailable(command) {
  return _mcpCommandProbes[command] ??= _mcp("discover", { domain: command })
    .then((res) => Boolean(res && !res.isError))
    .catch(() => false);
}

// discover(scope="view") names a view only when the viewer may open it, so this gates a
// task card that opens an MCP App. A viewer it refuses keeps the card's Carta link.
const _mcpViewProbes = {};
function mcpViewAvailable(view) {
  return _mcpViewProbes[view] ??= _mcp("discover", { scope: "view", domain: view })
    .then((res) => !res?.isError && _mcpResultCandidates(res).some((c) => c && c.view === view))
    .catch(() => false);
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

// An artifact cannot post into a chat, and an MCP App renders only when Claude calls its
// tool there. So the Workhub opens a new Claude Desktop chat with the prompt prefilled, for
// the GP to send. It also tries to put the prompt on the clipboard, in case the link handler
// does not fire. The copy is best-effort (a sandboxed frame or non-secure context can block
// it), so the toast says the prompt is on the clipboard only when the copy worked.
const CLAUDE_NEW_CHAT_URL = "claude://claude.ai/new?q=";
function openClaudeChat(prompt) {
  // Started inside the click's user gesture, which some hosts require. writeText can also
  // throw synchronously, so that counts as a failed copy too.
  let copy;
  try { copy = navigator.clipboard?.writeText ? navigator.clipboard.writeText(prompt) : Promise.reject(); }
  catch { copy = Promise.reject(); }
  const copied = Promise.resolve(copy).then(() => true, () => false);
  // A hidden link opened as a new window, so the protocol handler fires without the
  // artifact's own frame navigating to the claude:// URL, which blanks it.
  const a = document.createElement("a");
  a.href = CLAUDE_NEW_CHAT_URL + encodeURIComponent(prompt);
  a.target = "_blank";
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  return copied.then(ok => showToast(ok
    ? "Opening a new Claude chat. Send the prompt there; it is on your clipboard too."
    : "Opening a new Claude chat. Send the prompt there."));
}

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
// `msg` is the reason every queue tab shows.
function farShowSection(msg) {
  const s = document.getElementById('far-section');
  if (s) s.style.display = '';
  // Boot failed before the queue was read: settle it as empty so no later render
  // brings the loader back.
  if (_farRows === null) _farRows = [];
  if (msg) _farTabErrors = Object.fromEntries(FAR_QUEUE_TABS.map(key => [key, msg]));
  renderFarSection();
}

async function bootCartaWorkhub() {
  whTimingMark("boot");
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
    whTimingMark(active.is_active ? "firm already active" : "firm not active, setting context");

    // The server needs an active firm even when the id is passed explicitly. Setting
    // one takes seconds, so a firm Carta already has active is left as it is.
    if (!active.is_active) {
      try { await _mcp("set_context", { firm_id: firmId }); } catch (e) { /* best effort */ }
    }
    whTimingMark("context ready");
    _benchmarkFirmId = firmId;

    farSetFirmName(active.firm_name);

    await farFetchRequests();
  } catch (e) {
    console.error('[carta-workhub boot]', e);
    farShowSection('Could not read your firm from Carta.');
  }
}

bootCartaWorkhub();
