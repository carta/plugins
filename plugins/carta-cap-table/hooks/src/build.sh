#!/bin/sh
# Cross-compiles the tools/hooks dispatcher for all supported targets, and
# (--check) verifies committed tools/hooks/bin/ is reproducible from source.
set -eu

cd -- "$(dirname -- "$0")"

want_go_version=$(cat .go-version)
have_go_version=$(go version 2>/dev/null | awk '{print $3}' | sed 's/^go//')
if [ "$have_go_version" != "$want_go_version" ]; then
    echo "build.sh: go version mismatch: have '$have_go_version', want '$want_go_version' (see .go-version)" >&2
    echo "build.sh: select go $want_go_version before building/checking — a different toolchain can" >&2
    echo "build.sh: change SHA256SUMS and make --check fail for reasons unrelated to real drift" >&2
    exit 1
fi

targets='
darwin arm64
darwin amd64
linux arm64
linux amd64
windows amd64
'

# -buildvcs=false (below) avoids embedding the commit hash in the binary —
# left on, SHA256SUMS would change every commit and --check could never pass.
LDFLAGS='-s -w'

# build_targets OUTDIR: builds all 5 targets into OUTDIR (created if needed).
build_targets() {
    outdir="$1"
    mkdir -p "$outdir"
    echo "$targets" | while read -r goos goarch; do
        [ -z "$goos" ] && continue
        name="hooks-${goos}-${goarch}"
        [ "$goos" = windows ] && name="${name}.exe"
        CGO_ENABLED=0 GOOS="$goos" GOARCH="$goarch" \
            go build -trimpath -buildvcs=false -ldflags "$LDFLAGS" -o "$outdir/$name" .
        printf '  built %-28s %s bytes\n' "$name" "$(wc -c < "$outdir/$name" | tr -d ' ')" >&2
    done
}

# checksum OUTDIR: writes OUTDIR/SHA256SUMS over OUTDIR/hooks-*.
checksum() {
    outdir="$1"
    if command -v sha256sum >/dev/null 2>&1; then
        (cd "$outdir" && sha256sum hooks-*) > "$outdir/SHA256SUMS"
    else
        (cd "$outdir" && shasum -a 256 hooks-*) > "$outdir/SHA256SUMS"
    fi
}

if [ "${1:-}" = "--check" ]; then
    # Two independent claims. First: the committed binaries really are the ones
    # bin/SHA256SUMS describes — without this, a stale binary under a correct
    # manifest passes. Second (below): source still reproduces that manifest.
    if sh ./verify-checksums.sh; then
        echo "build.sh --check: OK — committed bin/ matches bin/SHA256SUMS" >&2
    else
        echo "build.sh --check: FAIL — committed bin/ does not match bin/SHA256SUMS" >&2
        echo "build.sh --check: run ./build.sh and commit the regenerated bin/" >&2
        exit 1
    fi

    tmp=$(mktemp -d)
    trap 'rm -rf "$tmp"' EXIT INT TERM
    echo "build.sh --check: rebuilding into $tmp (bin/ left untouched)" >&2
    build_targets "$tmp"
    checksum "$tmp"
    if diff -u bin/SHA256SUMS "$tmp/SHA256SUMS" >&2; then
        echo "build.sh --check: OK — rebuild is byte-identical to bin/SHA256SUMS"
        exit 0
    else
        echo "build.sh --check: FAIL — rebuild differs from committed bin/SHA256SUMS (see diff above)" >&2
        exit 1
    fi
fi

out=bin
mkdir -p "$out"
rm -f "$out"/hooks-* "$out"/SHA256SUMS
build_targets "$out"
checksum "$out"
echo "wrote $out/SHA256SUMS"
