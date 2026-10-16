# Spec operations

Every request maps to exactly one row below, or to "Unsupported requests". Node ids come
from the graph (SKILL.md Step 2); never show them to the user. Every call carries the **full** spec.

| The user asks to… | Operation | Spec |
|---|---|---|
| collapse, combine or group nodes into one box ("all funds as 'Funds'") | `groups` | `"groups": [{"label": "Funds", "nodeIds": ["<node_id>", "<node_id>"]}]` |
| rename or relabel a node | `rename` | `"rename": {"<node_id>": "Holdco A"}` |
| hide, remove or drop a node | `hide` | `"hide": ["<node_id>"]` |
| hide every ownership % | `hideOwnership` | `"hideOwnership": true` |
| add or change the title, subtitle or footer | `title`, `subtitle`, `footer` | `"title": "Atlas structure"` |
| show it again / un-hide / ungroup / restore a name | remove that entry from the spec | — |
| sign off, approve or add "approved by" | not an edit: SKILL.md Step 4.1, which runs the check first | — |

"All the funds" means every graph node whose type is `fund`. A group of funds stays a
fund; a group with any entity in it becomes an entity.

## Guard rails — check before applying

- **Hiding a node that holds others.** Hiding removes the node and every link touching
  it, and nothing is reconnected, so everything it holds is cut off from the chart.
  Before hiding a node the graph shows holding others, name what will be cut off and
  ask. Offer `groups` or `rename` as alternatives that keep the links.
- **One place per node.** A node may be in one group only, and never both hidden and
  grouped. If the user asks for a second placement, ask which one they want.
- **No renaming a group member.** Rename the group's label instead, or take the node out
  of the group first.
- **Group links merge.** Ownership from group members into the same holding is summed;
  several links from one holder into members become one link with no %. Mention this
  when grouping nodes that hold the same entity.

## Unsupported requests

When no row above matches, change nothing and reply in three parts:
1. Plainly: "The entity map view can't <what they asked> yet."
2. What it can do: group, rename or hide entities, hide all ownership %, and set a
   title, subtitle or footer, and a sign-off (by default under your own Carta name).
3. The closest alternative from this table, offered as a question.

| Request | Closest alternative |
|---|---|
| colours, fonts, layout, moving or reordering nodes | none in the view — the layout is Carta's |
| hiding a single link, or one ownership % | hide every % (`hideOwnership`), or hide or group a node |
| editing an ownership % or adding a link | none — the map shows Carta's data; fix it in Carta |
| adding entities, notes or annotations | a `footer` line, or a `rename` that says what the node is |
| the economic lens or flow view | none — the view shows legal ownership only |
| more than one page | none — the export is one page; group nodes to fit more |
| a drawn signature | a typed sign-off (Step 4) |

Never fake an unsupported request with another operation — for example, a `rename` that
writes a % into a label, or a `footer` that pretends to be a signature.
