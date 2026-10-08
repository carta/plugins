import { FS, sans } from "../../ui/theme.js";
import { Btn } from "../../ui/components.jsx";
import { buildReport, reportCsv } from "../../model/construction/report.js";
import { trackClick } from "../../analytics.js";

const subtle = { color: "var(--ink-color-global-text-subtle)" };

const PRINT_CSS = `
@media print {
  body * { visibility: hidden; }
  .fc-report, .fc-report * { visibility: visible; }
  .fc-report { position: absolute; left: 0; top: 0; width: 100%; }
  .fc-report .no-print { display: none !important; }
  .fc-report section { break-inside: avoid; }
}`;

function Table({ table }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="ledger" style={{ width: "100%" }}>
        <thead><tr>{table.columns.map((c) => <th key={c.key} style={{ textAlign: c.align }}>{c.label}</th>)}</tr></thead>
        <tbody>
          {table.rows.map((r, i) => (
            <tr key={i}>{table.columns.map((c) => <td key={c.key} style={{ textAlign: c.align, fontVariantNumeric: "tabular-nums" }}>{r[c.key]}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({ s }) {
  return (
    <section data-testid={`report-${s.id}`} className="card" style={{ padding: "14px 18px", marginBottom: 12 }}>
      <h3 style={{ ...sans, fontSize: FS.bodyLg, fontWeight: 600, margin: "0 0 8px" }}>{s.title}</h3>
      {s.note && <div style={{ ...sans, fontSize: FS.small, ...subtle, marginBottom: 8 }}>{s.note}</div>}
      {s.kv && (
        <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))", gap: "6px 24px", margin: 0 }}>
          {s.kv.map((r) => (
            <div key={r.label} style={{ display: "flex", justifyContent: "space-between", gap: 12, borderBottom: "1px solid var(--ink-color-global-border-subtle)", padding: "4px 0" }}>
              <dt style={{ ...sans, fontSize: FS.body, ...subtle }}>{r.label}</dt>
              <dd style={{ ...sans, fontSize: FS.body, margin: 0, textAlign: "right" }}>{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {s.table && <Table table={s.table} />}
      {s.text && s.text.map((t) => <p key={t} style={{ ...sans, fontSize: FS.body, margin: "4px 0" }}>{t}</p>)}
    </section>
  );
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export default function SummaryReport({ plan, result, snapshot, companies }) {
  const report = buildReport(plan, result, { snapshot, companies });
  if (!report) return null;
  const slug = (report.title || "plan").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return (
    <div className="fc-report" data-testid="summary-report">
      <style>{PRINT_CSS}</style>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ ...sans, fontSize: FS.h2 ?? 20, fontWeight: 600 }}>{report.title}</div>
          <div style={{ ...sans, fontSize: FS.small, ...subtle }}>{report.subtitle}</div>
        </div>
        <div className="no-print" style={{ display: "flex", gap: 8 }}>
          <Btn onClick={() => { trackClick("FundModeling.FundConstruction.Summary.Print"); window.print(); }} data-testid="summary-print">Print / Save as PDF</Btn>
          <Btn onClick={() => { trackClick("FundModeling.FundConstruction.Summary.Csv"); download(`${slug}-construction-summary.csv`, reportCsv(report)); }} data-testid="summary-csv">Download CSV</Btn>
        </div>
      </div>
      <section data-testid="report-outcome" className="card" style={{ padding: "14px 18px", marginBottom: 12 }}>
        <h3 style={{ ...sans, fontSize: FS.bodyLg, fontWeight: 600, margin: "0 0 8px" }}>Projected outcome</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 12 }}>
          {report.tiles.map((t) => (
            <div key={t.label} data-testid={`tile-${t.label.toLowerCase().replace(/\W+/g, "-")}`}>
              <div style={{ ...sans, fontSize: FS.small, ...subtle }}>{t.label}</div>
              <div style={{ ...sans, fontSize: 22, fontWeight: 600 }}>{t.value}</div>
            </div>
          ))}
        </div>
      </section>
      {report.sections.map((s) => <Section key={s.id} s={s} />)}
    </div>
  );
}
