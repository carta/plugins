// Chart preferences delivered by context, so the ~12 <Chart> call sites don't
// each have to thread `dashboard` down as a prop. Mounted once in App.jsx around
// the tab content; Chart/Scatter/Heatmap read it with useChartPrefs().
//
// A side benefit: because prefs live outside the component, the expanded-modal
// copy of a chart shares them — previously the modal rendered a second <Chart>
// with its own `labels` state, so toggling labels inline didn't carry through.
import { createContext, useContext, useMemo, createElement } from "react";
import { resolveChartPrefs, DEFAULTS, hasOverrides } from "../model/chartPrefs.js";

const Ctx = createContext(null);

export function ChartPrefsProvider({ dashboard, children }) {
  const doc = dashboard && dashboard.doc;
  const value = useMemo(() => ({
    doc,
    /** Flat, resolved settings for one chart. */
    get: (chartId, propDefaults) => resolveChartPrefs(doc, chartId, propDefaults),
    /** Patch a chart's own overrides (scope "chart") or the app-wide layer ("global"). */
    set: (chartId, patch, scope = "chart") => {
      if (!dashboard || !dashboard.update) return;
      dashboard.update((d) => {
        if (!d.chartPrefs) d.chartPrefs = { global: {}, byChart: {} };
        if (!d.chartPrefs.byChart) d.chartPrefs.byChart = {};
        if (!d.chartPrefs.global) d.chartPrefs.global = {};
        const target = scope === "global" ? d.chartPrefs.global
          : (d.chartPrefs.byChart[chartId] = d.chartPrefs.byChart[chartId] || {});
        for (const [k, v] of Object.entries(patch)) {
          // `colors` is a nested map — merge rather than replace
          if (k === "colors") target.colors = { ...(target.colors || {}), ...v };
          else target[k] = v;
        }
        return d;
      });
    },
    /** Drop overrides for one chart, or clear the global layer. */
    reset: (chartId, scope = "chart") => {
      if (!dashboard || !dashboard.update) return;
      dashboard.update((d) => {
        if (!d.chartPrefs) return null;
        if (scope === "global") d.chartPrefs.global = {};
        else if (d.chartPrefs.byChart) delete d.chartPrefs.byChart[chartId];
        return d;
      });
    },
    /** Whether this chart carries its own overrides (drives the "modified" dot). */
    isCustom: (chartId) => hasOverrides(doc, chartId),
  }), [doc, dashboard]);
  return createElement(Ctx.Provider, { value }, children);
}

/** Resolved prefs + writers for a chart. Safe outside a provider (read-only
 *  defaults), so charts still render in isolation or before the doc loads. */
export function useChartPrefs(chartId, propDefaults) {
  const ctx = useContext(Ctx);
  if (!ctx) {
    return { prefs: { ...DEFAULTS, ...(propDefaults || {}) }, set: () => {}, reset: () => {}, isCustom: false, available: false };
  }
  return {
    prefs: ctx.get(chartId, propDefaults),
    set: (patch, scope) => ctx.set(chartId, patch, scope),
    reset: (scope) => ctx.reset(chartId, scope),
    isCustom: ctx.isCustom(chartId),
    available: true,
  };
}
