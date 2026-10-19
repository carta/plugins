#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""One-time upgrade: copy a firm's saved Fund Modeling data from its slug KV keys to its UUID keys.

The hosted Worker keys firm data by lowercase firm UUID (`data:<uuid>:...`, `portfolio:<uuid>`,
`construction:<uuid>`). Workers older than carta-investors 6.90.1 keyed it by slug, and those slug
keys are this script's source. It copies each one to the UUID key through `wrangler kv key get` /
`put`. It never deletes the slug keys, and it skips a UUID key that already exists, so a save made
on the UUID-keyed Worker is not overwritten.

Run it immediately before deploying the UUID-keyed Worker: until then no UUID key exists, so every slug key
is copied. After the deploy, the first firm load writes a default `portfolio:<uuid>` that the copy
would skip. Slug-key portfolios and plans expire a day after their last save, so copy and deploy in
one session.

    uv run scripts/copy_kv_to_uuid_keys.py --namespace-id <kv_namespace_id> \\
        <firm_slug>=<firm_uuid> [<firm_slug>=<firm_uuid> ...] [--dry-run]

Run from the skill directory (so `npx wrangler` finds wrangler.toml) with the Cloudflare
credentials DEPLOY.md describes. Two firms that shared a slug shared one set of keys: map the
slug to the firm that owns that data.
"""
import argparse
import json
import re
import subprocess
import sys
import tempfile

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")

# Key families the Worker scopes to a firm, written `<family>:<firm>[:<document>]`.
FAMILIES = ("data", "portfolio", "construction")


def parse_mapping(arg):
    slug, sep, uuid = arg.partition("=")
    uuid = uuid.strip().lower()
    if not sep or not slug.strip() or not UUID_RE.match(uuid):
        raise argparse.ArgumentTypeError(f"expected <firm_slug>=<firm_uuid>, got {arg!r}")
    return slug.strip(), uuid


def plan_copies(slug, uuid, list_keys):
    """[(source_key, destination_key, expiration)] for every slug key of `slug`.

    `list_keys(prefix)` returns wrangler's key entries (`{"name": ..., "expiration": ...}`).
    """
    copies = []
    for kind in FAMILIES:
        slug_part = f"{kind}:{slug}"
        for entry in list_keys(slug_part):
            name = entry["name"]
            # The prefix also matches other slugs that start with this one ("acme" vs "acme-2").
            rest = name[len(slug_part):]
            if rest and not rest.startswith(":"):
                continue
            copies.append((name, f"{kind}:{uuid}{rest}", entry.get("expiration")))
    return copies


class Wrangler:
    def __init__(self, namespace_id):
        self.target = ["--namespace-id", namespace_id]

    def _run(self, *args):
        cmd = ["npx", "wrangler", "kv", "key", *args, *self.target, "--remote"]
        done = subprocess.run(cmd, capture_output=True, text=True)
        if done.returncode != 0:
            sys.exit(f"wrangler {args[0]} failed: {done.stderr.strip() or done.stdout.strip()}")
        return done.stdout

    def list_keys(self, prefix):
        return json.loads(self._run("list", "--prefix", prefix))

    def get(self, key):
        return self._run("get", key, "--text")

    def exists(self, key):
        return any(e["name"] == key for e in self.list_keys(key))

    def put(self, key, value, expiration):
        with tempfile.NamedTemporaryFile("w", suffix=".json") as f:
            f.write(value)
            f.flush()
            extra = ["--expiration", str(expiration)] if expiration else []
            self._run("put", key, "--path", f.name, *extra)


def copy_firm(slug, uuid, kv, dry_run=False, out=print):
    copied = skipped = 0
    for source, dest, expiration in plan_copies(slug, uuid, kv.list_keys):
        if kv.exists(dest):
            out(f"skip  {dest} (already exists)")
            skipped += 1
            continue
        out(f"{'would copy' if dry_run else 'copy'}  {source} -> {dest}")
        if not dry_run:
            kv.put(dest, kv.get(source), expiration)
        copied += 1
    return copied, skipped


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("mappings", nargs="+", type=parse_mapping, metavar="SLUG=UUID")
    parser.add_argument("--namespace-id", required=True, help="the Worker's KV namespace id (wrangler.toml)")
    parser.add_argument("--dry-run", action="store_true", help="list what would be copied; write nothing")
    args = parser.parse_args(argv)
    kv = Wrangler(args.namespace_id)
    for slug, uuid in args.mappings:
        copied, skipped = copy_firm(slug, uuid, kv, args.dry_run)
        print(f"{slug}: {copied} copied, {skipped} skipped")


if __name__ == "__main__":
    main()
