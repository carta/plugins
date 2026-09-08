import { useEffect, useState } from "react";
import { sans, INK, PAPER } from "../ui/theme.js";
import Sidebar, { SIDEBAR_WIDTH_PX } from "./Sidebar.jsx";

// 2-region layout for the carta-manco-reporting: fixed left sidebar (nav +
// data provenance), main content area on the right. No topbar — the
// as-of date moved into the sidebar (see Sidebar.jsx) once "Powered by
// Carta" was dropped and left the topbar with nothing else to show. The
// right-side drilldown drawer is mounted by <App> at a level ABOVE this
// shell, so the drawer floats over the entire page independent of route.
//
// Props:
//   sidebarProps     — {initials, firmName, route, items, onNavigate, asOf}
//   children         — the current route's page component.

// Matches carta-fund-modeling's useNarrow, so padding collapses at the
// same viewport width in both skills.
function useNarrow() {
  const [narrow, setNarrow] = useState(typeof window !== "undefined" && window.innerWidth < 1020);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1020px)");
    const fn = () => setNarrow(mq.matches);
    fn();
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  return narrow;
}

/** How wide a block of prose or a chart is allowed to get. Was the page's
 *  own width until a table needed more than the page was willing to give. */
export const CONTENT_MAX_PX = 1280;

/** A block that keeps the old page width. Everything the page used to cap
 *  wraps in one of these; what doesn't wrap takes the window. */
export function Capped({ children, style, id, ...rest }) {
  return <div id={id} style={{ maxWidth: CONTENT_MAX_PX, ...style }} {...rest}>{children}</div>;
}

export default function AppShell({ sidebarProps, children }) {
  const narrow = useNarrow();
  return (
    <div style={{
      ...sans,
      minHeight: "100vh",
      background: PAPER,
      color: INK,
    }}>
      <Sidebar {...sidebarProps} />

      <div style={{ marginLeft: SIDEBAR_WIDTH_PX }}>
        {/* No cap here. Most blocks cap themselves with <Capped> so prose
            stays readable, but a budget crosstab wants every column the
            window can fit — capping the page put a band of blank paper
            beside a table the reader had to scroll sideways. */}
        <main style={{ padding: narrow ? "22px 18px 48px" : "28px 40px 64px" }}>
          {children}
        </main>
      </div>
    </div>
  );
}
