// Iframe-side "inspect element" controller for Pinpoint mode. Hovering paints
// a devtools-style bounding-box overlay on the element under the cursor;
// clicking (capture-phase, so it wins over app handlers) pins the target via
// the same anchor pipeline Alt+click uses, then auto-exits. Esc exits without
// pinning. Pure stdlib DOM — no deps — so it can run inside the app iframe.
let inspecting = false;
let overlay = null;
let cfg = {};

export function isInspecting() {
  return inspecting;
}

function ensureOverlay() {
  if (overlay || typeof document === "undefined") return;
  overlay = document.createElement("div");
  overlay.setAttribute("data-fm-inspect-overlay", "");
  Object.assign(overlay.style, {
    position: "fixed",
    zIndex: 2147483646,
    pointerEvents: "none",
    background: "rgba(40,93,163,0.12)",
    outline: "2px solid var(--ink-color-global-border-focus-default, #285DA3)",
    borderRadius: "2px",
    transition: "all 40ms ease",
    display: "none",
  });
  document.body.appendChild(overlay);
}

function moveOverlay(el) {
  if (!overlay || !el || !el.getBoundingClientRect) return;
  const r = el.getBoundingClientRect();
  Object.assign(overlay.style, {
    display: "block",
    left: r.left + "px",
    top: r.top + "px",
    width: r.width + "px",
    height: r.height + "px",
  });
}

function onMove(e) {
  moveOverlay(e.target);
}

function onClick(e) {
  e.preventDefault();
  e.stopPropagation();
  const t = e.target;
  const onPin = cfg.onPin;
  setInspectMode(false, {});
  if (onPin) onPin(t);
}

function onKey(e) {
  if (e.key === "Escape") {
    const onCancel = cfg.onCancel;
    setInspectMode(false, {});
    if (onCancel) onCancel();   // let the outer shell sync its toggle off
  }
}

export function setInspectMode(on, config) {
  if (typeof document === "undefined") {
    inspecting = !!on;
    return;
  }
  if (on && !inspecting) {
    inspecting = true;
    cfg = config || {};
    ensureOverlay();
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    document.body.style.cursor = "crosshair";
  } else if (!on && inspecting) {
    inspecting = false;
    cfg = {};
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    if (overlay) overlay.style.display = "none";
    document.body.style.cursor = "";
  }
}
