# Data collection — links into Carta

Single source of truth for links into Carta from this skill. The other references point here
rather than repeating it.

**Never write a Carta URL yourself — not a host, not a path.** Which Carta the user is on is not
guessable from the firm or the conversation, and a wrong link sends them to a sign-in page for an
environment they are not using. The server knows which Carta it fronts, so it hands the skill the
links ready-made.

## Where the links come from

The firm settings response from the skill's Step 2 (`data_collection__get__firm_settings`)
carries a `_links` block, resolved for the current environment:

| Key | Opens |
|---|---|
| `_links.requests.web_url` | The firm's sent-requests dashboard |
| `_links.schedules.web_url` | The firm's recurring-requests dashboard |

Use each `web_url` **verbatim**. Do not edit it, append to it, or rebuild it from parts. Both
links are firm-wide: there is no company-scoped link, so never derive one per company or per
row.

Hold the Step 2 response for the whole session — it is read once, and these links are one more
reason not to call for it again.

## When the block is absent

An older server returns no `_links`. Then there is no link to give: say the page by name —
*"the sent requests dashboard under Data collection in Carta"* — and let the user open it from
their own Carta. Do not offer a URL of any kind in its place.

## Presenting a link

Offer the link after the data, never instead of it. Opening it in Claude's in-app browser needs a
sign-in the first time, because that browser does not inherit the desktop session — so say it can
also be opened in their own browser, where they are already signed in.
