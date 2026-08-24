// Export button — one implementation, used by every tab.
//
// Follows Ink's real .ink-btn--default (secondary) recipe: 40px fixed height,
// 0 15px padding, 14px/weight-500 label, and a border that is always present
// (transparent when it shouldn't show) so a focus ring can't shift the layout.
// border-default, not the border-subtle hairline — an interactive control's own edge
// is the heavier weight.
//
// Hover recolors ONLY the border (border-hover). Ink reserves the background wash for
// the `transparent` variant; giving both the same hover makes them indistinguishable.

import { useState } from "react";
import { C, FS, RADIUS } from "./theme.js";

/** A downward tray arrow. Stroked outline, matching the topbar glyph weight.
 *
 *  `stroke` is set via the style prop rather than the SVG presentation attribute:
 *  Safari < 15.4 silently ignores a var() reference in a presentation attribute and
 *  falls back to none, rendering nothing at all.
 */
function DownloadIcon({ size = 15 }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
      style={{ stroke: "currentColor", flex: "0 0 auto" }}
      aria-hidden
    >
      <path d="M12 3v12" />
      <path d="M7 11l5 5 5-5" />
      <path d="M4 20h16" />
    </svg>
  );
}

export default function ExportButton({ onExport, label = "Export CSV", title, disabled }) {
  const [hover, setHover] = useState(false);

  return (
    <button
      type="button"
      onClick={onExport}
      disabled={disabled}
      title={title}
      style={{
        display: "inline-flex", alignItems: "center", gap: 7,
        height: 40, padding: "0 15px",
        fontSize: FS.md, fontWeight: 500, fontFamily: "inherit",
        color: disabled ? C.textQuiet : C.textDefault,
        background: C.surfaceDefault,
        border: `1px solid ${disabled ? C.borderSubtle : hover ? C.borderHover : C.borderDefault}`,
        borderRadius: RADIUS,
        cursor: disabled ? "default" : "pointer",
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <DownloadIcon />
      {label}
    </button>
  );
}
