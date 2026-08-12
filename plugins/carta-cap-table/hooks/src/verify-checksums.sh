#!/bin/sh
# Verifies the committed bin/hooks-* binaries against the committed
# bin/SHA256SUMS. Used by build.sh --check and by the CircleCI smoke jobs,
# which run the committed binary instead of rebuilding it and so have to
# prove they got the bytes this manifest describes.
set -eu

cd -- "$(dirname -- "$0")"

sums=bin/SHA256SUMS
if [ ! -f "$sums" ]; then
    echo "verify-checksums.sh: FAIL — $sums is missing (run ./build.sh)" >&2
    exit 1
fi

check_sums() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum -c "$1"
    else
        shasum -a 256 -c "$1"
    fi
}

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT INT TERM

# A Windows checkout can hand us CRLF, which makes every filename in the
# manifest miss by one byte.
tr -d '\r' < "$sums" > "$tmp/SHA256SUMS"

if (cd bin && check_sums "$tmp/SHA256SUMS"); then
    echo "verify-checksums.sh: OK — bin/ matches bin/SHA256SUMS"
else
    echo "verify-checksums.sh: FAIL — bin/ does not match bin/SHA256SUMS" >&2
    echo "verify-checksums.sh: rebuild with ./build.sh and commit the regenerated bin/" >&2
    exit 1
fi
