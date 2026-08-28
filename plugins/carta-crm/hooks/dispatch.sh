#!/bin/sh
# Dispatch shim for the Carta hooks Go binary. Invoked by a plugin's
# hooks.json as `dispatch.sh <subcommand>`; forwards "$@" (subcommand +
# whatever else Claude Code appends) to the resolved native binary and
# passes stdin/stdout through untouched.
#
# Resolves the binary from "$here/bin/hooks-<os>-<arch>[.exe]", relative to
# THIS script's own path (not $PWD, which Claude Code does not guarantee).
# That single relative lookup covers both layouts that carry a bin/ sibling:
#   1. Published:  the publish pipeline injects dispatch.sh + bin/ side by side
#      into <plugin>/hooks/ — see scripts/pipeline/pipeline.py inject_hook_binaries
#   2. Monorepo:   tools/hooks/dispatch.sh run straight from a checkout, for
#      staff exercising hooks without a publish, where bin/ is checked in
#      alongside this script
#
# A third layout carries no bin/ at all: each instrumented plugin commits this
# script at plugins/<name>/hooks/dispatch.sh, and a marketplace install copies
# that plugin directory verbatim without running the publish pipeline. There the
# lookup finds nothing and every subcommand fails open below — hooks go quiet
# instead of erroring on a missing file, and PreToolUse still allows the call.
#
# Fail-open is PER SUBCOMMAND, not a blanket PreToolUse allow: an event with
# no allow/deny concept (SessionStart, UserPromptSubmit) must not emit a
# PreToolUse-shaped payload, and vice versa. The shapes below match the Go
# binary's own generic fail-open in tools/hooks/internal/hookio (see
# hookio.PreToolUseAllow / hookio.SessionStartOK / hookio.UserPromptSubmitOK),
# so a missing/non-executable binary behaves identically to a handler error.
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
subcommand="${1:-}"

os=$(uname -s)
arch=$(uname -m)
case "$os" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    MINGW* | MSYS* | CYGWIN*) os=windows ;;
    *) os="" ;;
esac
case "$arch" in
    arm64 | aarch64) arch=arm64 ;;
    *) arch=amd64 ;;
esac

bin=""
if [ -n "$os" ]; then
    candidate="$here/bin/hooks-${os}-${arch}"
    [ "$os" = windows ] && candidate="${candidate}.exe"
    if [ -x "$candidate" ]; then
        bin="$candidate"
    fi
fi

if [ -n "$bin" ]; then
    exec "$bin" "$@"
fi

# No binary resolved (unbuilt checkout, unsupported host, or a publish that
# dropped bin/) — fail open with the shape the invoking event requires.
case "$subcommand" in
    capture-model | inject-context | prune-session-data)
        # SessionStart: no allow/deny concept, but Claude Code expects the
        # hookSpecificOutput envelope back (hookio.SessionStartOK).
        printf '%s' '{"hookSpecificOutput":{"hookEventName":"SessionStart"}}'
        exit 0
        ;;
    capture-active-skill | inject-instrumentation)
        # PreToolUse: must explicitly allow, or Claude Code blocks the tool call.
        printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}'
        exit 0
        ;;
    cache-commands | track-corporation)
        # PostToolUse: silently best-effort, but still expects the envelope back.
        printf '%s' '{"hookSpecificOutput":{"hookEventName":"PostToolUse"}}'
        exit 0
        ;;
    capture-slash-skill)
        # UserPromptSubmit: silently best-effort, no stdout contract.
        exit 0
        ;;
    *)
        # Unknown subcommand: mirror the Go binary's own behavior for an
        # unregistered handler name — diagnostic on stderr, empty stdout,
        # exit 0 (no registered event to fail open into).
        echo "dispatch.sh: no hooks binary found for ${os:-unknown os}/${arch}, and unknown subcommand '$subcommand'" >&2
        exit 0
        ;;
esac
