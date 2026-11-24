---
name: carta-kyc-fill-form
description: >-
  Fills in the user's own Carta KYC forms from their documents, an investor's task or a GP's
  fund KYC, from a Carta Workhub KYC card or when asked. Use for "help me fill in my KYC form",
  "what does my KYC form still need", "complete my identity verification from these documents",
  "fill in all my KYC forms", "fill in our fund's KYC" or "submit my KYC". NOT FOR firm
  Documents uploads, configuring an LP KYC form, or Carta's own KYC review.
version: 1.0.0
model: inherit
allowed-tools:
  - mcp__carta__call_tool
  - mcp__carta__read_tool
  - mcp__claude_ai_Carta__call_tool
  - mcp__claude_ai_Carta__read_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__call_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__read_tool
  - AskUserQuestion
  - Read
  - Bash(ls -l *)
  # Opens the KYC form (companion_url: /kyc/task/<id>/ or /kyc/existing-fund/<id>/) when Claude
  # Code has no browser pane. Each entry fixes the host and the /kyc/ prefix; the trailing * does
  # not constrain what follows (more path, a closing quote, further arguments).
  - Bash(open "https://app.carta.com/kyc/*)
  - Bash(open "https://app.test.carta.rocks/kyc/*)
  - Bash(open "https://app.preprod.carta.rocks/kyc/*)
  - Bash(open "https://app.sandbox.carta.team/kyc/*)
  - Bash(uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-upload-firm-document/scripts/send_to_storage.py" *)
---

<!-- carta:plugin-version -->
<carta-plugin>carta-investors:7.61.8</carta-plugin>

> **If this plugin's files can't be found:** a path that still shows an unreplaced `${…}` variable, or a "not found" when you read or run one of this skill's files, means the skill loaded before this session's computer link was ready. Invoke this skill once more with the Skill tool and use the paths that copy gives. If they're still unreplaced, tell the user Carta's plugin files aren't available in this session yet (link your computer, then ask again) and stop. Don't search the disk for them.

# Fill in a Carta KYC form

Read `${CLAUDE_PLUGIN_ROOT}/skills/carta-kyc-fill-form/references/kyc-fill-form.md` (this skill's
own `references/`; read it by that exact path, don't search for it) and follow it.
This plugin's root is `${CLAUDE_PLUGIN_ROOT}`: wherever that file writes `<plugin_root>`, write
this path out in full.
