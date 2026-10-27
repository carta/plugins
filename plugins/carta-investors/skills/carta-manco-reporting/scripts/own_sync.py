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
same dashboard (a second machine, a reinstalled skill) has no local record and
would still come back as a pulled copy there.

Removing a synced report locally must go through `forget`, not
report_store.ReportStore.remove directly: `remove` alone only stops a local
pull from re-importing the mirror, it never deletes it from Carta, so the
hosted microapp would keep showing a report the user deleted locally.

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
more. For as long as main() holds the lock, a background heartbeat thread
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
import sys
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, Optional

import export_budget_bundle
import manco_paths
import preflight_claude
import report_payload
import report_store
import share_bridge
import share_ops
from share_bridge import ShareError

Emit = Callable[[str], None]

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
    this report. A report renamed while its payload fingerprint is unchanged sends
    just the name — no payload, no snapshot_basis — so renaming here never resends
    a budget nothing changed.

    Returns the report's metadata (report_store.ReportStore.metadata shape,
    including the new `own_sync` field) after a push, or None when nothing
    needed sending: the report is read-only (shared with you, not yours to
    mirror), hasn't been built yet, or neither its payload nor its name moved.

    `report_id` can also be removed locally (by another thread's own_sync.forget,
    or a plain report_store.ReportStore.remove on a report nothing had synced yet)
    while the bridge call above is in flight. When that happens this still
    returns None, but the uuid Carta just created or updated is deleted upstream
    first — it is never left live with nothing local claiming it.
    """
    doc = store.load()
    report = report_store.ReportStore.find(doc, report_id)
    if report_store.ReportStore.metadata(report)["read_only"]:
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
    fingerprint = report_store.payload_fingerprint(payload)
    name = report["name"]
    sync = report.get("own_sync") or {}
    payload_changed = sync.get("payload_fingerprint") != fingerprint
    name_changed = sync.get("pushed_name") != name
    if not payload_changed and not name_changed:
        return None

    ctx = share_ops.context(data_dir)
    uuid = sync.get("uuid")
    if uuid:
        emit("Syncing your report to the hosted app…" if payload_changed else "Renaming your report in the hosted app…")
        args = {"fund_uuid": ctx["fund_uuid"], "report_uuid": uuid, "shared_with": [user_id]}
        args.update(share_ops.report_args(ctx, name, payload, check_basis=payload_changed))
        try:
            response = share_ops.envelope(bridge.call("fa__mutate__budget_report", args, emit))
        except ShareError as e:
            if e.code not in ("not_found", "not_owner"):
                raise
            uuid = None  # the link is gone or no longer ours to update; create a fresh one
    if not uuid:
        emit("Saving your report for the hosted app…")
        args = {"fund_uuid": ctx["fund_uuid"], "shared_with": [user_id]}
        args.update(share_ops.report_args(ctx, name, payload, check_basis=True, source=share_ops.source()))
        response = share_ops.envelope(bridge.call("fa__create__budget_report", args, emit))
    pushed_uuid = response["report"].get("uuid")
    result = store.record_own_sync(report_id, pushed_uuid, payload, name)
    if result is None and pushed_uuid:
        # report_id was removed locally while the bridge call above was in flight:
        # record_own_sync already dismissed pushed_uuid so a pull won't re-import it,
        # but the mirror itself is still live in Carta until deleted here.
        share_ops.delete_upstream(bridge, ctx, pushed_uuid, emit)
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


def reconcile_names(store: report_store.ReportStore, data_dir: Path, bridge: Any,
                     emit: Emit = lambda message: None) -> None:
    """Bring a rename made on the hosted app onto the local report, without waiting for
    the next push: settles every own-synced, editable report's name against its current
    name in Carta. Never touches a report shared with you (read-only) or a report's own
    `shared` link — only `own_sync`.

    Two guards protect this against two different races, each against the one it alone
    prevents:

    reports.json is snapshotted (store.load()) *before* the slow Carta listing call, not
    after, so the three-way comparison in _reconcile_one_name is always made against the
    same state the listing was fetched against. Without that, a push landing elsewhere
    while this listing is still in flight — recording a new pushed_name while the listing
    still carries the old mirror name — would read as "only the mirror changed" once
    compared against a fresh reports.json a load taken after the listing would see instead.

    store.apply_synced_name is also given the exact local name and pushed_name the snapshot
    held, and writes only if both are still what's on disk right when it runs. This is what
    stops a rename or a push that lands *after* the snapshot (between it and
    apply_synced_name's own write) from being overwritten — the snapshot's ordering alone
    says nothing about that later window.

    Best-effort and silent, like sweep() itself: a dashboard predating report sharing, a
    listing Carta refuses, or any other error here never stops the push side sweep() runs
    right after.
    """
    doc = store.load()
    try:
        ctx = share_ops.context(data_dir)
        reports = share_ops.list_reports(bridge, ctx, emit)
    except ShareError as e:
        print("[own_sync] name reconcile skipped: %r" % e, file=sys.stderr)
        return
    if reports is None:
        return
    by_uuid = {m.get("uuid"): m for m in reports if isinstance(m, dict) and m.get("uuid")}
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
    still leaves a record a maintainer can read."""
    store = report_store.ReportStore(data_dir)
    reconcile_names(store, data_dir, bridge)
    for report in store.load()["reports"]:
        try:
            push_if_changed(bridge, store, data_dir, report["id"], user_id, lambda message: None)
        except Exception as e:
            print("[own_sync] push %r skipped: %r" % (report["id"], e), file=sys.stderr)


# A sweep's lock counts as stale only once the *process* holding it has
# stopped running, never because one Carta call or the sweep as a whole is
# slow: a single bridge turn can legitimately run well past any one timeout
# (a relay turn, a retry, a reset to a fresh session), so nothing about how
# long a call or a sweep takes can bound how long the lock may need to stay
# held. main()'s heartbeat thread refreshes it every
# _SWEEP_LOCK_HEARTBEAT_INTERVAL for as long as the process is alive; only a
# crash stops that, and _SWEEP_LOCK_STALE_AFTER is a fixed multiple of the
# interval so a waiter reclaims a lock a crashed holder left behind.
_SWEEP_LOCK_HEARTBEAT_INTERVAL = 30.0
_SWEEP_LOCK_STALE_AFTER = 4 * _SWEEP_LOCK_HEARTBEAT_INTERVAL


def _heartbeat(lock_path: Path, interval: float, stop: threading.Event) -> None:
    """Keep `lock_path`'s mtime fresh on its own thread for as long as the
    calling process holds it, so main()'s lock never looks abandoned while
    the process holding it is still alive — independent of how long any
    single Carta call inside the sweep it's guarding takes."""
    while not stop.wait(interval):
        try:
            os.utime(lock_path, None)
        except OSError:
            pass


def main(argv: Optional[list] = None) -> int:
    """Entry point for the detached sweep build_manco_datadir.py spawns after
    every build: push every report whose payload differs from its last push,
    or that has never been pushed, without making the build itself wait on it.

    Exits 0 and does nothing when there's no operator id to sync as yet (the
    plugin-level ${CLAUDE_PLUGIN_ROOT}/references/launch-user-id.md hasn't run
    for this dashboard), or no working `claude` CLI to reach Carta through —
    both are "try again next build", not failures.
    """
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", required=True)
    args = parser.parse_args(argv)
    data_dir = Path(args.data_dir).expanduser()

    user_id = manco_paths.read_user_id(data_dir)
    if user_id is None:
        return 0
    probed = preflight_claude.probe()
    if probed["reason"] != preflight_claude.REASON_OK:
        return 0

    # An abandoned lock frees itself once it goes stale, so there's nothing a
    # finite wait would gain over the lock's own staleness check — wait as
    # long as it takes for the dashboard's previous sweep to either finish or
    # stop refreshing it.
    lock_path = manco_paths.own_sync_lock_file(data_dir)
    lock = report_store._FileLock(lock_path, timeout=float("inf"), stale_after=_SWEEP_LOCK_STALE_AFTER,
                                   observe_stale=True)
    with lock:
        stop_heartbeat = threading.Event()
        heartbeat = threading.Thread(target=_heartbeat, args=(lock_path, _SWEEP_LOCK_HEARTBEAT_INTERVAL, stop_heartbeat),
                                     daemon=True)
        heartbeat.start()
        bridge = share_bridge.Bridge(str(data_dir), manco_paths.read_carta_environment(data_dir),
                                     override=manco_paths.read_share_mcp_server(data_dir),
                                     claude_bin=probed["bin"])
        try:
            sweep(data_dir, user_id, bridge)
        finally:
            bridge.close()
            # Stop (and wait for) the heartbeat before releasing the lock:
            # it must never refresh a lock this process no longer holds.
            stop_heartbeat.set()
            heartbeat.join()
    return 0


if __name__ == "__main__":
    sys.exit(main())
