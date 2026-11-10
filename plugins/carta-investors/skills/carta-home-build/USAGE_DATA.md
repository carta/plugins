# Carta Home usage tracking

These events answer the adoption questions: which firms opened Carta Home, which Home they
got (which dashboard cards had data for them), what they clicked, and who came back.

Every id is a fixed label: nothing carries a firm, fund, company or LP name, an amount or
typed text. A detail that varies (a version, a step, the cards shown) goes in the event's
`value`, which only a click carries. A *prompt* event is a click that also records the suggested prompt text. Tracking never blocks the page. Leave staff and demo
accounts out of adoption numbers (`IS_STAFF_USER`, `IS_DEMO_ACCOUNT` on
`CORE_MCP_TOOL_CALLED`, where these land as `track_ui_event` rows with interface
`carta-home`).

## Page

| Event | Type | Meaning |
|---|---|---|
| `CartaHome.View` | render | Home loaded |
| `CartaHome.View.Version` | click | `value` = the skill version the page was built with |
| `CartaHome.View.First` | render | First load in this browser |
| `CartaHome.View.Cards` | click | Every dashboard card the firm gets has loaded or failed, and the profile (`get_current_user`) has answered or failed. `value` = the cards shown, in order (`soi`, `perf`, `lp`, comma-separated), or `none`. A card whose query failed is shown with its error line, so it is in `value`; its `LoadError` event tells it apart from a card with data. Not sent when Carta isn't connected, there's no active firm, the profile never answers, or loading fails at the connector (`Unavailable.NoFirm`, `Unavailable.LoadError`) |
| `CartaHome.Unavailable.NoFirm` | render | No active firm in the viewer's Carta context |
| `CartaHome.Unavailable.LoadError` | render | Loading the firm's data failed at the connector |
| `CartaHome.Tab.<tab>` | click | Switched tab (Recommended, Directory) |

## Dashboard cards

A card whose query answers with no rows is hidden instead of shown blank. A card whose query fails stays, with an error line. Each sends one of these.

| Event | Type | Meaning |
|---|---|---|
| `CartaHome.SOI.Empty` | render | The investments query answered with no active investments, so the Schedule of investments card is hidden. Not sent when the query fails: the card stays with its error line and `SOI.LoadError` is sent |
| `CartaHome.SOI.LoadError` | render | The investments query failed; the Schedule of investments card stays and shows an error |
| `CartaHome.SOI.NewFund.Shown` | render | The SOI card's banner appeared for funds the published SOI page doesn't list. Sent once per page load for each different set of funds |
| `CartaHome.SOI.NewFund.Copy` | prompt | The banner's update prompt was copied (a `trackPrompt`, source `dashboard`, skill `carta-soi`). Carries the fixed text "Update my Schedule of Investments to add new funds", never fund names |
| `CartaHome.SOI.NewFund.Dismiss` | click | The banner was dismissed |
| `CartaHome.SOI.PartialScope` | render | The Schedule of investments card shows the "Carta administers N of your M funds" note, so Carta administers only part of the firm's funds. Not sent when the fund lookup fails: the note is hidden |
| `CartaHome.Perf.Empty` | render | The benchmark and fund metrics queries answered with no fund, so the Fund performance card is hidden. Not sent when either query fails without a fund to show: the card stays with its error line and `Perf.LoadError` is sent |
| `CartaHome.Perf.LoadError` | render | No fund could be shown because the benchmark or fund metrics query failed; the Fund performance card stays and shows an error |
| `CartaHome.LP.Empty` | render | A Fund Admin firm has no LPs to show, so the LP summary card is hidden |
| `CartaHome.LP.LoadError` | render | The LP query failed; the LP summary card stays and shows an error |
| `CartaHome.Dashboard.Open.<dashboard>` | click | Opened a built dashboard from its card |
| `CartaHome.Dashboard.CopyPrompt.<dashboard>` | prompt | Copied a dashboard's prompt from its card |
| `CartaHome.Customize.Open.<dashboard>` | click | Opened a card's customize options |
| `CartaHome.Customize.CopyPrompt.<dashboard>` | prompt | Copied a card's customize prompt |

## Capital activity

| Event | Type | Meaning |
|---|---|---|
| `CartaHome.CapActivity.ViewDetail` / `.CloseDetail` | click | Opened or closed a capital call or distribution's detail |
| `CartaHome.CapActivity.Dismiss` | click | Hid a card for this session |
| `CartaHome.CapActivity.Remind` / `.Remind.Send` | click | Started and sent a reminder to one LP. `Remind` carries `value` = `send`, or `resend` for an LP already reminded |
| `CartaHome.CapActivity.BulkNotify` / `.BulkNotify.Continue` / `.BulkNotify.Send` | click | Started, continued and sent a reminder to several LPs. `Continue` and `Send` carry `value` = how many were selected |
| `CartaHome.CapActivity.PreviewEmail` | click | Previewed a reminder email |

## Prompts, directory and What's new

| Event | Type | Meaning |
|---|---|---|
| `CartaHome.Capabilities.CopyPrompt` | prompt | Copied a "Suggested for you" prompt |
| `CartaHome.PromptPopover.Copy` | prompt | Copied a prompt after filling in its details |
| `CartaHome.RunPrompt[.<Skill>]` | prompt | Ran a prompt from Home; the suffix is the button's skill, when it has one |
| `CartaHome.Directory.Published` | render | The Skill Directory loaded its published list |
| `CartaHome.Directory.View.<source>.<counts>` | render | The Skill Directory rendered (where its list came from, and its size) |
| `CartaHome.Directory.<action>` | click | Used the Skill Directory |
| `CartaHome.Directory.Copy.<skill>` | prompt | Copied a skill's prompt from the Skill Directory |
| `CartaHome.WhatsNew.Select.<item>` | click | Picked a What's new item |
| `CartaHome.WhatsNew.Copy.<item>` | prompt | Copied a What's new item's prompt or set-up command |
| `CartaHome.WhatsNew.Unlock.<item>` | click | Opened a locked What's new item's unlock link |
| `CartaHome.WhatsNew.MicroappHelp` | click | Opened "What's a microapp?" |
| `CartaHome.CustomerStories.ReadMore` | click | Opened a customer story |

## Tour and updates

| Event | Type | Meaning |
|---|---|---|
| `CartaHome.Tour.Start` | click | The first-run tour opened |
| `CartaHome.Tour.Next` / `CartaHome.Tour.Skip` | click | `value` = the step number the viewer saw |
| `CartaHome.UpdateBanner.Shown` | render | A newer Home is available, and the banner showed |
| `CartaHome.UpdateBanner.Copy` | prompt | Copied the update prompt |
| `CartaHome.UpdateBanner.Dismiss` | click | Dismissed the update banner |
