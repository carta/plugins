#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""Copy saved portfolio documents from slug keys to firm-UUID keys in the SESSIONS KV namespace.

The Worker reads a firm's portfolio document from `portfolio:<firm_uuid>`. A document still
under `portfolio:<slug>` (keyed by the firm's name) is not read until it is copied. Run this once
per firm before deploying.

    uv run copy_portfolio_documents.py --namespace-id <kv_namespace_id> --list
    uv run copy_portfolio_documents.py --namespace-id <kv_namespace_id> <slug>=<firm_uuid> [...]

The old keys are left in place (they expire on their own after 30 days). A target key that
already exists is skipped, so a rerun after the deploy cannot overwrite a newer edit; pass
--force to overwrite on purpose.
"""
import argparse
import json
import os
import re
import shlex
import subprocess
import sys
import tempfile

# Matches the Worker's 30-day expirationTtl on saved portfolio documents.
PORTFOLIO_TTL_SECONDS = 86400 * 30
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def run_wrangler(wrangler, args):
    return subprocess.run(
        wrangler + args, check=True, capture_output=True, text=True
    ).stdout


def list_slug_keys(wrangler, namespace_id):
    """Keys of the form `portfolio:<slug>`. Skips `portfolio:<sid>:default` (local, per
    session) and keys already under a firm UUID."""
    out = run_wrangler(
        wrangler,
        ["kv", "key", "list", "--namespace-id", namespace_id, "--remote", "--prefix", "portfolio:"],
    )
    names = [entry["name"] for entry in json.loads(out)]
    suffixes = [name[len("portfolio:"):] for name in names]
    return sorted(s for s in suffixes if ":" not in s and not UUID_RE.match(s))


def key_exists(wrangler, namespace_id, key):
    out = run_wrangler(
        wrangler,
        ["kv", "key", "list", "--namespace-id", namespace_id, "--remote", "--prefix", key],
    )
    return any(entry["name"] == key for entry in json.loads(out))


def parse_pairs(pairs):
    mapping = {}
    for pair in pairs:
        slug, sep, firm_uuid = pair.partition("=")
        firm_uuid = firm_uuid.strip().lower()
        if not sep or not slug or not UUID_RE.match(firm_uuid):
            raise ValueError(f"expected <slug>=<firm_uuid>, got {pair!r}")
        mapping[slug] = firm_uuid
    return mapping


def copy_document(wrangler, namespace_id, slug, firm_uuid, force):
    """Returns 'copied', 'missing' (no document saved under the slug) or 'exists'."""
    source, target = f"portfolio:{slug}", f"portfolio:{firm_uuid}"
    if not key_exists(wrangler, namespace_id, source):
        return "missing"
    if not force and key_exists(wrangler, namespace_id, target):
        return "exists"
    doc = run_wrangler(wrangler, ["kv", "key", "get", source, "--namespace-id", namespace_id, "--remote"])
    # --path avoids shell argument limits on large documents.
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        f.write(doc)
        path = f.name
    try:
        run_wrangler(
            wrangler,
            ["kv", "key", "put", target, "--path", path, "--namespace-id", namespace_id, "--remote",
             "--ttl", str(PORTFOLIO_TTL_SECONDS)],
        )
    finally:
        os.unlink(path)
    return "copied"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--namespace-id", required=True, help="SESSIONS KV namespace id")
    parser.add_argument("--list", action="store_true", help="print the slug keys that need a copy, then exit")
    parser.add_argument("--force", action="store_true", help="overwrite a target key that already exists")
    parser.add_argument("--wrangler", default="npx wrangler", help="wrangler command (default: %(default)s)")
    parser.add_argument("pairs", nargs="*", metavar="slug=firm_uuid")
    args = parser.parse_args(argv)
    wrangler = shlex.split(args.wrangler)

    if args.list:
        for slug in list_slug_keys(wrangler, args.namespace_id):
            print(slug)
        return 0
    if not args.pairs:
        parser.error("give at least one slug=firm_uuid pair, or --list")
    try:
        mapping = parse_pairs(args.pairs)
    except ValueError as e:
        parser.error(str(e))

    for slug, firm_uuid in mapping.items():
        print(f"{slug}: {copy_document(wrangler, args.namespace_id, slug, firm_uuid, args.force)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
