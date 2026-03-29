#!/usr/bin/env python3
"""Validate marketplace.json registry against the actual plugin directories."""

from __future__ import annotations

import json
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
MARKETPLACE_JSON = REPO_ROOT / ".claude-plugin" / "marketplace.json"
PLUGINS_DIR = REPO_ROOT / "plugins"


def load_marketplace() -> dict | None:
    """Load and return the parsed marketplace.json, or None on parse error."""
    with MARKETPLACE_JSON.open() as f:
        try:
            return json.load(f)
        except json.JSONDecodeError as exc:
            print(f"\n✗ Failed to parse marketplace.json: {exc}")
            return None


def _resolve_source(plugin: dict) -> Path:
    """Resolve a plugin's source path to an absolute path under REPO_ROOT."""
    return REPO_ROOT / plugin["source"].removeprefix("./")


def check_source_paths(plugins: list[dict]) -> list[str]:
    """Check that every plugin source path exists as a directory."""
    errors: list[str] = []
    for plugin in plugins:
        name = plugin["name"]
        source = _resolve_source(plugin)
        if not source.is_dir():
            errors.append(f"  ✗ Plugin '{name}': source path does not exist: {plugin['source']}")
    return errors


def check_duplicate_names(plugins: list[dict]) -> list[str]:
    """Check for duplicate plugin names in marketplace.json."""
    errors: list[str] = []
    seen: dict[str, int] = {}
    for plugin in plugins:
        name = plugin["name"]
        seen[name] = seen.get(name, 0) + 1
    for name, count in seen.items():
        if count > 1:
            errors.append(f"  ✗ Plugin name '{name}' appears {count} times")
    return errors


def check_orphan_directories(plugins: list[dict]) -> list[str]:
    """Find plugin directories not registered in marketplace.json."""
    warnings: list[str] = []

    # Resolve all registered source paths to absolute paths
    registered: set[Path] = set()
    for plugin in plugins:
        registered.add(_resolve_source(plugin).resolve())

    # Walk immediate children and known subdirectories of plugins/
    plugin_dirs: list[Path] = []
    if PLUGINS_DIR.is_dir():
        for child in sorted(PLUGINS_DIR.iterdir()):
            if not child.is_dir():
                continue
            # Some plugins live in subdirectories (e.g. plugins/commands/*, plugins/mcps/*)
            has_plugin_json = (child / ".claude-plugin" / "plugin.json").exists()
            has_subdirs = any(sub.is_dir() for sub in child.iterdir())
            if has_plugin_json:
                plugin_dirs.append(child)
            elif has_subdirs:
                # Check nested directories (e.g. plugins/commands/carta-devtools)
                for sub in sorted(child.iterdir()):
                    if sub.is_dir() and (sub / ".claude-plugin" / "plugin.json").exists():
                        plugin_dirs.append(sub)
            else:
                plugin_dirs.append(child)

    for d in plugin_dirs:
        if d.resolve() not in registered:
            rel = d.relative_to(REPO_ROOT)
            warnings.append(f"  ! Directory '{rel}' is not registered in marketplace.json")

    return warnings


def check_required_files(plugins: list[dict]) -> list[str]:
    """Check that each registered plugin has the required plugin.json."""
    errors: list[str] = []
    for plugin in plugins:
        name = plugin["name"]
        source = _resolve_source(plugin)
        manifest = source / ".claude-plugin" / "plugin.json"
        if not manifest.is_file():
            errors.append(f"  ✗ Plugin '{name}': missing .claude-plugin/plugin.json")
    return errors


def main() -> int:
    print("=" * 60)
    print("Marketplace Validation")
    print("=" * 60)

    if not MARKETPLACE_JSON.is_file():
        print(f"\n✗ marketplace.json not found at {MARKETPLACE_JSON}")
        return 1

    data = load_marketplace()
    if data is None:
        return 1
    plugins = data.get("plugins", [])

    error_count = 0
    warning_count = 0

    # Check 1: Source paths exist
    print("\n--- Check 1: Source paths exist ---")
    errors = check_source_paths(plugins)
    if errors:
        for e in errors:
            print(e)
        error_count += len(errors)
    else:
        print("  ✓ All source paths exist")

    # Check 2: No duplicate plugin names
    print("\n--- Check 2: No duplicate plugin names ---")
    errors = check_duplicate_names(plugins)
    if errors:
        for e in errors:
            print(e)
        error_count += len(errors)
    else:
        print("  ✓ All plugin names are unique")

    # Check 3: Orphan plugin directories
    print("\n--- Check 3: Orphan plugin directories ---")
    warnings = check_orphan_directories(plugins)
    if warnings:
        for w in warnings:
            print(w)
        warning_count += len(warnings)
    else:
        print("  ✓ No orphan plugin directories found")

    # Check 4: Required files
    print("\n--- Check 4: Required files ---")
    errors = check_required_files(plugins)
    if errors:
        for e in errors:
            print(e)
        error_count += len(errors)
    else:
        print("  ✓ All plugins have required files")

    # Summary
    print("\n" + "=" * 60)
    print(f"Summary: {error_count} error(s), {warning_count} warning(s)")
    if error_count:
        print("FAILED")
    else:
        print("PASSED")
    print("=" * 60)

    return 1 if error_count else 0


if __name__ == "__main__":
    sys.exit(main())
