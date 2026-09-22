// Splice saved custom metrics into `data` as derived KPIs, so every view treats
// them like reported metrics. Refs resolve against REPORTED metrics only (acyclic).
import { buildCustomMetric } from "./customMetrics.js";

export function withCustomMetrics(data, customMetrics) {
  const list = customMetrics || [];
  if (!data || !list.length) return data;

  // Idempotent against a second call on the same data — a repeat call would
  // otherwise splice in duplicate custom metrics (doubling the Formulas picker).
  const already = new Set((data.metrics || []).filter((m) => m.custom).map((m) => m.key));
  const rows = list.filter((row) => !already.has(`custom:${row.id}`));
  if (!rows.length) return data;

  const reported = (data.metrics || []).filter((m) => !m.derived && !m.custom);
  const companies = data.companies || [];
  // Keep only rows that produced a series for at least one company — a row whose
  // expression references an unknown KPI (or evaluates for nobody) shouldn't
  // surface an empty, broken-looking metric across the rest of the app.
  const built = rows.map((row) => buildCustomMetric(row, companies, reported)).filter((b) => Object.keys(b.series).length);
  if (!built.length) return data;

  const nextCompanies = companies.map((c) => {
    const extra = {};
    for (const { metric, series } of built) if (series[c.id]) extra[metric.key] = series[c.id];
    return Object.keys(extra).length ? { ...c, series: { ...(c.series || {}), ...extra } } : c;
  });

  return { ...data, metrics: [...(data.metrics || []), ...built.map((b) => b.metric)], companies: nextCompanies };
}
