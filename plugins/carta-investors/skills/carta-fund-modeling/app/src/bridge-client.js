// App (iframe) side of the app<->outer bridge. Posts to the outer frame.
import { buildAnchor } from "./pinpoint/capture.js";
import { findAndMark } from "./pinpoint/findAndMark.js";
import { setInspectMode } from "./pinpoint/inspect.js";

export function postToOuter(type, payload) {
  // parent is the outer shell; restrict the target origin to our own.
  window.parent.postMessage({ source: "fm-app", type, payload }, window.location.origin);
}

// App (iframe) side of the outer->app direction. Mirrors onFromApp in
// outer/bridge.js, filtering on the outer shell's "fm-outer" source.
export function onFromOuter(type, handler) {
  function listener(event) {
    if (event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.source !== "fm-outer" || data.type !== type) return;
    handler(data.payload, event);
  }
  window.addEventListener("message", listener);
  return function off() { window.removeEventListener("message", listener); };
}

// Alt+click any element to pin it (scope a chat request to it). Alt-gate so
// normal clicks are untouched; Plan 3 later adds a visible "pin mode" toggle.
export function installPinpoint() {
  if (typeof document === "undefined") return;
  document.addEventListener("click", (e) => {
    if (!e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    postToOuter("pinpoint", buildAnchor(e.target));
  }, true);
  // The outer shell re-sends the active anchor as a "highlight" on anchor
  // change and after each iframe reload; draw/clear the mark accordingly.
  onFromOuter("highlight", (anchor) => findAndMark(anchor));
  // Explicit 📍 Pinpoint toggle (outer chat button): the outer shell drives
  // hover-inspect mode on/off; a pin reuses the same buildAnchor/postToOuter
  // pipeline as Alt+click, then exits the mode.
  onFromOuter("pinpoint-mode", (payload) => {
    setInspectMode(!!(payload && payload.on), {
      onPin: (el) => postToOuter("pinpoint", buildAnchor(el)),
      onCancel: () => postToOuter("pinpoint-cancel"),   // Esc inside the iframe
    });
  });
  // Chat-turn soft lock: the outer shell pauses autosave for the duration of a
  // turn (so an in-flight Claude edit and the user's own edit can't race) and
  // resumes it when the turn ends, ahead of the post-turn iframe reload.
  onFromOuter("autosave", (payload) => {
    const ctl = (typeof window !== "undefined") && window.__fmPortfolioCtl;
    if (!ctl) return;
    if (payload && payload.paused) ctl.pauseAutosave && ctl.pauseAutosave();
    else ctl.resumeAutosave && ctl.resumeAutosave();
  });
}
