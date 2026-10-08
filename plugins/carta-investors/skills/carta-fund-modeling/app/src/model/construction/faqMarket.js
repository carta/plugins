// A plan against Carta's market data, as { text, source, chart } comparisons; anything with no data behind it is left out.
import { fmtMIn, fmtX, fmtPct } from "../../ui/format.js";
import { cohortPercentile, ordinal } from "../benchmarks.js";
import { marketCohort, placeIn, shareThrough } from "./history.js";
import { VALUATION_BENCHMARKS, findValuationBenchmark } from "./valuationBenchmarks.js";

const PUBLIC_REFS = [
  ["spLongRun", "S&P 500, long-run average"],
  ["nasdaqActual", "Nasdaq, recent actual"],
  ["treasury10y", "10-year Treasury"],
];
const navYear = (snapshot) => +(snapshot?.source?.navAsOf ?? "").slice(0, 4) || new Date().getFullYear();

/** Vintages of the firm's own funds that Carta publishes a performance cohort for, oldest first. */
export function performanceCohorts(snapshot) {
  const year = navYear(snapshot);
  const seen = new Map();
  for (const f of snapshot?.funds ?? []) {
    const b = snapshot.benchmarks?.[f.id];
    if (!f.vintage || b?.tvpi?.p50 == null || seen.has(f.vintage)) continue;
    seen.set(f.vintage, { vintage: f.vintage, fundId: f.id, size: b.cohortSize ?? null, age: Math.max(1, year - f.vintage), tvpi: b.tvpi, dpi: b.dpi });
  }
  return [...seen.values()].sort((a, b) => a.vintage - b.vintage);
}

const where = (cp) => (!cp ? null : cp.below ? `below the ${ordinal(cp.belowP)} percentile` : cp.above ? `above the ${ordinal(cp.pctl)} percentile` : `around the ${ordinal(cp.pctl)} percentile`);
const marksOf = (band, keys) => keys.filter((k) => band?.[k] != null).map((k) => ({ key: k, label: k === "p50" ? "Median" : `${ordinal(+k.slice(1))}`, value: band[k] }));

/** Net TVPI and DPI at the cohort's age, against that vintage's cohort. */
function performance(res, cohort) {
  const target = cohort.age * 12;
  const rows = res.series.quarterly.filter((q) => q.tvpi != null && q.month <= target);
  const at = rows.at(-1);
  if (!at) return null;
  const tp = cohortPercentile(at.tvpi, cohort.tvpi), dp = cohort.dpi?.p50 != null ? cohortPercentile(at.dpi ?? 0, cohort.dpi) : null;
  const tvpiMarks = marksOf(cohort.tvpi, ["p25", "p50", "p75", "p90", "p95"]);
  const dpiMarks = marksOf(cohort.dpi, ["p25", "p50", "p75", "p90", "p95"]);
  const fmtMark = (m) => `${m.label === "Median" ? "median" : `${m.label} percentile`} ${fmtX(m.value)}`;
  return {
    text: `At year ${cohort.age}, the plan shows ${fmtX(at.tvpi)} net TVPI and ${fmtX(at.dpi ?? 0)} DPI. Carta's ${cohort.vintage}-vintage funds${cohort.size ? ` (${Math.round(cohort.size)} funds)` : ""}, the same ${cohort.age} years in, have a ${tvpiMarks.filter((m) => ["p50", "p75"].includes(m.key)).map(fmtMark).join(" and ")} TVPI. The plan's TVPI sits ${where(tp)}${dp ? ` and its DPI ${where(dp)}` : ""}. Those funds started in a different market, so read this as a yardstick, not a forecast.`,
    source: `Carta fund performance benchmarks, ${cohort.vintage} vintage, same age`,
    chart: {
      kind: "rulers",
      rulers: [
        { label: "Net TVPI", value: at.tvpi, valueText: fmtX(at.tvpi), marks: tvpiMarks.map((m) => ({ ...m, text: fmtX(m.value) })) },
        ...(dpiMarks.length ? [{ label: "DPI", value: at.dpi ?? 0, valueText: fmtX(at.dpi ?? 0), marks: dpiMarks.map((m) => ({ ...m, text: fmtX(m.value) })) }] : []),
      ],
    },
  };
}

/** Fees or expenses through the cohort's age, as a share of commitments, against funds of this size. */
function ops(plan, res, cohort, kind) {
  const g = plan.general;
  const band = kind === "fees" ? cohort.mgmtFees : cohort.opex;
  const series = kind === "fees" ? res.series.fees : res.series.expenses;
  if (!band || band.p50 == null) return null;
  const share = shareThrough(series, cohort.age, g.committed);
  const place = placeIn(share, band);
  const word = kind === "fees" ? "management fees" : "operating expenses";
  const size = cohort.bucket.replace(/m/g, "M").replace("-", " to ");
  return {
    text: `Through year ${cohort.age}, the plan's ${word} are ${share == null ? "—" : fmtPct(share, 1)} of commitments. Carta funds of ${size} from ${cohort.vintage} have a median of ${fmtPct(band.p50, 1)}, with the middle half between ${fmtPct(band.p25, 1)} and ${fmtPct(band.p75, 1)}: the plan is ${place === "below" ? "below" : place === "above" ? "above" : "within"} that range.${cohort.exactSize ? "" : " No ranking exists yet for a fund your size, so this is the nearest size."}`,
    source: "Carta fund-ops benchmarks",
    chart: {
      kind: "rulers",
      rulers: [{ label: kind === "fees" ? "Management fees" : "Operating expenses", value: share, valueText: share == null ? "—" : fmtPct(share, 1), marks: marksOf(band, ["p25", "p50", "p75"]).map((m) => ({ ...m, text: fmtPct(m.value, 1) })) }],
    },
  };
}

/** The pre-money and round size of the plan's entry rounds, against Carta's median for the same stage. */
function entryPrices(plan) {
  const g = plan.general;
  if (g.currency !== "USD" || plan.mode === "light") return null;
  const rows = [], seen = new Set();
  let source = null;
  for (const a of plan.allocations ?? []) {
    const s = plan.sectors.find((x) => x.id === a.sectorId);
    const stage = s?.stages[a.entryStage];
    const bench = findValuationBenchmark(s?.market?.prices) ?? VALUATION_BENCHMARKS[0];
    const ref = bench?.rounds?.[stage?.name];
    if (!stage || !ref) continue;
    const key = `${bench.id}|${stage.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    source = source ?? bench;
    rows.push({ label: `${stage.name} pre-money`, plan: stage.preMoney, market: ref.preMoney }, { label: `${stage.name} round size`, plan: stage.roundSize, market: ref.roundSize });
  }
  if (!rows.length) return null;
  const rel = (r) => (r.market > 0 ? (r.plan - r.market) / r.market : 0);
  const pre = rows.filter((r) => r.label.endsWith("pre-money"));
  const line = (r) => `${r.label.replace(" pre-money", "")} at ${fmtMIn(r.plan, "USD")} against Carta's ${fmtMIn(r.market, "USD")} median (${Math.abs(rel(r)) < 0.02 ? "in line" : `${fmtPct(Math.abs(rel(r)), 0)} ${rel(r) > 0 ? "above" : "below"}`})`;
  return {
    text: `Entry pre-money: ${pre.map(line).join("; ")}. A higher entry price than the market means the same check buys less of the company.`,
    source: `${source.source}, ${source.sector}, ${source.period}`,
    chart: { kind: "pairs", planLabel: "Plan", marketLabel: "Carta median", rows: rows.map((r) => ({ ...r, planText: fmtMIn(r.plan, "USD"), marketText: fmtMIn(r.market, "USD") })) },
  };
}

/** The plan's net IRR against simple public-market reference rates. */
function publicMarkets(plan, res, snapshot) {
  const refs = snapshot?.marketRefs;
  const irr = res.metrics.netIrr;
  if (plan.general.currency !== "USD" || !refs || irr == null) return null;
  const list = PUBLIC_REFS.filter(([k]) => refs[k] != null).map(([k, label]) => ({ label, value: refs[k], text: fmtPct(refs[k], 1) }));
  if (!list.length) return null;
  const sp = refs.spLongRun;
  return {
    text: `The plan's ${fmtPct(irr, 1)} net IRR is ${sp == null ? "shown against" : irr >= sp ? `${fmtPct(irr - sp, 1)} points above` : `${fmtPct(sp - irr, 1)} points below`} the S&P 500's long-run average${sp == null ? "" : ` of ${fmtPct(sp, 1)} a year`}. Venture is illiquid and risky, so LPs usually look for a premium over public markets. These are simple yearly rates, not a comparison on the same cash flows.`,
    source: "Public-market reference rates",
    chart: { kind: "bars", rows: [{ label: "This plan, net IRR", value: irr, text: fmtPct(irr, 1), highlight: true }, ...list] },
  };
}

/** `vintage` picks which of the firm's performance cohorts to compare against; the oldest is the default. */
export function buildMarket(plan, res, { snapshot, ops: opsData, vintage } = {}) {
  if (!res?.ok) return {};
  const out = {};
  const cohorts = performanceCohorts(snapshot);
  const cohort = cohorts.find((c) => c.vintage === vintage) ?? cohorts[0];
  if (cohort) out.net = performance(res, cohort);
  const year = navYear(snapshot);
  const oc = marketCohort(opsData, { committed: plan.general.committed, currency: plan.general.currency }, year);
  if (oc) { out.fees = ops(plan, res, oc, "fees"); out.expenses = ops(plan, res, oc, "opex"); }
  out.entry = entryPrices(plan);
  out.public = publicMarkets(plan, res, snapshot);
  for (const k of Object.keys(out)) if (!out[k]) delete out[k];
  return out;
}
