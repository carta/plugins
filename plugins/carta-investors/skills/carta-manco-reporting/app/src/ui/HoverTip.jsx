import { useState, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { TOOLTIP_BUBBLE, TOOLTIP_CARET } from "./components.jsx";

const MAX_WIDTH = 420;

// carta-fund-modeling's own InfoTip pattern (Companies.jsx): anchored to
// the trigger with a caret, portaled so a clipped table cell can't crop it.
export default function HoverTip({ text, children, style }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const tipRef = useRef(null);
  if (!text) return children;

  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ anchor: r.left + r.width / 2, left: r.left + r.width / 2, top: r.bottom + 8 });
    setOpen(true);
  };

  // A short label is narrower than the reserved max-width; re-clamp
  // against its real rendered width once known.
  useLayoutEffect(() => {
    if (!open || !tipRef.current || !pos) return;
    const half = tipRef.current.getBoundingClientRect().width / 2;
    const clamped = Math.max(half + 12, Math.min(pos.anchor, window.innerWidth - half - 12));
    if (clamped !== pos.left) setPos((p) => p && { ...p, left: clamped });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pos?.anchor]);

  return (
    <span ref={ref} style={style} onMouseEnter={show} onMouseLeave={() => setOpen(false)}>
      {children}
      {open && pos && createPortal(
        <div ref={tipRef} style={{ ...styles.tip, left: pos.left, top: pos.top, maxWidth: Math.min(MAX_WIDTH, window.innerWidth - 24) }}>
          {text}
          <span style={TOOLTIP_CARET.bottom} />
        </div>,
        document.body
      )}
    </span>
  );
}

const styles = {
  tip: {
    ...TOOLTIP_BUBBLE,
    position: "fixed",
    zIndex: 1000,
    pointerEvents: "none",
    transform: "translateX(-50%)",
    // The text arrives with its own newlines — one GL account per line.
    whiteSpace: "pre-line",
  },
};
