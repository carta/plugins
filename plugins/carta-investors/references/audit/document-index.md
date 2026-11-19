# Document index — one file that lists everything a download run pulled

Auditors often feed a download into their own tools or agents. A folder of zips,
one per fund and area, is hard for those tools to read. So every download run that
exports anything also delivers `audit-document-index.csv`: one spreadsheet-readable
file covering every fund, year and area in the run.

## Columns, in this order

| Column | Value |
|---|---|
| `firm` | The firm's name |
| `fund` | The fund's name |
| `audit_year` | The audit year the run used |
| `audit_area` | The area's label from `audit-areas.md` (e.g. "Partners' Equity"), never the slug |
| `document_name` | The row's `name` |
| `document_type` | The row's `document_type` |
| `document_year` | The row's `year`, blank when null |
| `status` | The readiness label from `audit-areas.md` (e.g. "Ready"), never the raw `lifecycle_status` |
| `last_updated_in_carta` | The row's `updated_at` as an ISO date (`YYYY-MM-DD`), blank when absent |
| `document_id` | The row's `id`, so a tool can match rows across runs |

Use the ISO date here rather than the friendly date the chat shows, because tools
sort and compare it. Quote every field (`"…"`, with any `"` inside doubled), since
document names often contain commas.

## Building it as the list arrives

The rows reach you as `fa__list__audit-documents` responses, or from an earlier
skill's listing, so write each response's rows once, as it arrives, and never list anything a second time for the
index (rows listed before the caller chooses follow "Rows listed before a choice"
below instead):

1. Pick a folder for this run's parts, `/tmp/carta-audit-documents/index-<YYYYMMDD-HHMMSS>/`,
   so a previous run's parts never mix in. Write the header row to `0000.csv` there
   with `Write`.
2. For each list response, `Write` its rows to the next numbered part
   (`0001.csv`, `0002.csv`, …), at most 200 rows per part, so no single write grows
   with the fund's size.
3. After the last export, join the parts in order:

   ```bash
   cat /tmp/carta-audit-documents/index-<YYYYMMDD-HHMMSS>/*.csv > /tmp/carta-audit-documents/audit-document-index.csv
   ```

   Send that file in the same `SendUserFile` call as the zips.

## Rows listed before a choice

Sometimes the rows are listed before the caller chooses what to download — for a
picker of areas and document types, or for document types named in words — or they
arrive from an earlier skill's listing with no list response here at all. Then write
no parts as the rows arrive: keep them. Once the choice is made, write parts (same
numbering and 200-row limit) for exactly the rows the run exports; the calling
skill's export step says which rows those are. The index then lists what the run
pulled, never the rows the caller left out.

## Saying what it covers

The index lists the listed rows the run exported. Each zip also carries its own
`manifest.csv`, which says what is actually inside that zip. For Partners' Equity
the two can differ (see `audit-areas.md`), so say so in one line when the run
includes that area.

Fetch every page (`has_next`) before finishing the index. If paging stopped early for
any fund, year and area, name those combinations in one line in the chat, so nobody
takes the index as complete for them.

If the run can't write files (no file tools on this surface), skip the index and say
in one line that it wasn't produced.
