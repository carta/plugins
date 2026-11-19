# Check record

The list of documents seen at the last check of a fund, year and area. The next check
compares against it to say what's new. `carta-investors:carta-audit`,
`carta-investors:carta-audit-whats-new` and the area picker in
`carta-investors:carta-audit-download` read and write the same record, so any of them
counts as "the last check".

## Where it lives

```
${CLAUDE_PLUGIN_DATA}/manifests/<fund_uuid>__<audit_year>__<audit_area-or-all>.json
```

Use `all` when the check covers the whole fund rather than one area.

`${CLAUDE_PLUGIN_DATA}` is the plugin's data folder on this machine, kept across plugin
updates. Never write the record under `${CLAUDE_PLUGIN_ROOT}`: that folder belongs to
one installed version, so an update leaves the record behind and every fund looks like
a first check again.

The record isn't shared across machines, users, or Claude clients without filesystem
access.

## Reading it

```bash
mkdir -p ${CLAUDE_PLUGIN_DATA}/manifests
```

`Read` the file at the path above. A "file not found" means no earlier check exists for
this combination, which is expected on a first check, not a failure. Treat it, and any
other read failure, as an empty `{"documents": {}}`.

`Read` succeeds even on a corrupt file, so check the content too: if it doesn't parse
as `{"documents": {...}}`, treat it as missing.

Never surface a file-level error to the caller. From their side this is simply a first
check.

### What counts as new

A document is new when its `id` isn't in its record. Decide the first check per
record — fund, year and area, or `all` — so a record that doesn't exist yet is on its
first check, and none of its documents count as new. A fund or year never checked
before then doesn't make every one of its documents look new. When every record in
view is on its first check, show no new counts at all and add one line: "Next time
I'll show what's been added since today." A skill that gives its own first-check
message uses it instead of this line. When only some records are on their first check,
add one line naming the funds and years whose documents aren't compared yet.

## Writing it

`Write` the current list, whether or not anything changed, so the next check starts
from today:

```json
{"documents": {"<id>": {"name": "<name>", "state": "<state>"}, "...": {}}}
```

Collect every page of the listing first (`has_next` / `after`). A partial record makes
later-page documents look new next time.

Write a whole-fund (`all`) record only when the listing covered every area: one call
with `audit_area` left out does, and a per-area listing does only when all seven areas
listed. An area that failed or was denied counts as not listed. A record missing an
area would make that area's documents all look new next time.

**Don't write it when the listing failed** with zero documents for the fund or a
permission error. An access failure isn't a real state worth comparing against later.
