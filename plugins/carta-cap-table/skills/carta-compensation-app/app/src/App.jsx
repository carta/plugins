import { useEffect, useState } from "react";
import { C, FS, RADIUS, SANS, SERIF, GLOBAL_CSS } from "./ui/theme.js";
import { useDashboardData } from "./state/useData.js";
import Benchmarks from "./views/Benchmarks.jsx";
import Scorecard from "./views/Scorecard.jsx";
import { Tag } from "./ui/components.jsx";

// Only shipped surfaces appear. Plan Modeling and Reports were previously declared
// here as permanently-disabled "soon" tabs — that advertises a roadmap in the product
// UI and gives every user two dead controls to discover. They come back when they
// exist.
//
// Scorecard is data-gated rather than release-gated: it needs roster.json, which only
// exists when the build swept a roster. A dashboard built before that feature — or one
// whose roster sweep failed — has benchmarks but no roster, so the tab is omitted
// rather than opening onto nothing. That is why the list is computed per load instead
// of being a module constant.
function tabsFor({ roster }) {
  return [
    { id: "benchmarks", label: "Benchmarks" },
    ...(roster ? [{ id: "scorecard", label: "Scorecard" }] : []),
  ];
}

function useGlobalCss() {
  useEffect(() => {
    if (document.getElementById("ctc-global-css")) return;
    const el = document.createElement("style");
    el.id = "ctc-global-css";
    el.textContent = GLOBAL_CSS;
    document.head.appendChild(el);
  }, []);
}

/** The Carta logo — inlined verbatim from theme-with-ink's canonical asset.
 *
 * Inline SVG rather than an <img> or a CSS mask: it paints in `currentColor`, so one
 * copy adapts to light and dark, and it needs no network fetch (this app is served
 * offline from a local data dir).
 *
 * KEEP `fill="none"` ON THE ROOT. The frame is a stroked <rect> that declares no fill
 * of its own — drop the root's `fill="none"` and it falls back to SVG's default black,
 * painting a solid box with the wordmark hidden black-on-black.
 */
function CartaLogo({ height = 26 }) {
  return (
    <svg
      width={height * 2} height={height} viewBox="0 0 64 32" fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img" aria-label="Carta"
      style={{ display: "block", color: C.textDefault, flex: "0 0 auto" }}
    >
      <rect x="0.64" y="0.64" width="62.72" height="30.72" stroke="currentColor" strokeWidth="1.28" />
      <path
        d="M8.4 16.62C8.4 13.42 11.1 11.53 13.53 11.53C15.27 11.53 16.9 12.19 17.76 13.69L16.14 14.63C15.86 14.21 15.48 13.86 15.03 13.62C14.58 13.39 14.08 13.26 13.57 13.27C12.14 13.27 10.44 14.38 10.44 16.59C10.44 18.8 12.06 19.93 13.7 19.93C14.84 19.93 15.79 19.3 16.35 18.32L18.01 19.08C17.07 20.78 15.39 21.68 13.44 21.68C10.98 21.67 8.4 19.79 8.4 16.62L8.4 16.62ZM23.94 21.68C25.29 21.68 26.56 21.08 27.22 20.22V21.4H29.23V11.78H27.22V12.97C26.6 12.1 25.29 11.53 23.94 11.53C20.98 11.53 18.92 13.68 18.92 16.6C18.92 19.52 21 21.68 23.94 21.68V21.68ZM24.13 13.36C25.99 13.36 27.26 14.74 27.26 16.6C27.26 18.47 25.99 19.85 24.13 19.85C22.28 19.85 20.96 18.45 20.96 16.57C20.96 14.68 22.28 13.36 24.13 13.36V13.36ZM40.01 13.69H37.93V11.77H40.03V9.26H42.1V11.77H44.2V13.69H42.1V21.4H40.01V13.69ZM49.96 21.68C51.32 21.68 52.59 21.08 53.25 20.22V21.4H55.26V11.78H53.25V12.97C52.62 12.1 51.32 11.53 49.96 11.53C47.01 11.53 44.94 13.68 44.94 16.6C44.94 19.52 47.03 21.68 49.96 21.68V21.68ZM50.16 13.36C52.01 13.36 53.29 14.74 53.29 16.6C53.29 18.47 52.01 19.85 50.16 19.85C48.31 19.85 46.99 18.45 46.99 16.57C46.99 14.68 48.3 13.36 50.16 13.36V13.36ZM33.77 21.39H31.69V11.77H33.6V13.56C34.07 12.5 34.78 11.8 35.94 11.75C36.18 11.74 36.41 11.75 36.65 11.77L36.62 13.7C34.96 13.7 33.77 14.59 33.77 17.07V21.4H33.77L33.77 21.39Z"
        fill="currentColor"
      />
    </svg>
  );
}

function Header({ snapshot, benchmarks, peerLabel, tabs, tab, setTab }) {
  // Unconditional and above every branch in this component — Header has no early
  // returns today, and this must stay ordered the same on every render regardless
  // (a hook after a conditional return is React error #310, which this app has
  // already been bitten by once).
  const [focusedTab, setFocusedTab] = useState(null);
  // Whether focus arrived by keyboard. Set true on any Tab/arrow keydown and false on
  // mousedown, which is the same signal :focus-visible derives — reimplemented here only
  // because engines disagree about it (Island paints the UA ring where Chromium does not).
  const [keyNav, setKeyNav] = useState(false);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Tab" || e.key.startsWith("Arrow")) setKeyNav(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const corp = snapshot?.source?.corporation;
  const version = benchmarks?.benchmarkVersion?.version || snapshot?.benchmarkVersion?.version;

  return (
    <header style={{ borderBottom: `1px solid ${C.borderSubtle}`, background: C.surfaceDefault }}>
      <div style={{ padding: "18px 24px 0" }}>
        {/* Logo is its own standalone element above the heading, left edge aligned with
            it — per Ink's brand rule. Not inline beside the title, not in a bar of its
            own: a logo that sits inline with an h1 reads as a rendering bug. */}
        <CartaLogo />

        <div style={{
          display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginTop: 12,
        }}>
          {/* Ink's real h1: 28px, weight 400, serif/prominent family. The old 600-weight
              sans treatment was neither — Ink heading weights are 400 or 500, never
              bold, and the page title is the one place the display serif belongs. */}
          <h1 style={{
            margin: 0, fontSize: FS.xxl, fontWeight: 400, fontFamily: SERIF,
            color: C.textDefault,
          }}>
            {corp || "Compensation"}
          </h1>
          <span style={{ fontSize: FS.md, color: C.textSubtle }}>Carta Total Compensation</span>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          {peerLabel && <Tag>Peer group {peerLabel}</Tag>}
          {version && <Tag>Benchmarks {version}</Tag>}
          {benchmarks?.equityQuantity === "FOUR_YEAR_GRANT" && <Tag>Equity: 4-year grant</Tag>}
        </div>

        {/* Tab focus is owned explicitly rather than left to the UA.

            The active label is brand black and so is Ink's focus outline, so any ring a
            browser paints for itself lands invisibly ON the text — which is how the
            selected tab's label disappeared. A `:focus:not(:focus-visible)` rule fixed it
            in Chromium but stays at the mercy of each engine's UA stylesheet and its
            `:focus-visible` heuristics (Island and Safari differ here), so each button
            also declares `outline: none` inline and draws its own ring from state.

            The ring is gated on keyNav (set from an observed Tab/arrow keydown): a ring
            is a keyboard-navigation affordance, and painting a heavy box on every mouse
            click is its own visual bug. That reimplements what :focus-visible would give
            us, from an event we observe ourselves so it behaves the same everywhere. */}
        <nav style={{ display: "flex", gap: 2, marginTop: 16 }}>
          {tabs.map((t) => {
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-current={active ? "page" : undefined}
                onFocus={() => setFocusedTab(t.id)}
                onBlur={() => setFocusedTab(null)}
                onMouseDown={() => setKeyNav(false)}
                style={{
                  border: "none", background: "none", padding: "8px 12px",
                  fontSize: FS.md, fontWeight: active ? 500 : 400,
                  // Active/selected is the brand-black ROLE, not blue — Ink reserves the
                  // link blue for links, focus and info accents. This was the
                  // `accent`-does-both conflation the Ink retrofit split apart.
                  //
                  // ...but via interactivePrimaryOnPage, not interactivePrimary: these are
                  // text and a rule drawn straight onto the page, and brand black is a flat
                  // #1A1A1A that does not adapt. In dark mode it put #1A1A1A on #121212 and
                  // the selected tab's label and underline both vanished.
                  color: active ? C.interactivePrimaryOnPage : C.textSubtle,
                  borderBottom: `2px solid ${active ? C.interactivePrimaryOnPage : "transparent"}`,
                  cursor: "pointer",
                  outline: "none",
                  // Radius only while the ring is drawn: applied unconditionally it
                  // rounds the 2px active underline into a tab-shaped curve.
                  borderRadius: keyNav && focusedTab === t.id ? RADIUS : 0,
                  // Inset so the ring never overlaps the glyphs, unlike the UA outline.
                  boxShadow: keyNav && focusedTab === t.id
                    ? `inset 0 0 0 2px ${C.linkDefault}` : "none",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

function Message({ title, body, tone }) {
  const warn = tone === "warn";
  return (
    <div style={{
      margin: 24, padding: "14px 16px", borderRadius: RADIUS,
      background: warn ? C.feedbackNoticeSubtle : C.surfaceUnderlay,
      // Ink's tag/banner rule: the border carries the semantic TONE, not a neutral
      // gray and not a hand-mixed tint (this was a hardcoded #EBD9B4).
      border: `1px solid ${warn ? C.feedbackNotice : C.borderSubtle}`,
      color: warn ? C.feedbackNotice : C.textSubtle, fontSize: FS.md, maxWidth: 620,
    }}>
      <strong style={{ display: "block", marginBottom: 4, color: warn ? C.warn : C.text }}>{title}</strong>
      {body}
    </div>
  );
}

export default function App() {
  useGlobalCss();
  const [tab, setTab] = useState("benchmarks");
  // Declared with the other hooks, ABOVE the early returns below. React requires the
  // same hooks to run in the same order on every render, and the loading/error paths
  // return before the main body — so a useState placed after them runs on the loaded
  // render but not the loading one, which is React error #310.
  //
  // Holds the whole active peer group, not just its citation sentence: the group's LABEL
  // appears in three places (header pill, footer citation, and the figures themselves),
  // and passing only the sentence up left the header pill reading the build's own group
  // forever — so after a switch the pill and the dropdown disagreed about what was on
  // screen. One source, one update.
  const [activeGroup, setActiveGroup] = useState(null);
  const { loading, error, snapshot, benchmarks, roster } = useDashboardData();

  if (loading) return <Message title="Loading…" body="Reading the local snapshot." />;
  if (error) return <Message title="Couldn't load the dashboard" body={error} tone="warn" />;
  if (!benchmarks) {
    return (
      <Message
        tone="warn"
        title="No benchmark data yet"
        body="This data directory has no benchmarks.json. Re-run the skill to build it."
      />
    );
  }

  // The attribution is contractual: any surface showing benchmark figures must cite the
  // peer group and release date alongside them.
  //
  // Held in state because the Benchmarks tab can switch peer group, and the citation has
  // to move with the figures — the peer-group LABEL is inside the sentence, so a fixed
  // string would mis-cite every group but the default. Benchmarks reports its active
  // citation up via onPeerGroupChange; the build's own value is the initial fallback.
  const buildAttribution = benchmarks.attribution || snapshot?.attribution;
  const attribution = activeGroup?.attribution || buildAttribution;

  // The peer-group pill tracks the SELECTION; version and equity basis are invariant
  // across groups (same benchmark release, same FOUR_YEAR_GRANT basis — that is why a
  // switch needs no re-fetch), so they come from the build and never go stale.
  //
  // Only shown on the tab that can change it. On the Scorecard the control isn't
  // reachable, so a pill there would state a peer group the reader can't see chosen or
  // change — and after a switch on the other tab it would describe figures not on screen.
  const activePeerLabel = tab === "benchmarks"
    ? (activeGroup?.label || benchmarks.peerGroup?.label || snapshot?.peerGroup?.label)
    : null;

  const tabs = tabsFor({ roster });

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: SANS }}>
      <Header
        snapshot={snapshot} benchmarks={benchmarks} peerLabel={activePeerLabel}
        tabs={tabs} tab={tab} setTab={setTab}
      />
      <main style={{ paddingTop: 4 }}>
        {tab === "benchmarks" && (
          <Benchmarks data={benchmarks} onPeerGroupChange={setActiveGroup} />
        )}
        {/* Guarded on roster as well as the tab id: a stale ?tab= or a roster that
            failed to load must not render the view against undefined. */}
        {tab === "scorecard" && roster && (
          <Scorecard roster={roster} corporation={snapshot?.source?.corporation} />
        )}
      </main>
      {attribution && (
        <footer style={{
          borderTop: `1px solid ${C.border}`, padding: "14px 24px 28px",
          fontSize: FS.sm, color: C.textFaint, fontStyle: "italic",
        }}>
          {attribution}
        </footer>
      )}
    </div>
  );
}
