#!/bin/sh
# Print the path to the committed bin/hooks-<os>-<arch> binary matching the
# current host. Used by test.sh in this directory.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
os=$(uname -s); arch=$(uname -m)
# Fail loudly on an unrecognized OS rather than defaulting to one — a wrong
# guess would still pass callers' `[ -x ... ]` check and fail later as an
# opaque exec error instead.
case "$os" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    MINGW* | MSYS* | CYGWIN*) os=windows ;;
    *) echo "detect-native.sh: unsupported OS: $os" >&2; exit 1 ;;
esac
case "$arch" in arm64 | aarch64) arch=arm64 ;; *) arch=amd64 ;; esac
bin="$here/bin/hooks-${os}-${arch}"
[ "$os" = windows ] && bin="${bin}.exe"
printf '%s' "$bin"
