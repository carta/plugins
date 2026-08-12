#!/bin/sh
# Runtime/smoke harness for the committed binary: proves it dispatches on
# argv[1], runs with no interpreter on PATH, and reports cold-start timing —
# what `go test ./...` can't, since that never runs the built binary itself.
# Neither this script nor any *_test.go ever ships: only tools/hooks/bin/*
# reaches a published plugin.
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
bin_native=$(sh "$here/detect-native.sh")
[ -x "$bin_native" ] || { echo "native binary missing: $bin_native (run ./build.sh)"; exit 1; }
fail=0

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT INT TERM

# A real plugin manifest so plugin.Resolve() succeeds.
plugin_root="$work/plugin"
mkdir -p "$plugin_root/.claude-plugin"
printf '%s' '{"name":"carta-crm","version":"1.0.0"}' > "$plugin_root/.claude-plugin/plugin.json"

export CLAUDE_PLUGIN_ROOT="$plugin_root"
export CLAUDE_PLUGIN_DATA="$work/data"
export CARTA_SESSION_STATE_DIR="$work/registry"
mkdir -p "$CLAUDE_PLUGIN_DATA/sessions"

SID="sess-abc-123"
# Skills already recorded for the session, as capture-active-skill would.
printf '%s' '{"skills":["list-deals"]}' > "$CLAUDE_PLUGIN_DATA/sessions/$SID.json"

sample_event() {
    printf '%s' "{\"tool_name\":\"mcp__carta__fetch\",\"tool_input\":{\"params\":{\"command\":\"c:v:n\"}},\"session_id\":\"$SID\",\"prompt_id\":\"p-1\",\"permission_mode\":\"default\",\"effort\":{\"level\":\"medium\"}}"
}

echo "== Test 1: runtime independence (inject-instrumentation, minimal PATH, no node/python/jq reachable) =="
MINIMAL_PATH=/usr/bin:/bin
if env -i PATH="$MINIMAL_PATH" sh -c 'command -v node >/dev/null 2>&1 || command -v python3 >/dev/null 2>&1 || command -v jq >/dev/null 2>&1'; then
    echo "  note: an interpreter happens to live in $MINIMAL_PATH on this box; the binary still uses none"
else
    echo "  confirmed: node/python3/jq are NOT reachable on the test PATH"
fi
out=$(sample_event | env -i \
    PATH="$MINIMAL_PATH" \
    CLAUDE_PLUGIN_ROOT="$CLAUDE_PLUGIN_ROOT" \
    CLAUDE_PLUGIN_DATA="$CLAUDE_PLUGIN_DATA" \
    CARTA_SESSION_STATE_DIR="$CARTA_SESSION_STATE_DIR" \
    "$bin_native" inject-instrumentation)
echo "$out" | grep -q '"_instrumentation_v2"' \
    && echo "  PASS: instrumentation payload injected (nested under params — fetch is a params tool)" \
    || { echo "  FAIL: no payload"; echo "  out=$out"; fail=1; }
echo "$out" | grep -q '"carta-crm:list-deals"' \
    && echo "  PASS: skills read from session state and namespaced" \
    || { echo "  FAIL: skills missing"; echo "  out=$out"; fail=1; }

echo "== Test 2: capture-slash-skill never writes to stdout (distinct, easily-verified contract point) =="
out=$(printf '%s' "{\"prompt\":\"hello there\",\"session_id\":\"$SID\"}" | "$bin_native" capture-slash-skill)
if [ -z "$out" ]; then
    echo "  PASS: zero bytes on stdout for a non-slash prompt"
else
    echo "  FAIL: expected zero bytes, got: $out"; fail=1
fi
out=$(printf '%s' "{\"prompt\":\"/list-deals\",\"session_id\":\"$SID\"}" | "$bin_native" capture-slash-skill)
if [ -z "$out" ]; then
    echo "  PASS: zero bytes on stdout even when it records a skill"
else
    echo "  FAIL: expected zero bytes, got: $out"; fail=1
fi

echo "== Test 3: native cold-start latency (informational, no pass/fail threshold) =="
evt="$work/event.json"
sample_event > "$evt"
N=200
start=$(date +%s%N)
i=0
while [ "$i" -lt "$N" ]; do
    "$bin_native" inject-instrumentation < "$evt" >/dev/null
    i=$((i + 1))
done
end=$(date +%s%N)
avg_us=$(( (end - start) / N / 1000 ))
echo "  $N invocations, avg ${avg_us}us per cold start (native $(uname -s)/$(uname -m))"

echo
[ "$fail" -eq 0 ] && echo "ALL TESTS PASSED" || { echo "FAILURES PRESENT"; exit 1; }
