#!/usr/bin/env python3
"""Manages the user-owned copy of app/src so plugin updates do not overwrite user edits."""
# long-comment-ok: one-liner is the whole module contract

import argparse
import datetime
import filecmp
import json
import os
import pathlib
import re
import shutil
import sys

SEMVER_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")
MODULE_SUMMARY_RE = re.compile(r"^\s*-\s*summary:\s*(.+)$")
FILES_KEY_RE = re.compile(r"^\s*files:\s*$")
FILE_ENTRY_RE = re.compile(r"^\s*-\s*(\S.+)$")

ARCHIVE_KEEP = 5
# AskUserQuestion takes at most 4 questions of 4 options each, which bounds how many
# modules Step 4.8's "Choose individually" prompt can list (serve-and-update.md).
MAX_MODULES = 16
OTHER_SUMMARY = "Other changes in this update"
# Unit tests live beside the source but are never served, so they are neither copied into
# the user's src nor counted as a change — a test-only edit never prompts anyone.
EXCLUDED_DIRS = ("__tests__",)


def user_src_dir(data_dir):
    return data_dir / "src"


def snapshot_dir(data_dir):
    return data_dir / ".plugin-src-snapshot"


def version_file(data_dir):
    return data_dir / ".version"


def archive_root(data_dir):
    return data_dir / ".src-archive"


def read_plugin_metadata(skill_dir):
    # Hand-parses a fixed two-level `whats-new` shape (no YAML dependency, matching
    # the rest of this file): a list of {summary, files: [...]} entries, e.g.
    #   whats-new:
    #     - summary: "Faster budget vs actuals refresh"
    #       files:
    #         - views/BudgetActualsView.jsx
    # File paths are relative to app/src, the same form `check` reports them in.
    # long-comment-ok: documents the exact frontmatter shape this parser requires
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.exists():
        sys.exit("ERROR: SKILL.md not found at {}".format(skill_md))

    version = None
    modules = []
    in_front = False
    in_whats_new = False
    in_files = False
    current_module = None

    for line in skill_md.read_text().splitlines():
        if line.strip() == "---":
            if not in_front:
                in_front = True
                continue
            else:
                break
        if not in_front:
            continue

        if line.startswith("version:"):
            v = line.split(":", 1)[1].strip()
            if SEMVER_RE.match(v):
                version = v
            in_whats_new = False
            continue

        if line.startswith("whats-new:"):
            in_whats_new = True
            in_files = False
            current_module = None
            continue

        if not in_whats_new:
            continue

        if line and not line[0].isspace():
            # Dedented back to another top-level frontmatter key.
            in_whats_new = False
            continue

        module_match = MODULE_SUMMARY_RE.match(line)
        if module_match:
            summary = module_match.group(1).strip().strip('"').strip("'")
            current_module = {"summary": summary, "files": []}
            modules.append(current_module)
            in_files = False
            continue

        if FILES_KEY_RE.match(line):
            in_files = True
            continue

        file_match = FILE_ENTRY_RE.match(line)
        if in_files and file_match and current_module is not None:
            current_module["files"].append(file_match.group(1).strip())

    if not version:
        sys.exit("ERROR: SKILL.md has no valid version: field")
    return version, modules


def bump_type(old_ver, new_ver):
    om = SEMVER_RE.match(old_ver or "")
    nm = SEMVER_RE.match(new_ver or "")
    if not om or not nm:
        return "major"
    o = (int(om.group(1)), int(om.group(2)), int(om.group(3)))
    n = (int(nm.group(1)), int(nm.group(2)), int(nm.group(3)))
    if n[0] != o[0]:
        return "major"
    if n[1] != o[1]:
        return "minor"
    return "patch"


def list_rel_files(root):
    root = pathlib.Path(root)
    if not root.exists():
        return []
    return sorted(
        str(f.relative_to(root)) for f in root.rglob("*")
        if f.is_file() and not set(EXCLUDED_DIRS).intersection(f.relative_to(root).parts)
    )


def changed_between(dir_a, dir_b):
    dir_a, dir_b = pathlib.Path(dir_a), pathlib.Path(dir_b)
    all_files = set(list_rel_files(dir_a)) | set(list_rel_files(dir_b))
    changed = []
    for rel in sorted(all_files):
        fa, fb = dir_a / rel, dir_b / rel
        if not fa.exists() or not fb.exists():
            changed.append(rel)
        elif not filecmp.cmp(str(fa), str(fb), shallow=False):
            changed.append(rel)
    return changed


def copy_tree(src, dst):
    src, dst = pathlib.Path(src), pathlib.Path(dst)
    if dst.exists():
        shutil.rmtree(str(dst))
    shutil.copytree(str(src), str(dst), ignore=shutil.ignore_patterns(*EXCLUDED_DIRS))


def cmd_check(args):
    skill_dir = pathlib.Path(args.skill_dir).resolve()
    data_dir = pathlib.Path(args.data_dir).resolve()
    plugin_src = skill_dir / "app" / "src"
    if not plugin_src.exists():
        sys.exit("ERROR: plugin src not found: {}".format(plugin_src))

    plugin_version, modules = read_plugin_metadata(skill_dir)
    user_src = user_src_dir(data_dir)
    ver_file = version_file(data_dir)
    snap_dir = snapshot_dir(data_dir)

    if not user_src.exists():
        print(json.dumps({
            "status": "new",
            "plugin_version": plugin_version,
            "user_src_dir": str(user_src),
            "plugin_src_dir": str(plugin_src),
            "snapshot_dir": str(snap_dir),
        }, indent=2))
        return

    installed = ver_file.read_text().strip() if ver_file.exists() else ""
    if installed == plugin_version:
        print(json.dumps({
            "status": "current",
            "version": plugin_version,
            "user_src_dir": str(user_src),
        }, indent=2))
        return

    btype = bump_type(installed, plugin_version)
    plugin_changed = changed_between(snap_dir, plugin_src) if snap_dir.exists() else list_rel_files(plugin_src)
    user_modified = changed_between(snap_dir, user_src) if snap_dir.exists() else []
    status = "patch_update" if btype == "patch" else "needs_decision"

    result = {
        "status": status,
        "installed_version": installed,
        "plugin_version": plugin_version,
        "bump_type": btype,
        "user_src_dir": str(user_src),
        "plugin_src_dir": str(plugin_src),
        "snapshot_dir": str(snap_dir),
        "plugin_changed_files": plugin_changed,
        "user_modified_files": user_modified,
    }

    if status == "needs_decision":
        result["modules"] = attribute_modules(modules, plugin_changed)

    print(json.dumps(result, indent=2))


def attribute_modules(declared_modules, plugin_changed_files):
    """Group changed files under their declared `whats-new` module.

    A file not claimed by any declared module falls into an auto-generated
    "Other changes in this update" module, so every changed file is always
    presented as part of some skippable item — an undeclared file is never
    silently force-applied. Past MAX_MODULES, the trailing declared modules are
    folded into that same entry so the list always fits the prompt.
    """
    changed_set = set(plugin_changed_files)
    claimed = set()
    result = []
    for module in declared_modules:
        files = [f for f in module["files"] if f in changed_set]
        if files:
            result.append({"summary": module["summary"], "files": files})
            claimed.update(files)
    leftover = [f for f in plugin_changed_files if f not in claimed]
    if len(result) + (1 if leftover else 0) > MAX_MODULES:
        folded = {f for module in result[MAX_MODULES - 1:] for f in module["files"]}
        result = result[:MAX_MODULES - 1]
        leftover = [f for f in plugin_changed_files if f not in claimed or f in folded]
    if leftover:
        result.append({"summary": OTHER_SUMMARY, "files": leftover})
    return result


def cmd_init(args):
    skill_dir = pathlib.Path(args.skill_dir).resolve()
    data_dir = pathlib.Path(args.data_dir).resolve()
    plugin_src = skill_dir / "app" / "src"
    plugin_version, _ = read_plugin_metadata(skill_dir)

    user_src = user_src_dir(data_dir)
    copy_tree(plugin_src, user_src)
    copy_tree(plugin_src, snapshot_dir(data_dir))
    ver_file = version_file(data_dir)
    ver_file.parent.mkdir(parents=True, exist_ok=True)
    ver_file.write_text(plugin_version)

    print(json.dumps({"ok": True, "version": plugin_version, "user_src_dir": str(user_src)}, indent=2))


def cmd_archive(args):
    """Snapshot the user's pre-merge src + sync state so it can be undone later."""
    data_dir = pathlib.Path(args.data_dir).resolve()
    user_src = user_src_dir(data_dir)
    if not user_src.exists():
        sys.exit("ERROR: no user src to archive at {}".format(user_src))

    ver_file = version_file(data_dir)
    installed = ver_file.read_text().strip() if ver_file.exists() else ""
    skill_dir = pathlib.Path(args.skill_dir).resolve()
    plugin_version, _ = read_plugin_metadata(skill_dir)

    now = datetime.datetime.now(datetime.timezone.utc)
    archive_id = now.strftime("%Y%m%dT%H%M%S") + "{:03d}Z".format(now.microsecond // 1000)
    dest = archive_root(data_dir) / archive_id

    copy_tree(user_src, dest / "src")
    snap_dir = snapshot_dir(data_dir)
    if snap_dir.exists():
        copy_tree(snap_dir, dest / "snapshot")
    (dest / "meta.json").write_text(json.dumps({
        "id": archive_id,
        "from_version": installed,
        "to_version": plugin_version,
    }, indent=2))

    _prune_archives(data_dir)

    print(json.dumps({"ok": True, "archive_id": archive_id}, indent=2))


def _prune_archives(data_dir):
    root = archive_root(data_dir)
    if not root.exists():
        return
    entries = sorted(p for p in root.iterdir() if p.is_dir())
    for stale in entries[:-ARCHIVE_KEEP]:
        shutil.rmtree(str(stale))


def cmd_rollback(args):
    data_dir = pathlib.Path(args.data_dir).resolve()
    root = archive_root(data_dir)
    entries = sorted((p for p in root.iterdir() if p.is_dir()), reverse=True) if root.exists() else []

    if args.list:
        archives = []
        for p in entries:
            meta_file = p / "meta.json"
            if meta_file.exists():
                archives.append(json.loads(meta_file.read_text()))
        print(json.dumps({"archives": archives}, indent=2))
        return

    if not args.to:
        sys.exit("ERROR: rollback requires --list or --to <archive_id>")

    target = root / args.to
    meta_file = target / "meta.json"
    if not meta_file.exists():
        sys.exit("ERROR: no archive named {}".format(args.to))
    meta = json.loads(meta_file.read_text())

    copy_tree(target / "src", user_src_dir(data_dir))
    if (target / "snapshot").exists():
        copy_tree(target / "snapshot", snapshot_dir(data_dir))
    ver_file = version_file(data_dir)
    ver_file.parent.mkdir(parents=True, exist_ok=True)
    ver_file.write_text(meta["from_version"])

    print(json.dumps({"ok": True, "restored_to_version": meta["from_version"], "archive_id": args.to}, indent=2))


def cmd_finalize(args):
    # `--files` (possibly empty) scopes the snapshot update to those paths, leaving a
    # skipped module's OLD snapshot entry in place so it stays "pending" next bump.
    skill_dir = pathlib.Path(args.skill_dir).resolve()
    data_dir = pathlib.Path(args.data_dir).resolve()
    plugin_src = skill_dir / "app" / "src"
    plugin_version, _ = read_plugin_metadata(skill_dir)
    snap_dir = snapshot_dir(data_dir)

    if args.files is not None:
        for rel in (f.strip() for f in args.files.split(",")):
            if not rel:
                continue
            src_file, snap_file = plugin_src / rel, snap_dir / rel
            if src_file.exists():
                snap_file.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(str(src_file), str(snap_file))
            elif snap_file.exists():
                snap_file.unlink()
    else:
        copy_tree(plugin_src, snap_dir)

    ver_file = version_file(data_dir)
    ver_file.parent.mkdir(parents=True, exist_ok=True)
    ver_file.write_text(plugin_version)

    print(json.dumps({"ok": True, "version": plugin_version}, indent=2))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--skill-dir", required=True,
                   help="path to the carta-manco-reporting skill root")
    p.add_argument("--data-dir", required=True,
                   help="this ManCo's dashboard_dir (from manco_paths.py resolve)")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("check").set_defaults(fn=cmd_check)
    sub.add_parser("init").set_defaults(fn=cmd_init)
    sub.add_parser("archive").set_defaults(fn=cmd_archive)
    finalize_p = sub.add_parser("finalize")
    finalize_p.add_argument(
        "--files", default=None,
        help="comma-separated relative paths actually applied this round "
             "(omit to snapshot the whole plugin tree; pass an empty string for none)",
    )
    finalize_p.set_defaults(fn=cmd_finalize)
    rollback_p = sub.add_parser("rollback")
    rollback_p.add_argument("--list", action="store_true", help="list available archives, newest first")
    rollback_p.add_argument("--to", help="archive id to restore (from --list)")
    rollback_p.set_defaults(fn=cmd_rollback)
    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
