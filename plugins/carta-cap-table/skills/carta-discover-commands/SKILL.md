---
name: carta-discover-commands
description: Find the right carta-cap-table command when no other skill matches. Use when unsure which command to call, exploring available data, or when the user's request doesn't match a specific skill.
---

<!-- Part of the official Carta AI Agent Plugin -->

# Discover Commands

Use the `discover()` tool to find available commands when no specific skill covers the user's request.

## When to Use

- No other carta-cap-table skill matches the user's request
- User asks "what can you do?" or "what data is available?"
- You're unsure which command to call

## Step 1 — Search for Relevant Commands

```
discover(search="<keyword from user's request>")
```

Use a keyword that captures the user's intent (e.g. "valuation", "grant", "safe", "stakeholder").

## Step 2 — Pick the Best Match

Review the returned commands. Each has:
- `command`: the name to pass to `fetch()`
- `description`: what it returns
- `required_params`: what you need to provide
- `help`: detailed field descriptions and caveats

## Step 3 — Execute

```
fetch("<command_name>", { ...params })
```

You still need `corporation_id` for most commands — get it from `list_accounts` if you don't have it.
