#!/usr/bin/env python3
"""Verify that plugins in a PR originated from the internal claude-marketplace repo.

For each plugin name provided, performs three checks:
    1. Existence: plugin directory exists in carta/claude-marketplace main branch.
    2. Security manifest: plugin appears with "status": "passed" in the manifest.
    3. Content integrity: local content hash matches the manifest's content_hash.

Usage:
    python verify-provenance.py "plugin-a,plugin-b,plugin-c"

Requires:
    GH_TOKEN environment variable for GitHub API authentication.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
PLUGINS_DIR = REPO_ROOT / "plugins"

GITHUB_API = "https://api.github.com"
MARKETPLACE_REPO = os.environ.get("PROVENANCE_REPO", "carta/claude-marketplace")
MARKETPLACE_REF = "main"

# Possible plugin directory prefixes in the marketplace repo.
# Plugins may live at plugins/<name> or nested under plugins/<category>/<name>.
MARKETPLACE_SEARCH_PREFIXES = [
    "plugins",
    "plugins/commands",
    "plugins/mcps",
]


def _gh_token() -> str:
    """Return the GitHub token or exit with an error."""
    token = os.environ.get("GH_TOKEN", "")
    if not token:
        print("Error: GH_TOKEN environment variable is not set.")
        print("Set it to a GitHub personal access token with repo read access.")
        sys.exit(1)
    return token


def _github_get(path: str) -> dict | None:
    """Make a GET request to the GitHub API and return parsed JSON.

    Returns None on 404. Raises SystemExit on auth or rate-limit errors.
    """
    url = f"{GITHUB_API}{path}"
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {_gh_token()}",
        "Accept": "application/vnd.github.v3+json",
        "X-GitHub-Api-Version": "2022-11-28",
    })

    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        if exc.code == 403:
            remaining = exc.headers.get("X-RateLimit-Remaining", "unknown")
            if remaining == "0":
                print(f"Error: GitHub API rate limit exceeded. Reset at "
                      f"{exc.headers.get('X-RateLimit-Reset', 'unknown')}.")
                print("Wait a few minutes or use a token with higher limits.")
                sys.exit(1)
            print(f"Error: GitHub API returned 403 Forbidden for {url}.")
            print("Ensure GH_TOKEN has read access to carta/claude-marketplace.")
            sys.exit(1)
        if exc.code == 401:
            print("Error: GitHub API returned 401 Unauthorized.")
            print("Ensure GH_TOKEN is a valid token with repo read access.")
            sys.exit(1)
        raise


# ---------------------------------------------------------------------------
# Content hash — must exactly match generate-security-manifest.py
# ---------------------------------------------------------------------------

# Exclusions must stay in sync with generate-security-manifest.py so that
# hashes computed here match hashes recorded in the security manifest.
HASH_EXCLUDE_DIRS = {"__pycache__", "node_modules"}


def _should_exclude(path: Path) -> bool:
    """Return True if *path* should be excluded from content hashing."""
    return (
        any(part in HASH_EXCLUDE_DIRS for part in path.parts)
        or path.suffix == ".pyc"
        or path.name == ".DS_Store"
    )


def compute_content_hash(plugin_dir: Path) -> str:
    """Compute a deterministic SHA-256 hash of all files in a plugin directory.

    Algorithm (must match generate-security-manifest.py exactly):
        1. Collect all files recursively, excluding build artifacts and OS
           metadata (__pycache__, .pyc, .DS_Store, node_modules).
        2. Sort by relative POSIX path.
        3. For each file: concatenate relative_path + newline + file bytes.
        4. Hash the full concatenation with SHA-256.
        5. Return "sha256:<hex>".
    """
    hasher = hashlib.sha256()

    all_files: list[Path] = sorted(
        (
            f
            for f in plugin_dir.rglob("*")
            if f.is_file() and not _should_exclude(f.relative_to(plugin_dir))
        ),
        key=lambda f: f.relative_to(plugin_dir).as_posix(),
    )

    for filepath in all_files:
        rel_path = filepath.relative_to(plugin_dir).as_posix()
        hasher.update(rel_path.encode("utf-8"))
        hasher.update(b"\n")
        hasher.update(filepath.read_bytes())

    return f"sha256:{hasher.hexdigest()}"


# ---------------------------------------------------------------------------
# Check 1: Existence in marketplace
# ---------------------------------------------------------------------------

def check_existence(plugin_name: str) -> tuple[bool, str, str | None]:
    """Verify the plugin exists in claude-marketplace main branch.

    Returns (passed, message, marketplace_path_prefix_or_none).
    """
    for prefix in MARKETPLACE_SEARCH_PREFIXES:
        api_path = (
            f"/repos/{MARKETPLACE_REPO}/contents/"
            f"{prefix}/{plugin_name}/.claude-plugin/plugin.json"
            f"?ref={MARKETPLACE_REF}"
        )
        result = _github_get(api_path)
        if result is not None:
            return (
                True,
                f"Found at {prefix}/{plugin_name} in {MARKETPLACE_REPO}",
                prefix,
            )

    searched = ", ".join(f"{p}/{plugin_name}" for p in MARKETPLACE_SEARCH_PREFIXES)
    return (
        False,
        f"Plugin '{plugin_name}' not found in {MARKETPLACE_REPO}. "
        f"Searched: {searched}. "
        f"Publish it to claude-marketplace first before adding to the public repo.",
        None,
    )


# ---------------------------------------------------------------------------
# Check 2 & 3: Security manifest
# ---------------------------------------------------------------------------

def fetch_security_manifest() -> dict | None:
    """Fetch and decode security-manifest.json from marketplace main branch."""
    api_path = (
        f"/repos/{MARKETPLACE_REPO}/contents/security-manifest.json"
        f"?ref={MARKETPLACE_REF}"
    )
    result = _github_get(api_path)
    if result is None:
        return None

    content_b64 = result.get("content", "")
    try:
        raw = base64.b64decode(content_b64)
        return json.loads(raw)
    except (json.JSONDecodeError, ValueError) as exc:
        print(f"Error: Failed to parse security-manifest.json: {exc}")
        return None


def check_security_manifest(
    plugin_name: str,
    manifest: dict,
) -> tuple[bool, str]:
    """Verify the plugin appears in the manifest with status 'passed'."""
    plugins = manifest.get("plugins", {})
    entry = plugins.get(plugin_name)

    if entry is None:
        return (
            False,
            f"Plugin '{plugin_name}' not found in security-manifest.json. "
            f"Run the security scan in claude-marketplace CI before publishing.",
        )

    status = entry.get("status", "unknown")
    if status != "passed":
        return (
            False,
            f"Plugin '{plugin_name}' has status '{status}' in security manifest "
            f"(expected 'passed'). Resolve security findings before publishing.",
        )

    return True, f"Security manifest status: passed"


def check_content_integrity(
    plugin_name: str,
    manifest: dict,
) -> tuple[bool, str]:
    """Compare local content hash with the manifest's recorded hash."""
    plugins = manifest.get("plugins", {})
    entry = plugins.get(plugin_name)

    if entry is None:
        return (
            False,
            f"Cannot verify content integrity — plugin '{plugin_name}' "
            f"missing from security manifest.",
        )

    # Prefer published_content_hash (accounts for publish transforms like
    # URL rewrites and file exclusions). Fall back to content_hash for
    # plugins that haven't been updated to include the published hash yet.
    expected_hash = entry.get("published_content_hash") or entry.get("content_hash", "")
    hash_field = "published_content_hash" if entry.get("published_content_hash") else "content_hash"
    if not expected_hash:
        return (
            False,
            f"No content hash recorded in manifest for '{plugin_name}'.",
        )

    # The local plugin directory is always at plugins/<name> in this repo,
    # regardless of where it lives in the marketplace repo.
    local_plugin_dir = PLUGINS_DIR / plugin_name
    if not local_plugin_dir.is_dir():
        return (
            False,
            f"Local plugin directory not found: {local_plugin_dir.relative_to(REPO_ROOT)}. "
            f"Ensure the plugin has been copied into the plugins/ directory.",
        )

    local_hash = compute_content_hash(local_plugin_dir)

    if local_hash != expected_hash:
        return (
            False,
            f"Content hash mismatch for '{plugin_name}'.\n"
            f"    Local:    {local_hash}\n"
            f"    Expected: {expected_hash} ({hash_field})\n"
            f"    The local plugin content differs from what was scanned in "
            f"claude-marketplace. Ensure you are syncing the exact same files.",
        )

    return True, f"Content hash verified: {local_hash}"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def verify_plugin(
    plugin_name: str,
    manifest: dict | None,
) -> bool:
    """Run all checks for a single plugin. Returns True if all pass."""
    print(f"\n--- Plugin: {plugin_name} ---")

    all_passed = True

    # Check 1: Existence
    passed, msg, _ = check_existence(plugin_name)
    status = "PASS" if passed else "FAIL"
    print(f"  [{status}] Existence check: {msg}")
    if not passed:
        all_passed = False

    # Check 2 & 3 require the manifest
    if manifest is None:
        print("  [FAIL] Security manifest check: security-manifest.json not found "
              f"in {MARKETPLACE_REPO} main branch. Ensure the security scan has run.")
        print("  [FAIL] Content integrity check: skipped (no manifest)")
        return False

    # Check 2: Security manifest status
    passed, msg = check_security_manifest(plugin_name, manifest)
    status = "PASS" if passed else "FAIL"
    print(f"  [{status}] Security manifest check: {msg}")
    if not passed:
        all_passed = False

    # Check 3: Content integrity
    passed, msg = check_content_integrity(plugin_name, manifest)
    status = "PASS" if passed else "FAIL"
    print(f"  [{status}] Content integrity check: {msg}")
    if not passed:
        all_passed = False

    return all_passed


def _load_marketplace_plugin_names() -> set[str]:
    """Load the set of plugin names registered in marketplace.json."""
    marketplace_path = REPO_ROOT / ".claude-plugin" / "marketplace.json"
    if not marketplace_path.is_file():
        print(f"Warning: marketplace.json not found at {marketplace_path.relative_to(REPO_ROOT)}")
        return set()

    try:
        data = json.loads(marketplace_path.read_text())
    except (json.JSONDecodeError, OSError) as exc:
        print(f"Warning: Failed to parse marketplace.json: {exc}")
        return set()

    return {
        p["name"]
        for p in data.get("plugins", [])
        if isinstance(p, dict) and "name" in p
    }


def main() -> int:
    if len(sys.argv) < 2 or not sys.argv[1].strip():
        print("No plugins to verify. Exiting.")
        return 0

    plugin_names = [n.strip() for n in sys.argv[1].split(",") if n.strip()]

    if not plugin_names:
        print("No plugins to verify. Exiting.")
        return 0

    print("=" * 60)
    print("Plugin Provenance Verification")
    print("=" * 60)
    print(f"Repo:    {MARKETPLACE_REPO} (ref: {MARKETPLACE_REF})")
    print(f"Plugins: {', '.join(plugin_names)}")

    # Load registered plugin names from marketplace.json (used for deletion checks)
    registered_plugins = _load_marketplace_plugin_names()

    # Fetch the security manifest once (used by checks 2 & 3)
    manifest = fetch_security_manifest()
    if manifest is None:
        print(f"\nWarning: Could not fetch security-manifest.json from "
              f"{MARKETPLACE_REPO} main branch.")

    results: dict[str, bool] = {}
    for name in plugin_names:
        local_plugin_dir = PLUGINS_DIR / name
        if not local_plugin_dir.is_dir():
            if name in registered_plugins:
                # Directory is missing but plugin is still in marketplace.json
                # — this is likely an accidental deletion.
                print(f"\n  [FAIL] Plugin '{name}' directory is missing but still "
                      f"listed in marketplace.json — either restore the plugin or "
                      f"remove it from marketplace.json")
                results[name] = False
            else:
                # Directory is missing AND plugin has been removed from
                # marketplace.json — intentional deletion, safe to skip.
                print(f"\n  [SKIP] Plugin '{name}' is being removed (directory deleted "
                      f"and removed from marketplace.json) — no provenance check needed.")
                results[name] = True
            continue
        results[name] = verify_plugin(name, manifest)

    # Summary
    passed = sum(1 for v in results.values() if v)
    failed = len(results) - passed

    print("\n" + "=" * 60)
    print(f"Summary: {passed} passed, {failed} failed out of {len(results)} plugin(s)")

    if failed:
        print("\nFailed plugins:")
        for name, ok in results.items():
            if not ok:
                print(f"  ✗ {name}")
        print("\nFAILED")
        return 1

    print("\nPASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
