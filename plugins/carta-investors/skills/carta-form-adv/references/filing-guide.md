# Form ADV — Interactive Filing Guide

<!-- Design note: output format evolution
     v1: PDF (reportlab) + Excel (openpyxl) generators. Both required runtime `pip install`
     fallbacks that silently fail on Windows (sys.executable points to a uv-managed shim
     without a writable pip environment) and required users to navigate to a /tmp file path.

     v2 (current): HTML artifact as the primary output — zero Python dependencies, opens
     automatically in Claude Desktop's preview panel, works identically on macOS and Windows.
     Blue/orange badge system (Carta-filled vs. must-enter-in-IARD) is interactive in HTML.

     Excel is back (v2.1): form_adv_excel_generator.py uses PEP 723 inline metadata so
     `uv run` resolves openpyxl automatically — no pip fallback needed. Generated alongside
     the HTML artifact for users who prefer a spreadsheet they can annotate offline.
-->

After presenting the markdown output, automatically generate an interactive Form ADV filing guide as a self-contained HTML artifact.
Tell the user: *"Building your Form ADV interactive filing guide..."*

### Step 1 — Build the data file

Extract values from Query 1 and Query 2. Use the `Write` tool to create `{TMPDIR}/form_adv_data.json` where `TMPDIR` is the system temp directory (`/tmp` on macOS/Linux, `%TEMP%` on Windows — resolve with `python3 -c "import tempfile; print(tempfile.gettempdir())"`):

```json
{
  "firm_name": "<firm display name>",
  "reporting_date": "<YYYY-MM-DD>",
  "funds": [
    { "<all columns from each row returned by Query 1>" }
  ],
  "investor_demographics": {
    "<fund_uuid>": { "<all columns from Query 2 for that fund>" }
  }
}
```

Use actual query result values — no placeholders.

### Step 2 — Generate the artifact

```bash
TMPDIR=$(python3 -c "import tempfile; print(tempfile.gettempdir())")
uv run ${CLAUDE_PLUGIN_ROOT}/skills/carta-form-adv/scripts/generate_form_adv_artifact.py \
  --data "${TMPDIR}/form_adv_data.json" \
  --title "<FirmName> — Form ADV <Year>" \
  --out "${TMPDIR}/FormADV_<FirmName>_<Year>.html"
```

### Step 3 — Generate Excel filing reference

Run immediately after Step 2 (reuses the same JSON data file):

```bash
TMPDIR=$(python3 -c "import tempfile; print(tempfile.gettempdir())")
uv run ${CLAUDE_PLUGIN_ROOT}/skills/carta-form-adv/scripts/form_adv_excel_generator.py \
  --data "${TMPDIR}/form_adv_data.json" \
  --title "<FirmName> — Form ADV <Year>" \
  --out "${TMPDIR}/FormADV_<FirmName>_<Year>.xlsx"
```

Tell the user the file path:
> *"Your Form ADV Excel filing reference has been saved to `{TMPDIR}/FormADV_<FirmName>_<Year>.xlsx`. Open it in Excel or Google Sheets. Blue cells are pre-filled from Carta — orange cells must be entered manually in IARD. The **Manual Fields** sheet lists every field requiring manual entry, organized by ADV item."*

### Step 4 — Open in preview panel (Claude Desktop)

1. **Read** `.claude/launch.json` if it exists (parse it, keep existing configs). If absent, start with `{"version":"0.0.1","configurations":[]}`.

2. **Upsert** this configuration (add or replace any entry whose `name` starts with `carta-form-adv-`):

```json
{
  "name": "carta-form-adv-<firm_slug>",
  "runtimeExecutable": "uv",
  "runtimeArgs": [
    "run", "python",
    "${CLAUDE_PLUGIN_ROOT}/skills/carta-form-adv/scripts/preview_server.py"
  ],
  "autoPort": true
}
```

3. **Write** the merged config back to `.claude/launch.json`.

4. Call `preview_start` — Claude Desktop spawns the server and opens the panel.

5. Call `preview_list` — find the entry whose name matches `carta-form-adv-<firm_slug>`. Extract `port` and `serverId`.

6. Call `preview_eval` with `serverId` and:
```javascript
window.location.href = 'http://localhost:<port>/FormADV_<FirmName>_<Year>.html';
```

Tell the user:

> *"Your Form ADV interactive filing guide is open in the preview panel. It has three tabs: Firm Overview (Items 5.D, 5.F, 5.H), Per-Fund Detail (Schedule D §7.B.(1) for each fund, expandable), and an IARD Checklist. Blue badges are pre-filled from Carta — orange badges need to be entered manually in IARD. Use **Print / Save PDF** in the top right to export a PDF copy for your records."*

**Fallback (non-Desktop):** If `preview_start` is unavailable, tell the user the file path to open in their browser:
> *"Your filing guide has been saved to `{TMPDIR}/FormADV_<FirmName>_<Year>.html`. Open this file in your browser to view it. Use File → Print → Save as PDF to export."*
