"""Share, update, pull and delete Budget vs Actuals reports through Carta.

Each operation takes a bridge (share_bridge.Bridge, or a stand-in with the same
`call(command, arguments, emit)`) and the dashboard's report store. The commands
behind the bridge are the Carta connector's fa:*:budget_report(s) family.

Python-stdlib only, 3.9-safe.
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

import report_payload
import report_store
from share_bridge import ShareError
from shapes import canonical

SOURCE_CLIENT = "carta-manco-reporting"
# Who can see the entity, kept beside the dashboard: the lookup takes seconds through
# Claude, and Carta still checks every recipient when a share is sent.
USERS_CACHE_FILE = ".shareable-users.json"
USERS_CACHE_MAX_AGE = 24 * 3600
PULL_BATCH = 25
Emit = Callable[[str], None]


def _plugin_version() -> Optional[str]:
    # The skill ships inside a plugin whose manifest names its version; a skill
    # installed on its own has none to report, which is fine — `source` is optional.
    manifest = Path(__file__).resolve().parents[3] / ".claude-plugin" / "plugin.json"
    try:
        return str(json.loads(manifest.read_text()).get("version") or "") or None
    except (OSError, ValueError):
        return None


def _source() -> Dict[str, str]:
    version = _plugin_version()
    return {"client": SOURCE_CLIENT, **({"client_version": version} if version else {})}


def _context(data_dir: Path) -> Dict[str, Any]:
    """Which ManCo entity the dashboard is for, and the data date it was built on."""
    try:
        accounts = json.loads((data_dir / "accounts.json").read_text())
        snapshot = json.loads((data_dir / "snapshot.json").read_text())
    except (OSError, ValueError):
        raise ShareError("This dashboard's data is missing; relaunch it from Claude.", "failed")
    fund_uuid = accounts.get("manco_uuid")
    if not fund_uuid:
        raise ShareError("This dashboard predates report sharing; relaunch it from Claude once.", "failed")
    return {
        "fund_uuid": fund_uuid,
        "as_of": snapshot.get("asOf"),
    }


def _shared_meta(report: Dict[str, Any]) -> Dict[str, Any]:
    """The local record of a report's share link, from Carta's metadata.
    Recipient names ride along only when Carta sent some, so a listing
    without them never wipes the ones recorded at share time."""
    meta = {
        "uuid": report.get("uuid"),
        "is_owner": bool(report.get("is_owner")),
        "created_by": report.get("created_by"),
        "created_by_name": report.get("created_by_name"),
        "updated_by": report.get("updated_by"),
        "updated_at": report.get("updated_at"),
        "created_at": report.get("created_at"),
        "shared_with_everyone": bool(report.get("shared_with_everyone")),
        "shared_with": report.get("shared_with"),
        "snapshot_basis": report.get("snapshot_basis") or {},
    }
    people = [p for p in report.get("shared_with_users") or [] if isinstance(p, dict) and p.get("email")]
    if people:
        meta["people"] = people
    return meta


def _envelope(response: Any) -> Dict[str, Any]:
    if isinstance(response, dict) and response.get("document_returned"):
        # fa:get:budget_report offloads an oversized report to a document URL
        # instead of inlining it (ADR-0019/0022) — nothing this skill downloads yet.
        raise ShareError("This report is too large to load here.", "too_large")
    if not isinstance(response, dict) or not isinstance(response.get("report"), dict):
        raise ShareError("Carta didn't return the shared report; try again.", "failed")
    return response


def shareable_users(bridge: Any, data_dir: Path, emit: Emit, refresh: bool = False,
                    now: Callable[[], float] = time.time) -> Dict[str, Any]:
    """Who the report can be shared with, as {users, fetched_at}: the saved list while it is
    under a day old for this entity, otherwise (or with `refresh`) Carta's answer, saved."""
    ctx = _context(data_dir)
    path = Path(data_dir) / USERS_CACHE_FILE
    if not refresh:
        try:
            saved = json.loads(path.read_text())
        except (OSError, ValueError):
            saved = None
        if (isinstance(saved, dict) and saved.get("fund_uuid") == ctx["fund_uuid"]
                and isinstance(saved.get("users"), list) and isinstance(saved.get("fetched_at"), (int, float))
                and 0 <= now() - saved["fetched_at"] < USERS_CACHE_MAX_AGE):
            return {"users": saved["users"], "fetched_at": saved["fetched_at"]}
    emit("Loading who can see this entity…")
    result = bridge.call("fa__get__budget_report_shareable_users", {"fund_uuid": ctx["fund_uuid"]}, emit)
    users = (result or {}).get("users") if isinstance(result, dict) else None
    if not isinstance(users, list):
        raise ShareError("Carta didn't return the list of people; try again.", "failed")
    fetched_at = now()
    tmp = path.with_suffix(".tmp")
    try:
        tmp.write_text(json.dumps({"fund_uuid": ctx["fund_uuid"], "fetched_at": fetched_at, "users": users}))
        os.replace(str(tmp), str(path))
    except OSError:
        pass  # the list still answers this request; the next one asks Carta again
    return {"users": users, "fetched_at": fetched_at}


def forget_shareable_users(data_dir: Path) -> None:
    """Drop the saved list, so the next lookup asks Carta."""
    try:
        (Path(data_dir) / USERS_CACHE_FILE).unlink()
    except OSError:
        pass


def share(
    bridge: Any,
    store: report_store.ReportStore,
    data_dir: Path,
    report_id: str,
    shared_with: Optional[List[int]],
    emit: Emit,
    force: bool = False,
    people: Optional[List[Dict[str, Any]]] = None,
    updating: bool = False,
) -> Dict[str, Any]:
    """Publish a report, or push its changes when it is already shared (see _share). When Carta
    refuses a recipient, the saved list of people is out of date, so it is dropped."""
    try:
        return _share(bridge, store, data_dir, report_id, shared_with, emit,
                      force=force, people=people, updating=updating)
    except ShareError as e:
        if e.code == "invalid_recipient":
            forget_shareable_users(data_dir)
        raise


def _share(
    bridge: Any,
    store: report_store.ReportStore,
    data_dir: Path,
    report_id: str,
    shared_with: Optional[List[int]],
    emit: Emit,
    force: bool = False,
    people: Optional[List[Dict[str, Any]]] = None,
    updating: bool = False,
) -> Dict[str, Any]:
    """Publish a report, or push its changes when it is already shared.

    `people` carries the names and emails of the recipients picked in the app.
    Carta answers with user ids only, so they are kept beside the link
    for the app to say who a report is shared with.

    `shared_with` names recipients by user id ([] = everyone who can see the
    entity's ledger); None on an update leaves the recipients alone. An update
    refuses to overwrite a newer version unless `force` — it returns
    {"status": "stale", ...} for the app to ask about instead.

    A new share with no list goes to everyone, so it is never created by accident: with no
    share record, an update (`updating`: the app showed this report as already shared, or
    `shared_with` is None) returns {"status": "deleted"} without calling Carta, for the app
    to ask about. Only publish_as_new, or a share made with an explicit list, creates one.
    """
    ctx = _context(data_dir)
    doc = store.load()
    report = report_store.ReportStore.find(doc, report_id)
    meta = report_store.ReportStore.metadata(report)
    if meta["read_only"]:
        raise ShareError("This report was shared with you; duplicate it to share your own version.", "not_owner")
    payload = store.read_share_payload(report_id)
    name = report["name"]
    basis = {"as_of": ctx["as_of"]} if ctx["as_of"] else {}
    source = _source()
    link = report.get("shared") or {}
    # The budget (and so the basis it was snapshotted at) travels only when it
    # changed: re-sending an unchanged one makes a change of recipients slow
    # for nothing. A create always sends both — there's nothing to compare to yet.
    is_update = bool(link.get("uuid") and link.get("is_owner"))
    if not is_update and (updating or shared_with is None):
        # Sharing was stopped (maybe from another tab) after the app drew this report as
        # shared; re-creating it from a stale view would reach everyone with ledger access.
        return {"status": "deleted"}
    sends_payload = (not is_update) or link.get("dirty") or shared_with is None
    try:
        report_payload.validate(payload)
        report_payload.check_name(name)
        if sends_payload:
            report_payload.check_snapshot_basis(basis)
        if not is_update:
            report_payload.check_source(source)
    except report_payload.PayloadError as e:
        raise ShareError(str(e), "invalid")

    if is_update:
        args: Dict[str, Any] = {
            "fund_uuid": ctx["fund_uuid"],
            "report_uuid": link["uuid"],
            "name": name,
        }
        if shared_with is not None:
            args["shared_with"] = shared_with
        if sends_payload:
            args.update(schema_version=report_payload.SCHEMA_VERSION,
                        payload_compact=report_payload.compact(payload), snapshot_basis=basis)
        if not force and link.get("updated_at"):
            args["expected_updated_at"] = link["updated_at"]
        emit("Updating the shared report…")
        try:
            response = _envelope(bridge.call("fa__mutate__budget_report", args, emit))
        except ShareError as e:
            if e.code == "conflict":
                return {"status": "stale"}
            if e.code == "not_found":
                return {"status": "deleted"}
            raise
    else:
        args = {
            "fund_uuid": ctx["fund_uuid"],
            "name": name,
            "schema_version": report_payload.SCHEMA_VERSION,
            "payload_compact": report_payload.compact(payload),
            "snapshot_basis": basis,
            "source": source,
        }
        if shared_with:
            args["shared_with"] = shared_with
        emit("Sharing your report…")
        response = _envelope(bridge.call("fa__create__budget_report", args, emit))
    shared = _shared_meta(response["report"])
    shared["people"] = _recipient_people(shared.get("shared_with"), shared.get("people"), people, link.get("people"))
    # Not sending the payload means it matches the one last sent (it would be marked
    # changed otherwise), so its fingerprint stands either way.
    store.record_shared(report_id, shared, payload)
    return {"status": "ok", "uuid": response["report"].get("uuid")}


def _recipient_people(ids: Any, from_carta: Any, picked: Any, known: Any) -> List[Dict[str, Any]]:
    """Name and email for each recipient id: Carta's own answer first, then the
    people just picked, then what was recorded before."""
    by_id: Dict[int, Dict[str, Any]] = {}
    for source in (known, picked, from_carta):
        for person in source if isinstance(source, list) else []:
            if isinstance(person, dict) and isinstance(person.get("user_id"), int):
                by_id[person["user_id"]] = {
                    "user_id": person["user_id"],
                    "name": str(person.get("name") or "")[:200],
                    "email": str(person.get("email") or "")[:200],
                }
    return [by_id[i] for i in (ids if isinstance(ids, list) else []) if i in by_id]


def publish_as_new(bridge: Any, store: report_store.ReportStore, data_dir: Path, report_id: str,
                   shared_with: Optional[List[int]], emit: Emit,
                   people: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """The owner deleted the shared copy meanwhile: share this report as a new one."""
    store.clear_shared(report_id)
    return share(bridge, store, data_dir, report_id, shared_with or [], emit, people=people)


def delete(bridge: Any, store: report_store.ReportStore, data_dir: Path, report_id: str,
           emit: Emit) -> Dict[str, Any]:
    """Stop sharing a report you shared: it goes for everyone; your local copy stays private."""
    ctx = _context(data_dir)
    report = report_store.ReportStore.find(store.load(), report_id)
    link = report.get("shared") or {}
    if not link.get("uuid"):
        raise ShareError("This report isn't shared.", "invalid")
    if not link.get("is_owner"):
        raise ShareError("Only the person who shared this report can delete it.", "not_owner")
    emit("Deleting the shared report…")
    try:
        bridge.call("fa__delete__budget_report", {"fund_uuid": ctx["fund_uuid"], "report_uuid": link["uuid"]}, emit)
    except ShareError as e:
        if e.code != "not_found":  # already gone upstream: the end state is the same
            raise
    store.clear_shared(report_id)
    return {"status": "ok"}


def pull(bridge: Any, store: report_store.ReportStore, data_dir: Path, emit: Emit) -> Dict[str, Any]:
    """Load the reports shared with you and refresh the ones you already have.

    Each payload is checked against the contract before it's stored; one that
    fails is skipped and counted, never rendered with wrong numbers.
    """
    ctx = _context(data_dir)
    emit("Loading shared reports…")
    listing = bridge.call("fa__get__budget_reports", {"fund_uuid": ctx["fund_uuid"]}, emit)
    # A flaky call can come back as {} — trusting that as "nothing is shared" would
    # drop every report already pulled, so only a real list prunes.
    trustworthy = isinstance(listing, dict) and isinstance(listing.get("reports"), list)
    reports = listing["reports"] if trustworthy else []
    doc = store.load()
    dismissed = store.dismissed_uuids(doc)
    local = {store.shared_uuid(r): r for r in doc["reports"] if store.shared_uuid(r)}
    wanted = []
    for meta in reports:
        uuid = meta.get("uuid")
        if uuid in dismissed:
            continue  # removed here on purpose: upsert_pulled would drop it anyway
        mine = local.get(uuid)
        if mine is not None and mine.get("state") != report_store.SHARED_IN:
            continue  # your own local report: Carta holds the copy you shared, not a newer one
        if mine is not None and (mine.get("shared") or {}).get("updated_at") == meta.get("updated_at"):
            continue  # unchanged since the last pull
        wanted.append(meta)
    pulled, skipped = [], 0
    for i, meta in enumerate(wanted, 1):
        emit("Fetching shared report %d of %d…" % (i, len(wanted)))
        try:
            full = bridge.call("fa__get__budget_report", {"fund_uuid": ctx["fund_uuid"], "report_uuid": meta["uuid"]}, emit)
            envelope = _envelope(full)
            report_payload.validate(envelope.get("payload"))
        except ShareError as e:
            if e.code == "unexpected_call":
                raise  # a call nobody asked for may have changed something: never a quiet skip
            skipped += 1
            continue
        except report_payload.PayloadError:
            skipped += 1
            continue
        info = envelope["report"]
        pulled.append({
            "uuid": info["uuid"],
            "name": info.get("name") or "Shared report",
            "budget": canonical.budget_from_canonical(envelope["payload"], report_id="pending", name=info.get("name") or "Shared report"),
            "shared": _shared_meta(info),
        })
    upstream = {m.get("uuid") for m in reports if m.get("uuid")} if trustworthy else None
    counts = store.upsert_pulled(pulled, upstream)
    counts["skipped"] = skipped
    return {"status": "ok", "counts": counts}
