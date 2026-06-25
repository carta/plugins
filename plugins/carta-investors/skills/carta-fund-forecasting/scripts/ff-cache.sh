#!/usr/bin/env bash
# Response cache for the fund-forecasting skill.
# Subcommands: path | stage-path | store | store-staged | lookup | meta | clear
set -euo pipefail

CACHE_DIR="${FF_CACHE_DIR:-$HOME/.cache/carta-fund-forecasting}"

ttl_for() {
  case "$1" in
    fund_forecasting:list:funds) echo 86400 ;;  # 24h — fund list rarely changes
    *) echo 3600 ;;                              # 60m — summary/details/investments
  esac
}

key_for() {
  # args: env command fund_id [params_json]
  # env is lowercased so prod/Prod/PROD (and local/Local) never split the cache —
  # the skill keys by the environment `welcome` reports, whose casing isn't guaranteed.
  local env command fund_id params
  env="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  command="$2" fund_id="$3" params="${4:-"{}"}"
  local cmd_slug params_norm phash
  cmd_slug="$(printf '%s' "$command" | tr ':' '_')"
  params_norm="$(printf '%s' "$params" | jq -S -c '.')"
  phash="$(printf '%s' "$params_norm" | shasum | cut -c1-6)"
  printf '%s__%s__%s__%s' "$env" "$cmd_slug" "$fund_id" "$phash"
}

path_for() { printf '%s/%s.json' "$CACHE_DIR" "$(key_for "$@")"; }

# A unique, deterministic staging path per (env,command,fund,params) where the agent
# Writes the raw `fetch` response before `store-staged` ingests it. Kept separate from
# the cache file so a half-written stage never looks like a valid cache entry.
stage_path_for() { printf '%s/staging/%s.staged.json' "$CACHE_DIR" "$(key_for "$@")"; }

iso_utc() {  # epoch -> ISO-8601 UTC (BSD `date -r` on macOS, GNU `date -d` on Linux)
  date -u -r "$1" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ
}

cmd_store() {  # args: env command fund_id params_json [now_epoch]; data JSON on stdin
  local env="$1" command="$2" fund_id="$3" params="${4:-"{}"}" now="${5:-$(date +%s)}"
  local ttl file
  ttl="$(ttl_for "$command")"   # NOTE: ttl_for expects the colon-form command, not the slug
  file="$(path_for "$env" "$command" "$fund_id" "$params")"
  mkdir -p "$CACHE_DIR"
  jq -n --arg cmd "$command" --arg env "$env" --arg fid "$fund_id" \
        --argjson params "$params" --arg iso "$(iso_utc "$now")" \
        --argjson epoch "$now" --argjson ttl "$ttl" --slurpfile data /dev/stdin \
     '{_meta:{command:$cmd,env:$env,fund_id:$fid,params:$params,fetched_at:$iso,fetched_at_epoch:$epoch,ttl_seconds:$ttl},data:$data[0]}' \
     > "$file"
  printf '%s\n' "$file"
}

cmd_stage_path() {  # args: env command fund_id [params_json] -> prints a fresh staging path
  local sp; sp="$(stage_path_for "$@")"
  mkdir -p "$(dirname "$sp")"
  # Clear any stale stage from an interrupted run so the agent's Write target never
  # pre-exists — that's what trips Claude Code's "file has not been read yet" guard.
  rm -f "$sp"
  printf '%s\n' "$sp"
}

cmd_store_staged() {  # args: env command fund_id params_json [now_epoch]; reads the staged file
  local sp; sp="$(stage_path_for "$1" "$2" "$3" "${4:-"{}"}")"
  if [ ! -f "$sp" ]; then
    echo "ff-cache.sh: no staged response at $sp — run 'stage-path' then Write the fetch result there" >&2
    return 4
  fi
  local rc=0
  cmd_store "$@" < "$sp" || rc=$?
  rm -f "$sp"
  return "$rc"
}

cmd_lookup() {  # args: env command fund_id params_json [now_epoch]
  # Prints the cached .data on a fresh hit, or the literal "CACHE_MISS" on a
  # miss/stale entry. ALWAYS exits 0 — a cache miss is the normal first-call
  # path, not a failure, so it must not surface as a non-zero "error" exit.
  local env="$1" command="$2" fund_id="$3" params="${4:-"{}"}" now="${5:-$(date +%s)}"
  local file fetched ttl
  file="$(path_for "$env" "$command" "$fund_id" "$params")"
  if [ -f "$file" ]; then
    fetched="$(jq -r '._meta.fetched_at_epoch // 0' "$file" 2>/dev/null || echo 0)"
    ttl="$(jq -r '._meta.ttl_seconds // 0' "$file" 2>/dev/null || echo 0)"
    if [ $(( now - fetched )) -lt "$ttl" ]; then jq -c '.data' "$file"; return 0; fi
  fi
  echo "CACHE_MISS"
  return 0
}

cmd_meta() {  # args: env command fund_id params_json -> prints ._meta
  local file
  file="$(path_for "$@")"
  [ -f "$file" ] || return 3
  jq -c '._meta' "$file"
}

cmd_clear() { rm -rf "$CACHE_DIR"; }

main() {
  local sub="${1:-}"; shift || true
  case "$sub" in
    path)         path_for "$@" ;;
    stage-path)   cmd_stage_path "$@" ;;
    store)        cmd_store "$@" ;;
    store-staged) cmd_store_staged "$@" ;;
    lookup)       cmd_lookup "$@" ;;
    meta)         cmd_meta "$@" ;;
    clear)        cmd_clear ;;
    *) echo "usage: ff-cache.sh {path|stage-path|store|store-staged|lookup|meta|clear} ..." >&2; exit 2 ;;
  esac
}
main "$@"
