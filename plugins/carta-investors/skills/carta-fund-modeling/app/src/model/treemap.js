// Treemap layout for the Companies map — pure geometry, no React.
//
// Squarified layout (Bruls, Huizing & van Wijk): boxes are laid in rows along
// the shorter side of the space left, and a row grows only while that keeps its
// boxes closer to square — so labels get room and small values stay visible.

// How far the row's least-square box is from a square (1 = square) when the
// row's areas are laid along a side of length `side`.
function worstRatio(areas, side) {
  const sum = areas.reduce((s, a) => s + a, 0);
  const max = Math.max(...areas);
  const min = Math.min(...areas);
  return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
}

/** Tile `rect` ({x, y, w, h}) with one box per item whose value is above 0,
 *  each box's area proportional to its value. Returns the kept items, largest
 *  first, each with its box's x, y, w, h added. */
export function squarify(items, rect) {
  const kept = items.filter((it) => it.value > 0).sort((a, b) => b.value - a.value);
  const total = kept.reduce((s, it) => s + it.value, 0);
  if (!total || rect.w <= 0 || rect.h <= 0) return [];
  const scale = (rect.w * rect.h) / total;
  const out = [];
  let { x, y, w, h } = rect;

  const placeRow = (row) => {
    const area = row.reduce((s, it) => s + it.value * scale, 0);
    if (w >= h) {
      // a column against the left edge, boxes stacked top to bottom
      const colW = area / h;
      let cy = y;
      for (const it of row) {
        const bh = (it.value * scale) / colW;
        out.push({ ...it, x, y: cy, w: colW, h: bh });
        cy += bh;
      }
      x += colW;
      w -= colW;
    } else {
      // a row against the top edge, boxes left to right
      const rowH = area / w;
      let cx = x;
      for (const it of row) {
        const bw = (it.value * scale) / rowH;
        out.push({ ...it, x: cx, y, w: bw, h: rowH });
        cx += bw;
      }
      y += rowH;
      h -= rowH;
    }
  };

  let row = [];
  for (const it of kept) {
    const side = Math.min(w, h);
    const areas = row.map((r) => r.value * scale);
    const next = [...areas, it.value * scale];
    if (row.length && worstRatio(next, side) > worstRatio(areas, side)) {
      placeRow(row);
      row = [];
    }
    row.push(it);
  }
  if (row.length) placeRow(row);
  return out;
}

/** Two-level treemap: groups ({id, items: [{id, value}]}) tile `rect` by their
 *  total value, then each group's items tile its box. `gap` is the space left
 *  between neighbouring groups. Groups with nothing above 0 are dropped. */
export function layoutTreemap(groups, rect, { gap = 0 } = {}) {
  const sized = groups.map((g) => ({
    ...g,
    value: g.items.reduce((s, it) => s + (it.value > 0 ? it.value : 0), 0),
  }));
  return squarify(sized, rect).map((g) => {
    const inner = { x: g.x + gap / 2, y: g.y + gap / 2, w: Math.max(0, g.w - gap), h: Math.max(0, g.h - gap) };
    return { ...g, items: squarify(g.items, inner) };
  });
}
