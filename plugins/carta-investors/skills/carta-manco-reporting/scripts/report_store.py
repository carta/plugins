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
from typing import Any, Callable, Dict, Iterator, List, Optional, Tuple

import manco_paths
from report_payload import MAX_NAME_LENGTH, PayloadError, check_name

REPORTS_FILE = "reports.json"
INPUTS_DIR = ".reports"
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


def _shared_uuid(report: dict) -> Optional[str]:
    return (report.get("shared") or {}).get("uuid")


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(text).lower()).strip("-") or "report"


_COPY_SUFFIX = " (copy)"


def _copy_name(source_name: str) -> str:
    """The source's name is already 1-255 chars; truncate it to leave room for
    the suffix rather than hand the server a name over the limit."""
    base = str(source_name or "")[: MAX_NAME_LENGTH - len(_COPY_SUFFIX)]
    return base + _COPY_SUFFIX


class _FileLock:
    """A lock file shared by the build and the app server, which run as separate
    processes. O_EXCL creation is atomic on every platform; a lock older than
    _LOCK_STALE_AFTER is treated as left behind by a crashed process."""

    def __init__(self, path: Path) -> None:
        self._path = path

    def __enter__(self) -> "_FileLock":
        deadline = time.time() + _LOCK_TIMEOUT
        while True:
            try:
                fd = os.open(str(self._path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                os.close(fd)
                return self
            except FileExistsError:
                try:
                    if time.time() - self._path.stat().st_mtime > _LOCK_STALE_AFTER:
                        self._path.unlink()
                        continue
                except FileNotFoundError:
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
        with self.transaction() as doc:
            self.sync(doc, source_files)
            ordered = self._ordered(doc, source_files)
        self.inputs_dir.mkdir(parents=True, exist_ok=True)
        for stale in self.inputs_dir.glob("budget-*.json"):
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
            path = self.inputs_dir / ("budget-%s.json" % report["id"])
            path.write_text(json.dumps(data))
            out.append((path, meta))
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

    def remove(self, report_id: str, *, expected_etag: Optional[str] = None) -> None:
        """Drop a local copy or a report shared with you. A report shared with you stays
        removed: later pulls skip it. A workbook report would only re-seed on the next
        build, so it is hidden instead."""
        with self.transaction(expected_etag) as doc:
            report = self.find(doc, report_id)
            if _is_workbook(report):
                raise ReportEditError("a workbook report can be hidden, not deleted", "invalid")
            uuid = _shared_uuid(report)
            if report.get("state") == SHARED_IN and uuid:
                dismissed = doc.setdefault("dismissed_uuids", [])
                if uuid not in dismissed:
                    dismissed.append(uuid)
            doc["reports"] = [r for r in doc["reports"] if r["id"] != report_id]

    def record_shared(self, report_id: str, shared: Dict[str, Any]) -> Dict[str, Any]:
        """Stamp the share link after a publish or an update; the report is clean again."""
        with self.transaction() as doc:
            report = self.find(doc, report_id)
            report["shared"] = dict(shared, dirty=False)
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
            by_uuid = {_shared_uuid(r): r for r in doc["reports"] if _shared_uuid(r)}
            dismissed = set(doc.get("dismissed_uuids") or [])
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
                    uuid = _shared_uuid(r)
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

    def read_share_payload(self, report_id: str) -> Dict[str, Any]:
        try:
            return json.loads(self.share_payload_path(report_id).read_text())
        except (OSError, ValueError):
            raise ReportEditError("this report hasn't been built yet; refresh the page and try again", "not_ready")
