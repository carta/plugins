# Gate — is the `Artifact` tool available?

Run this once, before any real work, in every skill that publishes an artifact.

`Artifact` is the single tool for every artifact operation; the mode is picked with
`action`, which defaults to `"publish"`.

**PASS:** `Artifact` is in this session. Continue, and say nothing about having checked.

**FAIL:** `Artifact` is absent. Stop immediately and tell the user:

> Your version of Claude is out of date, so I can't publish this. Update Claude —
> **Help → Check for Updates** in the desktop app, or `claude update` in the CLI — then
> start a fresh session and ask me again.

Do not offer a text or markdown fallback — the old `create_artifact` API is retired and
there is no alternative publish path.

## Don't narrate this check

Pass silently — no "gate", no "preflight", no announcement. That vocabulary is ours, not the
user's. On failure, use the message above.

## What the tool can do

For the full surface — publishing, updating in place, reading a page back, assets, runtime
capabilities, the CSP, and how a page calls Carta from browser JS — see
`skill-dev:build-cowork-live-artifact`. This gate only answers "can I publish at all?".
