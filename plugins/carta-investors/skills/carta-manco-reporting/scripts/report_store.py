"""Budget vs Actuals reports kept in the dashboard dir as reports.json.

A report is a budget the operator can rename, duplicate, hide and share. Each
imported workbook budget seeds one, which *tracks* its workbook file: it is
re-read on every build, so a re-parse or a newly answered mapping question still
reaches it. A duplicate holds its own copy of the budget and stands alone. A
report someone else shared is stored the same way, read-only.

The build reads reports instead of the workbook files (see build_inputs), so
everything downstream — mapping, projections, income and expense totals — runs
unchanged on every report.

Python-stdlib only, 3.9-safe.
"""
from __future__ import annotations

import copy
import hashlib
import json
import os
import re
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Iterator, List, Optional, Set, Tuple

import manco_paths
from report_payload import MAX_NAME_LENGTH, PayloadError, check_name

REPORTS_FILE = "reports.json"
INPUTS_DIR = ".reports"
_INPUT_NAME = "budget-%s.json"
STORE_VERSION = 1

TRACKING = "tracking"
EDITED = "edited"  # holds its own copy of the budget, apart from any workbook
SHARED_IN = "shared-in"

_LOCK_TIMEOUT = 10.0
_LOCK_STALE_AFTER = 30.0


class ReportEditError(ValueError):
    """A change the report can't take. `code` is the typed state the app shows."""

    def __init__(self, message: str, code: str = "invalid") -> None:
        super().__init__(message)
        self.code = code


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _is_workbook(report: dict) -> bool:
    return (report.get("origin") or {}).get("kind") == "workbook"


def payload_fingerprint(payload: Dict[str, Any]) -> str:
    """A hash of a share payload, independent of key order."""
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(text).lower()).strip("-") or "report"


def _dismiss(doc: Dict[str, Any], *uuids: Optional[str]) -> None:
    """Add each non-empty, not-already-present uuid to the list pulls skip."""
    dismissed = doc.setdefault("dismissed_uuids", [])
    for uuid in uuids:
        if uuid and uuid not in dismissed:
            dismissed.append(uuid)


_COPY_SUFFIX = " (copy)"


def _copy_name(source_name: str) -> str:
    """The source's name is already 1-255 chars; truncate it to leave room for
    the suffix rather than hand the server a name over the limit."""
    base = str(source_name or "")[: MAX_NAME_LENGTH - len(_COPY_SUFFIX)]
    return base + _COPY_SUFFIX


class _FileLock:
    """A lock file shared by processes that may run separately — the build and
    the app server here, own_sync.py's detached sweep too (own_sync.py passes
    its own, longer `stale_after`). O_EXCL creation is atomic on every
    platform; a lock whose mtime hasn't moved in over `stale_after` (default
    `_LOCK_STALE_AFTER`) is treated as left behind by a crashed holder — a
    caller that refreshes its own lock's mtime while it still holds it (a
    heartbeat) can run past that long without being reclaimed.

    `observe_stale=True` switches the staleness check from wall-clock
    (`time.time()`, compared against the file's mtime) to one the waiter
    times entirely on its own `time.monotonic()`: it watches the mtime it
    observes and only reclaims the lock once that same mtime has sat
    unchanged for `stale_after` of the waiter's *own* elapsed time. A laptop
    suspend advances wall-clock time but not monotonic time for both the
    holder and the waiter alike, so a holder whose heartbeat would have
    refreshed the lock before and after the suspend can't be seen as stale
    just because the wall clock jumped across it — the pre-suspend mtime a
    wall-clock check compares against is already stale the instant the
    machine wakes, even though the process holding the lock never stopped
    making progress. Leave this off for `ReportStore`'s own short-lived
    writer lock: `_LOCK_TIMEOUT` is shorter than `_LOCK_STALE_AFTER`, so a
    waiter observing staleness would always hit "busy" before it could ever
    see an mtime hold still for the full `stale_after`."""

    def __init__(self, path: Path, timeout: float = _LOCK_TIMEOUT, stale_after: float = _LOCK_STALE_AFTER,
                 observe_stale: bool = False) -> None:
        self._path = path
        self._timeout = timeout
        self._stale_after = stale_after
        self._observe_stale = observe_stale

    def __enter__(self) -> "_FileLock":
        deadline = time.time() + self._timeout
        seen_mtime, seen_at = None, None
        while True:
            try:
                fd = os.open(str(self._path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.close(fd)
                return self
            except FileExistsError:
                try:
                    mtime = self._path.stat().st_mtime
                except FileNotFoundError:
                    continue
                if self._observe_stale:
                    now = time.monotonic()
                    if mtime != seen_mtime:
                        seen_mtime, seen_at = mtime, now
                    elif now - seen_at > self._stale_after:
                        self._path.unlink(missing_ok=True)
                        seen_mtime, seen_at = None, None
                        continue
                elif time.time() - mtime > self._stale_after:
                    self._path.unlink(missing_ok=True)
                    continue
                if time.time() > deadline:
                    raise ReportEditError("reports are busy; try again", "busy")
                time.sleep(0.05)

    def __exit__(self, *exc: Any) -> None:
        try:
            self._path.unlink()
        except FileNotFoundError:
            pass


class ReportStore:
    """reports.json in one dashboard dir. Every write takes the cross-process lock."""

    def __init__(self, dashboard_dir: Any) -> None:
        self.dir = Path(dashboard_dir)
        self.path = self.dir / REPORTS_FILE
        self.inputs_dir = self.dir / INPUTS_DIR
        self._lock_path = self.dir / (REPORTS_FILE + ".lock")

    def _read_bytes(self) -> bytes:
        try:
            return self.path.read_bytes()
        except FileNotFoundError:
            return b""

    def load(self) -> Dict[str, Any]:
        raw = self._read_bytes()
        if not raw:
            return {"version": STORE_VERSION, "reports": []}
        doc = json.loads(raw.decode("utf-8"))
        doc.setdefault("reports", [])
        return doc

    def etag(self) -> str:
        return '"%s"' % hashlib.sha256(self._read_bytes()).hexdigest()[:16]

    def _save(self, doc: Dict[str, Any]) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(doc, indent=2))
        os.replace(str(tmp), str(self.path))

    @contextmanager
    def transaction(self, expected_etag: Optional[str] = None) -> Iterator[Dict[str, Any]]:
        """Load, let the caller change the doc, save. `expected_etag` refuses a change
        made against a stale read, the way the app's other writable documents do."""
        self.dir.mkdir(parents=True, exist_ok=True)
        with _FileLock(self._lock_path):
            if expected_etag is not None and expected_etag != self.etag():
                raise ReportEditError("the reports changed since you loaded them", "conflict")
            doc = self.load()
            before = json.dumps(doc, sort_keys=True)
            yield doc
            if json.dumps(doc, sort_keys=True) != before:
                self._save(doc)

    @staticmethod
    def find(doc: Dict[str, Any], report_id: str) -> dict:
        for report in doc["reports"]:
            if report["id"] == report_id:
                return report
        raise ReportEditError("that report no longer exists", "not_found")

    @staticmethod
    def dismissed_uuids(doc: Dict[str, Any]) -> Set[str]:
        """Uuids pulls leave out: reports shared with you that you removed here, and
        every report's own-sync mirror (own_sync.push_if_changed must never come back
        as if someone else had shared it with you)."""
        mirrored = {ReportStore.own_sync_uuid(r) for r in doc["reports"]}
        return (set(doc.get("dismissed_uuids") or []) | mirrored) - {None}

    @staticmethod
    def shared_uuid(report: Dict[str, Any]) -> Optional[str]:
        """The Carta uuid a report is shared under, or None if it isn't shared."""
        return (report.get("shared") or {}).get("uuid")

    @staticmethod
    def own_sync_uuid(report: Dict[str, Any]) -> Optional[str]:
        """The Carta uuid a report's private own-sync mirror is pushed under, or None."""
        return (report.get("own_sync") or {}).get("uuid")

    @staticmethod
    def _unique_id(doc: Dict[str, Any], base: str) -> str:
        taken = {r["id"] for r in doc["reports"]}
        candidate, n = base, 2
        while candidate in taken:
            candidate, n = "%s-%d" % (base, n), n + 1
        return candidate

    def _source_budget(self, report: dict) -> Dict[str, Any]:
        """The parsed budget a report shows: its own copy, or its workbook file while tracking."""
        if report.get("state") == TRACKING:
            source = self.dir / report["origin"]["file"]
            return json.loads(source.read_text())
        return copy.deepcopy(report["budget"])

    def sync(self, doc: Dict[str, Any], source_files: List[Path]) -> None:
        """Seed a report for each workbook budget that has none; drop a tracking report
        whose workbook file is gone (a report holding its own copy stands alone and stays)."""
        names = [f.name for f in source_files]
        by_origin = {
            r["origin"]["file"]: r for r in doc["reports"]
            if _is_workbook(r)
        }
        for f in source_files:
            if f.name in by_origin:
                continue
            try:
                data = json.loads(f.read_text())
            except (OSError, ValueError):
                continue
            base = data.get("id") or manco_paths.default_budget_id(f)
            report = {
                "id": self._unique_id(doc, base),
                "name": data.get("label") or (data.get("workbook_meta") or {}).get("sheet") or "Budget",
                "origin": {"kind": "workbook", "file": f.name},
                "state": TRACKING,
                "budget": None,
                "shared": None,
                "hidden": False,
                "updated_at": _now(),
            }
            doc["reports"].append(report)
            by_origin[f.name] = report
        doc["reports"] = [
            r for r in doc["reports"]
            if not (r.get("state") == TRACKING and r["origin"]["file"] not in names)
        ]

    def _ordered(self, doc: Dict[str, Any], source_files: List[Path]) -> List[dict]:
        """Workbook reports in workbook order (the first drives the dashboard's
        top-line figures), then copies and shared reports as stored."""
        rank = {f.name: i for i, f in enumerate(source_files)}
        workbook = sorted(
            (r for r in doc["reports"] if _is_workbook(r)),
            key=lambda r: rank.get(r["origin"]["file"], len(rank)),
        )
        others = [r for r in doc["reports"] if not _is_workbook(r)]
        return workbook + others

    def build_inputs(self, source_files: List[Path]) -> List[Tuple[Path, Dict[str, Any]]]:
        """Sync reports with the workbook files, then write each visible report as a
        budget-*.json the build reads. Returns (path, report metadata) in build order."""
        # The inputs are rewritten under the lock too: duplicate reads them (via
        # last_inputs) to tell which mapping answers are ambiguous.
        with self.transaction() as doc:
            self.sync(doc, source_files)
            ordered = self._ordered(doc, source_files)
            self.inputs_dir.mkdir(parents=True, exist_ok=True)
            for stale in self.inputs_dir.glob(_INPUT_NAME % "*"):
                stale.unlink()
            out = []
            for report in ordered:
                if report.get("hidden"):
                    continue
                try:
                    data = self._source_budget(report)
                except (OSError, ValueError, KeyError, TypeError):
                    continue
                data["id"] = report["id"]
                data["label"] = report["name"]
                meta = self.metadata(report)
                data["read_only"] = meta["read_only"]
                path = self.inputs_dir / (_INPUT_NAME % report["id"])
                path.write_text(json.dumps(data))
                out.append((path, meta))
        return out

    def last_inputs(self) -> List[Dict[str, Any]]:
        """The budgets the last build_inputs wrote; none before a first build.
        Takes no lock: duplicate calls it while already holding it."""
        out = []
        for path in sorted(self.inputs_dir.glob(_INPUT_NAME % "*")):
            try:
                data = json.loads(path.read_text())
            except (OSError, ValueError):
                continue
            if isinstance(data, dict):
                out.append(data)
        return out

    @staticmethod
    def metadata(report: dict) -> Dict[str, Any]:
        """What the app needs to know about a report beyond its rows."""
        shared = report.get("shared") or None
        read_only = report.get("state") == SHARED_IN and not (shared or {}).get("is_owner")
        return {
            "id": report["id"],
            "name": report["name"],
            "state": report.get("state"),
            "origin": (report.get("origin") or {}).get("kind"),
            "read_only": read_only,
            "editable": not read_only,
            "shared": shared,
            "own_sync": report.get("own_sync") or None,
            "updated_at": report.get("updated_at"),
        }

    def _own(self, doc: Dict[str, Any], report_id: str) -> dict:
        report = self.find(doc, report_id)
        if self.metadata(report)["read_only"]:
            raise ReportEditError("this report was shared with you and can't be changed; duplicate it to make your own copy", "read_only")
        return report

    def rename(self, report_id: str, name: str, *, expected_etag: Optional[str] = None) -> Dict[str, Any]:
        name = str(name or "").strip()
        try:
            check_name(name)
        except PayloadError as e:
            raise ReportEditError(str(e))
        with self.transaction(expected_etag) as doc:
            report = self._own(doc, report_id)
            report["name"] = name
            report["updated_at"] = _now()
            if report.get("shared"):
                report["shared"]["dirty"] = True
            return self.metadata(report)

    def duplicate(
        self,
        report_id: str,
        *,
        copy_mapping: Callable[[List[dict], str, str], Any],
        expected_etag: Optional[str] = None,
    ) -> Dict[str, Any]:
        """A private, editable copy. It keeps the source's mapping answers, which are
        re-recorded under the copy's own id (see build_manco_datadir.copy_budget_mapping)."""
        with self.transaction(expected_etag) as doc:
            source = self.find(doc, report_id)
            data = self._source_budget(source)
            new_id = self._unique_id(doc, _slug(source["name"]) + "-copy")
            if not self.metadata(source)["read_only"]:
                copy_mapping(data.get("rows") or [], source["id"], new_id)
            for row in data.get("rows") or []:
                row.pop("addr", None)
                row.pop("bare_addr", None)
            report = {
                "id": new_id,
                "name": _copy_name(source["name"]),
                "origin": {"kind": "copy", "from": source["id"]},
                "state": EDITED,
                "budget": data,
                "shared": None,
                "hidden": False,
                "updated_at": _now(),
            }
            doc["reports"].append(report)
            return self.metadata(report)

    def set_hidden(self, report_id: str, hidden: bool, *, expected_etag: Optional[str] = None) -> Dict[str, Any]:
        with self.transaction(expected_etag) as doc:
            report = self.find(doc, report_id)
            report["hidden"] = bool(hidden)
            return self.metadata(report)

    @staticmethod
    def _removable(doc: Dict[str, Any], report_id: str) -> dict:
        """The shape remove() enforces, given an already-loaded doc: the report exists
        and isn't a workbook report. Shared by remove() (inside its own transaction,
        reusing the doc it already holds) and check_removable() (a read-only pre-check
        for a caller — own_sync.forget — that must refuse before making any outside
        call, not just before writing)."""
        report = ReportStore.find(doc, report_id)
        if _is_workbook(report):
            raise ReportEditError("a workbook report can be hidden, not deleted", "invalid")
        return report

    def check_removable(self, report_id: str, *, expected_etag: Optional[str] = None) -> dict:
        """Raise the same ReportEditError remove() would, with nothing changed yet: a
        stale expected_etag, a missing report_id, or a workbook report. Returns the
        report dict. remove() enforces the same rule again, authoritatively, inside its
        own transaction — this lets a caller that must not touch anything else (Carta
        included) until the removal would actually succeed check first."""
        if expected_etag is not None and expected_etag != self.etag():
            raise ReportEditError("the reports changed since you loaded them", "conflict")
        return self._removable(self.load(), report_id)

    def remove(self, report_id: str, *, expected_etag: Optional[str] = None) -> Optional[str]:
        """Drop a local copy or a report shared with you. A report shared with you stays
        removed: later pulls skip it. A workbook report would only re-seed on the next
        build, so it is hidden instead.

        Returns the own-sync uuid this removal dismissed, or None. own_sync.forget
        compares this against the uuid it already deleted upstream before calling
        remove(): a push racing forget's own check_removable() call can stamp a
        *different* own-sync uuid on the report in between, and that uuid must be
        deleted too, or its mirror outlives every local trace of it."""
        with self.transaction(expected_etag) as doc:
            report = self._removable(doc, report_id)
            to_dismiss = []
            if report.get("state") == SHARED_IN:
                to_dismiss.append(self.shared_uuid(report))
            own_uuid = self.own_sync_uuid(report)
            # dismissed_uuids() only sees a *present* report's own_sync mirror; once
            # this report is gone, its mirror must stay excluded on its own. The mirror
            # itself still exists in Carta — own_sync.forget retires it there first.
            to_dismiss.append(own_uuid)
            _dismiss(doc, *to_dismiss)
            doc["reports"] = [r for r in doc["reports"] if r["id"] != report_id]
            return own_uuid

    def record_shared(self, report_id: str, shared: Dict[str, Any], payload: Dict[str, Any]) -> Dict[str, Any]:
        """Stamp the share link after a publish or an update, with a fingerprint of the
        payload that was sent; the report is clean again."""
        with self.transaction() as doc:
            report = self.find(doc, report_id)
            report["shared"] = dict(shared, dirty=False, payload_fingerprint=payload_fingerprint(payload))
            return self.metadata(report)

    def mark_if_payload_moved(self, report_id: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Mark your shared report changed when the payload it would be shared with now
        differs from the one last sent: a workbook re-import or a newly answered
        mapping question moves its figures without anyone touching the report.
        Returns the report's metadata, or None when it isn't one you shared."""
        with self.transaction() as doc:
            try:
                report = self.find(doc, report_id)
            except ReportEditError:
                return None
            shared = report.get("shared") or {}
            if not shared.get("is_owner"):
                return None
            sent = shared.get("payload_fingerprint")
            if sent and sent != payload_fingerprint(payload):
                shared["dirty"] = True
            return self.metadata(report)

    def record_own_sync(self, report_id: str, uuid: Optional[str], payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Stamp a report's private sync link to Carta after a push to own_sync.push_if_changed,
        with a fingerprint of the payload sent, so the next push can tell whether it moved
        again. Kept apart from `shared` — this link is never visible to anyone but the
        report's own owner, and the Share dialog must never read it.

        Returns the report's metadata, or None when `report_id` was removed while the
        push was in flight. Either way `uuid` must not end up live in Carta with
        nothing local claiming it: here it only goes into `dismissed_uuids`, so a pull
        never re-imports it even if the delete below fails; own_sync.push_if_changed is
        what actually deletes it upstream when this returns None."""
        with self.transaction() as doc:
            try:
                report = self.find(doc, report_id)
            except ReportEditError:
                _dismiss(doc, uuid)
                return None
            report["own_sync"] = {
                "uuid": uuid,
                "payload_fingerprint": payload_fingerprint(payload),
                "synced_at": _now(),
            }
            return self.metadata(report)

    def clear_shared(self, report_id: str, *, expected_etag: Optional[str] = None) -> Dict[str, Any]:
        """Forget the link to Carta: the report becomes private again. Only its
        owner's copy is unlinked; a report someone shared in stays theirs."""
        with self.transaction(expected_etag) as doc:
            report = self._own(doc, report_id)
            if report.get("state") == SHARED_IN:
                # Your own report, pulled into this dashboard: without its link it is a copy.
                report["state"] = EDITED
                report["origin"] = {"kind": "copy", "from": report["id"]}
            report["shared"] = None
            return self.metadata(report)

    def upsert_pulled(self, pulled: List[Dict[str, Any]], upstream_uuids: Optional[set]) -> Dict[str, int]:
        """Merge reports fetched from Carta. Each item: {uuid, name, budget, shared}.

        A report already linked locally is refreshed unless it has unshared changes;
        one no longer upstream is dropped if it only ever came from Carta.
        `upstream_uuids` is None when the listing wasn't trustworthy — then nothing
        is dropped.
        """
        counts = {"added": 0, "updated": 0, "removed": 0, "kept_local": 0}
        with self.transaction() as doc:
            by_uuid = {self.shared_uuid(r): r for r in doc["reports"] if self.shared_uuid(r)}
            dismissed = self.dismissed_uuids(doc)
            for item in pulled:
                existing = by_uuid.get(item["uuid"])
                if existing is not None:
                    if (existing.get("shared") or {}).get("dirty"):
                        counts["kept_local"] += 1
                        continue
                    if existing.get("state") != SHARED_IN:
                        # The owner's own local report: never overwrite it from Carta.
                        existing["shared"] = dict(existing["shared"], **{k: v for k, v in item["shared"].items() if k != "dirty"})
                        continue
                    existing["name"] = item["name"]
                    existing["budget"] = item["budget"]
                    existing["shared"] = dict(item["shared"], dirty=False)
                    existing["updated_at"] = _now()
                    counts["updated"] += 1
                    continue
                if item["uuid"] in dismissed:
                    continue
                report = {
                    "id": self._unique_id(doc, "shared-" + _slug(item["name"])),
                    "name": item["name"],
                    "origin": {"kind": "shared"},
                    "state": SHARED_IN,
                    "budget": item["budget"],
                    "shared": dict(item["shared"], dirty=False),
                    "hidden": False,
                    "updated_at": _now(),
                }
                doc["reports"].append(report)
                counts["added"] += 1
            if upstream_uuids is not None:
                keep = []
                for r in doc["reports"]:
                    uuid = self.shared_uuid(r)
                    if r.get("state") == SHARED_IN and uuid and uuid not in upstream_uuids:
                        counts["removed"] += 1
                        continue
                    keep.append(r)
                doc["reports"] = keep
        return counts

    def share_payload_path(self, report_id: str) -> Path:
        return self.inputs_dir / ("%s.share.json" % report_id)

    def write_share_payload(self, report_id: str, payload: Dict[str, Any]) -> None:
        self.inputs_dir.mkdir(parents=True, exist_ok=True)
        path = self.share_payload_path(report_id)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload))
        os.replace(str(tmp), str(path))

    def discard_share_payload(self, report_id: str) -> None:
        try:
            self.share_payload_path(report_id).unlink()
        except FileNotFoundError:
            pass

    def read_share_payload(self, report_id: str) -> Dict[str, Any]:
        try:
            return json.loads(self.share_payload_path(report_id).read_text())
        except (OSError, ValueError):
            raise ReportEditError("this report hasn't been built yet; refresh the page and try again", "not_ready")
