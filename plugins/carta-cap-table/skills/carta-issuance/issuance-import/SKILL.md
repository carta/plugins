---
name: carta-cap-table:issuance-import
description: >-
  Internal file-ingest sub-skill for carta-issuance. Turns an uploaded
  spreadsheet (.xlsx/.xlsm/.csv/.tsv) or document (.pdf/.docx) into the
  `knowns.rows` the config panel already consumes, for both certificates and
  option grants. Not invocable directly — dispatched by carta-issuance
  Phase 0.25.
owner: carta-cap-table maintainers (#cap-table-eng)
allowed-tools: []
---

<!-- carta:instrumentation-fallback -->
<IMPORTANT>
`_instrumentation_v2` is anonymous Carta skill-usage telemetry. ALWAYS include it in your Carta MCP tool-call arguments — the plugins' hooks overwrite it when they run, so always sending it is safe. Shape:
`_instrumentation_v2: {"skills": ["<plugin>:<skill>", ...], "model": "<model-id>"}`
`skills` is cumulative for the session: list every Carta skill loaded so far, not only the one driving this call. Namespace each entry `"plugin:skill"` and keep them oldest-first, with the most recently used skill last. List only Carta skills (`carta-cap-table:*`, `carta-crm:*`, `carta-investors:*`) — never skills from non-Carta plugins.
</IMPORTANT>

# issuance-import

Reads a file the admin already has — typically the Carta importer template they
downloaded from the app — and hands `carta-issuance` Phase 0.5 a prefilled
`knowns.rows`. The file feeds the **front** of the existing pipeline; it does not
add a path around any gate. Phase 1 still resolves stakeholders, Phase 1.5 still
saves and validates, Phase 2 still reviews, Phase 3 is still the only mutate.

**Do not invoke this skill directly.** Dispatched by `carta-issuance`
[Phase 0.25](../SKILL.md#phase-025--ingest-an-uploaded-file).

## References

| File | Purpose |
|---|---|
| `scripts/parse_upload.py` | **Does the parsing.** Header detection, column mapping, value coercion, `security_type` detection, and local name→id resolution. The model never hand-parses a workbook — a hand-read column is exactly how a quantity lands in an exercise-price field. |
| `references/column-map.md` | The header synonyms and value picklists as documentation, for humans and for `carta-modify-issuables` to reuse rather than fork. |

## Two rules the script exists to enforce

1. **Unresolved is blank, never guessed.** A `Vesting Schedule` or `Share Class`
   cell that doesn't match a real record exactly (case- and
   punctuation-insensitively) leaves the field **unset** and records an
   `import_notes` entry. There is deliberately no fuzzy matching: an
   almost-match issues genuinely wrong terms, and unlike a bad quantity the
   server cannot catch it. Do not add fuzzy fallback later without a
   product decision.
2. **Nothing is dropped silently.** Unmapped columns, skipped rows, and
   uncoercible cells all land in `_import_report.json`, and per-field in each
   row's `import_notes`. A dropped `Exercise Price` column is a wrong-priced
   grant the user has no way to notice.

## Usage

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-issuance/issuance-import/scripts/parse_upload.py" \
  --file "<path>" \
  [--sheet "<sheet name>"] \
  [--reference "$OUT_DIR/_data.json"] \
  --out-dir "$OUT_DIR"
```

- `--sheet` — only needed when the workbook has more than one importable sheet
  (the script exits 2 with `CANDIDATES=[…]`; ask which, then re-run).
- `--reference` — the **same JSON `build_config.py` takes as `--data`**: raw MCP
  section envelopes plus `stakeholders`. Pass it to get ids resolved in the same
  run. Omit it and every name comes back as an `import_notes` entry with the
  field left blank, which is correct but makes the admin re-pick by hand — so
  pass it whenever Phase 0.5's fetches have landed.

### Output

| File | Contents |
|---|---|
| `_import_knowns.json` | `{security_type, rows, equity_plan_id?, batch_errors?}` — merge `rows` into your `_knowns.json` |
| `_import_report.json` | `{mode, source_file, sheet, row_count, unmapped_columns, skipped_rows, plan_name, batch_errors, notes_by_row}` |
| `_import_text.txt` | Document mode only — extracted text |

stdout is `KEY=value` lines (`IMPORT_KNOWNS`, `IMPORT_REPORT`, `ROW_COUNT`,
`SECURITY_TYPE`). Exit 0 parsed, exit 2 nothing usable — the stderr line says
which (`ERROR:` or `AMBIGUOUS:` plus `CANDIDATES=`).

## Spreadsheet mode

Deterministic end to end.

- **Header row** — scanned across the first 6 rows, taking whichever maps the
  most known columns. Carta's importer template puts a paragraph of instructions
  in row 1 and the real headers in row 2, so assuming row 1 reads prose as
  column names. Needs ≥3 recognizable headers to count as a header row at all.
- **`security_type`** — decided by header signature first (`Exercise Price` /
  `Equity Plan Name` / `Document Set` → `option_grant`; `Share Class` /
  `Legend` / `Rule 144 Date` → `certificate`), sheet name only as a tiebreak.
  Generic headers (`Quantity`, `Email`) are deliberately not signals.
- **Multiple importable sheets** → `AmbiguousInput`, never a guess and never a
  merge. A batch is one security type (carta-issuance Hard rule 2).
- **Values** — dates to `YYYY-MM-DD`; numbers stripped of thousands separators,
  currency symbols and parenthesised negatives; `Individual` / `Non Individual`
  to `INDIVIDUAL` / `NON-INDIVIDUAL` (**hyphen** — matches
  `build_config.py`'s `STAKEHOLDER_KIND_CHOICES`, not the Django enum);
  relationship, option type and grant reason matched exactly against the
  panel's own picklists.
- **Out-of-scope rows skipped, not coerced.** An importer sheet can carry RSUs,
  SARs, CBUs, warrants, RSAs, convertibles. Those rows are skipped with a reason
  naming the Drafts UI — never reshaped into a grant of a different type.
- **Multiple equity plans in one sheet** → a `batch_errors` entry. A draft set
  is locked to one plan server-side, so this has to surface before the panel
  rather than failing at Phase 1.5.

## Document mode (`.pdf` / `.docx`)

The script extracts text and **stops**. It does not build rows from prose.

A signed grant doc or board consent has no fixed layout, so turning it into rows
is a judgement call — doing it in the script would mean guessing silently, which
is rule 2 inverted. So: read `_import_text.txt`, write the rows yourself **in
this script's own row schema**, and mark every field you filled this way with an
`import_notes` entry carrying `"confidence": "low"`. The panel renders those as
needs-confirmation, so a misread date is something the admin sees rather than
something that issues.

If the text comes back empty the file is a scan — the script exits 2 saying so.
Route the admin to OCR it or type the values into the panel; never infer values
from a filename.

## Row schema

The keys are exactly the ones `build_config.py` reads off a `knowns.rows` entry —
`ROW_KEYS` in `parse_upload.py` is the authoritative list, and
`test_rows_only_carry_keys_build_config_reads` fails if a stray key creeps in
(it would survive into the `save_drafts` payload and be rejected server-side).

Two additions beyond that list:

| Key | Meaning |
|---|---|
| `row_key` | Positional `r0`, `r1`, … — same contract `build_config.py` stamps, so Phase 1.5 can re-match a row to its `draft_pk` |
| `import_notes` | `[{field, raw_value, reason}]` — display-only. **Never** send to any mutate; `scripts/serialize_drafts.py` strips it at the payload boundary |

Dates in a row are **always ISO** (`YYYY-MM-DD`) — that is what `<input type="date">` accepts
and reads back. Three of them (`grant_expiration_date`, `vesting_start_date`, `rule_144_date`)
are `CharField`s the API only takes as `MM/DD/YYYY`; `serialize_drafts.py` converts them on the
way out. Do not emit `MM/DD/YYYY` here — it would break the panel.
