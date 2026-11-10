// Your report, shared from here; `dirty` means recipients don't have your latest changes.
export const ownShare = (report) => (report?.shared?.is_owner ? report.shared : null);

// Your report's private mirror on the hosted app (own_sync.py) — kept apart from `shared`
// above: it's never visible to anyone but you, and a report can hold either, both, or
// neither. null when it was never pushed, or its mirror was deleted on the hosted app
// (own_sync.py's own `retired`) — either way, nothing to show but an offer to sync it.
// `stale` folds in both ways a push can be due: the server already flags a payload moved
// since the last push (`dirty`, report_store.mark_if_payload_moved's own-sync side); a
// name-only rename is cheap enough to compare here, live, against the name last sent.
export function ownSync(report) {
  const sync = report?.own_sync;
  if (!sync || sync.retired) return null;
  return { ...sync, stale: !!sync.dirty || sync.pushed_name !== report.name };
}
