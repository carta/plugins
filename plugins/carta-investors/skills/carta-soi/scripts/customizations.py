# /// script
# requires-python = ">=3.9"
# ///
"""Find what a user changed on their published page, or stamp a page with a baseline.

The logic lives in the plugin's shared lib (lib/live_artifact_render/customizations.py);
this wrapper only puts it on the path so a skill can run it by its own script path.
"""
import sys
from pathlib import Path

_LIB = next(p for p in Path(__file__).resolve().parents if (p / "lib" / "live_artifact_render").is_dir()) / "lib"
sys.path.insert(0, str(_LIB))

from live_artifact_render.customizations import main  # noqa: E402

if __name__ == "__main__":
    main()
