// A tiny, dependency-free toast for gentle inline warnings — currently used when
// a user tries to edit the read-only Baseline scenario. It's a module-level store
// read via useSyncExternalStore (mirrors route.js), so warn() can be fired from
// anywhere — the state hook, a control — with no context provider or prop
// threading. One toast at a time: repeat fires of the SAME message just reset the
// dismiss timer without re-rendering, so a slider drag (which emits many events)
// never stacks or flickers the toast.
import { useSyncExternalStore } from "react";
import { FS, sans } from "./theme.js";
import { LockIcon } from "./components.jsx";

export const BASELINE_LOCKED_MSG =
  "The Baseline scenario is read-only — it mirrors Carta's reported figures. To change this value, create a new scenario with the + in the Scenarios list.";

const DISMISS_MS = 3600;

let state = { msg: null };
const listeners = new Set();
let timer = null;

function notify() { for (const l of listeners) l(); }

/** Show a gentle toast. Coalescing: while the same message is already visible we
 *  only extend its life (no state-identity change → no re-render → no flicker).
 *  (Store-only — touches module state + setTimeout, never the DOM — so it's safe
 *  under SSR and unit-testable without jsdom.) */
export function warn(msg) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (state.msg !== null) { state = { msg: null }; notify(); }
  }, DISMISS_MS);
  if (state.msg !== msg) { state = { msg }; notify(); }
}

export function subscribe(cb) { listeners.add(cb); return () => listeners.delete(cb); }
export function getSnapshot() { return state; }

/** Fixed, bottom-center, non-blocking toast. Mount once near the app root. */
export function WarnToast() {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (!s.msg) return null;
  return (
    <div role="status" aria-live="polite"
      style={{ position: "fixed", left: "50%", bottom: 28, transform: "translateX(-50%)",
        zIndex: 200, pointerEvents: "none", maxWidth: "min(92vw, 460px)" }}>
      <div className="popin"
        style={{ ...sans, display: "flex", alignItems: "flex-start", gap: 10,
          background: "var(--ink-color-global-surface-background-default)", border: `1px solid var(--ink-color-global-border-subtle)`, borderRadius: 8,
          boxShadow: "var(--shadow-hover)", padding: "12px 15px",
          fontSize: FS.body, lineHeight: 1.5, color: "var(--ink-color-global-text-default)" }}>
        <span style={{ color: "var(--ink-color-global-text-subtle)", flex: "none", marginTop: 2 }} aria-hidden>
          <LockIcon size={15} strokeWidth={2} />
        </span>
        <span>{s.msg}</span>
      </div>
    </div>
  );
}
