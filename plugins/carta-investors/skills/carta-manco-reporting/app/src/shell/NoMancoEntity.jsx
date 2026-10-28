// Shown full-page, in place of the sidebar/content shell, when /api/load-firm's stream ends
// with code "no_manco_entity" — the firm has no ManCo entity to report on. `message` is the
// server's own "No ManCo entity found for <firm>." so this names the firm without the client
// re-deriving it. Covering the whole page keeps the sidebar from ever rendering a firm name it
// doesn't have — the same reasoning the hosted loading screen's own `fullPage` note gives.
import { CartaLogo } from "../ui/components.jsx";
import { FS, INK, FAINT, PAPER, FULL_PAGE_COVER } from "../ui/theme.js";

export default function NoMancoEntity({ message, onChooseAnother }) {
  return (
    <div style={{ ...FULL_PAGE_COVER, display: "grid", placeItems: "center" }}>
      <div style={{ textAlign: "center", maxWidth: 420, padding: "0 28px" }}>
        <CartaLogo size={32} style={{ margin: "0 auto 20px" }} />
        <div style={{ fontSize: FS.bodyLg, color: FAINT, marginBottom: 20 }}>{message}</div>
        <button type="button" onClick={onChooseAnother}
          style={{ fontSize: FS.value, fontWeight: 500, cursor: "pointer", color: INK, fontFamily: "inherit",
            background: PAPER, border: `1px solid ${INK}`, borderRadius: 0, padding: "9px 18px" }}>
          Choose a different firm
        </button>
      </div>
    </div>
  );
}
