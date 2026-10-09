# Artifact output — Waterfall Modeling

Canonical spec for publishing the results page when `<SURFACE>` is `chat` and the `Artifact`
tool is in your tool list. The run flow lives in `SKILL.md`; the fetch loop in the command's
results doc. This file covers only the build, the publish and the reply. One new page per run;
write nothing between tool calls.

## Build

Once per run, after the results doc's fetch loop holds every entity's pages. `<slug>` is the
company name lowercased with non-alphanumerics collapsed to `-`. Pass every value as **one JSON
object in a file** — never as `--flag` arguments. First `Write` the object to
`<outputs-directory>/waterfall-<slug>-<execution_id>.json`, exactly in this shape:

```
{
  "owner_kind": "FIRM",
  "owner_id": "<org_pk from Step 1>",
  "target_kind": "<locked from Step 2>",
  "target_id": "<locked from Step 2>",
  "execution_id": "<locked from Step 5>",
  "get_command": "<get_command from Step 3, exactly>",
  "target_name": "<company name from Step 2>",
  "root_name": "<root.name, else the company name>",
  "is_multi_entity": <true or false, from Step 3>,
  "inputs": [ {"label": "<label>", "display_value": "<what the review showed>"} ],
  "equity_value": "<EQUITY_VALUE as the raw decimal you sent in Step 5>",
  "waterfall_date": "<WATERFALL_DATE, ISO>",
  "currency": "<currency from Step 3>",
  "base_url": "<base_url from get_current_user>",
  "entities": [
    {"display_name": "<name>", "is_root": true, "allocations": [ … ], "breakpoints": [ … ], "grand_totals": { … }}
  ]
}
```

Then build, on one line, exactly as written. `allowed-tools` matches the command text, so a
shell variable, a different path, or a line break makes the call ask for approval:

```
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-waterfall-modeling/scripts/build_artifact.py" --config "<outputs-directory>/waterfall-<slug>-<execution_id>.json" --out "<outputs-directory>/waterfall-<slug>-<execution_id>.html"
```

- Escape a `"` or `\` inside a value as `\"` / `\\` (it is JSON).
- `currency` — leave the key out when Step 3 returned none.
- `base_url` — the `base_url` field of `get_current_user`; reuse it if the session already called
  it, else call it once. Never type a host. If `get_current_user` fails, leave the key out.
- `inputs` — one `{"label", "display_value"}` per line of the Step 5 pre-run review other than the
  company: `label` is the input's `label` from Step 3, `display_value` the text the user saw. Add
  nothing the review did not show.
- `entities` — the results doc's `per_entity`, in `ordered` order (root first, `is_root: true` on
  it only). `allocations` is every accumulated `BY_HOLDER` row, verbatim, in page order;
  `breakpoints` the cached array, or `null` when unavailable this run; `grand_totals` verbatim.
  `core_results` → one entity: `display_name` the company name, `is_root: true`.

> **Path.** Bash reaches the `${CLAUDE_PLUGIN_ROOT}` path above on Claude Code and Cowork; do
> not search for it first. Only if `uv run` reports that the file does not exist, find the
> script once (this call asks for approval) and run it from the path it prints:
> ```
> find /mnt/skills /sessions "$HOME" -type f -path '*carta-waterfall-modeling/scripts/build_artifact.py' 2>/dev/null
> ```

The script prints the output path. Never copy the skill folder, edit a file inside it, or
hand-edit the HTML; if the build fails, fall back (below).

## Publish

```
Artifact({
  file_path: "<path the build printed>",
  description: "Waterfall results for <company name>.",
  icon: "chart"
})
```

## Reply

The BLUF lead and the page link, nothing else. Use the single-entity lead in `SKILL.md`, or the
multi-entity one in the results doc's §BLUF lead ending _"Per-entity breakdown on the page."_
Render the equity value in Step 3's `currency` (e.g. `£1.00B`; `$` when absent). Then present the
follow-up menu.

**Batches** (several equity values on one date): build and publish one page per run, then list
the links together, each labelled by its equity value; one BLUF line per run.

**If the build or the publish fails**, say one line — _"Couldn't open the results page, so here
are the tables."_ — and render this run's allocations tables inline per the results doc from the
pages already fetched.
