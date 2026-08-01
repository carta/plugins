// Pragmatic, SAFE markdown -> React renderer for assistant chat messages.
// React elements only — no dangerouslySetInnerHTML. Covers a small subset:
// fenced code blocks, inline code, bold, italic, links, unordered + ordered
// lists, and paragraphs. Anything unrecognized falls through as literal text.
import { FS } from "./theme.js";

let _k = 0;
const k = () => "md" + (_k++);

function inline(text) {
  const nodes = [];
  let rest = String(text);
  // Italic is *asterisk* only — underscore emphasis is intentionally NOT supported
  // so identifiers/paths/error codes with intraword underscores (turn_in_progress,
  // app/src/…) render literally instead of italicizing the middle segment.
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/;
  while (rest) {
    const m = re.exec(rest);
    if (!m) { nodes.push(rest); break; }
    if (m.index > 0) nodes.push(rest.slice(0, m.index));
    const t = m[0];
    if (t[0] === "`") nodes.push(<code key={k()} style={{ fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", background: "var(--ink-color-global-surface-lightgray-default)", padding: "1px 4px", borderRadius: 3 }}>{t.slice(1, -1)}</code>);
    else if (t.slice(0, 2) === "**") nodes.push(<strong key={k()}>{t.slice(2, -2)}</strong>);
    else if (t[0] === "[") { const mm = /\[([^\]]+)\]\(([^)]+)\)/.exec(t); nodes.push(<a key={k()} href={mm[2]} target="_blank" rel="noreferrer">{mm[1]}</a>); }
    else nodes.push(<em key={k()}>{t.slice(1, -1)}</em>);
    rest = rest.slice(m.index + t.length);
  }
  return nodes;
}

const TABLE_DELIM_RE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/;
const HEADING_RE = /^\s*(#{1,6})\s+(.*)$/;
const BLOCKQUOTE_RE = /^\s*>\s?/;
const HR_RE = /^\s*([-*_])\1{2,}\s*$/;
const HEADING_SIZE = { 1: 20, 2: 18, 3: 15, 4: 14, 5: 13, 6: 12 };

function splitTableRow(line) {
  const cells = line.split("|").map((c) => c.trim());
  if (cells.length && cells[0] === "") cells.shift();
  if (cells.length && cells[cells.length - 1] === "") cells.pop();
  return cells;
}

function delimAlign(cell) {
  const left = cell.startsWith(":"), right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return undefined;
}

export function renderMarkdown(src) {
  const out = [];
  const lines = String(src || "").split("\n");
  let i = 0;
  const isList = (l) => /^\s*[-*]\s+/.test(l), isOl = (l) => /^\s*\d+\.\s+/.test(l), isFence = (l) => /^```/.test(l);
  const isTableStart = (idx) => lines[idx] != null && lines[idx].includes("|") && lines[idx + 1] != null && TABLE_DELIM_RE.test(lines[idx + 1]);
  const isHeading = (l) => HEADING_RE.test(l);
  const isBlockquote = (l) => BLOCKQUOTE_RE.test(l);
  const isHr = (l) => HR_RE.test(l);
  const isBlockStart = (idx) => {
    const l = lines[idx];
    return l == null || l.trim() === "" || isFence(l) || isList(l) || isOl(l) || isTableStart(idx) || isHeading(l) || isBlockquote(l) || isHr(l);
  };
  while (i < lines.length) {
    const line = lines[i];
    if (isFence(line)) {
      const body = []; i++;
      while (i < lines.length && !isFence(lines[i])) { body.push(lines[i]); i++; }
      i++;
      out.push(<pre key={k()} style={{ background: "var(--ink-color-global-surface-lightgray-default)", padding: 10, borderRadius: 6, overflowX: "auto", fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", fontSize: FS.body, margin: "6px 0" }}><code>{body.join("\n")}</code></pre>);
      continue;
    }
    if (isList(line)) {
      const items = []; while (i < lines.length && isList(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, "")); i++; }
      out.push(<ul key={k()} style={{ margin: "4px 0", paddingLeft: 18 }}>{items.map((it) => <li key={k()}>{inline(it)}</li>)}</ul>);
      continue;
    }
    if (isOl(line)) {
      const items = []; while (i < lines.length && isOl(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, "")); i++; }
      out.push(<ol key={k()} style={{ margin: "4px 0", paddingLeft: 18 }}>{items.map((it) => <li key={k()}>{inline(it)}</li>)}</ol>);
      continue;
    }
    // TABLE must be checked before HR — a table's `---` delimiter row is
    // consumed here, so a lone `---` reaching the HR check below is real.
    if (isTableStart(i)) {
      const headerCells = splitTableRow(line);
      const delimCells = splitTableRow(lines[i + 1]);
      const align = delimCells.map(delimAlign);
      const colCount = headerCells.length;
      i += 2;
      const bodyRows = [];
      while (i < lines.length && lines[i].includes("|")) {
        const cells = splitTableRow(lines[i]);
        while (cells.length < colCount) cells.push("");
        cells.length = colCount;
        bodyRows.push(cells);
        i++;
      }
      out.push(
        <table key={k()} style={{ borderCollapse: "collapse", margin: "6px 0", fontSize: FS.body, width: "100%" }}>
          <thead><tr>{headerCells.map((c, ci) => (
            <th key={k()} style={{ textAlign: align[ci] || "left", borderBottom: "1px solid var(--ink-color-global-border-default)", padding: "4px 8px", fontWeight: 600 }}>{inline(c)}</th>
          ))}</tr></thead>
          <tbody>{bodyRows.map((row) => (
            <tr key={k()}>{row.map((c, ci) => (
              <td key={k()} style={{ textAlign: align[ci] || "left", borderBottom: "1px solid var(--ink-color-global-border-subtle)", padding: "4px 8px" }}>{inline(c)}</td>
            ))}</tr>
          ))}</tbody>
        </table>
      );
      continue;
    }
    if (isHr(line)) { i++; out.push(<hr key={k()} style={{ border: 0, borderTop: "1px solid var(--ink-color-global-border-subtle)", margin: "8px 0" }}/>); continue; }
    const headingMatch = HEADING_RE.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const Tag = `h${level}`;
      i++;
      out.push(<Tag key={k()} style={{ fontSize: HEADING_SIZE[level], margin: "8px 0 4px", fontWeight: 700 }}>{inline(headingMatch[2])}</Tag>);
      continue;
    }
    if (isBlockquote(line)) {
      const body = []; while (i < lines.length && isBlockquote(lines[i])) { body.push(lines[i].replace(BLOCKQUOTE_RE, "")); i++; }
      out.push(<blockquote key={k()} style={{ margin: "4px 0", padding: "2px 0 2px 10px", borderLeft: "3px solid var(--ink-color-global-border-subtle)", color: "var(--ink-color-global-text-subtle)" }}>{inline(body.join("\n"))}</blockquote>);
      continue;
    }
    if (line.trim() === "") { i++; continue; }
    const para = [line]; i++;
    while (i < lines.length && !isBlockStart(i)) { para.push(lines[i]); i++; }
    out.push(<p key={k()} style={{ margin: "4px 0", whiteSpace: "pre-wrap" }}>{inline(para.join("\n"))}</p>);
  }
  return out;
}
