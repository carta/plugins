# /// script
# requires-python = ">=3.9"
# ///
"""Load shared budget reports into a dashboard from a Claude session.

The app loads them through a background Claude session; when that can't run,
the skill does the same from chat: it calls the Carta commands itself, saves
their answers to a file, and this script checks and merges them exactly as the
in-app load would, then rebuilds the dashboard.

  import_shared_reports.py context --data-dir <dashboard_dir>
      → {"fund_uuid": ...}: the ManCo entity to pass to fa:get:budget_reports.
  import_shared_reports.py import --data-dir <dashboard_dir> --responses <file>
      <file>: {"list": <fa:get:budget_reports result>,
               "reports": {"<report_uuid>": <fa:get:budget_report result>, ...}}
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict

sys.path.insert(0, str(Path(__file__).resolve().parent))

import build_manco_datadir  # noqa: E402
import report_store  # noqa: E402
import share_ops  # noqa: E402
import share_bridge  # noqa: E402
from share_bridge import ShareError  # noqa: E402


class _Answers(object):
    """Stands in for the Carta bridge, answering from the saved responses."""

    def __init__(self, responses: Dict[str, Any]) -> None:
        self._list = responses.get("list")
        self._reports = responses.get("reports") or {}

    def call(self, command: str, arguments: Dict[str, Any], emit: Any) -> Any:
        if command == "fa__get__budget_reports":
            return _unwrap(self._list)
        if command == "fa__get__budget_report":
            return _unwrap(self._reports.get(arguments.get("report_uuid"))) or {}
        raise ShareError("unexpected command %s" % command, "failed")


def _unwrap(value: Any) -> Any:
    # Saved answers are the tool results as they came, parsed or not; the bridge reads both.
    if value is None:
        return None
    return share_bridge.unwrap(value if isinstance(value, str) else json.dumps(value))


def main() -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    ctx = sub.add_parser("context")
    ctx.add_argument("--data-dir", required=True)
    imp = sub.add_parser("import")
    imp.add_argument("--data-dir", required=True)
    imp.add_argument("--responses", required=True)
    args = ap.parse_args()
    data_dir = Path(args.data_dir).expanduser()
    try:
        if args.cmd == "context":
            print(json.dumps({"fund_uuid": share_ops.context(data_dir)["fund_uuid"]}))
            return 0
        responses = json.loads(Path(args.responses).expanduser().read_text())
        result = share_ops.pull(_Answers(responses), report_store.ReportStore(data_dir), data_dir,
                                lambda message: None)
        rebuilt, message = build_manco_datadir.rebuild(data_dir)
        if not rebuilt:
            raise ValueError(message)
    except ShareError as e:
        print(json.dumps({"status": "error", "message": str(e)}))
        return 1
    except (OSError, ValueError, KeyError) as e:
        print(json.dumps({"status": "error", "message": str(e)}))
        return 1
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
