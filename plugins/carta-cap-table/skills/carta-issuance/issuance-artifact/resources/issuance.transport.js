/* ---------- the artifact transport ----------  long-comment-ok: three host protocol
   facts that no code here can state, and each reports the opposite when guessed.
   1. `window.claude` promises `use` and nothing else. Every capability member —
      `.mcp`, `.db` — reads `undefined` at every moment, so `use()` is the only
      check, and a call must never be used to probe for one.
   2. Carta's generated command tools are not in the host's tool list. Every
      command goes through the GATEWAY proxy below, never by its own name.
   3. A capability this view does not serve resolves `null` after about 10s. So
      `use()` is resolved once at bring-up and kept — never per call. */

/** EVERY UI-issued call carries this, from exactly one place in this file. The host
    cannot distinguish a UI-issued call from a model-issued one at the protocol
    level, so this stamp is the only record of origin. */
const UI_CALL = { skills: ["carta-cap-table:carta-issuance"], from_ui: true };

/** The gateway proxy every Carta command is addressed through. */
const GATEWAY = "call_tool";

const T = { mcp: null, server: null, db: null, reason: "no_capability" };

/* ---------- error vocabulary ----------
   long-comment-ok: the contract these sets encode, which no name here can carry.
   Failures REJECT; they do not resolve with an isError envelope. Each set answers one
   question a caller asks, and the sets are deliberately not one bucket: collapsing them
   hides the single action that would fix the page — reconnect, sign in, choose one,
   allow it, or just wait — which is the named anti-pattern for this capability. */
const NEEDS_CONNECTOR = new Set(["server_not_connected", "needs_reauth", "selection_required"]);
/** A write that ended in one of these may or may not have landed. Never auto-retry.
    `cancelled` is absent on purpose: no call here passes an AbortSignal to a mutate,
    and without a signal `cancelled` only ever means the call never ran. */
const UNKNOWN_OUTCOME = new Set(["server_unavailable", "upstream_error"]);
const NO_LIVE_DATA = new Set(["not_granted", "capability_disabled", "capability_removed",
  "no_capability", "no_connector"]);
/** The connector answered and refused, and repeating the call cannot change that.
    Distinct from NO_LIVE_DATA only in what the user does about it. */
const NOT_ALLOWED = new Set(["not_in_manifest", "blocked_by_policy", "approval_required",
  "consent_required", "server_not_found", "user_changed"]);
/** This page sent something the host would not take. No user action helps. */
const PAGE_BUG = new Set(["bad_request", "transform_error", "bad_envelope"]);

/** What the user does about it, in their words. One entry per code that has its own
    fix; `connReason` falls back to the no-capability line for anything newer. */
const CONN_COPY = {
  no_connector: "This page cannot see a Carta connector. Connect Carta in Settings → Connectors, then ask Claude to open this page again.",
  server_not_connected: "This page can't reach Carta. Check Carta is connected in Settings → Connectors, then ask Claude to open this page again.",
  needs_reauth: "Carta needs you to sign in again. Reconnect Carta in Settings → Connectors, then ask Claude to open this page again.",
  selection_required: "You have more than one Carta connector. Pick the one this page should use when Claude asks, or choose it in Settings → Connectors, then open this page again.",
  not_granted: "This page was not granted access to Carta. Ask Claude to open it again and allow the Carta connector.",
  not_in_manifest: "This page is not allowed to use Carta. Allow the Carta connector for it when Claude asks, then open it again.",
  consent_required: "Allow the Carta connection for this page, then open it again.",
  approval_required: "Your organisation requires approval before this page can use Carta. Ask your Claude administrator, then open it again.",
  blocked_by_policy: "Your organisation's policy does not allow this page to use Carta.",
  server_not_found: "That Carta connector no longer exists. Add Carta in Settings → Connectors, then ask Claude to open this page again.",
  user_changed: "You are signed in as someone else now. Ask Claude to open this page again.",
  capability_disabled: "Live Carta data is switched off for this page, so nothing can be loaded or saved here.",
  capability_removed: "Live Carta data was switched off for this page, so nothing more can be loaded or saved here.",
  no_capability: "This page cannot reach Carta from here. Open it again from a Claude chat with Carta connected.",
  server_unavailable: "Carta did not answer. Nothing was loaded.",
  read_timeout: "Carta took too long to answer. Nothing was loaded.",
  cancelled: "You declined the confirmation, so nothing was sent to Carta.",
  bad_request: "This page sent something Carta could not read. Ask Claude to open it again.",
  transform_error: "This page sent something Carta could not read. Ask Claude to open it again.",
  bad_envelope: "Carta answered with something this page cannot read. Ask Claude to open it again.",
};

const code = (e) => (e && typeof e.code === "string" ? e.code : "");
const msgOf = (e) => String((e && (e.message || e.error || e.detail)) || "");

/** The one error type the form sees. `fromServer` draws the distinction the copy turns
    on: Carta rejected the call, as opposed to the call never reaching Carta. submit()
    picks its copy off it. */
function tErr(kind, message, src) {
  const e = new Error(String(message || kind).slice(0, 300));
  e.code = kind;
  e.fromServer = kind === "tool_error";
  e.retryable = !!(src && src.retryable);
  e.retryAfterMs = src && Number(src.retryAfterMs) > 0 ? Number(src.retryAfterMs) : 0;
  // A tool-level failure carries its whole envelope here, and Carta's own refusal text
  // is often in that envelope rather than in `message`.
  e.result = src && src.result;
  e.unknownOutcome = UNKNOWN_OUTCOME.has(kind);
  e.needsConnector = NEEDS_CONNECTOR.has(kind);
  e.noLiveData = NO_LIVE_DATA.has(kind);
  e.notAllowed = NOT_ALLOWED.has(kind);
  e.pageBug = PAGE_BUG.has(kind);
  /** The page has no live Carta and no retry will change that: stop offering writes and
      say what the user can do. The one flag the form branches its footer on. */
  e.noWrites = e.noLiveData || e.needsConnector || e.notAllowed || e.pageBug;
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
  if (!err || !err.fromServer) return false;
  const m = errText(err);
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
  const m = errText(err);
  return new RegExp(`\\b${name}\\b`).test(m)
    && /(unknown|unexpected|unsupported|not a valid|invalid|extra|undeclared)/i.test(m);
}

/* ---------- envelopes ---------- */
/** The gateway wraps every answer as `{"result": <json string>}`. An object `result` is
    unwrapped too: left wrapped, every field read below it reads `undefined` and the form
    paints empty controls with no error to show for them. */
function unwrap(o) {
  if (o && typeof o.result === "string") { try { return JSON.parse(o.result); } catch { return o; } }
  if (o && typeof o.result === "object" && o.result !== null) return o.result;
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

/** Everything Carta said about a refusal. The gateway puts a wrapped command's own
    error in the result envelope, so a `message`-only read misses it. */
const errText = (e) => [msgOf(e), textBlock(e && e.result)].filter(Boolean).join(" ");

/** A resolved-but-unreadable result throws rather than answering null: null would
    paint the form with empty dropdowns and no error at all, which reads to the user
    as "this company has no option plans". */
function assertPayload(res, name) {
  if (!res || typeof res !== "object") throw tErr("bad_envelope", name + " returned nothing");
  // Each envelope is tried on its VALUE, not its key: `payload` is optional, and a
  // host that materialises it as undefined must not cost us the sibling that has it.
  if (res.payload != null) {
    const u = unwrap(res.payload);
    if (u && typeof u === "object") return u;
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
/** `listTools()` answers with tool DESCRIPTORS — `{name, description, annotations?}` —
    never tool-name strings. A `tools.includes("call_tool")` read is therefore false for
    every server that has the gateway, which reports a live connector as absent. */
const toolNames = (s) => (Array.isArray(s && s.tools) ? s.tools : [])
  .map((t) => (typeof t === "string" ? t : (t && t.name) || ""))
  .filter(Boolean);

/** Prefer a Carta-named entry, never require one: whoever added the connector named it,
    and "Carta" is not promised. */
const pickCarta = (list) => list.find((s) => /carta/i.test(s.server)) || list[0] || null;

/** Resolve the connector by name at runtime; nothing about it is baked in. Baking the
    name in would be wrong as well as unnecessary — one published page runs for many
    viewers, whose connectors carry their own names. Returns false for every "no live
    data" case, with T.reason carrying which one. */
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
  // Claude's own per-artifact servers answer listTools too and are not the connector.
  const conns = servers.filter(
    (s) => s && typeof s.server === "string" && s.server && s.kind !== "artifact");
  const carta = pickCarta(conns.filter((s) => toolNames(s).includes(GATEWAY)))
    || pickCarta(conns);
  if (!carta) { T.reason = "no_connector"; noteConn(servers, T.reason); return false; }
  /* Lapsed credentials are the one state worth refusing on: the host already exhausted
     the refresh, so no call can succeed and the copy names a real fix. Everything else
     proceeds. An entry listing NO tools is either not connected or connected twice and
     unchosen — the listing cannot tell those apart but the first call's own code can,
     and they have different fixes. `authStatus: "unknown"` is a degraded status check,
     not a verdict, and is the normal state before the viewer has been asked.
     long-comment-ok: why a page that cannot prove it is connected still tries. */
  if (carta.authStatus === "needs_reauth") {
    T.reason = "needs_reauth"; noteConn(servers, T.reason); return false;
  }
  if (!toolNames(carta).includes(GATEWAY)) noteConn(servers, "no_tools_listed");
  // Only now: one() guards on these two being set, and that guard is the reason a
  // page the transport has given up on cannot still be calling Carta per keystroke.
  T.mcp = mcp;
  T.server = carta.server;
  T.reason = "";
  return true;
}

/** Console-only, and the reason a next run does not have to guess: the copy the user
    sees names a fix, not what the host answered. Carries no cap-table data. */
function noteConn(servers, reason) {
  try {
    console.warn("issuance artifact: Carta connector not confirmed", {
      reason: reason,
      gateway: GATEWAY,
      servers: (servers || []).map((s) => ({
        server: s && s.server, kind: s && s.kind, authStatus: s && s.authStatus,
        tools: toolNames(s),
      })),
    });
  } catch { /* a host without a console must not turn this into the failure */ }
}

/** The hand-off store, resolved exactly once — the answer is memoized either way. A
    capability this view does not serve resolves `null` only after ~10s, and the hand-off
    is written on four paths, so a second attempt would pay that wait again for an answer
    that cannot have changed. */
function openStore() {
  if (!T.db) {
    T.db = typeof window.claude?.use !== "function"
      ? Promise.resolve(null)
      : Promise.resolve(window.claude.use("db")).catch((err) => {
        console.error("issuance artifact: db capability unavailable", err);
        return null;
      });
  }
  return T.db;
}

/** Null when unavailable, and never throws — a hand-off that does not land must never
    be reported as a save that did not land. */
async function store() {
  return (await openStore()) || null;
}

/** A read, and so safe to re-issue. Every write this page sends is `__mutate__`; an
    allowlist rather than a mutate-blocklist, so a name nobody anticipated is a write. */
const isRead = (name) => /^cap_table__(get|list)__/.test(String(name));

/** A hung call otherwise sits on the host's ~130s reply budget, which the page shows as
    a grey skeleton and the word "Loading…". Writes never carry a signal: an aborted
    write is an unknown outcome, and this page must never create one.
    long-comment-ok: why the two reads are timed differently. The first attempt is cut
    short so a read that has stalled is retried while the reader is still waiting. The
    retry gets the server's own 20s ceiling, so a read that is merely slow still lands
    rather than being cut off twice, and the pair stays well inside the host's budget. */
const READ_DEADLINE_MS = 14000;
const READ_RETRY_DEADLINE_MS = 20000;
const readSignal = (ms) => {
  try {
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
      return AbortSignal.timeout(ms);
    }
  } catch { /* an older host has no timeout signal; the call simply has no deadline */ }
  return undefined;
};

/** Transient on a READ, so a second attempt is worth making. `cancelled` is here because
    on a read it is the deadline above firing — which is the case this exists for. */
const TRANSIENT_READ = new Set(["read_timeout", "cancelled", "upstream_error",
  "server_unavailable"]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const send = (retry) => {
    const opts = { cache: false };
    const signal = isRead(name)
      ? readSignal(retry ? READ_RETRY_DEADLINE_MS : READ_DEADLINE_MS) : undefined;
    if (signal) opts.signal = signal;
    // The stamp lands on the proxy call AND on the target command's own arguments,
    // both from UI_CALL, so the gateway records the origin of each.
    return T.mcp.callTool(T.server, GATEWAY, {
      name,
      arguments: Object.assign({}, args, { _instrumentation_v2: UI_CALL }),
      _instrumentation_v2: UI_CALL,
    }, opts);
  };
  let res;
  try {
    try { res = await send(); }
    catch (first) {
      /* One retry, reads only, fenced by isRead() — a write whose outcome is unknown is
         never re-sent: see UNKNOWN_OUTCOME. Two cases: the host stamped `retryable`
         itself (the first call on a connector whose consent could not be asked just
         then, which never reached Carta), and a read that stalled or that Carta could
         not answer this second. Without either, the whole boot lands on an empty form. */
      const again = first && (first.retryable || TRANSIENT_READ.has(code(first)));
      if (!again || !isRead(name)) throw first;
      await sleep(Math.min(Number(first.retryAfterMs) || 700 + Math.random() * 500, 8000));
      res = await send(true);
    }
  } catch (err) {
    done();
    throw tErr(kindOf(err, name), msgOf(err) || name, err);
  }
  done();
  try { return { payload: assertPayload(res, name) }; }
  catch (err) {
    // The tool RAN. So on a write, an answer this page cannot read is an unknown
    // outcome — the rows may be on the cap table — never a page bug to retry past.
    if (!isRead(name) && err && err.code === "bad_envelope") {
      throw tErr("upstream_error", err.message);
    }
    throw err;
  }
}

/** `cancelled` means two different things and only the call site can tell them apart:
    on a read it is READ_DEADLINE_MS firing, on a write it is the viewer declining the
    host's own confirm. Splitting them here keeps both copies honest. */
/** Every code this page has an answer for. A code the host adds later is read as Carta
    not answering, which on a write is the outcome nobody here can establish. */
const KNOWN_KINDS = new Set([...NEEDS_CONNECTOR, ...UNKNOWN_OUTCOME, ...NO_LIVE_DATA,
  ...NOT_ALLOWED, ...PAGE_BUG, "tool_error", "cancelled", "rate_limited", "read_timeout"]);
function kindOf(err, name) {
  const k = code(err) || "upstream_error";
  if (k === "cancelled" && isRead(name)) return "read_timeout";
  return KNOWN_KINDS.has(k) ? k : "upstream_error";
}
