# live_artifact_render — shared library for Live Artifact render-artifact.py scripts

Plumbing that more than one skill needs. Import it instead of writing your own.

## Modules

| Module | Use it for |
|---|---|
| `live_artifact_render` | `js_safe_json`, `check_path_under_cwd`, and the input-shape regexes `UUID_RE`, `MCP_SERVER_RE`, `ARTIFACT_ID_RE`, `CARTA_ID_RE`, `BASE_URL_RE`. |

## How to import it

A skill script runs standalone under `uv run`, which puts only the script's own
directory on `sys.path`. Add this preamble after your imports:

```python
_LIB = next(p for p in Path(__file__).resolve().parents if (p / "lib" / "live_artifact_render").is_dir()) / "lib"
sys.path.insert(0, str(_LIB))

from live_artifact_render import js_safe_json, check_path_under_cwd, UUID_RE  # noqa: E402
```

The walk-up works from any depth, so `carta-spa-audit/scripts/render-artifact.py`
(two levels under `plugins/carta-investors/`) and
`carta-portfolio-analytics-routing/references/soi/scripts/render-artifact.py`
(three levels under it) use the same two lines. It anchors on `__file__`, not
`$CLAUDE_PLUGIN_ROOT`, so it also works when a SKILL.md invokes the script by a
relative path.

Import only the names your script actually uses — `carta-soi`'s positional-arg
contract has no use for `CARTA_ID_RE` or `BASE_URL_RE`, so its script skips them.

## Two rules for the library itself

- **Stay Python 3.9-compatible.** Start every file with
  `from __future__ import annotations`. No `match`, no `datetime.UTC`. A
  consumer script that declares no PEP 723 floor may run on the macOS system
  Python 3.9, and the root `CLAUDE.md` convention binds every module it imports.
- **No third-party imports.** Every function here is stdlib-only (`json`, `re`,
  `pathlib`), so importing this module never pulls in a dependency a
  CLI-only script wouldn't otherwise need.

## Tests

`tests/carta-investors/` exercises these helpers indirectly through each
consumer's own `render-artifact.py` tests (e.g. `test_spa_audit_live_artifact.py`,
`test_co_investors_live_artifact.py`, `test_render_artifact.py` for SOI) rather
than through a dedicated unit-test module for the library itself.
