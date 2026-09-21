---
name: carta-cap-table:issuance-import
description: >-
  Internal file-ingest sub-skill for carta-issuance. Turns an uploaded
  spreadsheet (.xlsx/.xlsm/.csv/.tsv) or document (.pdf/.docx) into the
  `knowns.rows` the config panel already consumes, for certificates,
  option grants and profits interest units. Not invocable directly —
  dispatched by carta-issuance Phase 0.25.
owner: carta-cap-table maintainers (#cap-table-eng)
allowed-tools: []
---

<!-- carta:plugin-version -->
<carta-plugin>carta-cap-table:6.86.0</carta-plugin>

# issuance-import

Reads a file the admin already has — typically the Carta importer template they
downloaded from the app — and hands `carta-issuance` Phase 0.5 a prefilled
`knowns.rows`. The file feeds the **front** of the existing pipeline; it does not
add a path around any gate. Phase 1 still resolves stakeholders, Phase 1.5 still
saves and validates, Phase 2 still reviews, Phase 3 is still the only mutate.

**Do not invoke this skill directly.** Dispatched by `carta-issuance`
[Phase 0.25](../references/engine.md#phase-025--ingest-an-uploaded-file).

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

## Running the phase — step by step

`carta-issuance` [Phase 0.25](../references/engine.md#phase-025--ingest-an-uploaded-file) hands you the
whole ingest and expects `knowns.rows` back. These are its steps; nothing here is repeated in
`SKILL.md`, so work through them in order and return to [Phase
0.5](../references/engine.md#phase-05--configure-the-issuance) at the end.

### Step 0 — Confirm you can actually run the parser

The parser is a local script, so this phase needs `Bash(uv run *)`. **Check your own tool
surface for Bash before promising an import** — it is present on the Code adapter and is not
guaranteed on Cowork.

No Bash → **do not hand-read the file.** Reading a workbook by eye is the failure this whole
phase exists to prevent, and offering it as a fallback would make the parser's guarantees
optional. Say so and route to the feature built for this:

> *"I can't read spreadsheets in this session. Two options: import it directly in Carta's Drafts
> UI, which takes this same template — or paste the rows here as text and I'll set them up."*

Pasted-as-text rows are fine: they arrive in the prompt, so the ordinary prompt-driven flow
handles them with the user's own values in plain sight. That is different in kind from silently
parsing a binary nobody can see.

### Step 1 — Locate the file

Take the path straight from the prompt; a pasted `~/Downloads/…` path is the norm. Only if the
user said "the attached file" with no path, list the likely directories (`ls -t ~/Downloads`,
`~/Desktop`, the cwd) and look for a supported extension recently modified. Zero or several
plausible matches → `AskUserQuestion` which one (allowed by engine rule 5's file carve-out).
`Bash(find *)` is deliberately not granted to this skill — use `ls`.

### Step 2 — Parse, before spending any round trip

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-issuance/issuance-import/scripts/parse_upload.py" \
  --file "<path>" --out-dir "$OUT_DIR"
```

This first run is deliberately **without** `--reference`: it costs nothing, and its output tells
you the two things Phase 0.5's fetches need — the `security_type` and the names in the file. It
prints `SECURITY_TYPE=`, `ROW_COUNT=`, and the paths it wrote.

- **Exit 2 with `AMBIGUOUS:` + `CANDIDATES=[…]`** — the workbook has more than one importable
  sheet. `AskUserQuestion` which, then re-run with `--sheet "<name>"`. **Never merge two
  sheets into one batch** (carta-issuance hard rule 1) and never pick for the user.
- **Exit 2 with `ERROR:`** — nothing usable. Surface the message verbatim and fall back to the
  ordinary prompt-driven flow; do not guess at rows.

**Reconcile `security_type` with the prompt.** File and prompt disagreeing is a real fork →
`AskUserQuestion`. The file wins only when the prompt never said.

### Step 3 — Fetch reference data (Phase 0.5's fetches, informed by the file)

Run [Phase 0.5](../references/engine.md#phase-05--configure-the-issuance)'s fetches exactly as documented, with
`issuance_init`'s `security_type` now supplied by the file. The roster half follows the adapter
you selected in [Pick the surface](../SKILL.md#pick-the-surface):

- **Cowork** — pass `stakeholder_names` covering **the names the file contains** rather than
  the names the prompt named, which keeps the lookup bounded by the file's row count instead of
  roster size. Pass the whole list at once; a 40-row sheet resolved through a concatenated
  `search=` matches **nobody** and would create 40 duplicate stakeholders on a real cap table.
- **Code** — no names, full roster, exactly as [engine.md's Step
  1](../references/engine.md#step-1--what-the-surface-selection-changes-before-your-first-carta-call)
  says. The file's names change
  nothing here.

**The [account-setup gate](../references/engine.md#account-setup-gate-option-grant-and-piu) still applies.** Having a
parsed file in hand is not a reason to push past it: a corp with no option-grant document set
cannot issue one, whether the rows came from a spreadsheet or from the prompt. Stop where the
gate says to stop — the parsed rows cost nothing and the file is still there afterwards.

### Step 4 — Re-run the parser to resolve names to ids

```bash
uv run "…/parse_upload.py" --file "<path>" [--sheet "<name>"] \
  --reference "$OUT_DIR/_data.json" --out-dir "$OUT_DIR"
```

`--reference` is the same `_data.json` you just built for the surface's builder script. The
parser matches the file's free text against it — vesting schedule, acceleration terms, share
class (by name **or** prefix), legend (by code or name), document set, equity plan, and the
roster — and writes `_import_knowns.json`. A cell matching nothing leaves its field **unset**
with an `import_notes` entry; there is no fuzzy matching, and do not add any by hand.

On Code the roster is in its own file rather than in `_data.json`, so the parser resolves
everything except the roster pre-fill. Nothing is lost: the panel auto-fills email, stakeholder
type and relationship from `STAKEHOLDER_LIST_JSON` on an exact name match, and Phase 1
re-resolves all three authoritatively either way.

### Step 5 — Merge into `knowns` and open the surface

`_import_knowns.json` holds `{security_type, rows, equity_plan_id?, batch_errors?}`. Its `rows`
**are** your `knowns.rows` — merge them in and continue into Phase 0.5 unchanged. The row count
comes from the file, so engine rule 5's quantity-vs-headcount heuristic doesn't apply here (a
40-row sheet is unambiguously 40 blocks). Carry `batch_errors` through to the surface's
panel-level banner, and hold `equity_plan_id` for the first mutate only.

Each row may carry `import_notes` — `[{field, raw_value, reason}]`, **display-only**. The
surface must both **show every note against the field it names** and **render that field with
nothing selected**, so its own readiness check blocks submission until the admin picks. A
marker alone is ignorable; the blocked button is what actually prevents a silent wrong
issuance. Both builder scripts do this for you straight from `row.import_notes` — put the notes
on the rows in `knowns` and the form does the rest
([cowork-adapter.md § Import markers](../references/cowork-adapter.md#import-markers-uploaded-file-rows),
[code-adapter.md §0](../references/code-adapter.md#0-phase-overrides--what-differs-from-the-core)).

**Strip `import_notes` before any mutate** — same discipline as the review-only fields
([Build the mutate payload](../references/engine.md#build-the-mutate-payload-from-your-phase-1-resolved-rows)).
The server rejects unknown keys.

### Step 6 — Say what happened, in one line, before the surface opens

Read `_import_report.json` and report totals — never silently drop a column or a row. A dropped
`Exercise Price` column is a wrong-priced grant the user has no way to notice.

> *"Read 38 rows from Q3-grants.xlsx. State of Residency and Employee ID aren't fields this
> flow sets, and 3 values I couldn't match are flagged in the form — everything else is filled
> in. Review and submit when ready."*

**Name the skipped rows and the unmapped columns, not just their counts.** Rows this skill
can't issue (RSUs, SARs, CBUs, warrants, RSAs, convertibles) are skipped by the parser with a
reason and need the Drafts UI — an admin who thinks a 40-row sheet issued 40 securities when it
issued 37 has been misled. `unmapped_columns` holds the headers this skill has no field for;
several ([cowork-adapter.md](../references/cowork-adapter.md#fields) lists them) are dropped by
design, and *"2 columns I couldn't map"* leaves an admin who deliberately filled one in
believing it landed. Say which: *"State of Residency and Employee ID aren't fields this flow
sets — add them on the stakeholder record in Carta."*

### Documents (`.pdf` / `.docx`)

Build the rows yourself per [Document mode](#document-mode-pdf--docx) below, then continue
from Step 3.

---

## Spreadsheet mode

Deterministic end to end.

- **Header row** — scanned across the first 6 rows, taking whichever maps the
  most known columns. Carta's importer template puts a paragraph of instructions
  in row 1 and the real headers in row 2, so assuming row 1 reads prose as
  column names. Needs ≥3 recognizable headers to count as a header row at all.
- **`security_type`** — decided by header signature first (`Exercise Price` /
  `Equity Plan Name` / `Document Set` → `option_grant`; `Share Class` /
  `Legend` / `Rule 144 Date` → `certificate`), sheet name only as a tiebreak.
  A **threshold** column decides `piu` outright, before that comparison: the PIU
  template also carries an equity plan and a document set, which would otherwise
  tie it with the grant signals.
  Generic headers (`Quantity`, `Email`) are deliberately not signals.
- **Multiple importable sheets** → `AmbiguousInput`, never a guess and never a
  merge. A batch is one security type (carta-issuance hard rule 1).
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

**Take only what the document states.** A grant agreement rarely names a vesting template by
the company's own template name, so leave `vesting_template_id` unset rather than inferring it
from prose like "vests monthly over four years" — that is the fuzzy match rule 1 forbids, done
by hand.

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
