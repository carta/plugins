# Deploying Carta Workhub as a hosted micro-app

One Cloudflare Worker, `workhub`, serves every customer. Each customer gets a hostname,
`workhub.<label>.carta.cloud`, attached as a Custom Domain, and the label maps to the one
firm UUID that hostname may act on.

Workhub deploys with the other micro-app Workers, through the `skill-dev:deploy-microapps`
runbook. This file covers only what is specific to Workhub.

## How it works

- **Same code as the artifact.** The Worker reads `resources/` through its `ASSETS`
  binding and assembles the page the way `scripts/build_artifact.py` does, in the order
  `scripts/artifact_parts.json` gives. The page's Carta calls go through
  `server/bridge.js`, which stands in for the artifact runtime's
  `window.claude.use("mcp")`. Nothing under `resources/` knows which surface it is on.
- **`POST /api/tool` is the only route to Carta.** It refuses every tool and command
  outside its allowlist (`server/commands.json`, plus `list_contexts`, `set_context`,
  `welcome`, `discover`, `get_current_user` and `track_ui_event`). Before forwarding a
  `fetch`/`mutate`, it translates it into Carta's own tool name (`fa:list:firm-workflow` → `fa__list__firm-workflow`).
- **Tenancy.**
  - `list_contexts` answers with the hostname's firm only, and `set_context` to any
    other firm is refused, as is a `firm_uuid` naming another firm.
  - Before every write, and before each list that follows the active firm, the Worker
    switches Carta back to the hostname's firm. Carta keeps one active firm per user,
    so another tab can move it. A list reuses a switch from the last 10 seconds, or waits
    for one under way, so a page's burst of reads costs one `set_context`.
  - Reads scoped by id (`workflow_id`, `fund_uuid`) rely on Carta's own access checks.
- **Sign-in** is OAuth 2.1 with PKCE against `mcp.app.carta.com`. Sessions sit in the
  `SESSIONS` KV namespace encrypted with `SESSION_KEY` (AES-GCM, base64 of 32 bytes).
- **Analytics.** The vendored tracker relays events through `window.app.callServerTool`,
  which the bridge defines. The Worker sends them to Carta as `track_ui_event`, relabelled
  `interfaceType: "micro_app"`.

## What a deploy needs

- A Worker named `workhub`, whose config is copied into the **skill directory**
  (`carta-workhub-build/`), so that:
  - `main = "app/server/worker.js"`
  - `[assets] directory = "./resources"`, `binding = "ASSETS"`, `run_worker_first = true`,
    `html_handling = "none"`, `not_found_handling = "none"`
  - its own `SESSIONS` KV namespace, never shared with another app
  - `TENANTS = '{"<label>":"<firm_uuid>"}'`, and one `[[routes]]` block per label with
    `pattern = "workhub.<label>.carta.cloud"` and `custom_domain = true`
  - `workers_dev = false`
- The `SESSION_KEY` secret: `openssl rand -base64 32 | npx wrangler secret put SESSION_KEY`.
- **Never set** `AUTH_MODE`, `DASH_TOKEN`, `LOCAL_FIRM_UUID` or `MCP_BASE` on a deployed
  Worker: they exist for the local run below.

The microapps smoke check passes as-is: `/` is the sign-in page (200), `/auth/login`
redirects to Carta's authorize URL, and `/api/heartbeat` is 401 without a session.

## Local run

From `app/`:

1. `npm ci && npm test`.
2. Copy `wrangler.toml.example` to `wrangler.dev.toml` (gitignored) and delete its
   `[[routes]]` block.
3. Write `.dev.vars` (gitignored):

   ```
   AUTH_MODE=token
   DASH_TOKEN=dev
   LOCAL_FIRM_UUID=<firm_uuid>
   SESSION_KEY=<openssl rand -base64 32>
   MCP_BASE=http://127.0.0.1:8790
   ```

   Token mode skips sign-in and serves `LOCAL_FIRM_UUID`. `MCP_BASE` points the Worker
   at a stand-in MCP server, and only takes effect in token mode.
4. `npx wrangler dev --config wrangler.dev.toml`, then open `http://localhost:8787/?t=dev`.

A real sign-in needs a deployed hostname.
