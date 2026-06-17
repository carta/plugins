#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""
Sync Carta cap-table field definitions to the Stonly glossary guide.

Usage:
  uv run --no-project --script update-stonly-glossary.py [options]

Modes:
  (default / --dry-run)  Report what would change. No writes.
  --apply                Insert corrected steps (including multi-step consolidations)
                         and emit manual-delete checklist. No publish.
  --publish              Publish the guide after human confirms stale steps deleted.

Options:
  --sheet-id SHEET_ID    Google Sheet ID (default: 1hMePoWPVHYZdGFuiT7Gwqj42GzSA-hDqJBWnVF-Ke9E)
  --guide-id GUIDE_ID    Stonly guide ID (default: n9AohqIopQ)
  --steps ID,ID,...      Comma-separated step IDs to process (default: all)
  --state-file PATH      Run-state JSON file for idempotency (default: .stonly-run-state.json)

Environment:
  STONLY_API_KEY         Required for --apply and --publish (not needed for --dry-run).

Exit codes: 0 = success, 1 = error.
"""
from __future__ import annotations
import argparse, json, os, sys
from collections import Counter
from pathlib import Path

DEFAULT_SHEET_ID = "1hMePoWPVHYZdGFuiT7Gwqj42GzSA-hDqJBWnVF-Ke9E"
DEFAULT_GUIDE_ID = "n9AohqIopQ"
DEFAULT_STATE_FILE = ".stonly-run-state.json"
STEP_MAP_PATH = Path(__file__).parent / "stonly_step_map.json"


def _add_scripts_to_path() -> None:
    """Ensure the scripts/ directory is on sys.path for sibling imports."""
    scripts_dir = str(Path(__file__).parent)
    if scripts_dir not in sys.path:
        sys.path.insert(0, scripts_dir)


def main() -> None:
    _add_scripts_to_path()

    from glossary_common import gcloud_token, list_visible_tabs, read_tab, parse_tab_records
    from stonly_client import StonlyClient, StonlyError
    from stonly_replace import plan_replacements, writeback_step_map

    # -------------------------------------------------------------------------
    # 1. Parse args
    # -------------------------------------------------------------------------
    parser = argparse.ArgumentParser(
        description="Sync Carta cap-table field definitions to the Stonly glossary guide.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="Report what would change. No writes. (default mode)",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        default=False,
        help="Insert corrected steps and emit manual-delete checklist. No publish.",
    )
    parser.add_argument(
        "--publish",
        action="store_true",
        default=False,
        help="Publish the guide after human confirms stale steps deleted.",
    )
    parser.add_argument("--sheet-id", default=DEFAULT_SHEET_ID, help="Google Sheet ID")
    parser.add_argument("--guide-id", default=DEFAULT_GUIDE_ID, help="Stonly guide ID")
    parser.add_argument(
        "--steps",
        default=None,
        help="Comma-separated step IDs to process (default: all)",
    )
    parser.add_argument(
        "--state-file",
        default=DEFAULT_STATE_FILE,
        help="Run-state JSON file for idempotency (default: .stonly-run-state.json)",
    )
    args = parser.parse_args()

    # Default to dry-run if no mode flag given
    if not args.dry_run and not args.apply and not args.publish:
        args.dry_run = True

    if args.apply and args.publish:
        print("ERROR: --apply and --publish are mutually exclusive.", file=sys.stderr)
        sys.exit(1)

    if args.dry_run and args.publish:
        print("ERROR: --dry-run and --publish are mutually exclusive.", file=sys.stderr)
        sys.exit(1)

    if args.dry_run and args.apply:
        print("ERROR: --dry-run and --apply are mutually exclusive.", file=sys.stderr)
        sys.exit(1)

    # -------------------------------------------------------------------------
    # 2. Load step map
    # -------------------------------------------------------------------------
    try:
        with open(STEP_MAP_PATH) as f:
            step_map = json.load(f)
    except FileNotFoundError:
        print(f"ERROR: step map not found at {STEP_MAP_PATH}", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as exc:
        print(f"ERROR: invalid JSON in step map: {exc}", file=sys.stderr)
        sys.exit(1)

    # -------------------------------------------------------------------------
    # 3. Fetch sheet records
    # -------------------------------------------------------------------------
    token = gcloud_token()
    tabs = list_visible_tabs(token, args.sheet_id)
    sheet_records_by_section: dict[str, list[dict]] = {}
    for tab in tabs:
        values = read_tab(token, args.sheet_id, tab)
        records = parse_tab_records(values)
        for record in records:
            # Qualify with tab name to disambiguate sections that share a name
            # across tabs (e.g. "Equity Incentive Plan" in Cap Table and
            # Stakeholder Ownership Details). Step map section keys use the
            # same "Tab|Section" format.
            key = f"{tab}|{record['section']}"
            if key not in sheet_records_by_section:
                sheet_records_by_section[key] = []
            sheet_records_by_section[key].append(record)

    # -------------------------------------------------------------------------
    # 4. Fetch guide export
    # -------------------------------------------------------------------------
    steps: list[dict] = []
    live_data_available = False

    if args.dry_run:
        # Attempt to fetch but tolerate missing key
        try:
            client = StonlyClient()
            steps = client.export_guide(args.guide_id)
            live_data_available = True
        except StonlyError as exc:
            msg = str(exc)
            # Only suppress key-missing errors; re-raise unexpected ones
            if "not set" in msg or "bad/missing" in msg:
                print(
                    "NOTE: STONLY_API_KEY not available — dry-run without live data. "
                    "Change detection unavailable; listing all mapped steps as status unknown.",
                    file=sys.stderr,
                )
                live_data_available = False
            else:
                print(f"ERROR: Stonly API error: {msg}", file=sys.stderr)
                sys.exit(1)
    else:
        # --apply or --publish: require the key
        try:
            client = StonlyClient()
            steps = client.export_guide(args.guide_id)
            live_data_available = True
        except StonlyError as exc:
            msg = str(exc)
            if "not set" in msg or "bad/missing" in msg:
                print(
                    "ERROR: STONLY_API_KEY is required for --apply and --publish.",
                    file=sys.stderr,
                )
            else:
                print(f"ERROR: Stonly API error: {msg}", file=sys.stderr)
            sys.exit(1)

    # -------------------------------------------------------------------------
    # 5. Plan replacements
    # -------------------------------------------------------------------------
    results = plan_replacements(sheet_records_by_section, steps, step_map)

    # Apply --steps filter if provided
    if args.steps:
        try:
            filter_ids = set(int(x.strip()) for x in args.steps.split(","))
        except ValueError:
            print("ERROR: --steps must be comma-separated integers.", file=sys.stderr)
            sys.exit(1)
        results = [r for r in results if r["step_id"] in filter_ids]

    # -------------------------------------------------------------------------
    # 6. Count and print summary
    # -------------------------------------------------------------------------
    counts = Counter(r["classification"] for r in results)
    summary = {
        "steps_total": len(results),
        "unchanged": counts.get("unchanged", 0),
        "changed": counts.get("changed", 0),
        "new_sections": counts.get("new_section", 0),
        "flagged_aside": counts.get("flagged_aside", 0),
        "flagged_rechunk": counts.get("flagged_rechunk", 0),
        "unmapped": counts.get("unmapped", 0),
    }
    if not live_data_available:
        summary["note"] = "dry-run without live data — change detection unavailable"

    print(json.dumps(summary))

    for r in results:
        if r["classification"] == "unchanged":
            continue
        print(f"  [{r['classification'].upper()}] step {r['step_id']}: {r['title']}")

    # -------------------------------------------------------------------------
    # 7. --apply mode: run inserts + emit manual-delete checklist
    # -------------------------------------------------------------------------
    if args.apply:
        state_file = Path(args.state_file)
        run_state: dict[str, int] = {}
        if state_file.exists():
            try:
                run_state = json.loads(state_file.read_text())
            except (json.JSONDecodeError, OSError) as exc:
                print(f"WARNING: could not read state file {state_file}: {exc}", file=sys.stderr)
                run_state = {}

        changed_results = [r for r in results if r["classification"] == "changed"]

        for r in changed_results:
            rp = r["replace_plan"]
            # Support both single-step replace (stale_step_id) and multi-step consolidation (stale_step_ids)
            stale_ids = rp.get("stale_step_ids") or [rp["stale_step_id"]]
            state_key = str(stale_ids[0])  # keyed on the chain head (or the single stale step)

            if state_key in run_state:
                new_id = run_state[state_key]
                print(f"  [SKIP-ALREADY-INSERTED] stale={state_key} → new={new_id}")
            else:
                try:
                    new_id = client.append_step(
                        args.guide_id,
                        parent_id=rp["parent_id"],
                        content=rp["new_html"],
                        title=r["title"],
                        choice_label=rp["choice_label"],
                        position=rp["position"],
                    )
                    for succ in rp["successors"]:
                        client.link_steps(
                            args.guide_id,
                            source_id=new_id,
                            target_id=succ["id"],
                            choice_label=succ.get("choiceLabel", ""),
                            position=succ.get("position"),
                        )
                    run_state[state_key] = new_id
                    state_file.write_text(json.dumps(run_state, indent=2))
                    print(f"  [INSERTED] stale={state_key} → new={new_id}")
                except StonlyError as exc:
                    msg = str(exc)
                    print(f"  [ERROR] stale={state_key}: {msg}", file=sys.stderr)
                    state_file.write_text(json.dumps(run_state, indent=2))
                    sys.exit(1)

        # Create brand-new steps for sections with no existing step
        new_section_results = [r for r in results if r["classification"] == "new_section"]
        for r in new_section_results:
            cp = r["create_plan"]
            state_key = f"new:{cp['section_key']}"
            if state_key in run_state:
                new_id = run_state[state_key]
                print(f"  [SKIP-ALREADY-CREATED] {r['title']} → id={new_id}")
            else:
                try:
                    new_id = client.append_step(
                        args.guide_id,
                        parent_id=cp["parent_id"],
                        content=cp["new_html"],
                        title=r["title"],
                        choice_label=cp["choice_label"],
                        position=cp["position"],
                    )
                    if cp.get("successor_id"):
                        client.link_steps(
                            args.guide_id,
                            source_id=new_id,
                            target_id=cp["successor_id"],
                            choice_label="",
                            position=0,
                        )
                    run_state[state_key] = new_id
                    state_file.write_text(json.dumps(run_state, indent=2))
                    writeback_step_map(STEP_MAP_PATH, cp["section_key"], new_id, r["title"])
                    print(f"  [CREATED] {r['title']} → new={new_id}")
                except StonlyError as exc:
                    print(f"  [ERROR] {r['title']}: {exc}", file=sys.stderr)
                    state_file.write_text(json.dumps(run_state, indent=2))
                    sys.exit(1)

        # Print manual-delete checklist
        print("\n=== MANUAL DELETE CHECKLIST ===")
        print("Delete each stale step in the Stonly editor, then run --publish.")
        print()
        for r in changed_results:
            rp = r["replace_plan"]
            stale_ids = rp.get("stale_step_ids") or [rp["stale_step_id"]]
            for stale_id in stale_ids:
                editor_url = f"https://app.stonly.com/app/guide/{args.guide_id}/editor/{stale_id}"
                print(f"  DELETE step {stale_id}: {editor_url}")
        print()

        # Print flagged steps for manual review
        flagged = [r for r in results if r["classification"].startswith("flagged_")]
        if flagged:
            print(f"=== FLAGGED FOR MANUAL REVIEW ({len(flagged)} steps) ===")
            for r in flagged:
                print(f"  [{r['classification']}] step {r['step_id']}: {r['title']}")

    # -------------------------------------------------------------------------
    # 8. --publish mode: publish + poll
    # -------------------------------------------------------------------------
    if args.publish:
        import time

        try:
            job_id = client.publish(args.guide_id)
        except StonlyError as exc:
            msg = str(exc)
            print(f"ERROR: publish failed: {msg}", file=sys.stderr)
            sys.exit(1)

        print(f"Publishing... job_id={job_id}")
        for _ in range(30):
            try:
                status = client.job_status(job_id)
            except StonlyError as exc:
                print(f"ERROR: job status check failed: {exc}", file=sys.stderr)
                sys.exit(1)

            state = status.get("status", "").lower()
            if state == "done":
                print(
                    f"Published! Guide: https://support.carta.com/kb/guide/en/"
                    f"glossary-of-terms-for-carta-equity-reports-{args.guide_id}"
                )
                break
            if state == "failed":
                print(f"ERROR: publish job failed: {status}", file=sys.stderr)
                sys.exit(1)
            time.sleep(2)
        else:
            print("ERROR: publish job timed out after 60s", file=sys.stderr)
            sys.exit(1)


if __name__ == "__main__":
    main()
