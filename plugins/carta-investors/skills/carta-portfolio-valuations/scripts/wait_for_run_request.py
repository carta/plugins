# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""Wait for the dashboard's run request file, print it, and exit."""

import pathlib
import sys
import time

REQUEST = pathlib.Path(".claude/preview/run-request.json")
TIMEOUT_SECONDS = 1800


def main():
    for _ in range(TIMEOUT_SECONDS):
        if REQUEST.exists():
            print(REQUEST.read_text())
            return 0
        time.sleep(1)
    print("TIMEOUT")
    return 0


if __name__ == "__main__":
    sys.exit(main())
