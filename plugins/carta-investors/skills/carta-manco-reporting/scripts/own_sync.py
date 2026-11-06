"""Mirror a user's own imported Budget vs Actuals reports to Carta, privately.

A copy the hosted microapp can read without a manual export/upload. Reuses the
same fa:*:budget_report family share_ops already calls for deliberate sharing,
with `shared_with` always pinned to the caller's own user id — this never makes
a report visible to anyone else, and never touches `report["shared"]` (the
deliberate-sharing link the Share dialog reads).

A report is pushed only when its payload or its name has moved since the last
successful push (`own_sync.payload_fingerprint`/`pushed_name`), mirroring
report_store.mark_if_payload_moved's dirty check for shared reports — a
name-only move sends just the name, never the payload. reconcile_names runs
first, at the start of every sweep: it settles the other direction, a rename
made on the hosted app, back onto the local report before push_if_changed
looks at anything, so the two directions never fight over the same name (see
reconcile_names's own docstring for the three-way comparison that decides
whose rename wins). report_store.ReportStore.dismissed_uuids folds in every
report's own sync uuid, so a mirror this dashboard pushed is never imported
back by share_ops.pull as if someone else had shared it — only for *this*
local reports.json, though: a mirror pushed from a different checkout of the
same dashboard (a second machine, a reinstalled skill) has no local record
here, so share_ops.pull adopts it as a personal copy of its own
(report_store.ReportStore.adopt_own_sync), linked to the same mirror.

Removing a synced report locally must go through `forget`, not
report_store.ReportStore.remove directly: `remove` alone only stops a local
pull from re-importing the mirror, it never deletes it from Carta, so the
hosted microapp would keep showing a report the user deleted locally.

The other direction — deleting a mirror from the hosted app — is one-way: it
never deletes the local report, only its own-sync link to Carta. Both push
paths notice this the same way, on their own mutate getting `not_found`, and
both retire the link (report_store.ReportStore.retire_own_sync) instead of
creating a fresh mirror: the sweep's push_if_changed retires it itself; a
Claude session's own push (references/serve-and-update.md's Step 5.2) calls
`own_sync.py --retire <report_id>` (retire_session_push) to do the same. Either
way, no later push — sweep or session — silently resurrects a report whose
mirror someone just deleted deliberately, until an explicit `--recreate`
starts it over. The local report itself stays, unsynced, until its own owner
removes it there too.

push_if_changed and forget each read before making a slow Carta call and only
write afterward, so the two can race each other across threads (serve.py
handles requests on threads) or across processes (a detached sweep, see
main() below, and a live serve.py handling a removal at the same time).
Every uuid either of them creates or already holds ends up either recorded
on a live local report or deleted in Carta — never left live with nothing
local claiming it — even when they overlap: push_if_changed deletes its own
new uuid upstream if the report vanishes under it, and forget deletes
whatever uuid remove() actually dismissed, which can differ from the uuid
forget already deleted if a push stamped a new one in between.

main() additionally serializes every *sweep* on one dashboard behind a
cross-process lock (`.own-sync.lock`, same O_EXCL scheme as
report_store._FileLock, `observe_stale=True`): a build that finishes while
the same dashboard's previous sweep is still running would otherwise spawn a
second one, and two sweeps racing the same report would each call
fa__create__budget_report for it, with record_own_sync's last write winning
and the other's uuid orphaned in Carta with nothing local pointing at it any
more. For as long as a sweep holds the lock, a background heartbeat thread
refreshes its mtime on a fixed interval, independent of how long any single
Carta call inside the sweep takes — a bridge turn can run well past any one
timeout (a relay turn, a retry, a reset), so staleness must track whether
the holding *process* is still alive, never how long one call or how many
reports a sweep has. A waiter blocks until the holder either releases the
lock or its heartbeat thread stops (the process crashed) for
`_SWEEP_LOCK_STALE_AFTER`, timed on the waiter's own monotonic clock
(`_FileLock`'s `observe_stale` explains why).

A pushed payload's optional `variance_by_category` (the Top Categories of
Variance chart's data, trimmed to this one report) needs fund-admin's
budget_report payload validator to accept that key. A Carta that doesn't
(predating carta/fund-admin#97557) refuses a push that carries it.

Python-stdlib only, 3.9-safe.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, Iterator, List, Optional, Tuple

import export_budget_bundle
import manco_paths
import preflight_claude
import report_payload
import report_store
import share_bridge
import share_ops
from share_bridge import ShareError

Emit = Callable[[str], None]

# Why a sweep couldn't reach Carta, recorded in own_sync_status.json
# (manco_paths.write_own_sync_status) for diagnosis — --plan never reads it.
# preflight_claude's own reasons are recorded as they are.
BLOCKED_NO_USER_ID = "no_user_id"
BLOCKED_NOT_INSTALLED = preflight_claude.REASON_NOT_INSTALLED
BLOCKED_NOT_LOGGED_IN = preflight_claude.REASON_NOT_LOGGED_IN
BLOCKED_UNREACHABLE = share_bridge.UNREACHABLE


def _is_unreachable(e: BaseException) -> bool:
    """No Carta connector answered: every later call would fail the same way."""
    return isinstance(e, ShareError) and e.code == BLOCKED_UNREACHABLE

_VARIANCE_CATEGORY_FIELDS = ("name", "budget", "actual", "variance")


def _variance_by_category_for(data_dir: Path, report_id: str) -> Optional[Dict[str, Any]]:
    """`report_id`'s own entry from the dashboard's snapshot.varianceByCategory (the Top
    Categories of Variance chart's data), for just this one report (own_sync pushes one
    at a time), with each category trimmed to the four fields the chart renders — a
    synced report can't support the drill-down fields (gl_codes, carta_tags, scopes,
    excluded_claims, monthly/quarterly_budget) any more than a shared-in report can.
    Everything else on the entry (period, budget_period, excluded, label) is carried as
    the snapshot holds it, same as the manual-upload bundle.

    None when the snapshot has nothing for this report. push_if_changed is what decides
    whether the entry actually ships — it needs the whole payload to know whether adding
    it would push the report over report_payload's overall size limit, not just this
    entry's own."""
    try:
        snapshot = json.loads((data_dir / "snapshot.json").read_text())
    except (OSError, ValueError):
        return None
    variance = export_budget_bundle._own_variance(snapshot.get("varianceByCategory"), {report_id})
    if not variance:
        return None
    own = variance["budgets"][0]
    categories = own.get("categories") or []
    if not categories:
        return None
    trimmed = dict(own, categories=[{k: c.get(k) for k in _VARIANCE_CATEGORY_FIELDS} for c in categories])
    return {"budgets": [trimmed], "default_id": variance["default_id"]}


def plan_push(
    store: report_store.ReportStore,
    data_dir: Path,
    report_id: str,
    user_id: int,
    *,
    create: bool = False,
) -> Optional[Dict[str, Any]]:
    """What syncing `report_id` would send right now: {"command", "arguments", "payload",
    "name"}, with `payload` the canonical payload whose fingerprint a successful push
    records. None when nothing needs sending: the report is read-only (shared with you,
    not yours to mirror), hasn't been built yet, its own-sync was retired (see below) and
    `create` wasn't asked for, or neither its payload nor its name moved since the last push.

    A report already synced is updated in place; a rename alone sends just the name,
    never the payload or snapshot_basis. `create` plans a fresh create instead, for
    when that update finds the link no longer ours (`not_owner`, on either push path), or
    for an explicit `--recreate` — the one way a retired report's own-sync starts again. Never
    automatic: no push path — the sweep's push_if_changed or a session's own --retire, this
    module's own doc for why both treat `not_found` the same way — resurrects a mirror the
    hosted app deliberately deleted just because the local payload or name moved since.

    push_if_changed sends this through the `claude` CLI's bridge; a Claude session with its
    own Carta connector sends the same arguments itself (main()'s --plan and --record)."""
    doc = store.load()
    report = report_store.ReportStore.find(doc, report_id)
    if report_store.ReportStore.metadata(report)["read_only"]:
        return None
    sync = report.get("own_sync") or {}
    if not create and sync.get("retired"):
        return None
    try:
        payload = store.read_share_payload(report_id)
    except report_store.ReportEditError:
        return None
    variance = _variance_by_category_for(data_dir, report_id)
    if variance is not None:
        with_variance = dict(payload, variance_by_category=variance)
        try:
            report_payload.validate(with_variance)
            payload = with_variance
        except report_payload.PayloadError:
            pass  # the payload with variance attached is over a limit; push it without
    name = report["name"]
    payload_changed = sync.get("payload_fingerprint") != report_store.payload_fingerprint(payload)
    if not create and not payload_changed and sync.get("pushed_name") == name:
        return None

    ctx = share_ops.context(data_dir)
    uuid = None if create else sync.get("uuid")
    if uuid:
        args = {"fund_uuid": ctx["fund_uuid"], "report_uuid": uuid, "shared_with": [user_id]}
        args.update(share_ops.report_args(ctx, name, payload, check_basis=payload_changed))
        return {"command": share_ops.MUTATE_COMMAND, "arguments": args, "payload": payload, "name": name}
    return _create_plan(ctx, name, payload, user_id)


def _create_plan(ctx: Dict[str, Any], name: str, payload: Dict[str, Any], user_id: int) -> Dict[str, Any]:
    args = {"fund_uuid": ctx["fund_uuid"], "shared_with": [user_id]}
    args.update(share_ops.report_args(ctx, name, payload, check_basis=True, source=share_ops.source()))
    return {"command": share_ops.CREATE_COMMAND, "arguments": args, "payload": payload, "name": name}


def push_if_changed(
    bridge: Any,
    store: report_store.ReportStore,
    data_dir: Path,
    report_id: str,
    user_id: int,
    emit: Emit,
) -> Optional[Dict[str, Any]]:
    """Push `report_id`'s current payload and name to Carta as a report visible to
    nobody but `user_id`, when either has moved since the last successful push for
    this report (plan_push decides what, if anything, to send).

    Returns the report's metadata (report_store.ReportStore.metadata shape,
    including its `own_sync` field) after a push, or None when nothing
    needed sending.

    `report_id` can also be removed locally (by another thread's own_sync.forget,
    or a plain report_store.ReportStore.remove on a report nothing had synced yet)
    while the bridge call is in flight. When that happens this still
    returns None, but the uuid Carta just created or updated is deleted upstream
    first — it is never left live with nothing local claiming it.
    """
    plan = plan_push(store, data_dir, report_id, user_id)
    if plan is None:
        return None
    response = None
    if plan["command"] == share_ops.MUTATE_COMMAND:
        emit("Syncing your report to the hosted app…" if "payload_compact" in plan["arguments"]
             else "Renaming your report in the hosted app…")
        try:
            response = share_ops.envelope(bridge.call(share_ops.MUTATE_COMMAND, plan["arguments"], emit))
        except ShareError as e:
            if e.code == "not_found":
                # Someone else deleted this mirror — the hosted app's own Delete, most
                # likely — deliberately, not by accident: never resurrect it just because the
                # local payload or name moved since. report_store.ReportStore.retire_own_sync
                # makes plan_push refuse every later push for this report; only an explicit
                # --recreate pushes a fresh one again.
                store.retire_own_sync(report_id)
                return None
            if e.code != "not_owner":
                raise
            # The link is no longer ours to update; create a fresh one from the same
            # payload, even if the report was removed meanwhile (_record_push retires it).
            plan = _create_plan(share_ops.context(data_dir), plan["name"], plan["payload"], user_id)
    if response is None:
        emit("Saving your report for the hosted app…")
        response = share_ops.envelope(bridge.call(share_ops.CREATE_COMMAND, plan["arguments"], emit))
    return _record_push(store, data_dir, report_id, plan, response["report"].get("uuid"),
                        lambda uuid: share_ops.delete_upstream(bridge, share_ops.context(data_dir), uuid, emit))


def _record_push(store: report_store.ReportStore, data_dir: Path, report_id: str, plan: Dict[str, Any],
                 pushed_uuid: Optional[str], delete_upstream: Callable[[str], None]) -> Optional[Dict[str, Any]]:
    """Stamp a push of `plan` that Carta answered with `pushed_uuid`, and clear the sweep's
    blocked reason: Carta was reached."""
    result = store.record_own_sync(report_id, pushed_uuid, plan["payload"], plan["name"])
    manco_paths.write_own_sync_status(data_dir, None)
    if result is None and pushed_uuid:
        # report_id was removed locally while the push was in flight: record_own_sync
        # already dismissed pushed_uuid so a pull won't re-import it, but the mirror
        # itself is still live in Carta until deleted here.
        delete_upstream(pushed_uuid)
    return result


def forget(
    bridge: Any,
    store: report_store.ReportStore,
    data_dir: Path,
    report_id: str,
    emit: Emit,
    *,
    expected_etag: Optional[str] = None,
) -> None:
    """Retire a report's private mirror in Carta, then remove it locally — refusing
    before touching Carta whenever the local removal itself would be refused (the
    report doesn't exist, it's a workbook report, or `expected_etag` is stale). The
    one way to remove a report that may have been synced: report_store.ReportStore.
    remove alone only stops a local pull from re-importing the mirror, it never
    retires it upstream.

    A push racing this call can still stamp a *different* own-sync uuid on the
    report between this check and the final remove() — when that happens, the
    uuid remove() actually dismissed is deleted too, so no mirror outlives its
    report either way.
    """
    report = store.check_removable(report_id, expected_etag=expected_etag)
    uuid = report_store.ReportStore.own_sync_uuid(report)
    if uuid:
        share_ops.delete_upstream(bridge, share_ops.context(data_dir), uuid, emit)
    dismissed = store.remove(report_id)
    if dismissed and dismissed != uuid:
        share_ops.delete_upstream(bridge, share_ops.context(data_dir), dismissed, emit)


def _parse_dt(value: Any) -> Optional[datetime]:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _is_later(a: Any, b: Any) -> bool:
    """Whether ISO timestamp `a` is strictly after `b` — Carta's own report
    `updated_at` compared against this dashboard's. An unparsable or missing `a`
    never wins; an unparsable or missing `b` always loses to a parsable `a`."""
    parsed_a = _parse_dt(a)
    if parsed_a is None:
        return False
    parsed_b = _parse_dt(b)
    return parsed_b is None or parsed_a > parsed_b


def _reconcile_one_name(store: report_store.ReportStore, report: Dict[str, Any], mirror: Dict[str, Any]) -> None:
    """Settle one report's name against its mirror's current name in Carta, by the
    three-way comparison reconcile_names documents: local name, mirror name, and
    the name last pushed (`own_sync.pushed_name`) — all three read from the same
    snapshot of reports.json reconcile_names took before its listing call, not a
    fresh load here: `report` is that snapshot's own dict, and it is what
    store.apply_synced_name is told to expect still holds before it writes."""
    mirror_name = mirror.get("name")
    if not isinstance(mirror_name, str):
        return
    # Stripped the same way report_store.rename()/apply_synced_name store a name: without
    # this, a mirror name Carta hands back with surrounding whitespace never equals the
    # stripped pushed_name apply_synced_name just stored for it, so every later sweep reads
    # "only the mirror changed" again — reapplying the same name forever, bumping updated_at
    # and marking any deliberate share link dirty on every pass, and never actually settling.
    mirror_name = mirror_name.strip()
    sync = report.get("own_sync") or {}
    pushed_name = sync.get("pushed_name")
    local_name = report["name"]
    if mirror_name == pushed_name:
        return  # nothing moved upstream since the last push; a local-only change (if
                # any) is push_if_changed's job, run right after this in sweep()
    if local_name == pushed_name:
        # only the mirror changed
        store.apply_synced_name(report["id"], mirror_name, expected_name=local_name, expected_pushed_name=pushed_name)
        return
    if local_name != mirror_name and _is_later(mirror.get("updated_at"), report.get("updated_at")):
        # both changed; Carta's is newer
        store.apply_synced_name(report["id"], mirror_name, expected_name=local_name, expected_pushed_name=pushed_name)
    # else: both changed and the local edit is newer (or they already match) —
    # leave it; push_if_changed resends it since pushed_name no longer matches.


def _reconcile_from_doc(store: report_store.ReportStore, doc: Dict[str, Any],
                         mirrors: List[Dict[str, Any]]) -> None:
    """Settle every own-synced, editable report in `doc` against its current name in
    `mirrors` (a `fa:get:budget_reports` listing's `reports` array). Never touches a report
    shared with you (read-only) or a report's own `shared` link — only `own_sync`. Shared by
    reconcile_names and reconcile_names_from_listing, which differ only in when each loads
    `doc` relative to fetching `mirrors` — see their own docstrings."""
    by_uuid = {m.get("uuid"): m for m in mirrors if isinstance(m, dict) and m.get("uuid")}
    for report in doc["reports"]:
        try:
            if report_store.ReportStore.metadata(report)["read_only"]:
                continue
            uuid = report_store.ReportStore.own_sync_uuid(report)
            mirror = by_uuid.get(uuid) if uuid else None
            if mirror is not None:
                _reconcile_one_name(store, report, mirror)
        except Exception as e:
            print("[own_sync] name reconcile for %r skipped: %r" % (report.get("id"), e), file=sys.stderr)


def reconcile_names_from_listing(store: report_store.ReportStore, mirrors: List[Dict[str, Any]]) -> None:
    """Bring a rename made on the hosted app onto the local report, without waiting for
    the next push: settles every own-synced, editable report's name against `mirrors` (a
    `fa:get:budget_reports` listing's `reports` array, already fetched by the caller).

    Loads reports.json here, after `mirrors` was already fetched — the one ordering
    reconcile_names (below) avoids, because its single process can hold the listing and the
    load together. A session push can't: the listing runs over a session's own Carta
    connector (own_sync.py has none), in a sub-agent, written to a file, and read back by a
    separate `--plan --mirrors` process — there is no way to load reports.json before a
    listing call made somewhere else entirely. The race that ordering guards
    against in reconcile_names — a concurrent push elsewhere recording a new `pushed_name`
    while the listing was still in flight — is narrower here, not eliminated: best-effort
    against another writer racing the exact gap between the sub-agent's listing and this
    call, not a guarantee against it. `store.apply_synced_name` still refuses to write
    unless the local name and `pushed_name` it's given are still what's on disk at write
    time, so a *local* rename or push landing after this function's own load is never
    overwritten — only a mirror listing that was already stale when it was taken is a risk
    this function can't fully close.
    """
    _reconcile_from_doc(store, store.load(), mirrors)


def reconcile_names(store: report_store.ReportStore, data_dir: Path, bridge: Any,
                     emit: Emit = lambda message: None) -> None:
    """The sweep's own way of settling a hosted rename onto the local report: unlike
    reconcile_names_from_listing (above), this loads reports.json *before* fetching the
    listing, not after — one process holds both, so the three-way comparison in
    _reconcile_one_name is always made against the same state the listing was fetched
    against. Without that, a push landing elsewhere while this listing is still in flight —
    recording a new pushed_name while the listing still carries the old mirror name — would
    read as "only the mirror changed" once compared against a fresh reports.json a load
    taken after the listing would see instead.

    store.apply_synced_name is also given the exact local name and pushed_name the snapshot
    held, and writes only if both are still what's on disk right when it runs. This is what
    stops a rename or a push that lands *after* the snapshot (between it and
    apply_synced_name's own write) from being overwritten — the snapshot's ordering alone
    says nothing about that later window.

    Best-effort and silent, like sweep() itself: a dashboard predating report sharing, a
    listing Carta refuses, or any other error here never stops the push side sweep() runs
    right after. The one exception is a Carta connector the `claude` CLI can't reach at
    all: that ShareError (code BLOCKED_UNREACHABLE) is raised, since no push can succeed either.
    """
    doc = store.load()
    try:
        ctx = share_ops.context(data_dir)
        reports = share_ops.list_reports(bridge, ctx, emit)
    except ShareError as e:
        if _is_unreachable(e):
            raise
        print("[own_sync] name reconcile skipped: %r" % e, file=sys.stderr)
        return
    if reports is None:
        return
    _reconcile_from_doc(store, doc, reports)


def sweep(data_dir: Path, user_id: int, bridge: Any) -> None:
    """Settle every own-synced report's name against Carta (reconcile_names), then
    push every own, eligible report in this dashboard's reports.json, one at a
    time. The push side is best-effort and silent: a report that fails to push
    (an invalid payload, a Carta error) is skipped — logged to stderr, never
    raised — so one bad report never stops the rest. push_if_changed itself
    already skips a report that's read-only (shared with you), unbuilt, or
    unchanged.

    main()'s production caller (build_manco_datadir.py's _spawn_sync_sweep)
    redirects this stderr to manco_paths.own_sync_log_file, so a skipped push
    still leaves a record a maintainer can read.

    A Carta connector the `claude` CLI can't reach stops the sweep: every push
    would fail the same way. That is recorded as the sweep's status while a push is
    still due (_record_blocked), and a sweep that did reach Carta clears it."""
    store = report_store.ReportStore(data_dir)
    try:
        reconcile_names(store, data_dir, bridge)
        for report in store.load()["reports"]:
            try:
                push_if_changed(bridge, store, data_dir, report["id"], user_id, lambda message: None)
            except Exception as e:
                if _is_unreachable(e):
                    raise
                print("[own_sync] push %r skipped: %r" % (report["id"], e), file=sys.stderr)
    except ShareError as e:
        _record_blocked(data_dir, BLOCKED_UNREACHABLE,
                        "the claude CLI can't reach a Carta connector (%s): %s"
                        % (", ".join(bridge.servers), e), user_id)
        return
    manco_paths.write_own_sync_status(data_dir, None)


def _due_plans(store: report_store.ReportStore, data_dir: Path, report_ids: List[str], user_id: int,
               create: bool = False) -> Iterator[Tuple[str, Dict[str, Any]]]:
    """(report_id, plan) for each of `report_ids` with a push due. Makes no Carta call; a
    report that can't be planned is logged and skipped."""
    for report_id in report_ids:
        try:
            plan = plan_push(store, data_dir, report_id, user_id, create=create)
        except (ShareError, report_store.ReportEditError) as e:
            print("[own_sync] plan %r skipped: %r" % (report_id, e), file=sys.stderr)
            continue
        if plan is not None:
            yield report_id, plan


def _record_blocked(data_dir: Path, reason: str, detail: str, user_id: Optional[int] = None) -> None:
    """Log why a sweep couldn't reach Carta, and record it in own_sync_status.json (the one
    rule for that file) — diagnostic only; `--plan` never reads it.

    - `no_user_id` (no `user_id` here) is recorded for every report.
    - Any other reason is recorded with `due`, the reports that still have a push due; with
      none due, `blocked_by` is None.
    - _record_push writes None after any push, a sweep's or a session's --record."""
    print("[own_sync] not synced to the hosted app: %s" % detail, file=sys.stderr)
    if user_id is None:
        manco_paths.write_own_sync_status(data_dir, reason)
        return
    store = report_store.ReportStore(data_dir)
    due = [report_id for report_id, _ in
           _due_plans(store, data_dir, [r["id"] for r in store.load()["reports"]], user_id)]
    manco_paths.write_own_sync_status(data_dir, reason if due else None, due if due else None)


# A sweep's lock counts as stale only once the *process* holding it has
# stopped running, never because one Carta call or the sweep as a whole is
# slow: a single bridge turn can legitimately run well past any one timeout
# (a relay turn, a retry, a reset to a fresh session), so nothing about how
# long a call or a sweep takes can bound how long the lock may need to stay
# held. main()'s heartbeat thread refreshes it every
# _SWEEP_LOCK_HEARTBEAT_INTERVAL for as long as a sweep holds it (a --plan holds it only
# for write_plans, with no heartbeat); only a crash stops that before the release, and _SWEEP_LOCK_STALE_AFTER is a fixed multiple of the
# interval so a waiter reclaims a lock a crashed holder left behind.
_SWEEP_LOCK_HEARTBEAT_INTERVAL = 30.0
_SWEEP_LOCK_STALE_AFTER = 4 * _SWEEP_LOCK_HEARTBEAT_INTERVAL


def _heartbeat(lock_path: Path, interval: float, stop: threading.Event) -> None:
    """Keep `lock_path`'s mtime fresh on its own thread for as long as a sweep
    holds it, so a sweep's lock never looks abandoned while the process holding
    it is still alive — independent of how long any
    single Carta call inside the sweep it's guarding takes."""
    while not stop.wait(interval):
        try:
            os.utime(lock_path, None)
        except OSError:
            pass


def _sweep_lock(data_dir: Path) -> "report_store._FileLock":
    """The one lock that serializes a dashboard's sweeps and --plan, so neither ever writes
    reports.json at the same time as the other. A sweep holds it for its whole run, the
    `claude` CLI probe included. An abandoned lock frees itself once it goes stale, so
    there's nothing a finite wait would gain over the lock's own staleness check: wait as
    long as it takes for the holder to either finish or stop refreshing it."""
    return report_store._FileLock(manco_paths.own_sync_lock_file(data_dir), timeout=float("inf"),
                                  stale_after=_SWEEP_LOCK_STALE_AFTER, observe_stale=True)


def write_plans(data_dir: Path, user_id: int, recreate: Optional[str] = None) -> List[Dict[str, Any]]:
    """Write a plan for every report that needs pushing (or, with `recreate`, a fresh
    create for that one report, after Carta answered its update with `not_owner` — the link
    is no longer this user's to update, not gone; `not_found` goes through `--retire`
    instead, which plans nothing) to manco_paths.own_sync_plan_dir, and return what a session
    needs to make each call: report_id, name, command, arguments_file. _plan drops earlier
    plans."""
    store = report_store.ReportStore(data_dir)
    plan_dir = manco_paths.own_sync_plan_dir(data_dir)
    ids = [r["id"] for r in store.load()["reports"]] if recreate is None else [recreate]
    plan_dir.mkdir(parents=True, exist_ok=True)
    pushes = []
    for report_id, plan in _due_plans(store, data_dir, ids, user_id, create=recreate is not None):
        plan_file, arguments_file = manco_paths.own_sync_plan_files(data_dir, report_id)
        arguments_file.write_text(json.dumps(plan["arguments"], separators=(",", ":")))
        plan_file.write_text(json.dumps(plan))
        pushes.append({"report_id": report_id, "name": plan["name"], "command": plan["command"],
                       "arguments_file": str(arguments_file)})
    return pushes


def record_session_push(data_dir: Path, report_id: str, pushed_uuid: str) -> Dict[str, Any]:
    """Stamp a push a Claude session made from `report_id`'s plan, exactly as
    push_if_changed stamps its own, and drop that plan either way — a refused stamp
    (below) still consumed the plan it was asked to record, so leaving it on disk would
    only have a later, unrelated push wrongly match or fail to rule it out
    (guard-own-sync-push.js; retire_session_push's own doc). `delete_uuid` names a mirror
    the session must delete itself (the report was removed while the push was in
    flight); this process has no Carta connection to do it.

    Answers `{"recorded": False, "delete_uuid": None, "error": "conflict"}`, deleting
    nothing, when `pushed_uuid` already names a different, real local report (report_store.
    ReportStore.record_own_sync's own doc) — the uuid the caller passed is wrong, not a
    report-removed-meanwhile race, and that uuid is still the other report's live mirror.
    """
    plan_file, arguments_file = manco_paths.own_sync_plan_files(data_dir, report_id)
    plan = json.loads(plan_file.read_text())
    orphaned: List[str] = []
    try:
        result = _record_push(report_store.ReportStore(data_dir), data_dir, report_id, plan, pushed_uuid,
                              orphaned.append)
    except report_store.ReportEditError as e:
        return {"recorded": False, "delete_uuid": None, "error": e.code}
    finally:
        plan_file.unlink(missing_ok=True)
        arguments_file.unlink(missing_ok=True)
    return {"recorded": result is not None, "delete_uuid": orphaned[0] if orphaned else None}


def retire_session_push(data_dir: Path, report_id: str) -> Dict[str, Any]:
    """A Claude session's own not_found, exactly as push_if_changed's (see its doc for why
    `not_found` must never fall back to a create): retires `report_id`'s own-sync link
    (report_store.ReportStore.retire_own_sync is the one place that happens, sweep or session
    alike) and drops its plan, making no Carta call of its own — the mirror is already gone,
    so there's nothing left for this process to delete upstream either.

    Drops the plan files even when `retire_own_sync` finds no local report to retire (removed
    locally while the push was in flight): guard-own-sync-push.js compares a later, unrelated
    create/mutate call against every `.plan.json` still on disk, so a stale one left behind
    here could still wrongly match (or wrongly fail to rule out) a call for a different
    report."""
    report_store.ReportStore(data_dir).retire_own_sync(report_id)
    plan_file, arguments_file = manco_paths.own_sync_plan_files(data_dir, report_id)
    plan_file.unlink(missing_ok=True)
    arguments_file.unlink(missing_ok=True)
    return {"retired": True}


def _read_mirrors(path: str) -> Optional[List[Dict[str, Any]]]:
    """`--mirrors FILE`'s `reports` array, or `None` when the file is missing or the listing
    isn't trustworthy (`share_ops.trusted_reports`) — a malformed or flaky listing is treated
    as "nothing to reconcile against", never as "every report was deleted".

    The file holds a `call_tool` result for `fa__get__budget_reports` exactly as the
    sub-agent's tool call returned it — double-wrapped as `{"result": "<json>"}`, the shape
    every `call_tool` answer arrives in — so it goes through the same `share_bridge.unwrap`
    a live `Bridge.call` applies to its own capture, before the same trust guard
    `share_ops.list_reports` uses."""
    try:
        text = Path(path).read_text()
    except OSError:
        return None
    return share_ops.trusted_reports(share_bridge.unwrap(text))


def main(argv: Optional[list] = None) -> int:
    """With no flags: entry point for the detached sweep build_manco_datadir.py spawns when
    it runs without `--no-sync-sweep` — push every report whose payload differs from its
    last push, or that has never been pushed, without making the build itself wait on it.

    Exits 0 having pushed nothing when there's no operator id to sync as yet (the
    plugin-level ${CLAUDE_PLUGIN_ROOT}/references/launch-user-id.md hasn't run
    for this dashboard), or no working `claude` CLI to reach Carta through —
    both are "try again next build", not failures. Why goes to the log, and to the
    status file under own_sync._record_blocked's rule.

    `--plan` (with `--mirrors` or `--recreate`), `--record`, `--retire` and `--lookup` are the
    skill's own session-push side of this, documented on `_plan`, `record_session_push`,
    this function's own `--retire`/`--lookup` branches, and references/serve-and-update.md's
    Step 5.2, below.
    """
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", required=True)
    parser.add_argument("--plan", action="store_true",
                        help="write the pushes this session should make itself, once this "
                             "dashboard's own-sync lock is free (held by a sweep — only for a "
                             "build made without --no-sync-sweep — or another --plan, whichever "
                             "got there first); prints them as JSON. Always plans a push for "
                             "every report with one due")
    parser.add_argument("--recreate", metavar="REPORT_ID",
                        help="with --plan: plan a fresh create for this report, after Carta answered "
                             "its update with not_owner — the link is no longer this user's to "
                             "update. Not for not_found: use --retire instead, there is no mirror "
                             "left to recreate")
    parser.add_argument("--retire", metavar="REPORT_ID",
                        help="stamp this report's own-sync as retired, after Carta answered its "
                             "update with not_found — the hosted app's own Delete, most likely, "
                             "deliberate, not a glitch. Drops this report's plan without making "
                             "any Carta call; a later --plan never pushes this report again, "
                             "sweep or session alike, until an explicit --recreate starts it "
                             "over. Prints {\"retired\": true}")
    parser.add_argument("--mirrors", metavar="FILE",
                        help="with --plan: a fa:get:budget_reports call_tool result for this entity, "
                             "fetched by the caller over its own Carta connector and written here "
                             "exactly as the tool call returned it — settles a rename made on the "
                             "hosted app onto the local report before anything is planned, so the "
                             "plan never resends a stale name over it. Read once and deleted; a "
                             "second --plan with the same path finds nothing there and reconciles "
                             "nothing, rather than replaying a listing that may now be stale")
    parser.add_argument("--record", metavar="REPORT_ID",
                        help="stamp a push a Claude session made from this report's plan")
    parser.add_argument("--uuid", help="with --record: the report uuid Carta answered with")
    parser.add_argument("--lookup", metavar="REPORT_ID",
                        help="print {\"uuid\": <this report's own-sync uuid as last recorded "
                             "locally, or null>} — null for an unknown report id, one whose "
                             "own-sync was retired (its mirror was deleted on the hosted app), "
                             "or while a plan for this report is still on disk (a push this run "
                             "that hasn't been recorded yet, succeeded or not), never a uuid a "
                             "failed push or a retired link left stale. A plain local read, no "
                             "Carta call, no lock, always exits 0; for Step 5.3 once Step 5.2's "
                             "push has already returned")
    args = parser.parse_args(argv)
    data_dir = Path(args.data_dir).expanduser()

    if args.record:
        if not args.uuid:
            parser.error("--record needs --uuid")
        print(json.dumps(record_session_push(data_dir, args.record, args.uuid)))
        return 0

    if args.retire:
        print(json.dumps(retire_session_push(data_dir, args.retire)))
        return 0

    if args.lookup:
        print(json.dumps({"uuid": _lookup_uuid(data_dir, args.lookup)}))
        return 0

    user_id = manco_paths.read_user_id(data_dir)
    if args.plan:
        if user_id is None:
            print(json.dumps({"error": BLOCKED_NO_USER_ID}))
            return 3
        mirrors = None
        if args.mirrors:
            try:
                mirrors = _read_mirrors(args.mirrors)
            finally:
                # Read once: a listing this old by the next --plan could be stale, and
                # reconciling against it could undo a rename that happened since.
                Path(args.mirrors).unlink(missing_ok=True)
        return _plan(data_dir, user_id, args.recreate, mirrors=mirrors)

    _locked(data_dir, lambda: _sweep_under_lock(data_dir, user_id))
    return 0


def _locked(data_dir: Path, fn: Callable[[], Any]) -> Any:
    """Run `fn` holding the cross-process sweep lock, with a heartbeat thread refreshing it
    for as long as `fn` runs, so a long sweep's lock never looks abandoned while it still
    runs. Returns whatever `fn` returns."""
    lock_path = manco_paths.own_sync_lock_file(data_dir)
    with _sweep_lock(data_dir):
        # The heartbeat runs for exactly as long as this process holds the lock.
        stop_heartbeat = threading.Event()
        heartbeat = threading.Thread(target=_heartbeat, args=(lock_path, _SWEEP_LOCK_HEARTBEAT_INTERVAL, stop_heartbeat),
                                     daemon=True)
        heartbeat.start()
        try:
            return fn()
        finally:
            # Stop (and wait for) the heartbeat before the lock is released: it must never
            # refresh a lock this process no longer holds.
            stop_heartbeat.set()
            heartbeat.join()


def _plan(data_dir: Path, user_id: int, recreate: Optional[str],
         mirrors: Optional[List[Dict[str, Any]]] = None) -> int:
    """--plan: print the pushes this session should make, under the own-sync lock so it
    never runs alongside a sweep (a build made without build_manco_datadir.py's
    --no-sync-sweep) or another --plan mutating reports.json at the same time. Plans a push
    for every report with one due, unconditionally — build_manco_datadir.py's
    --no-sync-sweep means no detached sweep ever runs for a dashboard built this way, so
    there is no `claude`-CLI attempt to wait on or defer to.

    `mirrors`, when given, settles every own-synced report's name against it
    (reconcile_names_from_listing) before anything is planned — a plan built from a stale
    local name would silently resend it and overwrite a rename made on the hosted app since
    the last push.

    After any plan with `recreate=None`, the only plans on disk are the ones just printed: a
    plan left behind keeps the push guard checking calls against it."""
    with _sweep_lock(data_dir):
        if mirrors is not None:
            reconcile_names_from_listing(report_store.ReportStore(data_dir), mirrors)
        if recreate is None:
            shutil.rmtree(manco_paths.own_sync_plan_dir(data_dir), ignore_errors=True)
        pushes = write_plans(data_dir, user_id, recreate)
    print(json.dumps({"pushes": pushes}))
    return 0


def _cli_bridge(data_dir: Path, claude_bin: str) -> share_bridge.Bridge:
    """How the sweep reaches Carta through the `claude` CLI: the same environment, the same
    `.share-mcp-server` pin and the same probed binary Share's own bridge uses, so the two
    never talk to different connectors."""
    return share_bridge.Bridge(str(data_dir), manco_paths.read_carta_environment(data_dir),
                               override=manco_paths.read_share_mcp_server(data_dir),
                               claude_bin=claude_bin)


def _sweep_under_lock(data_dir: Path, user_id: Optional[int]) -> None:
    """The sweep proper, with the sweep lock held from before the CLI probe on, so it never
    runs alongside a --plan writing reports.json at the same time."""
    if user_id is None:
        _record_blocked(data_dir, BLOCKED_NO_USER_ID,
                        "no %s yet, so there's no Carta user to sync as"
                        % manco_paths.user_id_file(data_dir).name)
        return
    probed = preflight_claude.probe()
    if probed["reason"] != preflight_claude.REASON_OK:
        _record_blocked(data_dir, probed["reason"], "the claude CLI is %s" % probed["reason"].replace("_", " "),
                        user_id)
        return

    bridge = _cli_bridge(data_dir, probed["bin"])
    try:
        sweep(data_dir, user_id, bridge)
    finally:
        bridge.close()


def _recorded_uuid(store: report_store.ReportStore, report_id: str) -> Optional[str]:
    """The own-sync uuid `report_id` has on record locally right now, or `None` if it has
    never been pushed, or its own-sync was retired — report_store.ReportStore.retire_own_sync's
    own doc names every caller and reader of `retired`, and why the dead uuid stays on the
    report regardless. The one lookup `_lookup_uuid` (below) builds on, so a change to it (or
    to what counts as "recorded") only needs making once."""
    doc = store.load()
    report = report_store.ReportStore.find(doc, report_id)
    if (report.get("own_sync") or {}).get("retired"):
        return None
    return report_store.ReportStore.own_sync_uuid(report)


def _lookup_uuid(data_dir: Path, report_id: str) -> Optional[str]:
    """What `--lookup` prints: `report_id`'s own-sync uuid as last recorded locally, or
    `None` when there is nothing safe to offer — the report doesn't exist
    (`report_store.ReportEditError`), its own-sync was retired (`_recorded_uuid`'s own doc:
    the hosted app's own Delete, most likely), or a plan for it is still on disk
    (`manco_paths.own_sync_plan_files`). A plan on disk means this run's `--plan` found a
    push due for this report and `--record` hasn't cleared it yet: the push may
    still be in flight, or it may have failed and was never recorded. Either way, the uuid
    `_recorded_uuid` would answer is from an *earlier* push, not this run's — offering it
    would claim the report is on the hosted app the moment this run's own attempt may have
    just failed to put it there."""
    plan_file, _ = manco_paths.own_sync_plan_files(data_dir, report_id)
    if plan_file.exists():
        return None
    try:
        return _recorded_uuid(report_store.ReportStore(data_dir), report_id)
    except report_store.ReportEditError:
        return None


if __name__ == "__main__":
    sys.exit(main())
