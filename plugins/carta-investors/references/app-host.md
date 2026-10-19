# App host for links into Carta

Maps the Carta environment to the web app's host for links built from `get_current_user`'s
`environment`.

Read `environment` from `get_current_user` and map it (call it first if its
result isn't already in context — the Carta MCP bootstrap normally has it):

| `environment` | App base URL |
|---|---|
| `production` | `https://app.carta.com` |
| `preprod` | `https://app.preprod.carta.rocks` |
| `sandbox` | `https://app.sandbox.carta.team` |
| `demo` | `https://app.demo.carta.team` |
| `test` | `https://app.test.carta.rocks` |
| `local` | ambiguous — see below |

These are the `web_base_url` values `carta config list-envs` reports per
environment; re-derive from there if a new environment appears.

`local` is the one row you cannot resolve from the name alone. A local MCP
fronting the shared TEST backend serves `https://app.test.carta.rocks`, while a
fully local stack serves `http://localhost:8000` — the environment name is
identical either way. When `get_current_user`'s `base_url` is an `http://localhost:<port>`
address, that is the web app: use it. Otherwise ask the user which one they are on rather
than picking.

**Outside that `local` case, never use `get_current_user`'s `base_url` as the app host.** It is the
API host, not the app host: on `test` it returns `https://test.carta.rocks`,
which resolves to the Kong API gateway and has no web app behind it. A link
built from it does not 404 — the browser aborts the connection before any page
loads, so don't go hunting for a Carta error page when one of these is wrong.
The app host always carries the `app.` prefix — and on production the
environment name drops out entirely (`app.carta.com`, not `app.production.…`),
so the prefix cannot be derived by string-munging `base_url` either. Use the
table.

Treat a row's name as a prefix, so `preproduction` still resolves to the
`preprod` row. If `environment` matches no row, ask the user which environment
they are in rather than guessing a host.
