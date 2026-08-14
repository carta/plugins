# Scenario sharing (publish / pull)

Firm admins can share Fund Modeling scenarios across their firm. Sharing is **built into the
app** — there is no chat/prompt flow. If a user asks to share, publish, or pull scenarios,
point them at the in-app controls below.

## In the app

- **SHARED sidebar section** — always shown, below your local SCENARIOS. Its **Load shared
  scenarios** (⤓) control pulls the firm's shared scenarios; they render under SHARED.
- **Per-scenario actions** (top bar, for the active scenario):
  - **Publish** — a local scenario → shared with the firm.
  - **Update** — push your local edits to the shared scenario (any firm admin;
    last-write-wins, with a prompt if a teammate changed it since you loaded it). Shown
    disabled until you edit the scenario, so the edit→publish path is visible up front. If the
    owner deleted the shared copy meanwhile, Update reports it and offers **Publish as new**
    (re-share your edits) or **Keep private** (drop the link, keep a local copy).
  - **Duplicate** — an independent private copy that drops the share link.
  - **Hide** — take the scenario off your list; the firm's copy stays and a later pull keeps
    it hidden. "N hidden · Show" in the SHARED header brings hidden scenarios back.
  - **Delete** — owner only; removes the scenario for the whole firm.
- A shared scenario shows "updated {when} · by you / another admin" and, when it was built
  against a different data vintage than yours, an informational drift banner.

## How it works

- **The browser never calls Carta.** `serve.py` exposes `POST /api/scenarios/{publish,pull,delete}`
  and `GET /api/scenarios/share-status`; `scripts/share.py` drives a headless Claude MCP session
  (the same bridge the "Update data" refresh button uses) to call the `fa:*:investor_scenarios`
  commands, then merges the result into `portfolio.json`. The local server holds no credentials.
- A shared scenario is an ordinary slice carrying
  `shared:{uuid, createdBy, updatedBy, updatedAt, snapshotBasis, dirty}`. **Pull** re-hydrates each
  payload onto your current baseline by `entity_link_id` and upserts by `shared.uuid` — idempotent,
  skips scenarios you have unpublished edits on, drops ones deleted upstream, keeps ones you hid
  hidden, and leaves your forks alone. Editing a shared scenario marks it `dirty` until you **Update**.
- **Firm-admin gated**. When sharing isn't enabled for the firm, the
  app surfaces one clean message ("Scenario sharing isn't enabled for this firm yet") and does
  nothing else — no retry, no fallback.
- The headless session reaches Carta the same way the refresh button does (via the connected Carta
  MCP), so sharing works wherever the refresh button does.

## LP data & XSS

The shared payload carries only the closed scenario-knob set plus fund assumptions — never LP
rows. Scenario names and notes come from other firm admins, so the app renders them as text
(React escapes) and allow-lists link schemes (`http`/`https`/`mailto`); `dangerouslySetInnerHTML`
is banned outside the one static-logo sink.
