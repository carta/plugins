# /// script
# requires-python = ">=3.9"
# ///
"""Print the link message for Carta's waterfall export once `export_status_command` is `complete`.

Reads one JSON object (a file the Write tool creates):

  {"company": "<company name>", "scenario": "<equity value, in a batch only>",
   "status": <the export_status_command response, verbatim>}

Usage:
  uv run scripts/export_link.py --config <path>.json

Prints the message; an `expires_at` it can't read counts as missing. Exits non-zero, printing nothing,
when the status isn't `complete` or carries neither `download_url` nor `report_url`.
"""
import argparse
import json
import sys
from datetime import datetime, timedelta
from typing import Optional

CONTINUE = "Tell me when you're ready to continue."
# Below this, the download link may lapse before the user clicks it, so only Carta's link is shown.
MIN_DOWNLOAD_WINDOW = timedelta(minutes=15)


def parse_instant(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        # Python 3.9's fromisoformat rejects a trailing "Z".
        parsed = datetime.fromisoformat(value[:-1] + "+00:00" if value.endswith("Z") else value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else None


def local_time(instant: datetime) -> str:
    local = instant.astimezone()
    hour = local.hour % 12 or 12
    return f"{hour}:{local:%M} {'AM' if local.hour < 12 else 'PM'} {local.tzname()}"


def message(company: str, status: dict, now: Optional[datetime] = None, scenario: Optional[str] = None) -> str:
    download_url, report_url = status.get("download_url"), status.get("report_url")
    if status.get("status") != "complete":
        raise ValueError("the export isn't complete")
    if not (download_url or report_url):
        raise ValueError("the export has neither a download link nor a Carta link")
    subject = f"{company} at {scenario}" if scenario else company
    expires_at = parse_instant(status.get("expires_at"))
    now = now or datetime.now().astimezone()
    if report_url and (not download_url or (expires_at and expires_at - now < MIN_DOWNLOAD_WINDOW)):
        return f"[Open Carta's waterfall export for {subject} in Carta]({report_url})\n\n{CONTINUE}"
    until = f"until {local_time(expires_at)}" if expires_at else "for a limited time"
    line = f"[Download Carta's waterfall export for {subject}]({download_url}). The link works {until}"
    line += f"; after that, [open it in Carta]({report_url})." if report_url else "."
    return f"{line}\n\n{CONTINUE}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--config", required=True)
    args = parser.parse_args()
    with open(args.config, encoding="utf-8") as f:
        config = json.load(f)
    try:
        print(message(config["company"], config["status"], scenario=config.get("scenario")))
    except (KeyError, TypeError, ValueError) as error:
        print(f"export_link: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
