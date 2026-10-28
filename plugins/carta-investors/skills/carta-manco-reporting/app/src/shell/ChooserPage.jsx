// Shared full-page "pick one of these" frame for FirmChooser and MancoEntityChooser — the
// logo, title, subtitle and scrollable column are one visual language; a change to either
// belongs here once, not in both files.
import { CartaLogo } from "../ui/components.jsx";
import { FS, INK, FAINT, LINE, PAPER, FULL_PAGE_COVER } from "../ui/theme.js";

export function ChooserPage({ title, subtitle, children }) {
  return (
    <div style={{ ...FULL_PAGE_COVER, display: "flex", justifyContent: "center", overflowY: "auto" }}>
      <div style={{ width: "100%", maxWidth: 560, padding: "88px 28px 56px" }}>
        <CartaLogo size={32} style={{ marginBottom: 20 }} />
        <div style={{ fontSize: FS.h2, fontWeight: 500, marginBottom: 6 }}>{title}</div>
        <div style={{ fontSize: FS.bodyLg, color: FAINT, marginBottom: 24 }}>{subtitle}</div>
        {children}
      </div>
    </div>
  );
}

// One row of a chooser's list — same padding, border and type for every pick in either
// chooser. Spreads `rest` so callers can still set `data-testid` and the like.
export function ChooserButton({ onClick, children, ...rest }) {
  return (
    <button onClick={onClick} {...rest}
      style={{ textAlign: "left", cursor: "pointer", background: PAPER, border: "none", borderBottom: `1px solid ${LINE}`,
        padding: "14px 2px", fontSize: FS.value, color: INK, fontFamily: "inherit" }}>
      {children}
    </button>
  );
}
