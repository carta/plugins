import { GLOBAL_CSS } from "./theme.js";

// Snapshot-to-HTML export. Charts are inline SVG (ui/components.jsx), so
// cloning the rendered element captures them verbatim — no canvas involved.
// A window.print()-based PDF path was tried and dropped: nothing in this
// marketplace generates one from a click without a new dependency this app avoids.

const MONTH_NAME = ["January", "February", "March", "April", "May", "June",
                     "July", "August", "September", "October", "November", "December"];

function fmtAsOf(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("-").map(Number);
  return `${MONTH_NAME[m - 1]} ${d}, ${y}`;
}

let tokensCssCache = null;

// Ink's raw --ink-color-global-* tokens. The live app links this file; a
// standalone export has no such link target, so its text is inlined instead.
async function fetchTokensCss() {
  if (tokensCssCache != null) return tokensCssCache;
  try {
    const res = await fetch("/src/ui/tokens.css");
    tokensCssCache = res.ok ? await res.text() : "";
  } catch {
    tokensCssCache = "";
  }
  return tokensCssCache;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function slugify(s) {
  return String(s || "export").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "export";
}

function cloneWithoutExcluded(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll("[data-export-exclude]").forEach((n) => n.remove());
  return clone;
}

// Chart SVGs carry no viewBox and are sized to the live container's width.
// Add one so a clone scales with its new container instead of a frozen size.
function makeChartsResponsive(root) {
  root.querySelectorAll(".ink-chart__plot").forEach((plot) => { plot.style.height = "auto"; });
  root.querySelectorAll("svg").forEach((svg) => {
    if (svg.hasAttribute("viewBox")) return; // icons already carry their own
    const w = parseFloat(svg.getAttribute("width"));
    const h = parseFloat(svg.getAttribute("height"));
    if (!w || !h) return;
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.style.width = "100%";
    svg.style.height = "auto";
    svg.style.display = "block";
  });
}

function buildDocument({ title, entityName, pageLabel, asOf, bodyHtml, tokensCss, generatedAt }) {
  const meta = [pageLabel, asOf ? `As of ${fmtAsOf(asOf)}` : null].filter(Boolean).map(escapeHtml).join(" · ");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://rsms.me/" />
<link rel="stylesheet" href="https://rsms.me/inter/inter.css" />
<style>${tokensCss}</style>
<style>${GLOBAL_CSS}</style>
<style>
  html, body { margin: 0; padding: 0; background: var(--paper, #fff); }
  body { padding: 28px 40px 48px; }
  /* Stands in for the hover tooltip, which has no JS behind it here. */
  .ink-chart__value-label { display: block !important; }
  .manco-export-header {
    display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
    margin-bottom: 20px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--line, #E9EAEA);
  }
  .manco-export-header__entity {
    font: 600 20px/1.3 Inter, sans-serif;
    color: var(--ink, #1A1A1A);
  }
  .manco-export-header__meta {
    font: 400 13px/1.4 Inter, sans-serif;
    color: var(--faint, #656B6B);
  }
  .manco-export-footer {
    font: 400 11px/1.4 Inter, sans-serif;
    color: var(--faint, #656B6B);
    margin-top: 28px;
    padding-top: 10px;
    border-top: 1px solid var(--line, #E9EAEA);
  }
</style>
</head>
<body>
<div class="manco-export-header">
  <span class="manco-export-header__entity">${escapeHtml(entityName)}</span>
  ${meta ? `<span class="manco-export-header__meta">${meta}</span>` : ""}
</div>
${bodyHtml}
<div class="manco-export-footer">Exported from Carta Mgmt Company Reporting — ${escapeHtml(generatedAt)}</div>
</body>
</html>
`;
}

// Clones `el`, drops anything marked data-export-exclude, and downloads the
// result as one standalone .html file — no server or app behind it.
export async function exportElementAsHtml(el, { entityName, pageLabel, asOf, filenameBase }) {
  if (!el) return;
  const tokensCss = await fetchTokensCss();
  const clone = cloneWithoutExcluded(el);
  makeChartsResponsive(clone);
  const generatedAt = new Date().toLocaleString();
  const title = [entityName, pageLabel].filter(Boolean).join(" — ") || "Carta Mgmt Company Reporting";
  const html = buildDocument({ title, entityName, pageLabel, asOf, bodyHtml: clone.outerHTML, tokensCss, generatedAt });

  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slugify(filenameBase)}-${new Date().toISOString().slice(0, 10)}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
