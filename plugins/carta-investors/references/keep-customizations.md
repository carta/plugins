# Keep the user's customizations when a page is rebuilt

Users customize published pages by asking Claude to edit them — the Customize prompts on
Carta Home's SOI and Fund Performance cards invite exactly that. Rebuilding a page
publishes a fresh one over the same URL, which throws those changes away unless the
rebuild finds them first. Carta Home, the Schedule of Investments and Fund Performance all
follow this procedure before republishing over a page that already exists. Nothing here
runs on a first publish.

**Keeping is the default.** Every change the user made goes into the new version without
asking. The user is asked only about a change that collides with the new version, and only
about that change. Afterwards a short summary tells them what was kept, so they can undo
anything they don't want.

The calling skill supplies:

- **page** — what the user calls it: "Carta Home", "your Schedule of Investments",
  "your Fund Performance dashboard"
- **live file** — where to save the published page: the page's render output path minus
  `.html`, plus `.live.html`, as the page's own skill names it. One page has one live file.
- **script** — the caller's own `scripts/customizations.py`. Wherever this reference writes
  `"<script>"`, put that literal path, quoted, and run each command on one line —
  `allowed-tools` grants exactly that text.
- **new build** — the page this run is about to publish, once it is built

## 1. Start fresh, only on request

When the user asked for a clean page — "start fresh", "reset", "without my changes" — or a
calling skill passes that on, carry nothing over: save the live file (step 2) so the old
page can come back, then publish the new build as usual. Never offer start fresh as a
question up front; the summary (step 6) offers it afterwards.

## 2. Save the live page

If the caller says the page is already saved, use that file. Otherwise read it with
`Artifact({action: "read", url})` and save it to the **live file**: if the tool hands back
a file, use that; otherwise write the HTML it returns to that path. It is
the user's backup and what an undo restores from, so keep it as saved for the whole run:
never edit it.

## 3. Find what changed, and where it collides

Once the new build exists:

```
uv run "<script>" plan "<live file>" "<new build>"
```

Every build stamps a baseline of itself into the page, so the script lines the live page up
against the page as it was built and prints JSON with a `status`:

| `status` | Meaning | What to do |
|---|---|---|
| `unmodified` | the page is exactly as built | nothing to carry over; publish the new build |
| `customized` | `hunks` holds each change: the live `line` it starts at, the lines `added`, how many were `removed`, and `conflict` — `true` when Carta changed or removed the same part of the page in the new build | carry them over (step 4) |
| `no_baseline` | published before pages carried a baseline | run `diff "<live file>" --against "<new build>"` instead |

`--against` lists only lines the live page has and the new build doesn't, and no hunk says
`conflict`. Some are the user's additions; some are lines Carta has since removed. Carry over
only what reads as the user's (a column, a filter, a colour rule, a card or a chart), leave
out anything that reads as Carta's own page code, and judge conflicts yourself. Lines the
live page changed are left out and counted in `summary.skipped`: most are an older build's
version of Carta's own code, and carrying them would roll the page back. Don't go looking for
them in the live file.

**If the script can't be run here** — bash can't reach it, or `uv run` fails because the
file isn't there — don't guess at the changes. This is the one case that asks up front:
question "Update <page>?", label "Update it (Recommended)" · description "Get the latest
version. Any changes you made to it are replaced.", label "Keep it as it is" · description
"Leave <page> exactly as it is." Keeping it means not publishing.

Describe each change in one plain line a fund CFO recognises, named by where it shows —
"Holdings table: rows tinted by gain/loss", never a line number or a function name. Read the
live file around a hunk's `line` when the added lines alone don't say what it does. Several
hunks that make one change are one line. These lines are what the summary lists.

## 4. Carry the changes over

Apply each change to the new build, working from what it does rather than pasting old lines
back in: the code around it may have moved or been rewritten since.

- **`conflict: false`** — apply it. No question.
- **`conflict: true`** — the part of the page it changed is different now. Ask (step 5).
- **Now built in** — while applying any change, if the new version already does what it did
  (a column the user added that Carta now ships, say), ask about it too. Only you can spot
  this one; the script can't.

**A page that is mostly the user's own flips the direction.** When `summary.changed_share`
is 0.3 or more (only for a page with a baseline; a `no_baseline` page always carries its
changes onto the new build), carrying their changes onto the new build means rebuilding most of their
page by hand. Publish their page instead, with Carta's changes brought into it — but never
edit the live file itself: it is the backup step 6 restores from. Work on a copy:

1. `uv run "<script>" unwrap "<live file>" --out "<live file>.work.html"` writes the copy.
2. Bring each of Carta's changes from
   `uv run "<script>" diff "<live file>" --release "<new build>"` into
   `<live file>.work.html`. Ask only where one of Carta's changes lands on something the
   user changed.
3. `uv run "<script>" rebase "<live file>.work.html" "<new build>" --out "<live file>.rebased.html"`,
   and publish the file it writes. It marks the page as matching the new build, so the next
   update doesn't mistake Carta's changes for the user's.

## 5. Ask about conflicts only

One question per conflicting change, naming it and what changed in the new version:

- changed or removed — label "Adapt it (Recommended)" · description "Rework your change to
  fit the new version", or label "Drop it" · description "Use the new version here"
- now built in — label "Use the built-in one (Recommended)" · description "The page now
  does this; your version is dropped", or label "Keep mine" · description "Keep your version
  instead"

Up to four go in one `AskUserQuestion` call. More than four is one question first: label
"Adapt them all", "Use the new version for all" or "Go through them". A change that doesn't
collide never becomes a question, and nothing else is asked: publish when the conflicts are
settled, with the caller's usual `Artifact` call and its existing `url`.

**When a caller has already settled it**, skip the questions it answered. Carta Home runs
its dashboards one after another when they carry changes, so each dashboard skill still asks
about its own conflicts itself; Home only passes on "start fresh" when the user asked for it.

## 6. Summarize what was kept

The user wasn't asked about most of their changes, so this is how they find out and how
they undo one:

> Kept your <N> changes: <plain line>, <plain line>, <plain line>.
> Want to undo any of them, or start fresh? Your previous page is saved.

Past five changes, name the areas with a count ("Kept your 14 changes: 9 on the holdings
table, 5 on the header"). Add a line for each conflict and how it was settled ("Days held
column: the page now has one built in, so yours was dropped"). For a `no_baseline` page,
say "These look like your changes" instead of "Kept your changes", and when
`summary.skipped` is above zero add "If anything else you changed is missing, your previous
page is saved and I can bring it back." After start fresh, say
nothing was carried over and where the previous page is saved.

A calling skill that publishes several pages — Carta Home and its dashboards — returns these
lines rather than printing them, so the user gets one summary for the whole update.

**Undo.** If they ask to undo a change, remove it from the published page (edit the built
file, republish with the same call and `url`). "Start fresh" republishes the plain new
build. "Put my old page back" runs
`uv run "<script>" unwrap "<live file>" --out "<live file>.restored.html"` and republishes
the file it writes; publishing the saved live file as it is would nest the viewer's wrapping
inside the page.
