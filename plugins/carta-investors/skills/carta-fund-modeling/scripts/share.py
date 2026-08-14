"""Button-driven scenario sharing (publish / pull) for the fund-modeling console.

serve.py owns the locks and the HTTP surface; share.py drives a headless `claude`
session for the Carta fa:*:investor_scenarios calls and does the domain-specific
merge into portfolio.json. Mirrors refresh.py and reuses its session scaffolding.

The fa handlers are firm_uuid-param-scoped and never read set_context, so this
never touches the per-user firm context — safe to run alongside a refresh fetch.
The browser never calls Carta: the headless session (which inherits the user's
own Carta connector auth) makes the calls, and serve.py writes portfolio.json.

Python-stdlib only, 3.9-safe.
"""
import json
import os
import threading
from typing import Callable, List, Optional

import build_datadir
import chat_session
import refresh

SHARE_SYSTEM_PROMPT = (
    "You are a scenario-sharing executor for a fund-modeling console. You have a Carta MCP server "
    "whose tools are named mcp__<server>__welcome and mcp__<server>__call_tool. If a named tool is "
    "not immediately visible it may be deferred — load it with ToolSearch first, then call it in "
    "the same turn. Make exactly the tool calls the user message specifies, in order, with the "
    "given arguments, and call no other tool. Emit each tool call immediately, with no explanatory "
    "text before it. Reply with exactly DONE once they have returned."
)
TURN_TIMEOUT = 180
GET_BATCH = 25  # fa__get__ per pull turn — bounds a 250-scenario firm to ~10 turns, not 250
SHARE_MODEL = "haiku"  # executor only relays one tool call — a fast model beats Sonnet's turn floor


class ShareError(Exception):
    """User-surfaced sharing failure. `code` is the typed UI state; `needs_human` marks the
    "open Claude" states; `raw` keeps the original tool error for server-side logging only."""
    def __init__(self, message, code="failed", needs_human=False, raw=None):
        # type: (str, str, bool, Optional[str]) -> None
        super(ShareError, self).__init__(message)
        self.code = code
        self.needs_human = needs_human
        self.raw = raw


def _first_json(text):
    # type: (Optional[str]) -> Optional[dict]
    i = (text or "").find("{")
    while i >= 0:
        try:
            return json.loads(text[i:])
        except ValueError:
            i = text.find("{", i + 1)
    return None


def _unwrap(text):
    # type: (Optional[str]) -> Optional[dict]
    """fa call_tool results arrive double-wrapped as {"result": "<stringified-json>"};
    unwrap to the inner object. Tolerates an already-flat object too."""
    obj = _first_json(text)
    if isinstance(obj, dict) and isinstance(obj.get("result"), str):
        inner = _first_json(obj["result"])
        return inner if inner is not None else obj
    return obj


def _classify(err):
    # type: (str) -> tuple
    """Map a Carta error string to (code, user_message, needs_human). Substring heuristics —
    the fa layer has no typed error codes — ordered most-specific first."""
    e = (err or "").lower()
    if "unknown command" in e or "not enabled" in e or "feature flag" in e:
        return ("not_enabled", "Scenario sharing isn't enabled for this firm yet.", False)
    if "403" in e or "forbidden" in e or "permission" in e:
        if "owner" in e or "creator" in e or "delete" in e:
            return ("not_owner", "Only the creator can delete this shared scenario.", False)
        return ("not_admin", "Publishing scenarios needs firm-admin access.", False)
    if "413" in e or "too large" in e or "256 kb" in e or "256kb" in e:
        return ("too_large", "This scenario is too large to share.", False)
    # Match the cap precisely — bare "limit"/"count"/"250" false-positived on "rate limit",
    # "account"/"encountered", or any stray "250" and mislabeled unrelated failures as the cap.
    if ("scenario limit" in e or "limit reached" in e or "too many scenario" in e
            or "maximum number of scenario" in e or "250 active" in e or "250 shared" in e):
        return ("cap_reached", "This firm has reached the 250 shared-scenario limit.", False)
    if "404" in e or "not found" in e:
        return ("not_found", "That shared scenario no longer exists.", False)
    return ("failed", "Couldn't finish — try again, or run it from Claude.", True)


def _run_turn_all(session, prompt, timeout=TURN_TIMEOUT, on_step=None):
    # type: (object, str, int, Optional[Callable]) -> tuple
    """Run one prompt to turn end → (ok, captures, err). captures is the unwrapped envelope of
    EVERY call_tool result in the turn (the multi-get fan-out reads them all); err is the first."""
    session.send(prompt)
    pending = {}
    captures = []
    err = None
    for ev in session.events(timeout=timeout):
        t = ev.get("type")
        if t == "assistant":
            for b in ev.get("message", {}).get("content", []):
                if b.get("type") == "tool_use":
                    pending[b.get("id")] = b.get("name")
                    if on_step:
                        on_step("issued")
        elif t == "user":
            for b in ev.get("message", {}).get("content", []):
                if b.get("type") != "tool_result":
                    continue
                name = pending.get(b.get("tool_use_id"))
                if not (name or "").endswith("__call_tool"):
                    continue
                text = refresh._flatten(b.get("content"))
                if b.get("is_error"):
                    if err is None:
                        err = text
                else:
                    captures.append(_unwrap(text))
                if on_step:
                    on_step("received")
        elif t == "result":
            return (not ev.get("is_error"), captures, err)
    return (False, captures, err or "session ended without a result")


def _allowed_tools(prefer_nonprod):
    # type: (bool) -> str
    """Env-scoped (not refresh's additive allowlist): each env allowlists only its own Carta
    connectors, so `welcome` can't resolve to the wrong environment. fa needs welcome + call_tool."""
    prefixes = refresh._PREFIXES_NONPROD if prefer_nonprod else refresh._PREFIXES_PROD
    return ",".join("mcp__%s__%s" % (p, t) for p in prefixes for t in ("welcome", "call_tool"))


def _start_session(prefer_nonprod, data_dir, claude_bin, model):
    # type: (bool, str, Optional[str], Optional[str]) -> object
    return chat_session.ChatSession(
        cwd=data_dir, add_dirs=[],
        claude_bin=claude_bin or os.environ.get("FM_CLAUDE_BIN", "claude"),
        model=model or chat_session.DEFAULT_MODEL,
        allowed_tools=_allowed_tools(prefer_nonprod),
        system_prompt=SHARE_SYSTEM_PROMPT)


def _bootstrap(session, prefer_nonprod, firm_uuid, emit):
    # type: (object, bool, str, Callable) -> tuple
    """One turn: welcome + a firm-scoped fa:list. Resolves the env-correct connector prefix
    (naming the candidate welcome tools, since a generic name picks the wrong one when several
    Carta connectors are present) and warms the deferred call_tool — the first isolated call_tool
    in a fresh session is flaky, so the op's own call is never that first one. Returns
    (call_tool_name, listing); the listing lets a same-turn pull skip re-listing."""
    emit("connect", "Connecting to Carta…")
    cands = list(refresh._PREFIXES_NONPROD if prefer_nonprod else refresh._PREFIXES_PROD)
    names = ", ".join("mcp__%s__welcome" % c for c in cands)
    la = json.dumps({"name": "fa__list__investor_scenarios", "arguments": {"firm_uuid": firm_uuid}},
                    separators=(",", ":"))
    session.send(
        "Do these two tool calls in order, then reply DONE (load a deferred tool with ToolSearch "
        "first, then call it — never stop after only searching):\n"
        "1. Call whichever ONE of these Carta welcome tools resolves — try in order, call no other "
        "server's welcome: %s\n"
        "2. On that SAME Carta server, call its call_tool tool with arguments %s" % (names, la))
    pending, prefix, listing, err = {}, None, None, None
    for ev in session.events(timeout=TURN_TIMEOUT):
        t = ev.get("type")
        if t == "assistant":
            for b in ev.get("message", {}).get("content", []):
                if b.get("type") == "tool_use":
                    pending[b.get("id")] = b.get("name")
                    p = refresh.prefix_from_toolname(b.get("name"))
                    if p in cands and prefix is None:
                        prefix = p
        elif t == "user":
            for b in ev.get("message", {}).get("content", []):
                if b.get("type") != "tool_result":
                    continue
                if not (pending.get(b.get("tool_use_id")) or "").endswith("__call_tool"):
                    continue
                text = refresh._flatten(b.get("content"))
                if b.get("is_error"):
                    err = err or text
                else:
                    listing = _unwrap(text)
        elif t == "result":
            break
    if err:
        code, msg, nh = _classify(err)
        raise ShareError(msg, code, nh, raw=err)
    if not prefix:
        raise ShareError("Couldn't reach Carta — sharing needs the Carta connector connected. "
                         "You can also run it from Claude.", "unreachable", True)
    return "mcp__%s__call_tool" % prefix, (listing or {})


def _is_arg_format_error(err):
    # type: (Optional[str]) -> bool
    """MCP rejected call_tool's arguments before running the tool (model passed a stringified blob,
    not a JSON object). Non-executing, so retryable; likelier on a large/nested payload."""
    e = (err or "").lower()
    return "arguments must be a dict" in e or "valid json string" in e


def _call(session, call, tool_name, args, emit, label=None):
    # type: (object, str, str, dict, Callable, Optional[str]) -> dict
    """Issue one carta call_tool and return its unwrapped envelope; map a real tool error to a
    typed ShareError."""
    emit("work", label or "Talking to Carta…")
    obj = json.dumps(args, separators=(",", ":"))  # compact: the model retypes this verbatim, so bytes = tokens
    base = ('Make exactly one tool call, then reply DONE. Call %s with two parameters: name = "%s", '
            'and arguments = the following JSON OBJECT (pass it as an object, never as a quoted '
            'string):\n%s' % (call, tool_name, obj))
    prompt = base
    # Retry the two non-executing flakes (op never ran → no duplicate-write risk): the model
    # searches but never invokes, or passes arguments as a string the MCP rejects. Real errors raise.
    for _ in range(3):
        ok, captures, err = _run_turn_all(session, prompt)
        if captures:
            return captures[-1]
        if err and not _is_arg_format_error(err):
            code, msg, nh = _classify(err)
            raise ShareError(msg, code, nh, raw=err)
        prompt = ('That call did not go through — %s. Call %s again (if it is not loaded, run '
                  'ToolSearch "select:%s" first, then invoke it THIS turn). Pass exactly: '
                  'name = "%s", arguments = this JSON OBJECT, not a quoted string:\n%s'
                  % ("the arguments must be a JSON object, not a string" if err else
                     "you searched but never invoked it", call, call, tool_name, obj))
    raise ShareError("Couldn't finish — try again, or run it from Claude.", "failed", True)


def _read_portfolio(data_dir):
    # type: (str) -> dict
    with open(os.path.join(data_dir, "portfolio.json")) as fh:
        return json.load(fh)


def _write_portfolio(data_dir, doc):
    # type: (str, dict) -> None
    p = os.path.join(data_dir, "portfolio.json")
    tmp = p + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(doc, fh)
    os.replace(tmp, p)


def _baseline(doc):
    # type: (dict) -> dict
    for s in doc.get("slices") or []:
        if s.get("id") == "baseline":
            return s
    return (doc.get("slices") or [{}])[0]


def _find_slice(doc, slice_id):
    # type: (dict, str) -> Optional[dict]
    for s in doc.get("slices") or []:
        if s.get("id") == slice_id:
            return s
    return None


def _slice_payload(sl):
    # type: (dict) -> dict
    """Payload for one slice: closed knob set (via _slice_overlay, v2/v3-safe) keyed by
    entity_link_id, fund assumptions, extensions. LP data is excluded by construction."""
    return {"companies": build_datadir._slice_overlay(sl),
            "assumptions": sl.get("assumptions") or {},
            "extensions": sl.get("extensions") or {}}


def _load_context(data_dir):
    # type: (str) -> tuple
    try:
        with open(os.path.join(data_dir, "snapshot.json")) as fh:
            snap = json.load(fh)
    except (OSError, ValueError):
        raise ShareError("This firm's cache is missing or unreadable; relaunch it from Claude.",
                         "failed", True)
    src = snap.get("source") or {}
    firm_uuid = src.get("firmUuid")
    if not firm_uuid:
        raise ShareError("This cache predates firm-id tracking; relaunch from Claude once.",
                         "failed", True)
    prefer_nonprod = (src.get("cartaEnvironment") == "nonprod")
    snapshot_basis = {"navAsOf": src.get("navAsOf"),
                      "source": src.get("provider") or "carta-fund-admin"}
    live_fund_ids = set(f.get("id") for f in (snap.get("funds") or []) if f.get("id"))
    return firm_uuid, prefer_nonprod, snapshot_basis, live_fund_ids


def _shared_meta(env, snapshot_basis):
    # type: (dict, dict) -> dict
    return {"uuid": env.get("uuid"), "createdBy": env.get("created_by"),
            "updatedBy": env.get("updated_by"), "updatedAt": env.get("updated_at"),
            "snapshotBasis": env.get("snapshot_basis") or snapshot_basis, "dirty": False}


class WarmShareSession(object):
    """A reusable headless claude session for share ops, owned by serve.py. The first op pays
    spawn + welcome + warm-up; later ops reuse the live session and cached call-tool name. Reports
    its subprocess via on_session so serve.py reaps it on shutdown; a dead session respawns next
    warm()."""

    def __init__(self, data_dir, claude_bin=None, model=SHARE_MODEL, on_session=None):
        # type: (str, Optional[str], Optional[str], Optional[Callable]) -> None
        self._data_dir = data_dir
        self._claude_bin = claude_bin
        self._model = model
        self._on_session = on_session or (lambda s: None)
        self._lock = threading.Lock()
        self.session = None
        self.call = None

    def _alive(self):
        s = self.session
        return (s is not None and not getattr(s, "_closed", False)
                and getattr(s, "proc", None) is not None and s.proc.poll() is None)

    def is_warm(self):
        # type: () -> bool
        """A live, bootstrapped session ready for reuse — lets the load-time prewarm skip a
        redundant spawn. Lock-free fast path; a benign race only costs a no-op warm()."""
        return self._alive() and self.call is not None

    def warm(self, firm_uuid, prefer_nonprod, emit):
        # type: (str, bool, Callable) -> tuple
        """Ensure a live, bootstrapped session → (call_tool_name, bootstrap_listing). listing is
        the cold bootstrap's warm-up fa:list (a same-call pull reuses it), None when reused."""
        with self._lock:
            if self._alive() and self.call:
                return self.call, None
            self._reset_locked()
            session = _start_session(prefer_nonprod, self._data_dir, self._claude_bin, self._model)
            try:
                session.start()
            except Exception:
                raise ShareError("Couldn't start a Claude session for sharing.", "failed", True)
            self.session = session
            self._on_session(session)  # report for reaping BEFORE the slow bootstrap
            try:
                self.call, listing = _bootstrap(session, prefer_nonprod, firm_uuid, emit)
            except Exception:
                self._reset_locked()
                raise
            return self.call, listing

    def reset(self):
        # type: () -> None
        """Close the current session so the next warm() respawns. Shutdown reaping goes through
        serve.py's _share_session channel, not this."""
        with self._lock:
            self._reset_locked()

    def _reset_locked(self):
        # type: () -> None
        s = self.session
        self.session = None
        self.call = None
        if s is not None:
            try:
                s.close()
            except Exception:
                pass
            self._on_session(None)


def _drop_pool_if_session_error(warm, exc):
    # type: (WarmShareSession, BaseException) -> None
    """Drop the pooled session on a session-level failure (timeout/crash) so the next op respawns;
    keep it for ordinary tool errors — the session is healthy, only the request was rejected."""
    if not isinstance(exc, ShareError) or exc.code in ("failed", "unreachable"):
        warm.reset()


def run_publish(data_dir, slice_id, emit, portfolio_lock, warm, force=False, as_new=False):
    # type: (str, str, Callable, object, WarmShareSession, bool, bool) -> dict
    """Publish one local scenario (create) or push edits to its shared row (update, when the slice
    carries shared.uuid). Update refuses to overwrite a server row changed since the local copy
    unless force=True; `as_new` forces create for a slice with shared.uuid (the "publish as new"
    recovery when the row was deleted upstream). Returns {status:"ok"|"stale"|"deleted", ...}."""
    firm_uuid, prefer_nonprod, snapshot_basis, _ = _load_context(data_dir)
    emit("preflight", "Reading your scenario…")
    sl = _find_slice(_read_portfolio(data_dir), slice_id)
    if sl is None:
        raise ShareError("That scenario is gone; reload and try again.", "failed", False)
    payload = _slice_payload(sl)
    name = sl.get("name") or "Scenario"
    shared = sl.get("shared") or {}
    scenario_uuid = shared.get("uuid")

    call, _ = warm.warm(firm_uuid, prefer_nonprod, emit)
    session = warm.session
    try:
        if scenario_uuid and not as_new:
            try:
                if not force:
                    cur = _call(session, call, "fa__get__investor_scenarios",
                                {"firm_uuid": firm_uuid, "scenario_uuid": scenario_uuid},
                                emit, "Checking for others' changes…")
                    srv = cur.get("updated_at")
                    if srv and shared.get("updatedAt") and srv != shared.get("updatedAt"):
                        return {"status": "stale", "scenarioUuid": scenario_uuid,
                                "updatedBy": cur.get("updated_by"), "updatedAt": srv}
                env = _call(session, call, "fa__update__investor_scenarios",
                            {"firm_uuid": firm_uuid, "scenario_uuid": scenario_uuid,
                             "name": name, "payload": payload}, emit, "Updating the shared scenario…")
            except ShareError as e:
                # The row was deleted upstream (owner-only). Don't dead-end the user's unpublished
                # edits — report it so the UI can offer to publish a fresh copy or keep it private.
                if e.code == "not_found":
                    return {"status": "deleted", "scenarioUuid": scenario_uuid}
                raise
        else:
            env = _call(session, call, "fa__create__investor_scenarios",
                        {"firm_uuid": firm_uuid, "name": name, "payload": payload,
                         "snapshot_basis": snapshot_basis}, emit, "Publishing your scenario…")
    except Exception as e:
        _drop_pool_if_session_error(warm, e)
        raise

    if not env.get("uuid"):
        raise ShareError("Carta didn't return the published scenario; try again.", "failed", True)
    new_shared = _shared_meta(env, snapshot_basis)
    # Re-read current portfolio.json (the browser may have saved during the MCP calls) and stamp
    # only the target slice's shared link — never write back the minutes-old pre-MCP snapshot.
    with portfolio_lock:
        doc = _read_portfolio(data_dir)
        target = _find_slice(doc, slice_id)
        if target is None:
            raise ShareError("That scenario was removed while publishing.", "failed", False)
        target["shared"] = new_shared
        _write_portfolio(data_dir, doc)
    return {"status": "ok", "uuid": new_shared["uuid"]}


def run_delete(data_dir, slice_id, emit, portfolio_lock, warm):
    # type: (str, str, Callable, object, WarmShareSession) -> dict
    """Soft-delete a shared scenario's firm row (fa:delete, owner-only) and drop the local
    copy. A non-owner 403 surfaces as not_owner."""
    firm_uuid, prefer_nonprod, _, _ = _load_context(data_dir)
    sl = _find_slice(_read_portfolio(data_dir), slice_id)
    if sl is None:
        raise ShareError("That scenario is gone.", "failed", False)
    scenario_uuid = (sl.get("shared") or {}).get("uuid")
    if not scenario_uuid:
        raise ShareError("That scenario isn't shared.", "failed", False)

    # The model hesitates on this destructive op and sometimes never invokes the tool. The
    # hesitation is per-session, so respawn a fresh session and retry once (idempotent — safe).
    for attempt in range(2):
        call, _ = warm.warm(firm_uuid, prefer_nonprod, emit)
        try:
            _call(warm.session, call, "fa__delete__investor_scenarios",
                  {"firm_uuid": firm_uuid, "scenario_uuid": scenario_uuid},
                  emit, "Deleting the shared scenario…")
            break
        except ShareError as e:
            # A 403 on delete is always owner-only, whatever the server phrasing.
            if e.code in ("not_admin", "not_owner"):
                raise ShareError("Only the creator can delete this shared scenario.",
                                 "not_owner", False)
            if e.code == "not_found":
                break  # already gone upstream == deleted (idempotent)
            warm.reset()  # stuck/session-level: a fresh session usually un-sticks the delete
            if attempt == 0:
                continue
            raise
        except Exception:
            warm.reset()
            if attempt == 0:
                continue
            raise

    with portfolio_lock:
        doc = _read_portfolio(data_dir)
        doc["slices"] = [s for s in (doc.get("slices") or []) if s.get("id") != slice_id]
        _write_portfolio(data_dir, doc)
    return {"status": "ok"}


def _listing_ok(x):
    # type: (object) -> bool
    """A trustworthy fa:list envelope carries an explicit `scenarios` array. A flaky bootstrap
    returns {} / None; trusting that as "0 upstream" would prune every clean shared slice."""
    return isinstance(x, dict) and isinstance(x.get("scenarios"), list)


def run_pull(data_dir, emit, portfolio_lock, warm, override_uuids=None):
    # type: (str, Callable, object, WarmShareSession, Optional[set]) -> dict
    """Load the firm's shared scenarios, re-hydrate each onto the current baseline by
    entity_link_id, and upsert into portfolio.json by shared.uuid (idempotent; skip
    locally-dirty rows, drop upstream-deleted ones, leave user forks untouched).
    `override_uuids` overwrite even if locally dirty — the "load theirs" conflict resolution."""
    firm_uuid, prefer_nonprod, _, live_fund_ids = _load_context(data_dir)
    emit("preflight", "Checking your Carta connection…")
    call, boot = warm.warm(firm_uuid, prefer_nonprod, emit)
    session = warm.session
    try:
        # A flaky bootstrap returns {} (no scenarios array); re-fetch rather than trust it as the list.
        listing = boot if _listing_ok(boot) else _call(
            session, call, "fa__list__investor_scenarios",
            {"firm_uuid": firm_uuid}, emit, "Loading shared scenarios…")
        prune = _listing_ok(listing)  # only drop upstream-deleted slices against a trustworthy list
        scenarios = listing.get("scenarios") if prune else []
        upstream_uuids = set(s.get("uuid") for s in scenarios if s.get("uuid"))
        remote = []
        for i in range(0, len(scenarios), GET_BATCH):
            chunk = scenarios[i:i + GET_BATCH]
            emit("work", "Fetching shared scenarios…", step=min(i + len(chunk), len(scenarios)),
                 total=len(scenarios))
            lines = "\n".join(
                '%s {"name":"fa__get__investor_scenarios","arguments":{"firm_uuid":"%s","scenario_uuid":"%s"}}'
                % (call, firm_uuid, s.get("uuid")) for s in chunk if s.get("uuid"))
            prompt = ("Run these %d tool calls (one per line), then reply DONE:\n%s"
                      % (len(chunk), lines))
            ok, captures, err = _run_turn_all(session, prompt, timeout=TURN_TIMEOUT + 20 * len(chunk))
            if err and not captures:
                code, msg, nh = _classify(err)
                raise ShareError(msg, code, nh, raw=err)
            remote.extend(c for c in captures if isinstance(c, dict) and c.get("uuid"))
    except Exception as e:
        _drop_pool_if_session_error(warm, e)
        raise

    return _merge_pull(data_dir, portfolio_lock, remote, live_fund_ids, upstream_uuids,
                       override_uuids or set(), prune=prune)


def _merge_pull(data_dir, portfolio_lock, remote, live_fund_ids, upstream_uuids,
                override_uuids=None, prune=True):
    # type: (str, object, List[dict], set, set, Optional[set], bool) -> dict
    """`remote` = fetched payloads to upsert; `upstream_uuids` = every uuid the firm still has
    (authoritative fa:list, drives the deletion pass); `override_uuids` = overwrite even if dirty.
    `prune` gates the deletion pass — False when the listing wasn't authoritative (skip deletions)."""
    override_uuids = override_uuids or set()
    with portfolio_lock:
        doc = _read_portfolio(data_dir)
        base_companies = _baseline(doc).get("companies") or []
        by_uuid = {}
        for s in doc.get("slices") or []:
            sh = s.get("shared")
            if isinstance(sh, dict) and sh.get("uuid"):
                by_uuid[sh["uuid"]] = s
        dropped, added, updated, skipped = [], 0, 0, 0

        for env in remote:
            uuid = env.get("uuid")
            existing = by_uuid.get(uuid)
            if (existing and (existing.get("shared") or {}).get("dirty")
                    and uuid not in override_uuids):
                skipped += 1  # a locally-dirty scenario's edits are unpublished — don't clobber
                continue
            payload = env.get("payload") or {}
            old = {"edits": payload.get("companies") or {},
                   "assumptions": payload.get("assumptions") or {}}
            reconciled, drops = build_datadir.reconcile_slice(old, base_companies, live_fund_ids)
            dropped.extend(drops)
            local_id = existing["id"] if existing else ("shared-" + (uuid or "")[:8])
            new_shared = _shared_meta(env, None)  # pulled row: no locally-computed basis fallback
            # A locally-hidden scenario stays hidden across pulls — carry the view-state flag.
            if existing and (existing.get("shared") or {}).get("hidden"):
                new_shared["hidden"] = True
            new_slice = {
                "id": local_id, "name": env.get("name"), "locked": False,
                "shared": new_shared,
                "assumptions": reconciled.get("assumptions") or {},
                "edits": reconciled.get("edits") or {},
                "extensions": payload.get("extensions") or {},
            }
            if existing:
                doc["slices"][doc["slices"].index(existing)] = new_slice
                updated += 1
            else:
                doc["slices"].append(new_slice)
                added += 1

        # Drop shared slices deleted upstream (absent from the authoritative listing) with no local
        # edits — never drop one merely because its fa:get failed this pull, or the list was flaky.
        removed = 0
        if prune:
            kept = []
            for s in doc.get("slices") or []:
                sh = s.get("shared")
                if (isinstance(sh, dict) and sh.get("uuid") and sh["uuid"] not in upstream_uuids
                        and not sh.get("dirty")):
                    removed += 1
                    continue
                kept.append(s)
            doc["slices"] = kept
        _write_portfolio(data_dir, doc)

    return {"status": "ok", "added": added, "updated": updated, "skipped": skipped,
            "removed": removed, "dropped": sorted(set(x for x in dropped if x))}
