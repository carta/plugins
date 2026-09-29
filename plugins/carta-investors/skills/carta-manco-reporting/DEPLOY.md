# Deploying ManCo Reporting to Cloudflare

**Not yet deployed.** No Worker of this name exists in the microapps account, and no
hostnames are attached. The steps below are what a first deployment takes; the tenant
model matches carta-fund-modeling and carta-portfolio-analytics-app, which do run.

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

## Architecture

One Worker serves every customer. Each customer gets a vanity hostname,
`manco.<label>.carta.cloud`, attached as a Custom Domain.

The Worker serves the SPA via Cloudflare's asset binding (`run_worker_first = true`).
`webapp/src` is a symlink to `app/src` — wrangler follows it, so source changes deploy without a
build step. OAuth 2.1 with PKCE authenticates users against `mcp.app.carta.com`. Session tokens
and report data live in KV.

### Tenant isolation

Three checks run before any firm's data is read:

1. `tenantOf()` parses the Host header into a label and looks it up in the `TENANTS` map.
   An unmapped label yields a null prefix.
2. `tenantAllows()` permits a firm slug only when it equals the mapped prefix or begins with
   `<prefix>-`. This stops one customer's hostname reaching another's data.
3. `authorizedFirm()` confirms through MCP `list_contexts` that the signed-in user actually
   has the firm, then caches the allow or deny under `allowed-firm:<sid>:<slug>`.

That cache key is per session on purpose. A shared key would let one user's successful
lookup satisfy the next user's request for the same firm.
`app/src/__tests__/workerTenancy.test.js` holds that contract.

**There is no `DEFAULT_FIRM`.** Setting one would pin every vanity hostname to a single firm's
data, which on a shared Worker means cross-tenant exposure.

## Configuration

Copy `wrangler.toml.example` to `wrangler.toml` and fill in:

- `account_id` — the target Cloudflare account
- `[[kv_namespaces]].id` — the KV namespace backing sessions and report data
- `[vars].TENANTS` — JSON mapping each URL label to the firm-slug prefix it may read
- `[[routes]]` — one `custom_domain` entry per customer hostname

To find a firm slug, read it from the firm's Carta URL or ask the customer.

## Deploy

```bash
cd plugins/carta-investors/skills/carta-manco-reporting
npx wrangler deploy
```

## Add a customer

1. Add the label and its firm slug to `[vars].TENANTS`.
2. Add a route:

```toml
[[routes]]
pattern = "manco.<label>.carta.cloud"
custom_domain = true
```

3. `npx wrangler deploy`. Cloudflare provisions the DNS record and TLS certificate.

A hostname added outside wrangler still needs its `TENANTS` entry, or every firm is denied.

## Local development

Copy `wrangler.toml` to `wrangler.dev.toml`, drop every `[[routes]]` block, set
`workers_dev = false`, and run:

```bash
cd plugins/carta-investors/skills/carta-manco-reporting
npx wrangler dev --config wrangler.dev.toml
```

Dropping `[[routes]]` is what makes OAuth work. With routes present, `wrangler dev` serves the
*production* hostname, so the login redirect targets a production callback and the browser lands
on the deployed Worker. The state key only exists in local KV, so that fails with
"Invalid or expired state".

Serve over plain HTTP, not `--local-protocol https`. `mcp.app.carta.com` accepts
`http://localhost:…` because RFC 8252 exempts loopback addresses, and it rejects `http://` on a
public hostname — which is what the production hostname above produces.

`tenantOf()` returns null off `carta.cloud`, so local runs are unrestricted by tenant. Point
local runs at a non-production account and KV namespace.

## Troubleshooting

**403 "No access to firm"**: Either the label is missing from `TENANTS`, or the slug does not
match that label's prefix, or the signed-in user genuinely lacks the firm in `list_contexts`.

**OAuth redirect loop**: The Worker uses dynamic client registration with `mcp.app.carta.com`.
Make sure the Worker URL matches the registered redirect URI (`https://<worker-url>/auth/callback`).
