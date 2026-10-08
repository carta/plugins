# Gate — is the `Artifact` tool available?

Run this once, before any real work, in every skill that publishes an artifact.

`Artifact` is the single tool for every artifact operation; the mode is picked with
`action`, which defaults to `"publish"`.

**PASS:** `Artifact` is in this session. Continue, and say nothing about having checked.

**FAIL:** `Artifact` is absent. Stop immediately and tell the user:

> I can't publish this because this session has no `Artifact` tool. That usually means one
> of two things:
>
> - **You're in claude.ai chat.** Artifacts are published from Claude Code or Cowork. Open a
>   new Claude Code or Cowork session and ask me again.
> - **Artifacts are turned off for your organization.** An organization Owner can turn them
>   on under **Organization settings → Artifacts**. Then relaunch Claude and start a new
>   Claude Code or Cowork session.
>   A session that lists only `create_artifact` / `update_artifact` is this case; updating
>   Claude won't change it.
>
> If neither applies, update Claude (**Help → Check for Updates** in the desktop app, or
> `claude update` in the CLI), start a fresh session and ask me again.

Do not offer a text or markdown fallback — the old `create_artifact` API is retired and
there is no alternative publish path.

## Don't narrate this check

Pass silently — no "gate", no "preflight", no announcement. That vocabulary is ours, not the
user's. On failure, use the message above.

## What the tool can do

For the full surface — publishing, updating in place, reading a page back, assets, runtime
capabilities, the CSP, and how a page calls Carta from browser JS — see
`skill-dev:build-cowork-live-artifact`. This gate only answers "can I publish at all?".
