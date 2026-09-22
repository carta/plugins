// Host tab: enriches the data with custom formula metrics, then renders the
// flat, click-to-sort ranked table.
import { useMemo } from "react";
import { sans } from "../ui/theme.js";
import { withCustomMetrics } from "../model/derived.js";
import { injectFormulaInputs } from "../model/overviewColumns.js";
import RankedTable from "./overview/RankedTable.jsx";
import { GlobalFilter, useOverviewFilter } from "./overview/OverviewFilters.jsx";
import WhatChanged from "./overview/WhatChanged.jsx";

/** Inject numeric position/computed columns as formula inputs, then splice saved
 *  custom formula metrics in as `custom:<id>` metrics. Exported for a unit test. */
export function overviewData(rawData, doc) {
  return withCustomMetrics(injectFormulaInputs(rawData), doc?.customMetrics || []);
}

export default function Overview({ data: rawData, dashboard }) {
  // Recomputes when rawData or customMetrics changes. dashboard.update clones
  // the doc, so any edit gives customMetrics a new reference (expected, cheap).
  const data = useMemo(
    () => overviewData(rawData, dashboard?.doc),
    [rawData, dashboard?.doc?.customMetrics],
  );
  const { filterCompanies, filterApi, filterProps } = useOverviewFilter(data, dashboard);
  const companies = data.companies || [];
  // Filtering needs the doc (tags/favorites/signals), so it only runs with a dashboard.
  const shown = dashboard ? filterCompanies(companies) : companies;
  const empty = companies.length === 0;
  const noMatch = !empty && shown.length === 0;

  return (
    <>
      <WhatChanged data={rawData} dashboard={dashboard} />

      <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <h2 style={{ ...sans, margin: 0, fontSize: 20, lineHeight: "28px", fontWeight: 600, letterSpacing: "-0.01em", color: "var(--ink-color-global-text-default)" }}>Portfolio</h2>

        {/* Stays up when the filter matches nothing — hiding it there strands the
            user with an empty table and no way to clear what emptied it. */}
        {!empty && dashboard && (
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <GlobalFilter {...filterProps} />
          </div>
        )}

        {empty ? (
          <div style={{ ...sans, textAlign: "center", padding: "60px 20px", color: "var(--ink-color-global-text-subtle)" }}>
            No portfolio companies report KPIs yet
          </div>
        ) : noMatch ? (
          <div style={{ ...sans, textAlign: "center", padding: "60px 20px", color: "var(--ink-color-global-text-subtle)" }}>
            No companies match this filter
          </div>
        ) : (
          <RankedTable rows={shown.map((c) => ({ id: c.id, name: c.name }))} data={data} dashboard={dashboard}
            filterApi={dashboard ? filterApi : undefined} />
        )}
      </section>
    </>
  );
}
