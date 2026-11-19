#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""Build the contents page for an audit documents download.

Reads every zip a download run delivered, and the manifest.csv Carta puts in each, and
writes one self-contained HTML page: a flat, searchable table with one row per document,
naming the zip and the folder inside it where the file sits. The page links to nothing.

Usage: build_contents_page.py <spec.json> <out.html>

spec.json lists the run's zips:
  {"zips": [{"zip": "<path>", "firm": "...", "fund": "...", "audit_year": 2026,
             "area": "<area label>"}]}
"""
from __future__ import annotations

import calendar
import csv
import html
import io
import json
import re
import sys
import zipfile
from pathlib import Path, PurePosixPath
from typing import Dict, List, Optional

AUDIT_AREAS_MD = Path(__file__).resolve().parents[3] / "references" / "audit" / "audit-areas.md"

# The reason codes fund-admin writes for a requested document it left out of a zip.
EXCLUSION_REASONS = {
    "delivered_via_carta_web": "Delivered in the investor reports zip for this area",
    "storage_returned_not_found": "Carta couldn't retrieve the file",
    "storage_returned_no_url": "Carta couldn't retrieve the file",
    "excluded_by_caller": "Left out of this export",
}

MISSING_FROM_ZIP = "Carta lists this file, but it isn't in the zip"
NO_FOLDER = "Folder not given by Carta"
TOP_LEVEL = "Top level of the zip"
NOT_IN_ZIP = "Not in this zip"

COLUMNS = ("Fund", "Year", "Area", "Document type", "Document name", "Date/period",
           "Status", "In zip", "Folder", "Notes")


def _audit_areas_tables() -> tuple:
    """Area labels by slug, and readiness labels by raw lifecycle_status, from audit-areas.md."""
    text = AUDIT_AREAS_MD.read_text(encoding="utf-8")
    areas = {slug: label for label, slug in re.findall(r"^\| ([^|`]+?) \| `([a-z-]+)` \|", text, re.M)}
    readiness = {}
    for statuses, label in re.findall(r"^\| ((?:`[^`]+`(?:, )?)+) \| ([^|]+?) \|", text, re.M):
        for status in re.findall(r"`([^`]+)`", statuses):
            readiness[status] = label
    return areas, readiness


def _manifest_rows(archive: zipfile.ZipFile) -> Optional[List[Dict[str, str]]]:
    """Rows of the zip's manifest.csv, which Carta writes beside the documents."""
    names = [n for n in archive.namelist() if PurePosixPath(n).name == "manifest.csv"]
    if not names:
        return None
    manifest = min(names, key=lambda n: n.count("/"))
    text = archive.read(manifest).decode("utf-8-sig")
    return list(csv.DictReader(io.StringIO(text)))


def _folder(entry: str) -> str:
    folder = str(PurePosixPath(entry).parent)
    return TOP_LEVEL if folder == "." else folder


def _period(row: Dict[str, str]) -> str:
    """The period the document covers, else the month and year it belongs to."""
    start, end = (row.get("period_start") or "").strip(), (row.get("period_end") or "").strip()
    if start and end:
        return f"{start} to {end}"
    if start or end:
        return f"From {start}" if start else f"Until {end}"
    month, year = (row.get("document_month") or "").strip(), (row.get("document_year") or "").strip()
    name = calendar.month_name[int(month)] if month.isdigit() and 1 <= int(month) <= 12 else month
    return " ".join(part for part in (name, year) if part)


def _documents(zip_path: Path, readiness: dict) -> tuple:
    """(documents, note) for one zip. Each document is a dict with the table cells
    type, name, period, status, in_zip, folder and notes."""
    # Every read of the zip sits in this one guard, so a damaged zip costs only its own
    # listing, never the page. It guards only zip reads and a CSV parse, so catching
    # everything can't hide a bug in the page code.
    try:
        with zipfile.ZipFile(zip_path) as archive:
            entries = set(archive.namelist())
            rows = _manifest_rows(archive)
    except Exception:
        return [], "This zip couldn't be read, so its contents aren't listed."
    if rows is None:
        files = sorted(n for n in entries if not n.endswith("/"))
        documents = [
            {
                "type": "",
                "name": PurePosixPath(n).name,
                "period": "",
                "status": "",
                "in_zip": zip_path.name,
                "folder": _folder(n),
                "notes": "",
            }
            for n in files
        ]
        return documents, "Carta sends no manifest with this zip, so only file names and folders are shown."

    has_paths = bool(rows) and "file_path" in rows[0]
    documents = []
    for row in rows:
        entry = row.get("file_path") or ""
        reason = row.get("reason") or ""
        in_zip, folder, notes = zip_path.name, NO_FOLDER, ""
        if row.get("included") == "False":
            in_zip, folder = NOT_IN_ZIP, ""
            notes = EXCLUSION_REASONS.get(reason, reason)
        elif entry and entry not in entries:
            in_zip, folder, notes = NOT_IN_ZIP, "", MISSING_FROM_ZIP
        elif entry:
            folder = _folder(entry)
        documents.append(
            {
                "type": row.get("document_type") or "",
                "name": row.get("name") or PurePosixPath(entry).name,
                "period": _period(row),
                "status": readiness.get(row.get("lifecycle_status") or "", row.get("lifecycle_status") or ""),
                "in_zip": in_zip,
                "folder": folder,
                "notes": notes,
            }
        )
    note = None if has_paths else "Carta's manifest for this zip doesn't give folders yet, so none are shown."
    return documents, note


STYLE = """
:root{
  color-scheme:light dark;
  --ink-color-global-text-default:light-dark(#1A1A1A,#EDEDED);
  --ink-color-global-text-subtle:light-dark(#656B6B,#A7AAAA);
  --ink-color-global-surface-background-default:light-dark(#FFFFFF,rgb(18 18 18));
  --ink-color-global-surface-background-underlay:light-dark(#F1F1F1,#2D2D2D);
  --ink-color-global-border-subtle:light-dark(#DEDFDF,#2D2D2D);
  --ink-color-global-border-default:light-dark(#A7AAAA,#656B6B);
  --ink-size-global-radius-subtle:4px;
}
*{box-sizing:border-box}
body{margin:0;padding:24px;font:14px/22px Inter,system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--ink-color-global-surface-background-default);color:var(--ink-color-global-text-default)}
h1{font-size:22px;line-height:30px;font-weight:600;margin:0 0 8px}
p{margin:0 0 12px;max-width:72ch}
label{display:block;font-weight:600;margin-bottom:4px}
input{width:100%;max-width:480px;font:inherit;padding:6px 10px;color:inherit;background:var(--ink-color-global-surface-background-default);border:1px solid var(--ink-color-global-border-default);border-radius:var(--ink-size-global-radius-subtle)}
:focus-visible{outline:2px solid var(--ink-color-global-text-default);outline-offset:2px}
.count{color:var(--ink-color-global-text-subtle);margin:8px 0}
.notes{margin:0 0 12px;padding-left:20px;max-width:90ch}
.wrap{overflow-x:auto;border:1px solid var(--ink-color-global-border-subtle)}
table{border-collapse:collapse;width:100%;font-size:13px;line-height:20px}
th,td{text-align:left;vertical-align:top;padding:6px 10px;border-bottom:1px solid var(--ink-color-global-border-subtle);overflow-wrap:break-word}
thead th{background:var(--ink-color-global-surface-background-underlay);white-space:nowrap;padding:0}
th button{font:inherit;font-weight:600;color:inherit;background:none;border:0;padding:6px 10px;width:100%;text-align:left;cursor:pointer}
th button .arrow{color:var(--ink-color-global-text-subtle);margin-left:4px}
tr[hidden]{display:none}
"""

SCRIPT = """
(function(){
  const box=document.getElementById('filter'),count=document.getElementById('count');
  const body=document.querySelector('#documents tbody');
  const rows=Array.from(body.rows),total=rows.length;
  const noun=n=>n===1?'document':'documents';
  const collator=new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});
  function filter(){
    const terms=box.value.toLowerCase().split(/\\s+/).filter(Boolean);
    let shown=0;
    rows.forEach(r=>{
      const text=r.textContent.toLowerCase();
      r.hidden=!terms.every(t=>text.includes(t));
      if(!r.hidden)shown++;
    });
    count.textContent=terms.length?shown+' of '+total+' '+noun(total):total+' '+noun(total);
  }
  box.addEventListener('input',filter);
  const heads=Array.from(document.querySelectorAll('#documents thead th'));
  heads.forEach((th,col)=>{
    const button=th.querySelector('button'),arrow=th.querySelector('.arrow');
    button.addEventListener('click',()=>{
      const dir=th.getAttribute('aria-sort')==='ascending'?'descending':'ascending';
      heads.forEach(h=>{h.removeAttribute('aria-sort');h.querySelector('.arrow').textContent='';});
      th.setAttribute('aria-sort',dir);
      arrow.textContent=dir==='ascending'?'\u25B2':'\u25BC';
      const sign=dir==='ascending'?1:-1;
      rows.slice().sort((a,b)=>sign*collator.compare(a.cells[col].textContent,b.cells[col].textContent))
        .forEach(r=>body.appendChild(r));
    });
  });
})();
"""


def _cell(value: str) -> str:
    return f"<td>{html.escape(value)}</td>"


def build(spec: dict) -> str:
    areas, readiness = _audit_areas_tables()
    area_order = {label: i for i, label in enumerate(areas.values())}
    items = sorted(
        spec["zips"],
        key=lambda i: (i["firm"], i["fund"], str(i["audit_year"]),
                       area_order.get(i["area"], len(area_order)), i["area"], Path(i["zip"]).name),
    )

    rows = []
    notes = []
    for item in items:
        zip_path = Path(item["zip"])
        documents, note = _documents(zip_path, readiness)
        if note:
            notes.append(f"{zip_path.name}: {note}")
        for d in sorted(documents, key=lambda d: (d["folder"].lower(), d["name"].lower())):
            cells = (item["fund"], str(item["audit_year"]), item["area"], d["type"], d["name"],
                     d["period"], d["status"], d["in_zip"], d["folder"], d["notes"])
            rows.append("<tr>" + "".join(_cell(c) for c in cells) + "</tr>")

    total = len(rows)
    intro = (
        "This page lists the documents inside each zip you downloaded. To find a file, "
        "open the zip named in the \"In zip\" column, then the folder named in the "
        "\"Folder\" column. Type in the filter box to narrow the list, and select a "
        "column heading to sort by it."
    )
    head = "".join(
        f'<th scope="col"><button type="button">{html.escape(c)}<span class="arrow" aria-hidden="true"></span></button></th>'
        for c in COLUMNS
    )
    note_list = (
        '<ul class="notes">' + "".join(f"<li>{html.escape(n)}</li>" for n in notes) + "</ul>" if notes else ""
    )
    return (
        '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        "<title>Audit documents contents</title>"
        f"<style>{STYLE}</style></head><body>"
        f"<h1>Audit documents contents</h1><p>{html.escape(intro)}</p>"
        f"{note_list}"
        '<label for="filter">Filter by name, type, status, fund or area</label>'
        '<input id="filter" type="search" autocomplete="off">'
        f'<p class="count" id="count" role="status">{total} {"document" if total == 1 else "documents"}</p>'
        '<div class="wrap" role="region" aria-label="Documents" tabindex="0">'
        f'<table id="documents"><thead><tr>{head}</tr></thead><tbody>{"".join(rows)}</tbody></table></div>'
        f"<script>{SCRIPT}</script></body></html>"
    )


def main(argv: List[str]) -> int:
    if len(argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    spec = json.loads(Path(argv[1]).read_text(encoding="utf-8"))
    Path(argv[2]).write_text(build(spec), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
