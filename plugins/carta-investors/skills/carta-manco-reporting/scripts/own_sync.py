"""Mirror a user's own imported Budget vs Actuals reports to Carta, privately.

A copy the hosted microapp can read without a manual export/upload. Reuses the
same fa:*:budget_report family share_ops already calls for deliberate sharing,
with `shared_with` always pinned to the caller's own user id — this never makes
a report visible to anyone else, and never touches `report["shared"]` (the
deliberate-sharing link the Share dialog reads).

A report is pushed only when its payload has moved since the last successful
push, mirroring report_store.mark_if_payload_moved's dirty check for shared
reports. report_store.ReportStore.dismissed_uuids folds in every report's own
sync uuid, so a mirror this dashboard pushed is never imported back by
share_ops.pull as if someone else had shared it — only for *this* local
reports.json, though: a mirror pushed from a different checkout of the same
dashboard (a second machine, a reinstalled skill) has no local record and
would still come back as a pulled copy there.

Removing a synced report locally must go through `forget`, not
report_store.ReportStore.remove directly: `remove` alone only stops a local
pull from re-importing the mirror, it never deletes it from Carta, so the
hosted microapp would keep showing a report the user deleted locally.

push_if_changed and forget each read before making a slow Carta call and only
write afterward, so the two can race each other across threads (serve.py
handles requests on threads). Every uuid either of them creates or already
holds ends up either recorded on a live local report or deleted in Carta —
never left live with nothing local claiming it — even when they overlap:
push_if_changed deletes its own new uuid upstream if the report vanishes
under it, and forget deletes whatever uuid remove() actually dismissed, which
can differ from the uuid forget already deleted if a push stamped a new one
in between.

A pushed payload's optional `variance_by_category` (the Top Categories of
Variance chart's data, trimmed to this one report) needs fund-admin's
budget_report payload validator to accept that key. A Carta that doesn't
(predating carta/fund-admin#97557) refuses a push that carries it.

Python-stdlib only, 3.9-safe.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable, Dict, Optional

import export_budget_bundle
import report_payload
import report_store
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
    """Push `report_id`'s current payload to Carta as a report visible to nobody but
    `user_id`, when it has moved since the last successful push for this report.

    Returns the report's metadata (report_store.ReportStore.metadata shape,
    including the new `own_sync` field) after a push, or None when nothing
    needed sending: the report is read-only (shared with you, not yours to
    mirror), hasn't been built yet, or its payload is unchanged.

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
    sync = report.get("own_sync") or {}
    if sync.get("payload_fingerprint") == fingerprint:
        return None

    ctx = share_ops.context(data_dir)
    uuid = sync.get("uuid")
    if uuid:
        emit("Syncing your report to the hosted app…")
        args = {"fund_uuid": ctx["fund_uuid"], "report_uuid": uuid, "shared_with": [user_id]}
        args.update(share_ops.report_args(ctx, report["name"], payload, check_basis=True))
        try:
            response = share_ops.envelope(bridge.call("fa__mutate__budget_report", args, emit))
        except ShareError as e:
            if e.code not in ("not_found", "not_owner"):
                raise
            uuid = None  # the link is gone or no longer ours to update; create a fresh one
    if not uuid:
        emit("Saving your report for the hosted app…")
        args = {"fund_uuid": ctx["fund_uuid"], "shared_with": [user_id]}
        args.update(share_ops.report_args(ctx, report["name"], payload, check_basis=True, source=share_ops.source()))
        response = share_ops.envelope(bridge.call("fa__create__budget_report", args, emit))
    pushed_uuid = response["report"].get("uuid")
    result = store.record_own_sync(report_id, pushed_uuid, payload)
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
    ctx = share_ops.context(data_dir)
    if uuid:
        share_ops.delete_upstream(bridge, ctx, uuid, emit)
    dismissed = store.remove(report_id)
    if dismissed and dismissed != uuid:
        share_ops.delete_upstream(bridge, ctx, dismissed, emit)
