// Tag chips shared by the Dashboard pivot rows and the Company page header so the
// two can't drift apart.
//
// Carta chips are read-only by design: no MCP write path exists for Fund Admin
// investment tags, so the app never offers to add or remove one.
import { useState, useMemo } from "react";
import { Badge } from "./components.jsx";
import { tagsFor, tagId } from "../model/tags.js";
import { STATUS_CAT, toneForStatus } from "../model/status.js";

const CHIP = { height: "auto", padding: "1px 6px", fontSize: 10, lineHeight: "16px" };

// A long custom tag has no spaces, so Badge's default nowrap grows it sideways
// into the next column. Wrap and cap width; overflowWrap:anywhere breaks the string.
const WRAP = { whiteSpace: "normal", overflowWrap: "anywhere", height: "auto", maxWidth: 220, textAlign: "left" };

/** Status is colour-coded by outcome; every other Carta category keeps the
 *  single "info" blue, so colour stays meaningful rather than decorative. */
const toneFor = (t) => (t.cat === STATUS_CAT ? toneForStatus(t.value) : "info");

/** Status is computed from holdings, not fetched, so it must not claim to
 *  come from Carta's own tags. */
const titleFor = (t) =>
  t.cat === STATUS_CAT
    ? `${t.cat} — derived from holdings`
    : `${t.cat} — from Carta`;

// Collapse Carta chips that repeat a value (case-insensitive), keeping the first.
// Fund Admin data routinely echoes a value across categories — "US" as both
// Country and Region — which reads as pure noise in the grid.
const dedupeByValue = (tags) => {
  const seen = new Set();
  return tags.filter((t) => { const k = t.value.trim().toLowerCase(); return seen.has(k) ? false : seen.add(k); });
};

/** Status stays visible; every other Carta tag collapses behind a single
 *  "Tags (N)" pill that expands the chips inline on click, keeping dense rows
 *  readable. `compact` shrinks the chips for the Dashboard grid. */
export function CompanyTags({ company, compact = false }) {
  const all = useMemo(() => tagsFor(company), [company]);
  const status = useMemo(() => all.filter((t) => t.cat === STATUS_CAT), [all]);
  const rest = useMemo(() => dedupeByValue(all.filter((t) => t.cat !== STATUS_CAT)), [all]);
  const [expanded, setExpanded] = useState(false);
  // A chromeless button so the pill / Show-less chip stays a Badge (keeps its
  // tone and hover title) while becoming clickable.
  const chipBtn = { border: "none", background: "transparent", padding: 0, margin: 0, cursor: "pointer", lineHeight: 0 };
  const chip = (t) => (
    <Badge key={tagId(t.cat, t.value)} tone={toneFor(t)} title={titleFor(t)}
      style={{ ...(compact ? CHIP : {}), ...WRAP, cursor: "default" }}>
      {t.value}
    </Badge>
  );

  return (
    <>
      {status.map(chip)}
      {rest.length > 0 && !expanded && (
        <button type="button" onClick={() => setExpanded(true)} style={chipBtn}
          aria-label={`Show ${rest.length} tags`}>
          <Badge tone="neutral" title={rest.map((t) => `${t.cat}: ${t.value}`).join("\n")}
            style={compact ? CHIP : undefined}>
            Tags ({rest.length})
          </Badge>
        </button>
      )}
      {expanded && rest.map(chip)}
      {expanded && rest.length > 0 && (
        <button type="button" onClick={() => setExpanded(false)} style={chipBtn} aria-label="Show fewer tags">
          <Badge tone="neutral" style={compact ? CHIP : undefined}>Show less</Badge>
        </button>
      )}
    </>
  );
}
