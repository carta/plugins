# List the firm's entities

Run this when a skill needs the firm's entities from `fa__list__entities` (via
`read_tool`). One call that covers many types, or no type at all, is larger than
the response limit for a firm with many entities and fails with "response too
large". The calling skill names the entity types it needs; use those.

1. **One call per entity type**, passing `{"entity_types": "<type>"}`, then merge
   the results. Never call it without `entity_types`, and never skip a type: a
   skipped type silently drops all of its entities. A type the firm doesn't use
   returns an empty list; move on.
2. **A type that still comes back "response too large"** is split with `search=`
   on name fragments that together cover it, such as the firm's fund-family names.
   Join the pieces. A single `search=` for the one entity the user named does not
   cover the type.
3. **A type that can't be fetched in full** means the list is incomplete. Tell the
   user which kind of entity may be missing from the view, and never continue with
   a partial list silently.
