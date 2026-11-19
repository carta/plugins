# Next step

## Next-step question

Each skill ends by asking what the caller wants to do next, so they click a choice
instead of typing one. The skill names the choices and where each answer routes; this
section says how to ask.

- Ask with one `AskUserQuestion` call, `multiSelect: false`.
- **question:** "What would you like to do next?" · **header:** "Next step"
- Each choice's label and description are in plain language, never skill names.
- Don't also print the choices as a list in the reply; the question card shows them.
- `AskUserQuestion` needs at least two choices. With fewer left to offer, skip the
  question.
- If `AskUserQuestion` isn't available, show the same choices as a bulleted list under
  **What would you like to do next?**

## Routing an answer to another skill

When the chosen answer routes to another skill, start it with the `Skill` tool by the
full name the skill gives (for example `carta-investors:carta-audit-readiness`).

If that call fails, or the skill isn't in your list, it is still in this plugin: `Read`
`${CLAUDE_PLUGIN_ROOT}/skills/<skill-name>/SKILL.md` (the skill name without the
`carta-investors:` part; do not search for it) and follow it here, reading every
`${CLAUDE_PLUGIN_ROOT}` in it as this plugin's root. Don't tell the caller the plugin
didn't load, and don't answer from what this conversation already listed instead.
Only if that read fails too, say the step couldn't start and offer to try again.
