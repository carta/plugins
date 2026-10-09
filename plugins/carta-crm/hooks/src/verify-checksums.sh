#!/bin/sh
# Verifies the committed bin/hooks-* binaries against the committed
# bin/SHA256SUMS. Used by build.sh --check and by the CircleCI smoke jobs,
# which run the committed binary instead of rebuilding it and so have to
# prove they got the bytes this manifest describes.
set -eu

cd -- "$(dirname -- "$0")"

# bin/ sits beside this script in the repo (tools/hooks/bin/) and one level up
# in a published plugin, where this script ships in hooks/src/ and the
# binaries in hooks/bin/.
bin_dir=bin
[ -d "$bin_dir" ] || bin_dir=../bin

sums=$bin_dir/SHA256SUMS
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

if (cd "$bin_dir" && check_sums "$tmp/SHA256SUMS"); then
    echo "verify-checksums.sh: OK — $bin_dir/ matches $sums"
else
    echo "verify-checksums.sh: FAIL — $bin_dir/ does not match $sums" >&2
    echo "verify-checksums.sh: rebuild with ./build.sh and commit the regenerated bin/" >&2
    exit 1
fi
