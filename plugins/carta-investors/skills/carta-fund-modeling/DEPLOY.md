# Deploying Fund Modeling to Cloudflare

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
`fund-modeling.<label>.carta.cloud`, attached as a Custom Domain.

The Worker serves a React SPA via Cloudflare's asset binding (`run_worker_first = true`).
`webapp/src` is a symlink to `app/src` — wrangler follows it, so source changes deploy without a
build step. OAuth 2.1 with PKCE authenticates users against `mcp.app.carta.com`. Session tokens
and cached data live in KV.

### Tenant isolation

Three checks run before any firm's data is read:

1. `tenantOf()` parses the Host header into a label and looks it up in the `TENANTS` map.
   An unmapped label yields a null prefix.
2. `tenantAllows()` permits a firm slug only when it equals the mapped prefix or begins with
   `<prefix>-`. This stops one customer's hostname reaching another's data.
3. `authorizedFirm()` confirms through MCP `list_contexts` that the signed-in user actually
   has the firm, then caches the allow or deny in KV.

KV keys come from `dataKey()`: firm-scoped once the firm is known, session-scoped otherwise.

**There is no `DEFAULT_FIRM`.** Setting one would pin every vanity hostname to a single firm's
data, which on a shared Worker means cross-tenant exposure.

## Configuration

Copy `wrangler.toml.example` to `wrangler.toml` and fill in:

- `account_id` — the target Cloudflare account
- `[[kv_namespaces]].id` — the KV namespace backing sessions and cached data
- `[vars].TENANTS` — JSON mapping each URL label to the firm-slug prefix it may read
- `[[routes]]` — one `custom_domain` entry per customer hostname

To find a firm slug, read it from the firm's Carta URL or ask the customer.

## Deploy

```bash
cd plugins/carta-investors/skills/carta-fund-modeling
npx wrangler deploy
```

## Add a customer

1. Add the label and its firm slug to `[vars].TENANTS`.
2. Add a route:

```toml
[[routes]]
pattern = "fund-modeling.<label>.carta.cloud"
custom_domain = true
```

3. `npx wrangler deploy`. Cloudflare provisions the DNS record and TLS certificate.

Equivalently, against an already-deployed Worker:

```
PUT /accounts/{account_id}/workers/domains
{ "hostname": "fund-modeling.<label>.carta.cloud",
  "service":  "fund-modeling",
  "zone_id":  "<zone_id>" }
```

A hostname added this way still needs its `TENANTS` entry, or every firm is denied.

## Local development

Local dev needs its own config — copy `wrangler.toml` to `wrangler.dev.toml`, drop every
`[[routes]]` block, and set `workers_dev = false`:

```bash
cd plugins/carta-investors/skills/carta-fund-modeling
npx wrangler dev --config wrangler.dev.toml
```

Dropping `[[routes]]` is what makes OAuth work. With routes present, `wrangler dev` serves the
*production* hostname, so `getRedirectUri()` builds a production callback and the browser lands
on the live Worker after login. The state key only exists in local KV, so that fails with
"Invalid or expired state".

Serve over plain HTTP, not `--local-protocol https`. Two reasons:

- The app registers a service worker, which needs a **trusted** secure context.
  `http://localhost` counts as one; `https://localhost` behind wrangler's self-signed
  certificate does not, so registration fails.
- `mcp.app.carta.com` accepts `http://localhost:…` because RFC 8252 exempts loopback
  addresses. It rejects `http://` on a public hostname — which is what the production
  hostname above produces, and the reason HTTPS looks necessary until the routes are gone.

`tenantOf()` returns null off `carta.cloud`, so local runs are unrestricted by tenant and fall
back to session-scoped keys. Point local runs at a non-production account and KV namespace.

## Troubleshooting

**`.find` TypeError on first load**: The Worker auto-migrates pre-slices portfolio data on read. If a stale KV entry causes issues, clear it by redeploying — the next `/api/load-firm` SSE stream rebuilds the data.

**OAuth redirect loop**: The Worker uses dynamic client registration with `mcp.app.carta.com`. Make sure the Worker URL matches the registered redirect URI (`https://<worker-url>/auth/callback`).

**403 "No access to firm"**: Either the label is missing from `TENANTS`, or the slug does not
match that label's prefix, or the signed-in user genuinely lacks the firm in `list_contexts`.
