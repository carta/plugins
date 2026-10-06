// Mounts only the pivot company groups near the viewport; two spacer rows keep the scroll height.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { findScrollParent } from "./components.jsx";

/** Tables at or under this many rows render in full — windowing buys nothing there. */
export const WINDOW_MIN_ROWS = 150;
// Height guess for a row nobody has measured yet (one line of 14px text + 9px padding twice).
const DEFAULT_ROW_H = 40;

/** Contiguous runs of rows sharing a companyId: `[{ id, start, count }]`. */
export function groupRows(rows) {
  const out = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && last.id === r.companyId) last.count++;
    else out.push({ id: r.companyId, start: out.length ? last.start + last.count : 0, count: 1 });
  }
  return out;
}

/** Sum of `heights[from..to)`. */
export const sumHeights = (heights, from, to) => {
  let s = 0;
  for (let i = from; i < to; i++) s += heights[i];
  return s;
};

/** Which groups to mount. `offset` is how far the viewport's top sits below the top of
 *  the first group; `overscan` extends the mounted band that many px past both viewport
 *  edges. Returns `{ start, end }` (end exclusive), always at least one group when any exist. */
export function windowRange(heights, offset, viewH, overscan) {
  const n = heights.length;
  if (!n) return { start: 0, end: 0 };
  const lo = offset - overscan, hi = offset + viewH + overscan;
  let top = 0, start = n - 1;
  for (let i = 0; i < n; i++) {
    if (top + heights[i] > lo) { start = i; break; }
    top += heights[i];
  }
  let end = start + 1, bottom = top + heights[start];
  while (end < n && bottom < hi) bottom += heights[end++];
  return { start, end };
}

/** Windows `groups` against the page's scroll position. While printing the whole table
 *  mounts (`windowed: false`), so a printout still carries every row.
 *  `resetKey` drops the measured heights when something changes row height wholesale.
 *  Returns `{ windowed, rowStart, rowEnd, padTop, padBottom }`; the caller renders rows
 *  `[rowStart, rowEnd)` between spacer rows of those heights, tagging each `<tr>` with
 *  `data-company` so its height can be measured. */
export function useRowWindow({ groups, wrapRef, tbodyRef, resetKey }) {
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const on = () => flushSync(() => setPrinting(true));
    const off = () => setPrinting(false);
    const mq = window.matchMedia ? window.matchMedia("print") : null;
    const onMq = (e) => (e.matches ? on() : off());
    window.addEventListener("beforeprint", on);
    window.addEventListener("afterprint", off);
    if (mq && mq.addEventListener) mq.addEventListener("change", onMq);
    return () => {
      window.removeEventListener("beforeprint", on);
      window.removeEventListener("afterprint", off);
      if (mq && mq.removeEventListener) mq.removeEventListener("change", onMq);
    };
  }, []);

  const rowCount = groups.length ? groups[groups.length - 1].start + groups[groups.length - 1].count : 0;
  const windowed = rowCount > WINDOW_MIN_ROWS && !printing;

  // Measured group heights by company id, as `{ n, h }` (rows, px). A group nobody has
  // measured costs the running average row height times its row count.
  const measured = useRef(new Map());
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const heightsOf = useCallback(() => {
    let h = 0, n = 0;
    for (const m of measured.current.values()) { h += m.h; n += m.n; }
    const avg = n ? h / n : DEFAULT_ROW_H;
    return groupsRef.current.map((g) => {
      const m = measured.current.get(g.id);
      return m && m.n === g.count ? m.h : g.count * avg;
    });
  }, []);

  const [, setTick] = useState(0);
  const [range, setRange] = useState(() => {
    const vh = typeof window === "undefined" ? 800 : window.innerHeight;
    return windowRange(heightsOf(), 0, vh, vh);
  });

  const resetRef = useRef(resetKey);
  if (resetRef.current !== resetKey) { resetRef.current = resetKey; measured.current.clear(); }

  const place = useCallback(() => {
    const tbody = tbodyRef.current, wrap = wrapRef.current;
    if (!tbody || !wrap) return;
    const sp = findScrollParent(wrap);
    const viewH = sp ? sp.clientHeight : window.innerHeight;
    if (!viewH) return;
    const offset = (sp ? sp.getBoundingClientRect().top : 0) - tbody.getBoundingClientRect().top;
    const next = windowRange(heightsOf(), offset, viewH, viewH);
    setRange((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
  }, [tbodyRef, wrapRef, heightsOf]);

  // After every commit: record the real height of each mounted group, then re-place the
  // window against the corrected heights before the browser paints.
  useLayoutEffect(() => {
    if (!windowed) return;
    const tbody = tbodyRef.current;
    if (!tbody) return;
    const sums = new Map();
    for (const tr of tbody.children) {
      const id = tr.dataset.company;
      if (id !== undefined) sums.set(id, (sums.get(id) || 0) + tr.getBoundingClientRect().height);
    }
    let changed = false;
    for (const g of groupsRef.current) {
      const h = sums.get(String(g.id));
      if (!h) continue;   // unmounted, or no layout (e.g. a detached DOM)
      const prev = measured.current.get(g.id);
      if (!prev || prev.n !== g.count || Math.abs(prev.h - h) > 0.5) {
        measured.current.set(g.id, { n: g.count, h });
        changed = true;
      }
    }
    if (changed) setTick((t) => t + 1);
    place();
  });

  useEffect(() => {
    if (!windowed) return undefined;
    document.addEventListener("scroll", place, { capture: true, passive: true });
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [windowed, place]);

  if (!windowed) return { windowed: false, rowStart: 0, rowEnd: rowCount, padTop: 0, padBottom: 0 };
  const heights = heightsOf();
  const start = Math.min(range.start, Math.max(0, groups.length - 1));
  const end = Math.max(start + 1, Math.min(range.end, groups.length));
  return {
    windowed: true,
    rowStart: groups[start].start,
    rowEnd: groups[end - 1].start + groups[end - 1].count,
    padTop: sumHeights(heights, 0, start),
    padBottom: sumHeights(heights, end, groups.length),
  };
}
