// Status dots live inside the pivot's cells; the popovers that review them (Publish
// changes, Resolve conflicts) belong to the sidebar/header controls. Only one of those
// controls is ever mounted for a given edit's status, so a window event bridges the gap.
import { useEffect, useRef } from "react";

export const OPEN_CORRECTIONS = "pa:open-corrections";

export function openCorrections(edit) {
  window.dispatchEvent(new CustomEvent(OPEN_CORRECTIONS, { detail: edit }));
}

export function useOpenCorrections(handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const onOpen = (e) => ref.current(e.detail);
    window.addEventListener(OPEN_CORRECTIONS, onOpen);
    return () => window.removeEventListener(OPEN_CORRECTIONS, onOpen);
  }, []);
}
