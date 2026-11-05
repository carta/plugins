# LP Summary usage tracking

These events answer the adoption questions: which firms built an LP Summary (from chat or
from Carta Home), which builds finished, and who came back to the page and used it — picked
an LP, switched to the table, filtered, or exported profiles.

Nothing here carries an LP, fund or firm name, an amount or typed text. Every id is a fixed
label. Tracking never blocks the skill or the page: a failed checkpoint or event is
skipped. Leave staff and demo accounts out of adoption numbers (`IS_STAFF_USER`,
`IS_DEMO_ACCOUNT` on the MCP tables; `IS_STAFF` on the Snowplow events).

## Skill checkpoints

Sent by the skill through carta-mcp's `skill_checkpoint`, as
`skill_name="carta-investors:carta-lp-summary"`. The first four count build runs only (a
first build or a refresh); a request to brand a page that already exists sends only its
source checkpoint. Each fires at most once per run, and a build run that sent `skill_started`
ends in exactly one of `skill_finished` or `skill_failed`.

| Checkpoint | Meaning |
|---|---|
| `skill_started` | The Carta connector answered `welcome`; a build or refresh has begun. Branding an existing page doesn't send it |
| `data_checked` | The firm's LP tables resolved and it has active limited partners |
| `skill_finished` | A build or refresh published the page. A branding republish doesn't send it |
| `skill_failed` | A build or refresh stopped after `skill_started` and before `skill_finished`, at any step. Stops before it (no connector, `welcome` fails) send nothing |
| `brand_source_website` | Branding was taken from the firm's website |
| `brand_source_deck` | Branding was taken from a deck the user dropped in |

## Page events

Sent by the published page through the shared UI tracker (`trackUi`, relayed by the Carta
connector's `track_ui_event` tool). Every id starts with `LPSummary.`. A page published
without the tracker sends nothing.

| Event | Action | Meaning |
|---|---|---|
| `LPSummary.View.FromHome` / `.FromChat` | render | The page loaded; built by Carta Home or from a chat request |
| `LPSummary.Empty` | render | The page loaded with no limited partners to show |
| `LPSummary.Unavailable.LoadError` | render | The page couldn't load its data |
| `LPSummary.Update.Show` / `.Dismiss` | render / click | The "newer version" banner showed / was dismissed |
| `LPSummary.View.Switch.<list\|table>` | click | Switched between list and table view |
| `LPSummary.List.PickLP` | click | Picked an LP in the list (value: its position) |
| `LPSummary.List.Search` | click | Started typing in the LP filter (once per page load) |
| `LPSummary.List.Resize` | click | Resized the list pane |
| `LPSummary.Header.Overview.Reopen` | click | Unfolded the collapsed overview header |
| `LPSummary.Detail.Back` | click | Went back from an LP's detail |
| `LPSummary.Detail.Contacts.Open` | click | Opened an LP's contacts |
| `LPSummary.Detail.CopyEmail` | click | Copied a contact's email |
| `LPSummary.Detail.WireStatus.Jump` | click | Jumped from the wire pill to the LP's wire details |
| `LPSummary.Detail.Positions.More` | click | Showed all of an LP's fund positions |
| `LPSummary.Exposure.Mode.<mode>` | click | Switched exposure between company, sector and geography |
| `LPSummary.Exposure.Fund.Open` / `.Pick` | click | Opened / picked from the exposure fund menu |
| `LPSummary.Exposure.Row.Expand` | click | Expanded an exposure row |
| `LPSummary.Exposure.ShowAll` | click | Showed every exposure row |
| `LPSummary.Filter.Open` / `.Clear` | click | Opened / cleared the filter menu |
| `LPSummary.Filter.Attention.On` / `.Off` | click | Turned the "wires need review" filter on / off |
| `LPSummary.Filter.Fund.Pick` / `.Remove` | click | Added / removed a fund filter |
| `LPSummary.Table.Sort.<column>` | click | Sorted the table by a column |
| `LPSummary.Table.Expand` / `.ExpandAll` / `.More` | click | Expanded a table row / every row / more of a row's funds |
| `LPSummary.Table.Select` | click | Ticked an LP in the table |
| `LPSummary.Table.OpenLP` | click | Opened an LP's detail from the table |
| `LPSummary.Export.Open` | click | Opened the Export dialog (value: LPs already ticked) |
| `LPSummary.Export.SelectAll` | click | Ticked every LP in the dialog |
| `LPSummary.Export.Template.<template>` | click | Switched the PDF template (firm or Carta) |
| `LPSummary.Export.Go` / `.GoCombined` | click | Exported separate PDFs / one combined PDF (value: LP count) |
| `LPSummary.Export.Done` / `.Failed` / `.Declined` | render | The export finished / failed / was refused by the host |
| `LPSummary.Export.Close` | click | Closed the dialog without exporting |
| `LPSummary.Brand.CopyPrompt` | click | Copied the "Brand my LP profiles" setup prompt |
