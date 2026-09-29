# Deploying Portfolio Analytics to Cloudflare

## Prerequisites

- `npx wrangler` (or `npm i -g wrangler`), authenticated to the target Cloudflare account
- A `wrangler.toml` — gitignored, because it carries account IDs, namespace IDs and
  customer slugs. Copy `wrangler.toml.example` to start.

### Scoping an API token

`wrangler login` cannot be granularly scoped. To use a scoped token, set `CLOUDFLARE_API_TOKEN`
and `CLOUDFLARE_ACCOUNT_ID` as environment variables instead. Minimum permissions:

| Scope | Permission | Needed for |
|---|---|---|
| Account | Workers Scripts → Edit | Uploading the script and its static assets |
| Account | Account Settings → Read | Account resolution |
| Zone | Workers Routes → Edit | Attaching or changing a hostname (drop it after first setup) |

`Workers KV Storage → Edit` is **not** required to deploy a Worker that merely *binds* KV — only
to read or write KV data directly (`wrangler kv key put`, etc.).

Creating a Worker that does not exist yet needs the account-level `Workers Scripts → Edit` above;
per-Worker grants only apply to Workers that already exist.

## Architecture

One Worker serves every customer. Each customer gets a vanity hostname,
`analytics.<label>.carta.cloud`, attached as a Custom Domain.

- `server/worker.js` is the entry point and owns auth, routing and tenant checks
- `server/kpi-builder.js` and `server/queries.js` build KPI data from MCP results
- `webapp/` is the static asset directory; `webapp/src` is a symlink to `app/src`, which
  wrangler follows, so source changes deploy without a build step
- OAuth 2.1 with PKCE authenticates users against `mcp.app.carta.com`; session tokens and
  cached data live in KV

### Tenant isolation

Three checks run before any firm's data is read:

1. `tenantOf()` parses the Host header into a label and looks it up in the `TENANTS` map.
   An unmapped label yields a null UUID.
2. `tenantFirm()` asks Carta for that one firm: it calls MCP `set_context` with the label's
   UUID. Carta is the access check. It switches to the firm for a user who holds it, and for
   Carta staff (who reach any firm), and returns a plain "not found or not authorized" result
   for anyone else. The Worker never lists a user's firms on a vanity hostname, so a
   hostname can only ever open its own firm.
3. `authorizedFirm()` allows a firm only when it is that tenant firm and its slug matches
   the URL. The allow or deny is cached per session under `tenant-firm:<sid>:<firm_uuid>`.
   A failed Carta call is not cached.

**There is no `DEFAULT_FIRM`.** Setting one would pin every vanity hostname to a single firm's
data, which on a shared Worker means cross-tenant exposure.

### Session encryption

Each signed-in user's Carta access and refresh tokens are stored in KV under `session:<sid>`
as AES-GCM ciphertext. The key is the Worker secret `SESSION_KEY` (base64 of 32 random
bytes), so read access to KV alone yields nothing usable. The KV key name is bound into the
ciphertext, so a blob copied under another session's key does not open. A Worker without the
secret refuses to store a session; it never falls back to plaintext.

Set it once per Worker. **Each Worker gets its own key**, so one app cannot open another's
sessions even though they share a KV namespace:

```bash
openssl rand -base64 32 | wrangler-microapps secret put SESSION_KEY
```

Rotating the key signs every user out, which is the safe direction. Sessions written before
encryption existed read as signed out.

## Configuration

Copy `wrangler.toml.example` to `wrangler.toml` and fill in:

- `account_id` — the target Cloudflare account
- `[[kv_namespaces]].id` — the KV namespace backing sessions and cached data
- `[vars].TENANTS` — JSON mapping each URL label to the firm UUID it may read
- `[[routes]]` — one `custom_domain` entry per customer hostname

To find a firm UUID, query `PROD_DB.DBT_VERIFIED_TRANSFORM.TRANSFORM_FUND_ADMIN_FIRMS` (`ID`, by `CARTA_ID` or `NAME`).

## Deploy

```bash
cd plugins/carta-investors/skills/carta-portfolio-analytics-app
npx wrangler deploy
```

## Add a customer

1. Add the label and its firm UUID to `[vars].TENANTS`.
2. Add a route:

```toml
[[routes]]
pattern = "analytics.<label>.carta.cloud"
custom_domain = true
```

3. `npx wrangler deploy`. Cloudflare provisions the DNS record and TLS certificate.

Equivalently, against an already-deployed Worker:

```
PUT /accounts/{account_id}/workers/domains
{ "hostname": "analytics.<label>.carta.cloud",
  "service":  "portfolio-analytics",
  "zone_id":  "<zone_id>" }
```

A hostname added this way still needs its `TENANTS` entry, or every firm is denied.

## Local development

Two options. The plain Node server is simpler because it skips OAuth entirely:

```bash
cd plugins/carta-investors/skills/carta-portfolio-analytics-app
node server/local.js
```

It uses `FileKV` (JSON files under `.data/kv/`) and dash-token auth, and opens at
`http://127.0.0.1:8788/?t=dev`.

To exercise the real Worker runtime instead, copy `wrangler.toml` to `wrangler.dev.toml`, drop
every `[[routes]]` block, set `workers_dev = false`, and run:

```bash
npx wrangler dev --config wrangler.dev.toml
```

Dropping `[[routes]]` is what makes OAuth work. With routes present, `wrangler dev` serves the
*production* hostname, so the login redirect targets a production callback and the browser lands
on the live Worker. The state key only exists in local KV, so that fails with
"Invalid or expired state".

Serve over plain HTTP, not `--local-protocol https`:

- The app registers a service worker, which needs a **trusted** secure context.
  `http://localhost` counts as one; `https://localhost` behind wrangler's self-signed
  certificate does not, so registration fails.
- `mcp.app.carta.com` accepts `http://localhost:…` because RFC 8252 exempts loopback
  addresses. It rejects `http://` on a public hostname — which is what the production
  hostname above produces, and the reason HTTPS looks necessary until the routes are gone.

`tenantOf()` returns null off `carta.cloud`, so local runs are unrestricted by tenant. Point
local runs at a non-production account and KV namespace.

`wrangler dev` needs the key too. Put a throwaway one in `.dev.vars` next to `wrangler.toml`
(gitignored):

```bash
echo "SESSION_KEY=$(openssl rand -base64 32)" > .dev.vars
```

## Troubleshooting

**OAuth redirect loop**: The Worker uses dynamic client registration with `mcp.app.carta.com`.
Make sure the Worker URL matches the registered redirect URI (`https://<worker-url>/auth/callback`).

**403 or an empty firm list**: Either the label is missing from `TENANTS`, or the UUID in `TENANTS` is wrong,
or Carta refused `set_context` for that firm (the signed-in user is not staff and does not hold it).
