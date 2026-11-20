---
name: carta-workhub-build
description: >-
  Opens the Carta Workhub for a GP. The Workhub is an app in the Carta connector, so a request to
  open, show, build, rebuild, update or set up the Carta Workhub, or its artifact, goes here:
  call `open_workhub` and do not list or open a Workhub artifact, which is an old copy. Use it
  for "open the carta workhub", "open the carta workhub artifact", "open my Carta workhub",
  "show my Carta workhub", "build the carta workhub artifact", "rebuild carta workhub", "update
  my Carta Workhub artifact", "set up carta workhub", "deploy carta workhub", "rebuild carta
  tasks", "show my Carta task board" or "pin my Carta requests". A prompt from a Workhub page's
  KYC card, which names this skill's KYC branch, goes to carta-investors:carta-kyc-fill-form.
model: inherit
allowed-tools:
  - mcp__claude_ai_Carta__open_workhub
  - mcp__carta_production__open_workhub
  - mcp__carta__open_workhub
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__open_workhub
  - Skill(carta-investors:carta-kyc-fill-form)
---

<!-- carta:plugin-version -->
<carta-plugin>carta-investors:7.56.12</carta-plugin>

# Carta Workhub

The Carta Workhub is an app in the Carta connector. Workhub pages built from this skill are
frozen copies that get no updates, and this skill builds nothing.

## KYC cards on a built Workhub page

A prompt that names this skill's KYC branch (a built Workhub page's KYC card, or its **Fill all**
or **Fill selected** button) is for `carta-investors:carta-kyc-fill-form`: invoke it with the
Skill tool, pass the user's prompt along unchanged, and stop without opening the Workhub. Every
other prompt opens the Workhub (below).

## Open it

1. Call `open_workhub` (no params) on the Carta connector. Do not list or open a Workhub artifact:
   it is an old copy.
2. When the Workhub opens, tell the user, in a few plain lines:
   - The Carta Workhub now opens from the Carta connector, so there is nothing to rebuild.
   - They can ask Claude to "open my Carta Workhub" any time.
   - The old Workhub page no longer gets updates, and they can delete it from their artifacts.
3. When the call fails, the tool isn't there, or it answers that it can't be shown here, say the
   Carta connector couldn't open the Workhub and ask them to check that Carta is connected in
   Settings → Connectors. Keep their old page until it opens. Do not build or publish an artifact.
