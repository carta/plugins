/* ---------- the artifact transport ----------  long-comment-ok: two host protocol
   facts that no code here can state, and both report the opposite when guessed.
   1. `window.claude.use` is a function, but `Object.keys(window.claude)` is `[]`.
      Only `typeof` on the call detects it. A property read reports "absent".
   2. Carta's generated command tools are not in the host's tool list. Every
      command goes through the GATEWAY proxy below, never by its own name. */

/** EVERY UI-issued call carries this, from exactly one place in this file. The host
    cannot distinguish a UI-issued call from a model-issued one at the protocol
    level, so this stamp is the only record of origin. */
const UI_CALL = { skills: ["carta-cap-table:carta-issuance"], from_ui: true };

/** The gateway proxy every Carta command is addressed through. */
const GATEWAY = "call_tool";

const T = { mcp: null, server: null, reason: "no_capability" };

/* ---------- error vocabulary ----------
   Failures reject; they do not resolve with an isError envelope. These sets turn the
   host's code into the one question each caller actually asks. */
const NEEDS_CONNECTOR = new Set(["server_not_connected", "needs_reauth", "selection_required"]);
/** A write that ended in one of these may or may not have landed. Never auto-retry. */
const UNKNOWN_OUTCOME = new Set(["server_unavailable", "upstream_error", "cancelled"]);
const NO_LIVE_DATA = new Set(["not_granted", "capability_disabled", "capability_removed",
  "no_capability", "no_connector"]);

/** What the user does about it, in their words. `selection_required` gets the
    not-connected copy: the shell does the asking, so this page just says what is
    missing. */
const CONN_COPY = {
  no_connector: "This page cannot see a Carta connector. Connect Carta in Settings → Connectors, then ask Claude to open this page again.",
  server_not_connected: "Carta is not connected. Connect it in Settings → Connectors, then ask Claude to open this page again.",
  needs_reauth: "Carta needs you to sign in again. Reconnect Carta in Settings → Connectors, then ask Claude to open this page again.",
  selection_required: "Carta is not connected to this page yet. Connect Carta in Settings → Connectors, then ask Claude to open this page again.",
  not_granted: "This page was not granted access to Carta. Ask Claude to open it again and allow the Carta connector.",
  capability_disabled: "Live Carta data is switched off for this page, so nothing can be loaded or saved here.",
  capability_removed: "Live Carta data was switched off for this page, so nothing more can be loaded or saved here.",
  no_capability: "This page cannot reach Carta from here. Open it again from a Claude chat with Carta connected.",
  server_unavailable: "Carta did not answer. Nothing was loaded.",
};

const code = (e) => (e && typeof e.code === "string" ? e.code : "");
const msgOf = (e) => String((e && (e.message || e.error || e.detail)) || "");

/** The one error type the form sees. `fromServer` keeps the panel's meaning exactly:
    Carta rejected the call, as opposed to the call never reaching Carta. submit()
    picks its copy off it. */
function tErr(kind, message, src) {
  const e = new Error(String(message || kind).slice(0, 300));
  e.code = kind;
  e.fromServer = kind === "tool_error";
  e.retryable = !!(src && src.retryable);
  e.unknownOutcome = UNKNOWN_OUTCOME.has(kind);
  e.needsConnector = NEEDS_CONNECTOR.has(kind);
  e.noLiveData = NO_LIVE_DATA.has(kind);
  return e;
}

/** What to tell the user about a connection that is not there. Pass a failed call's
    `err.code`; with no argument it reports why bring-up never connected. */
function connReason(kind) {
  return CONN_COPY[kind || T.reason] || CONN_COPY.no_capability;
}

/** A command this MCP simply does not have, as opposed to one that ran and refused.
    Both arrive as a server-side rejection, so the message has to name the command or
    the tool — otherwise a deployed command's own "corporation not found" would be
    swallowed as "not deployed here". */
function isMissingCommand(err) {
  if (!err) return false;
  if (err.code === "tool_not_found" || err.code === "unknown_tool") return true;
  if (!err.fromServer) return false;
  const m = msgOf(err);
  return /(unknown|not found|no such|unrecognized|not available|not registered)/i.test(m)
    && /(tool|command|_get__|issuance_bootstrap)/i.test(m);
}

/** A deployed command that does not know `name`. The refusal happens before the call
    leaves the gateway, so nothing ran and the caller can retry without the argument —
    which is what makes a newly added optional argument safe to send blind.

    It must name the argument. A looser rule reads a genuine refusal — no access to this
    corporation, no such company — as "drop the argument and retry", and the retry then
    succeeds without the blockers the first call would have reported. */
function isUnknownParam(err, name) {
  if (!err || !err.fromServer || !name) return false;
  return new RegExp(`\\b${name}\\b`).test(msgOf(err))
    && /(unknown|unexpected|unsupported|not a valid|invalid|extra|undeclared)/i.test(msgOf(err));
}

/* ---------- envelopes ---------- */
function unwrap(o) {
  if (o && typeof o.result === "string") { try { return JSON.parse(o.result); } catch { return o; } }
  return o;
}
/** The form's only envelope reader. one() has already asserted the payload parses,
    so this is a field read rather than a parse that can fail. */
function payload(res) {
  return res && res.payload != null ? res.payload : null;
}
const textBlock = (res) => {
  const c = res && res.content;
  const t = c && c.find && c.find((x) => x && x.type === "text");
  return (t && t.text) || "";
};

/** A resolved-but-unreadable result throws rather than answering null: null would
    paint the form with empty dropdowns and no error at all, which reads to the user
    as "this company has no option plans". */
function assertPayload(res, name) {
  if (!res || typeof res !== "object") throw tErr("bad_envelope", name + " returned nothing");
  if (res.isError) throw tErr("tool_error", textBlock(res) || name);
  if ("payload" in res) {
    // The gateway's own envelope: res.payload is {"result": "<json string>"}.
    const u = unwrap(res.payload);
    if (u && typeof u === "object") return u;
    throw tErr("bad_envelope", name + " returned a payload this page cannot read");
  }
  if (res.structuredContent != null) {
    const u = unwrap(res.structuredContent);
    if (u && typeof u === "object") return u;
  }
  const t = textBlock(res);
  if (t) {
    try {
      const u = unwrap(JSON.parse(t));
      if (u && typeof u === "object") return u;
    } catch { /* not JSON — falls through to the throw below */ }
  }
  throw tErr("bad_envelope", name + " returned something this page cannot read");
}

/* ---------- bring-up ---------- */
/** Resolve the connector by name at runtime; nothing about it is baked in. Returns
    false for every "no live data" case, with T.reason carrying which one. */
async function connect() {
  if (typeof window.claude?.use !== "function") { T.reason = "no_capability"; return false; }
  let mcp = null;
  try { mcp = await window.claude.use("mcp"); }
  catch (err) { T.reason = code(err) || "no_capability"; return false; }
  if (!mcp) { T.reason = "no_capability"; return false; }
  let servers = [];
  try {
    // listTools never prompts for consent, so this is safe before first paint.
    const r = await mcp.listTools();
    servers = (r && r.servers) || [];
  } catch (err) { T.reason = code(err) || "server_unavailable"; return false; }
  // A name match is preferred, never required: the manifest granted one connector, and
  // whoever added it named it — "Carta" is not promised.
  const usable = servers.filter((s) => s && s.server && s.kind !== "artifact"
    && (!Array.isArray(s.tools) || s.tools.includes(GATEWAY)));
  const carta = usable.find((s) => /carta/i.test(s.server)) || usable[0];
  if (!carta) { T.reason = "no_connector"; return false; }
  T.mcp = mcp;
  T.server = carta.server;
  T.reason = "";
  return true;
}

/** The hand-off store. Null when unavailable, and never throws — a hand-off that
    does not land must never be reported as a save that did not land. */
async function store() {
  if (typeof window.claude?.use !== "function") return null;
  try { return (await window.claude.use("db")) || null; }
  catch (err) { console.error("issuance artifact: db capability unavailable", err); return null; }
}

/* ---------- the one call site ----------
   Measured too, so the page's boot shows up in the host's performance timeline
   without a debug build. */
async function one(name, args) {
  if (!T.mcp || !T.server) throw tErr(T.reason || "no_capability", connReason());
  const t0 = performance.now();
  const done = () => {
    try { performance.measure("carta-issuance:bridge:" + name, { start: t0 }); }
    catch { /* measure with a start option is not universal; timing is optional */ }
  };
  let res;
  try {
    // The stamp lands on the proxy call AND on the target command's own arguments,
    // both from UI_CALL, so the gateway records the origin of each.
    res = await T.mcp.callTool(T.server, GATEWAY, {
      name,
      arguments: Object.assign({}, args, { _instrumentation_v2: UI_CALL }),
      _instrumentation_v2: UI_CALL,
    });
  } catch (err) {
    done();
    throw tErr(code(err) || "upstream_error", msgOf(err) || name, err);
  }
  done();
  return { payload: assertPayload(res, name) };
}
