// One report structure for both modes, which the page renders and the CSV download flattens.
import { fmtMIn, fmtX, fmtPct, fmtOwn, fmtYm, fmtYears, fmtCount } from "../../ui/format.js";
import { CALL_FREQUENCIES, FEE_BASES, deriveGeneral, gpCommitPctOf, lpLabels, waterfallTerms } from "./plan.js";
import { writeupDocument, includedCount } from "./writeup.js";
import { EVERGREEN_YEARS, termMonthsOf, termYearsOf, expenseTotalOf } from "./feeTiers.js";
import { marketSummary } from "./market.js";
import { assumptions } from "./summary.js";
import { lightPortfolio } from "./light.js";

const kv = (label, value) => ({ label, value: String(value) });
const col = (key, label, align = "right") => ({ key, label, align });

function generalRows(plan) {
  const g = plan.general, ccy = g.currency, d = deriveGeneral(g);
  const closes = g.closes ?? [];
  return [
    kv("Fund name", g.fundName || plan.name),
    kv("Committed capital", fmtMIn(g.committed, ccy)),
    kv("LP / GP commitment", `${fmtPct(1 - gpCommitPctOf(g), 1)} / ${fmtPct(gpCommitPctOf(g), 1)}`),
    kv("Currency", ccy ?? "—"),
    kv("Start date", fmtYm(g.startDate)),
    kv("Term", g.evergreen ? `Evergreen (modeled over ${EVERGREEN_YEARS} years)` : `${fmtYears(g.termYears)}, ending ${fmtYm(d.endDate)}`),
    kv("Investment period", `${fmtYears(g.investmentPeriodYears)}, until ${fmtYm(d.investmentPeriodEnd)}`),
    kv("Capital calls", CALL_FREQUENCIES.find((c) => c.id === g.callFrequency)?.label ?? "—"),
    ...(closes.length > 1 ? [kv("Commitment closes", closes.map((c) => `${fmtPct(c.pct, 0)} at month ${c.month}`).join(", "))] : []),
  ];
}

function waterfallLines(plan) {
  const w = plan.waterfall;
  const { european, prefOn, catchupOn } = waterfallTerms(w);
  const tiers = (w.carryTiers ?? []).length;
  return [
    european ? "European (whole-fund) waterfall: LPs get all their capital back before the GP earns carry." : "American (deal-by-deal) waterfall: carry is paid on each deal's gain.",
    prefOn ? `${w.hurdleType === "multiple" ? `${fmtX(w.hurdleMultiple, 2)} preferred return` : `${fmtPct(w.preferredReturn, 1)} a year preferred return`} for LPs.` : "No preferred return.",
    prefOn ? (catchupOn ? `GP catch-up at ${fmtPct(w.catchupRate, 0)}.` : "No GP catch-up.") : null,
    `${fmtPct(w.carryRate, 0)} GP carried interest${tiers ? `, stepping up across ${tiers + 1} tiers` : ""}.`,
    w.clawback ? "GP carry is subject to clawback." : "No clawback.",
  ].filter(Boolean);
}

function advanced(plan, result) {
  const g = plan.general, ccy = g.currency;
  const sections = [{ id: "general", title: "General", kv: generalRows(plan) }];

  const used = new Set(plan.allocations.map((a) => a.sectorId));
  for (const s of plan.sectors.filter((x) => used.has(x.id))) {
    sections.push({
      id: `profile-${s.id}`, title: `Market profile: ${s.name || "Profile"}`, note: marketSummary(s),
      table: {
        columns: [col("round", "Round", "left"), col("pre", "Pre-money"), col("size", "Round size"), col("post", "Post-money"), col("dilution", "Additional dilution"), col("grad", "Graduate"),
          col("exit", "Exit"), col("exitValue", "Exit value"), col("toGrad", "Months to graduate"), col("toExit", "Months to exit")],
        rows: s.stages.map((st, i) => ({
          round: st.name, pre: fmtMIn(st.preMoney, ccy), size: fmtMIn(st.roundSize, ccy), post: fmtMIn(st.preMoney + st.roundSize, ccy), dilution: fmtPct(st.dilutionPct ?? 0, 1),
          grad: i === s.stages.length - 1 ? "—" : fmtPct(st.gradRate, 0), exit: fmtPct(st.exitRate ?? 0, 0), exitValue: fmtMIn(st.exitValuation, ccy),
          toGrad: i === s.stages.length - 1 ? "—" : String(st.monthsToGraduate ?? "—"), toExit: String(st.monthsToExit ?? "—"),
        })),
      },
    });
  }

  const followOns = (a, sector) => {
    const list = (sector?.stages ?? []).map((st, i) => ({ st, fo: a.followOns?.[i] })).filter(({ st, fo }) => fo && fo.mode !== "none" && sector.stages.indexOf(st) > a.entryStage);
    return list.length ? list.map(({ st, fo }) => `${st.name}: ${fo.mode === "prorata" ? "pro-rata" : fmtMIn(fo.amount, ccy)} in ${fmtPct(fo.participation ?? 0, 0)} of companies`).join("; ") : "None";
  };
  sections.push({
    id: "allocations", title: "Allocations",
    table: {
      columns: [col("name", "Name", "left"), col("profile", "Profile", "left"), col("entry", "Entry round", "left"), col("share", "% of capital"), col("check", "First check"),
        col("follow", "Follow-ons", "left"), col("horizon", "Investment period"), col("deals", "Companies")],
      rows: plan.allocations.map((a) => {
        const sector = plan.sectors.find((s) => s.id === a.sectorId);
        const r = result.allocations.find((x) => x.id === a.id);
        return {
          name: a.name, profile: sector?.name ?? "—", entry: sector?.stages[a.entryStage]?.name ?? "—", share: fmtPct(a.capitalPct, 0),
          check: a.checkMode === "ownership" ? `${fmtOwn(a.entryOwnership)} ownership` : fmtMIn(a.initialCheck, ccy), follow: followOns(a, sector),
          horizon: `${a.horizonMonths} months`, deals: r ? fmtCount(r.initialDeals) : "—",
        };
      }),
    },
  });

  const term = termMonthsOf(g);
  const f = plan.fees ?? { tiers: [] };
  sections.push({
    id: "fees", title: "Management fees",
    table: {
      columns: [col("rate", "Fee"), col("basis", "Charged on", "left"), col("from", "From month"), col("to", "To month")],
      rows: (f.tiers ?? []).map((t) => ({ rate: fmtPct(t.rate, 2), basis: FEE_BASES.find((b) => b.id === t.basis)?.label ?? "Committed capital", from: String(t.startMonth ?? 1), to: String(t.endMonth ?? term) })),
    },
  });
  const expenses = expenseTotalOf(f, g);
  if (expenses > 0) {
    const years = termYearsOf(g);
    sections.push({ id: "expenses", title: "Fund expenses", kv: [kv("Total over the fund's life", fmtMIn(expenses, ccy)), kv("About a year", fmtMIn(expenses / years, ccy))] });
  }
  const r = plan.recycling;
  sections.push({
    id: "recycling", title: "Recycling",
    text: [r?.enabled ? `Up to ${fmtPct(r.pctOfProceeds, 0)} of exit proceeds are reinvested, capped at ${fmtPct(r.capPct, 0)} of commitments (${fmtMIn(g.committed * r.capPct, ccy)}), for ${fmtYears(r.termYears)}.` : "Off. Proceeds go back to LPs."],
  });
  sections.push({ id: "waterfall", title: "Waterfall", text: waterfallLines(plan) });
  if (plan.lps?.length) {
    const total = plan.lps.reduce((s, l) => s + (l.commitment || 0), 0);
    const names = lpLabels(plan);
    sections.push({
      id: "lps", title: "Limited partners",
      table: {
        columns: [col("name", "LP", "left"), col("commitment", "Commitment"), col("share", "Share")],
        rows: plan.lps.map((l, i) => ({ name: names[i], commitment: fmtMIn(l.commitment, ccy), share: total > 0 ? fmtPct((l.commitment || 0) / total, 1) : "—" })),
      },
    });
  }
  return sections;
}

function light(plan, result) {
  const ccy = plan.general.currency;
  const groups = assumptions(plan).filter((g) => ["terms", "fees", "waterfall", "portfolio"].includes(g.id));
  const sections = groups.map((g) => ({ id: g.id, title: g.title, kv: g.rows.map((r) => kv(r.label, r.value)) }));
  const book = lightPortfolio(plan.light);
  sections.push({
    id: "outcomes", title: "Outcomes",
    table: {
      columns: [col("name", "Outcome", "left"), col("companies", "Companies"), col("each", "Invested per company"), col("multiple", "Gross multiple"), col("proceeds", "Gross proceeds")],
      rows: book.groups.map((o) => ({ name: o.label, companies: fmtCount(o.count), each: fmtMIn(o.perCompany, ccy), multiple: fmtX(o.multiple), proceeds: fmtMIn(o.proceeds, ccy) })),
    },
  });
  sections.push({ id: "waterfall-text", title: "Waterfall detail", text: waterfallLines(plan) });
  return sections;
}

/** The sections the user has added to the write-up, drafts marked as such. */
function writeupSections(plan, result, ctx) {
  if (!includedCount(plan)) return [];
  return writeupDocument(plan, result, ctx).filter((d) => d.included && (d.text || (d.id === "team" && d.facts.length))).map((d) => ({
    id: `writeup-${d.id}`, title: d.title,
    ...(d.source === "draft" ? { note: "Draft from the model" } : {}),
    ...(d.text ? { text: d.text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean) } : {}),
    ...(d.id === "team" && d.facts.length ? { kv: d.facts } : {}),
  }));
}

/** The whole report for a plan whose result is ok: { title, subtitle, tiles, sections }. `ctx.snapshot` adds the track record. */
export function buildReport(plan, result, ctx = {}) {
  if (!result?.ok) return null;
  const m = result.metrics, t = result.totals, ccy = plan.general.currency;
  const isLight = plan.mode === "light";
  return {
    title: plan.general.fundName || plan.name,
    subtitle: `${isLight ? "Light" : "Advanced"} plan · construction summary`,
    tiles: [
      { label: "Net TVPI", value: fmtX(m.tvpi) },
      { label: "DPI", value: fmtX(m.dpi) },
      { label: "Net IRR", value: m.netIrr == null ? "—" : fmtPct(m.netIrr, 1) },
      { label: "Gross MOIC", value: fmtX(m.grossMoic) },
      { label: "Companies", value: fmtCount(m.initialDeals) },
      { label: "Invested", value: fmtMIn(t.invested, ccy) },
    ],
    sections: [...writeupSections(plan, result, ctx), ...(isLight ? light(plan, result) : advanced(plan, result))],
  };
}

const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

/** The report as CSV: one block per section, blank line between. */
export function reportCsv(report) {
  const lines = [[q(report.title)].join(","), [q(report.subtitle)].join(","), ""];
  lines.push(["Projected outcome"].map(q).join(","));
  for (const t of report.tiles) lines.push([t.label, t.value].map(q).join(","));
  for (const s of report.sections) {
    lines.push("", [s.title].map(q).join(","));
    if (s.note) lines.push([s.note].map(q).join(","));
    if (s.kv) for (const r of s.kv) lines.push([r.label, r.value].map(q).join(","));
    if (s.table) {
      lines.push(s.table.columns.map((c) => q(c.label)).join(","));
      for (const r of s.table.rows) lines.push(s.table.columns.map((c) => q(r[c.key])).join(","));
    }
    if (s.text) for (const t of s.text) lines.push([t].map(q).join(","));
  }
  return lines.join("\n") + "\n";
}
