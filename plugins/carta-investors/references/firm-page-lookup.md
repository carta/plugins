# Finding a firm's existing page

Carta Home, SOI and LP Summary are each bound to one firm: the build bakes in that firm's
dashboards, funds or warehouse ids. Their titles carry no firm, so every firm a user builds
for has its own page under the same title, and the title alone is not an identity. Each of
these pages names its firm at the start of its artifact `description`: the description's
firm is the text before its first ` — `.

Given the page's title and its firm-named title (both from the calling skill), and the
`Artifact({action: "list", scope: "mine"})` listing:

1. **This firm's page** is an artifact whose title matches the page's title whole **and**
   whose description's firm, the text before its first ` — `, is exactly the active firm's
   name. A firm whose name merely starts the same way ("Acme" and "Acme Ventures") is a
   different firm. Keep its `url`.
2. **A firm-named title** for the active firm (for example `Carta Home - <Firm>`), matched
   whole with the active firm's exact name, is this firm's page too. Keep its `url`: republishing over it renames it in place.
3. **Anything else is another firm's page.** A title match whose description's firm is any
   other name, or that has no firm before a ` — `, is not a match. Leave it alone and
   publish a new page.
4. **No descriptions in the listing.** Reuse a title match only when the user has a single
   firm. Otherwise ask the user which page is this firm's before reusing any `url`.
5. **More than one page for this firm** (steps 1 and 2 together find more than one) is a
   collision, not a choice. Some earlier run created a second artifact instead of
   redeploying over the first. Do not silently pick the newest: tell the user how many this
   firm has and which URL you are about to redeploy over, so the stale ones can be cleaned
   up deliberately. Pages that belong to other firms are not duplicates; never offer them
   for cleanup.

Match whole titles and whole firm names, never a fragment, and never reuse a `url` on title
or favicon alone.
