# Source for these binaries

The `hooks-*` files here are compiled from Go source that ships beside them.
They run the plugin's Claude Code hooks (see `hooks.json`) through
`dispatch.sh`.

| Layout | Binaries | Source |
|---|---|---|
| Published plugin | `hooks/bin/` | `hooks/src/` |
| This repo | `tools/hooks/bin/` | `tools/hooks/` |

`SHA256SUMS` lists the SHA-256 hash of every binary. The source has no
dependencies outside the Go standard library (see `go.mod`).

## Check the binaries match `SHA256SUMS`

No Go needed:

```sh
sh hooks/src/verify-checksums.sh      # published plugin
sh tools/hooks/verify-checksums.sh    # this repo
```

## Rebuild from source and compare

Needs the Go version pinned in `.go-version` in the source dir. With a newer
Go installed, `GOTOOLCHAIN` fetches that exact version:

```sh
GOTOOLCHAIN=go$(cat hooks/src/.go-version) sh hooks/src/build.sh --check
```

`build.sh --check` checks the committed binaries against `SHA256SUMS`, then
rebuilds all five targets into a temp dir and diffs their hashes against
`SHA256SUMS`. It leaves `bin/` alone. The build is byte-for-byte
reproducible: `CGO_ENABLED=0`, `-trimpath`, `-buildvcs=false` and
`-ldflags "-s -w"`, so the checkout path and commit don't change the output.

Each build command:

```sh
CGO_ENABLED=0 GOOS=<os> GOARCH=<arch> go build -trimpath -buildvcs=false -ldflags "-s -w" -o hooks-<os>-<arch> .
```
