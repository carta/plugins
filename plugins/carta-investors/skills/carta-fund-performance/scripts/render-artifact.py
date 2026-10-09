# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""Render the Fund Performance page: render-artifact.py <output> [--home-url <carta_home_url>]"""

import sys
from pathlib import Path

_LIB = next(p for p in Path(__file__).resolve().parents if (p / "lib" / "live_artifact_render").is_dir()) / "lib"
sys.path.insert(0, str(_LIB))

from live_artifact_render import CLAUDE_ARTIFACT_URL_RE, check_path_under_cwd  # noqa: E402

TEMPLATE = Path(__file__).resolve().parent.parent / "references" / "artifact.html"
PLACEHOLDER = "{{HOME_URL}}"


def main() -> int:
    args = sys.argv[1:]
    home_url = ""
    if len(args) == 3 and args[1] == "--home-url":
        home_url = args[2]
    elif len(args) != 1:
        print("usage: render-artifact.py <output> [--home-url <carta_home_url>]", file=sys.stderr)
        return 2

    if home_url and not CLAUDE_ARTIFACT_URL_RE.match(home_url):
        print(f"error: --home-url is not a claude.ai artifact URL: {home_url!r}", file=sys.stderr)
        return 1

    out_path = check_path_under_cwd(Path(args[0]), "output path")
    if out_path is None:
        return 1

    content = TEMPLATE.read_text(encoding="utf-8")
    if PLACEHOLDER not in content:
        print(f"error: template missing {PLACEHOLDER}", file=sys.stderr)
        return 1

    out_path.write_text(content.replace(PLACEHOLDER, home_url), encoding="utf-8")
    print(out_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
