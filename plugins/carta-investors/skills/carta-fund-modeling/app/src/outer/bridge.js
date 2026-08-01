// Outer-frame side of the app<->outer bridge. Same-origin only.
export function onFromApp(type, handler) {
  function listener(event) {
    if (event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.source !== "fm-app" || data.type !== type) return;
    handler(data.payload, event);
  }
  window.addEventListener("message", listener);
  return function off() { window.removeEventListener("message", listener); };
}

// Outer -> app direction: post a message into the app iframe. Restrict the
// target origin to our own, matching onFromApp's same-origin gate.
export function postToApp(iframeEl, type, payload) {
  const w = iframeEl && iframeEl.contentWindow;
  if (w) w.postMessage({ source: "fm-outer", type, payload }, window.location.origin);
}
