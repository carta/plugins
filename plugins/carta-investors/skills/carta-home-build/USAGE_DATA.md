# Carta Home usage tracking

These events answer the adoption questions: which firms opened Carta Home, which Home they
got (which dashboard cards had data for them), what they clicked, and who came back.

Every id is a fixed label: nothing carries a firm, fund, company or LP name, an amount or
typed text. A detail that varies (a version, a step, the cards shown) goes in the event's
`value`, which only a click carries. A *prompt* event is a click that also records the suggested prompt text. Tracking never blocks the page. Leave staff and demo
accounts out of adoption numbers (`IS_STAFF_USER`, `IS_DEMO_ACCOUNT` on
`CORE_MCP_TOOL_CALLED`, where these land as `track_ui_event` rows with interface
`carta-home`).

## Connection states

A card whose data can't load shows a note in its data area naming the cause, with Try again or
Check again. When the whole Carta connection is gone (signed out, not added, or no Carta in the
view), one reconnect panel replaces the capital activity and dashboard sections. When the viewer
is signed out, it says to reconnect in Settings → Connectors → Carta; when Carta was never added
or isn't in the view, it says to add the Carta connector in Settings → Connectors. Both buttons
reload Home. The page sends these over the Carta connection, so with the connection gone they
arrive only when the host still relays UI events.

| Event | Type | Meaning |
|---|---|---|
| `CartaHome.Reconnect.Shown` | render | The reconnect panel replaced the Carta-data sections |
| `CartaHome.Reconnect.CheckAgain` | click | The viewer chose Check again on the reconnect panel |
| `CartaHome.CardNote.TryAgain` | click | Try again on a card that failed to load. `value` = the card (`soi`, `perf`, `lp`) |
| `CartaHome.CardNote.CheckAgain` | click | Check again on a card whose Carta tool is off, whose firm is missing, or whose Carta connector isn't chosen. `value` = the card |

## Page

| Event | Type | Meaning |
|---|---|---|
| `CartaHome.View` | render | Home loaded |
| `CartaHome.View.Version` | click | `value` = the skill version the page was built with |
| `CartaHome.View.First` | render | First load in this browser |
| `CartaHome.View.Cards` | click | Every dashboard card the firm gets has loaded or failed, and the profile (`get_current_user`) has answered or failed. `value` = the cards shown, in order (`soi`, `perf`, `lp`, `nda`, comma-separated), or `none`. A card whose query failed is shown with its note, so it is in `value`, except NDA insights, which hides on error; its `LoadError` event tells it apart from a card with data. Not sent when Carta isn't connected, there's no active firm, the profile never answers, the reconnect panel is shown, or loading fails at the connector (`Unavailable.NoFirm`, `Unavailable.LoadError`), unless a later load of the same page (on return, or Try again) gets every card |
| `CartaHome.View.LawOnly` | render | Once per page, a Carta Law firm (NDAs Carta has read, no Fund Admin) got the Law-only Home: NDA prompts, no What's new carousel, no Skill directory tab, a tour without capital activity or the directory. Counts Carta Law firms' Home opens |
| `CartaHome.Unavailable.NoFirm` | render | Once per page, the first time Home finds no active firm in the viewer's Carta context |
| `CartaHome.Unavailable.LoadError` | render | Once per page, the first time loading the firm's data fails at the connector, after Home's quiet retries for a passing failure |
| `CartaHome.Load.Recovered` | click | Home's data loaded after a failure. `value` = `<trigger>:<try>`: `open` (first open, after quiet retries), `focus` (the viewer came back to a Home that had failed) or `button` (Try again), and which try worked, e.g. `open:3`. A first-try load on open sends nothing |
| `CartaHome.Load.Failed` | click | Home's load ended on an error the viewer can see. `value` = what started it (`open`, `focus`, `button`). Only arrives when the connector still carries events, so it undercounts connector failures |
| `CartaHome.Tab.<tab>` | click | Switched tab (Recommended, Directory) |

## Dashboard cards

A card whose query answers with no rows is hidden instead of shown blank. A card whose query fails stays, with a note. Each sends one of these.

| Event | Type | Meaning |
|---|---|---|
| `CartaHome.SOI.Empty` | render | The investments query answered with no active investments, so the Schedule of investments card is hidden. Not sent when the query fails: the card stays with its note and `SOI.LoadError` is sent |
| `CartaHome.SOI.LoadError` | render | The investments query failed; the Schedule of investments card stays and shows a note |
| `CartaHome.SOI.FundOfFunds` | render | The firm is a fund of funds: it runs at least one entity of type `Fund`, and in one of its funds' reporting currencies at least `FOF_MIN_FUNDS` outside funds (not named like its own funds) hold at least `FOF_MIN_SHARE` of its value in that currency, not counting stakes in its own Carta funds. The Schedule of investments card lists the top `SOI_CARD_ROWS` of those outside funds, in that reporting currency, instead of its own funds |
| `CartaHome.SOI.NewFund.Shown` | render | The SOI card's banner appeared for funds the published SOI page doesn't list. Sent once per page load for each different set of funds |
| `CartaHome.SOI.NewFund.Copy` | prompt | The banner's update prompt was copied (a `trackPrompt`, source `dashboard`, skill `carta-soi`). Carries the fixed text "Update my Schedule of Investments to add new funds", never fund names |
| `CartaHome.SOI.NewFund.Dismiss` | click | The banner was dismissed |
| `CartaHome.SOI.PartialScope` | render | The Schedule of investments card shows the "Carta administers N of your M funds" note, so Carta administers only part of the firm's funds. Not sent when the fund lookup fails: the note is hidden. Not sent for a fund of funds either |
| `CartaHome.Perf.PartialScope` | render | The Fund performance card lists the funds Carta administers first and marks the funds the lookup flags as not administered (a fund the lookup misses shows unmarked), and shows the "Carta administers N of your M funds" note. Not sent when the fund lookup fails: the card shows every fund with no note |
| `CartaHome.Perf.Empty` | render | The benchmark and fund metrics queries answered with no fund that has a value, so the Fund performance card is hidden. Not sent when either query fails without a fund to show: the card stays with its note and `Perf.LoadError` is sent |
| `CartaHome.Perf.LoadError` | render | No fund could be shown because the benchmark or fund metrics query failed; the Fund performance card stays and shows a note |
| `CartaHome.LP.Empty` | render | A Fund Admin firm has no LPs to show, so the LP summary card is hidden |
| `CartaHome.LP.LoadError` | render | The LP query failed; the LP summary card stays and shows a note |
| `CartaHome.NDA.Empty` | render | The firm has no NDAs Carta has read, so the NDA insights card is hidden. Sent for every firm without Carta Law |
| `CartaHome.NDA.LoadError` | render | The NDA query failed. The NDA insights card stays hidden, since most firms don't use Carta Law, and is left out of `View.Cards`; a retry of Home's load tries it again |
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
| `CartaHome.Directory.OpenCategory.<Category>` / `CloseCategory.<Category>` | click | Expanded or collapsed a category card |
| `CartaHome.Directory.Search.Results<N>` | click | A search settled (800 ms after typing) and found N skills exactly (in their own words or, when none match, their category's name), or by a short last word (2–3 letters) read as the start of a word in the skill's text or its category's name. The typed words are never sent |
| `CartaHome.Directory.Search.Related<N>` | click | A search settled and found N close matches but no exact one |
| `CartaHome.Directory.Search.ZeroResults` | click | A search settled and found no skill; the empty state showed |
| `CartaHome.Directory.Search.Clear` | click | Cleared the search with the X |
| `CartaHome.Directory.Search.DidYouMean` | click | A search settled, found no skill, and the empty state offered a corrected spelling that does find one |
| `CartaHome.Directory.DidYouMean.Accept` | click | Clicked the corrected spelling; the corrected search ran |
| `CartaHome.Directory.AskClaude` | click | Copied the "Ask Claude about this" message from the empty state. The message holds the typed words but is not sent as a prompt |
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
