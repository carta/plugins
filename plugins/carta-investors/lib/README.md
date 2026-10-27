# Shared library for carta-investors skill scripts

Plumbing that more than one skill needs. Import it instead of writing your own.

## Modules

| Module | Use it for |
|---|---|
| `live_artifact_render` | `js_safe_json`, `check_path_under_cwd`, and the input-shape regexes `UUID_RE`, `MCP_SERVER_RE`, `ARTIFACT_ID_RE`, `CARTA_ID_RE`, `BASE_URL_RE`. |
| `live_artifact_render.customizations` | `stamp_baseline` for a render script's last step; `diff`, `release_changes` and `plan` to find what a user changed on a published page and where it collides with a new build; `rebase` and `unwrap` to write a saved live page back out for republishing. Skills run it through a `scripts/customizations.py` wrapper; `references/keep-customizations.md` is the procedure. |
| `carta_storage` | `is_carta_bucket(urlsplit(url))`: whether a URL is on one of Carta's document buckets. The firm-document upload and download scripts run pre-approved and use it as their guard on where a file goes; the download script also accepts `documents.carta.com`. Load it with the preamble below, anchoring on `carta_storage.py`. |
| `claude_chat_session` | The interactive `claude -p` stream-json session a skill's in-app chat feature uses: `build_argv`, `ChatSession`, `parse_event`/`event_text`/`is_turn_end`, `anchor_preamble` (a pinpoint selection → prompt preamble), and the `CLAUDE_MODELS`/`DEFAULT_MODEL`/`ALLOWED_MODEL_VALUES` catalog served to the browser's model picker. A consuming skill keeps a thin `chat_session.py` wrapper of its own that supplies its system-prompt note, its `claude_bin` default resolution, and its anchor's `context_keys`/`strip_prefix` — see `carta-manco-reporting/scripts/chat_session.py` for a worked example, including why its `ChatSession` subclass overrides only `__init__` (so a test that patches the wrapper's own `build_argv` still reaches `ChatSession.start()`). |

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

Most of these helpers are exercised indirectly through each consumer's own
tests (e.g. `test_spa_audit_live_artifact.py`, `test_co_investors_live_artifact.py`,
`test_render_artifact.py` for SOI) rather than through a dedicated unit-test
module. `claude_chat_session` is the exception: `tests/carta-investors/test_claude_chat_session_lib.py`
tests it directly, since a protocol/argv regression there would otherwise only
surface through whichever consumer's own tests happen to cover that code path.
