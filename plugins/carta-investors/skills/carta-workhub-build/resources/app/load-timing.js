// ── Load timing ──
// Keep this part first in app_js_parts: the boot marks milestones before later parts run.

const WH_TIMING_KEY = "cartaWorkhub.loadTimings";
const WH_TIMING_KEEP = 10;

const _whOrigin = (typeof performance !== "undefined" && performance.timeOrigin) || Date.now();
const _whLoad = {
  id: `${_whOrigin}`,
  started_at: new Date(_whOrigin).toISOString(),
  build: "{{BUILD_ID}}",
  marks: [],
  calls: [],
};
let _whSeq = 0;
let _whPanel = null;

function _whNow() {
  return Math.round(typeof performance !== "undefined" ? performance.now() : Date.now() - _whOrigin);
}

function whTimingMark(name) {
  _whLoad.marks.push({ name, ms: _whNow() });
  _whSave();
}

// A fetch is named by the command it carries, since every list goes through one tool.
function _whLabel(tool, args) {
  if (tool !== "fetch" || !args || !args.command) return tool;
  return args.params && args.params.after ? `${args.command} (next page)` : args.command;
}

// Returns the callback that closes the call with what came back.
function whTimingStart(tool, args) {
  const call = { seq: ++_whSeq, tool: _whLabel(tool, args), sent: _whNow(), at: new Date().toISOString() };
  _whLoad.calls.push(call);
  _whSave();
  return (res, err) => {
    call.ms = _whNow() - call.sent;
    call.ok = !err && !(res && res.isError);
    if (err) call.error = String((err && (err.code || err.message)) || err).slice(0, 120);
    _whSave();
  };
}

// This load comes from memory, so it shows even when storage cannot be read or written.
function whTimingLoads() {
  let saved = [];
  try {
    const parsed = JSON.parse(localStorage.getItem(WH_TIMING_KEY) || "[]");
    if (Array.isArray(parsed)) saved = parsed;
  } catch (e) {
    /* storage unavailable */
  }
  return [_whLoad, ...saved.filter((l) => l && l.id !== _whLoad.id)].slice(0, WH_TIMING_KEEP);
}

// Never throws: it runs inside _mcp, where an error would turn a good answer into a failure.
function _whSave() {
  try {
    localStorage.setItem(WH_TIMING_KEY, JSON.stringify(whTimingLoads()));
  } catch (e) {
    /* timing is best-effort */
  }
  try {
    if (_whPanel) _whRenderPanel();
  } catch (e) {
    /* the panel is best-effort too */
  }
}

function whTimingText(load) {
  const pad = (v, n) => String(v).padStart(n);
  const lines = [`load ${load.started_at}  build ${load.build}`];
  for (const m of load.marks) lines.push(`${pad(m.ms, 7)} ms  mark  ${m.name}`);
  for (const c of [...load.calls].sort((a, b) => a.sent - b.sent)) {
    const took = c.ms == null ? "pending" : `${c.ms} ms`;
    const state = c.ms == null ? "" : c.ok ? "" : `  FAILED ${c.error || ""}`;
    lines.push(`${pad(c.sent, 7)} ms  #${pad(c.seq, 2)}  ${pad(took, 9)}  ${c.tool}  ${c.at}${state}`);
  }
  return lines.join("\n");
}

function _whRenderPanel() {
  const text = whTimingLoads().map(whTimingText).join("\n\n");
  _whPanel.querySelector("pre").textContent = text;
}

function whTimingTogglePanel() {
  if (_whPanel) {
    _whPanel.remove();
    _whPanel = null;
    return;
  }
  _whPanel = document.createElement("div");
  _whPanel.setAttribute("role", "dialog");
  _whPanel.setAttribute("aria-label", "Load timing");
  _whPanel.style.cssText =
    "position:fixed;inset:auto 16px 16px 16px;max-height:60vh;overflow:auto;z-index:9999;" +
    "background:#111;color:#eee;font:12px/1.4 ui-monospace,Menlo,monospace;padding:12px;border-radius:8px";
  _whPanel.innerHTML =
    '<div style="display:flex;gap:8px;margin-bottom:8px"><strong style="flex:1">Load timing</strong>' +
    '<button type="button" data-wh="copy">Copy</button><button type="button" data-wh="close">Close</button></div>' +
    '<pre style="margin:0;white-space:pre;overflow-x:auto"></pre>';
  _whPanel.addEventListener("click", (e) => {
    const action = e.target && e.target.getAttribute && e.target.getAttribute("data-wh");
    if (action === "close") whTimingTogglePanel();
    if (action === "copy") _whCopy(e.target);
  });
  document.body.appendChild(_whPanel);
  _whRenderPanel();
}

async function _whCopy(button) {
  const text = JSON.stringify(whTimingLoads(), null, 2);
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied";
  } catch (e) {
    // Clipboard can be refused in the artifact frame; select the text for a manual copy.
    const pre = _whPanel.querySelector("pre");
    pre.textContent = text;
    window.getSelection().selectAllChildren(pre);
    button.textContent = "Selected";
  }
}

if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("keydown", (e) => {
    if (!(e.altKey && e.shiftKey && e.code === "KeyT")) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ""))) return;
    e.preventDefault();
    whTimingTogglePanel();
  });
  if (typeof location !== "undefined" && /timing/.test(location.hash || "")) {
    whTimingTogglePanel();
  }
}
