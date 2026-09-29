var SLUG_RE = /[^a-z0-9]+/g;
var TRUE_WORDS = new Set(["yes", "true", "y", "t", "1"]);
var FALSE_WORDS = new Set(["no", "false", "n", "f", "0"]);
var MONTHS_TO_SUFFIX = "__MONTHS_TO";
var DAYS_PER_MONTH = 30.4375;
var EPOCH = new Date("1970-01-01");
var BALANCE_IN_FLOW = /(PERIOD_END_CASH|ENDING_CASH|CASH_AT_END|BEGINNING_CASH|CASH_AT_BEGIN)/i;
var BALANCE_NAME = /\b(period[- ]end|ending|beginning|closing|opening)\b.*\bcash\b|\bcash\b.*\b(at (the )?(end|beginning)|balance)\b/i;
var FLOW_REPORT_TYPES = new Set(["profit and loss", "cash flow", "income statement", "profit & loss", "p&l", "cashflow"]);
export function slugify(s) {
  return (s || "").toLowerCase().replace(SLUG_RE, "-").replace(/^-|-$/g, "") || "x";
}
function normCo(name) {
  let s = (name || "").toLowerCase();
  s = s.replace(/\(fka[^)]*\)/g, " ");
  s = s.replace(/[.,]/g, " ");
  s = s.replace(/\b(inc|llc|ltd|corp|co|lp|plc|holdings|company|the)\b/g, " ");
  s = s.replace(/[^a-z0-9]+/g, " ");
  return s.trim().replace(/\s+/g, " ");
}
function col(row, ...names) {
  if (!row) return "";
  const lower = {};
  for (const k in row) lower[k.toLowerCase()] = row[k];
  for (const n of names) {
    const v = lower[n.toLowerCase()];
    if (v !== void 0 && v !== null && v !== "") return v;
  }
  return "";
}
function numn(v) {
  if (v === null || v === void 0 || v === "") return null;
  if (typeof v === "number") return v;
  let s = String(v).trim().replace(/,/g, "").replace(/\$/g, "");
  const neg = s.startsWith("(") && s.endsWith(")");
  s = s.replace(/^\(|\)$/g, "");
  const f = parseFloat(s);
  if (isNaN(f)) return null;
  return neg ? -f : f;
}
var DATE_PATTERNS = [
  /^([A-Za-z]{3}) (\d{1,2}), (\d{4})$/,
  /^(\d{4})-(\d{2})-(\d{2})$/,
  /^(\d{2})\/(\d{2})\/(\d{4})$/
];
var MONTH_NAMES = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function parseDate(s) {
  if (!s) return null;
  s = String(s).trim();
  const iso = DATE_PATTERNS[1].exec(s);
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
  const mdy = DATE_PATTERNS[2].exec(s);
  if (mdy) return new Date(+mdy[3], +mdy[1] - 1, +mdy[2]);
  const named = DATE_PATTERNS[0].exec(s);
  if (named) {
    const m = MONTH_NAMES[named[1].toLowerCase().slice(0, 3)];
    if (m !== void 0) return new Date(+named[3], m, +named[2]);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
function parseQual(unitType, raw) {
  const s = raw == null ? "" : String(raw).trim();
  if (!s) return [null, null, null, null];
  const unit = (unitType || "").trim().toLowerCase();
  const low = s.toLowerCase();
  if (unit === "boolean" || !unit && (TRUE_WORDS.has(low) || FALSE_WORDS.has(low))) {
    if (TRUE_WORDS.has(low)) return [1, s, "boolean", null];
    if (FALSE_WORDS.has(low)) return [0, s, "boolean", null];
    return [null, s, "text", null];
  }
  if (unit === "date") {
    const d = parseDate(s);
    if (d) return [Math.floor((d - EPOCH) / 864e5), s, "date", d];
    return [null, s, "text", null];
  }
  return [null, s, "text", null];
}
function monthsBetween(periodEnd, target) {
  const start = parseDate(String(periodEnd).slice(0, 10));
  if (!start || !target) return null;
  return Math.round((target - start) / 864e5 / DAYS_PER_MONTH * 10) / 10;
}
function metricKey(mnemonic, name) {
  const mn = (mnemonic || "").trim().toUpperCase();
  if (mn) return mn;
  return "M_" + slugify(name).replace(/-/g, "_").toUpperCase();
}
function metricLabel(name, key) {
  if (name && name.trim()) return name.trim();
  return key.replace(/^(FS|M)_/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || key;
}
function aggMode(mnemonic, name, reportType) {
  const rt = (reportType || "").trim().toLowerCase();
  if (!FLOW_REPORT_TYPES.has(rt)) return "last";
  if (BALANCE_IN_FLOW.test(mnemonic || "") || BALANCE_NAME.test(name || "")) return "last";
  return "sum";
}
function normFreq(f) {
  f = (f || "").trim().toUpperCase();
  if (f.startsWith("Q")) return "Q";
  if (f.startsWith("M")) return "M";
  if (f.startsWith("A") || f.startsWith("Y")) return "A";
  if (f.startsWith("S")) return "S";
  return f || null;
}
function seriesPoint(period, val, cur, disp, qtr) {
  const pt = { d: period, v: val, cur };
  if (disp !== null && disp !== void 0) pt.s = disp;
  if (qtr !== null && qtr !== void 0) pt.q = qtr;
  return pt;
}
function parseTags(raw) {
  if (!raw) return {};
  let tj;
  try {
    tj = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return {};
  }
  if (!tj || typeof tj !== "object" || Array.isArray(tj)) return {};
  const out = {};
  for (const [cat, vals] of Object.entries(tj)) {
    const c = String(cat).trim();
    if (!c) continue;
    const arr = Array.isArray(vals) ? vals : [vals];
    const clean = arr.filter((v) => v != null && String(v).trim()).map((v) => String(v).trim());
    if (clean.length) out[c] = [...out[c] || [], ...clean];
  }
  return out;
}
function firstTag(coTags, cat) {
  const vals = coTags[cat];
  return vals && vals.length ? [...vals].sort()[0] : null;
}
function resolve(n, canon, canonTokens) {
  if (canon.has(n)) return n;
  const nt = new Set(n.split(/\s+/));
  let best = n, bestKey = [-1, -1];
  for (const [c, ct] of canonTokens) {
    const intersection = [...nt].filter((t) => ct.has(t));
    if (!intersection.length) continue;
    const subset = [...nt].every((t) => ct.has(t)) || [...ct].every((t) => nt.has(t)) ? 1 : 0;
    let common = 0;
    const a = n, b = c;
    const longer = Math.max(a.length, b.length);
    if (longer === 0) continue;
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i] === b[i]) common++;
    }
    const ratio = longer > 0 ? 2 * common / (a.length + b.length) : 0;
    if (subset || ratio >= 0.9) {
      const key = [subset, ratio];
      if (key[0] > bestKey[0] || key[0] === bestKey[0] && key[1] > bestKey[1]) {
        best = c;
        bestKey = key;
      }
    }
  }
  return best;
}
function remap(d, canon, canonTokens, mergeFn) {
  const out = {};
  for (const [k, v] of Object.entries(d)) {
    const rk = resolve(k, canon, canonTokens);
    if (rk in out && mergeFn) out[rk] = mergeFn(out[rk], v);
    else if (!(rk in out)) out[rk] = v;
  }
  return out;
}
function addn(x, y) {
  return x == null && y == null ? null : (x || 0) + (y || 0);
}
function mergeRet(a, b) {
  const dates = [a.firstDate, b.firstDate].filter(Boolean);
  return {
    cost: addn(a.cost, b.cost),
    fmv: addn(a.fmv, b.fmv),
    proceeds: addn(a.proceeds, b.proceeds),
    unrealized: addn(a.unrealized, b.unrealized),
    firstDate: dates.length ? dates.sort()[0] : null
  };
}
function mergeTags(a, b) {
  const out = {};
  for (const [k, v] of Object.entries(a)) out[k] = new Set(v);
  for (const [k, v] of Object.entries(b)) {
    if (!out[k]) out[k] = new Set();
    for (const x of v) out[k].add(x);
  }
  const result = {};
  for (const [k, v] of Object.entries(out)) result[k] = [...v];
  return result;
}
function mergeSoiHist(a, b) {
  const byD = {};
  for (const p of [...a, ...b]) {
    const m = byD[p.d];
    if (!m) {
      byD[p.d] = { ...p };
      continue;
    }
    m.fmv = addn(m.fmv, p.fmv);
    m.cost = addn(m.cost, p.cost);
    if (p.pps != null && (m.pps == null || Math.abs(p.pps) > Math.abs(m.pps))) m.pps = p.pps;
  }
  return Object.keys(byD).sort().map((d) => byD[d]);
}
export function buildKpi(stems, meta) {
  const asOfMax = (new Date()).toISOString().slice(0, 10);
  const firmName = meta.name || "Firm";
  const slug = meta.slug || slugify(firmName);
  const fundNameOf = {};
  for (const r of stems.funds || []) {
    const u = col(r, "fund_uuid");
    const nm = col(r, "fund_name", "name");
    if (u && nm) fundNameOf[u] = nm;
  }
  const compFunds = {};
  for (const r of stems.holdings || []) {
    const issuer = col(r, "issuer_name", "issuer");
    const u = col(r, "fund_uuid");
    if (!issuer) continue;
    const fn = fundNameOf[u] || u || null;
    if (fn) {
      const nm = normCo(issuer);
      if (!compFunds[nm]) compFunds[nm] = new Set();
      compFunds[nm].add(fn);
    }
  }
  const metricsMeta = {};
  const metricOrder = [];
  const series = {};
  const finAcc = {};
  const displayName = {};
  let finCurrency = null;
  const lastResponded = {};
  function addMonthsTo(nmNorm, key, period, target) {
    const ck = key + MONTHS_TO_SUFFIX;
    if (!metricsMeta[ck]) {
      metricsMeta[ck] = {
        key: ck,
        label: "Months to " + metricsMeta[key].label,
        unit: "Number",
        reportType: metricsMeta[key].reportType,
        agg: "last",
        derivedFrom: key
      };
      metricOrder.push(ck);
    }
    const gap = monthsBetween(period, target);
    if (gap != null) {
      if (!series[nmNorm]) series[nmNorm] = {};
      if (!series[nmNorm][ck]) series[nmNorm][ck] = {};
      series[nmNorm][ck][String(period)] = [gap, null, null, null];
    }
  }
  for (const r of stems.financials || []) {
    const legal = col(r, "legal_name", "company", "name_legal");
    const nmNorm = normCo(legal);
    const period = col(r, "period_end", "as_of_date", "period");
    if (!nmNorm || !period) continue;
    const unit = col(r, "unit_type", "unit") || "Number";
    let val = numn(col(r, "float_value", "value"));
    let disp = null, kind = null, qdate = null;
    if (val == null) {
      [val, disp, kind, qdate] = parseQual(unit, col(r, "string_value", "text_value"));
    }
    if (val == null && disp == null) continue;
    const mnemonic = col(r, "mnemonic");
    const reported = col(r, "name", "metric_name");
    const key = metricKey(mnemonic, reported);
    if (!metricsMeta[key]) {
      const rtype = col(r, "report_type") || null;
      metricsMeta[key] = {
        key,
        label: metricLabel(reported, key),
        unit,
        reportType: rtype,
        agg: kind ? "last" : aggMode(mnemonic, reported, rtype)
      };
      if (kind) metricsMeta[key].kind = kind;
      metricOrder.push(key);
    } else if (kind && !metricsMeta[key].kind) {
      metricsMeta[key].kind = kind;
      metricsMeta[key].agg = "last";
    }
    const cur = col(r, "currency") || null;
    if (cur && !finCurrency && metricsMeta[key].unit === "Dollar") finCurrency = cur;
    if (!displayName[nmNorm]) displayName[nmNorm] = legal;
    const v4 = val != null ? Math.round(val * 1e4) / 1e4 : null;
    const freq = normFreq(col(r, "frequency"));
    const asof = String(col(r, "as_of_date") || "");
    const asofDay = asof.slice(0, 10);
    if (asofDay && asofDay <= asOfMax) {
      const prev = lastResponded[nmNorm];
      if (!prev || asofDay > prev) lastResponded[nmNorm] = asofDay;
    }
    if (!finAcc[nmNorm]) finAcc[nmNorm] = {};
    if (!finAcc[nmNorm][key]) finAcc[nmNorm][key] = {};
    if (!finAcc[nmNorm][key][String(period)]) finAcc[nmNorm][key][String(period)] = {};
    if (!finAcc[nmNorm][key][String(period)][freq]) finAcc[nmNorm][key][String(period)][freq] = [];
    finAcc[nmNorm][key][String(period)][freq].push([asof, v4, cur, disp]);
    if (qdate != null) addMonthsTo(nmNorm, key, period, qdate);
  }
  for (const [nm, byKey] of Object.entries(finAcc)) {
    for (const [key, byPeriod] of Object.entries(byKey)) {
      for (const [pe, byFreq] of Object.entries(byPeriod)) {
        const best = {};
        for (const [fr2, rows] of Object.entries(byFreq)) {
          const live = rows.filter((x) => x[0].slice(0, 10) <= asOfMax);
          best[fr2] = (live.length ? live : rows).reduce((a, b) => a[0] > b[0] ? a : b);
        }
        const qval = best["Q"] ? best["Q"][1] : null;
        const fr = best["M"] ? "M" : best["Q"] ? "Q" : Object.keys(best)[0];
        const [, v4, cur, disp] = best[fr];
        if (!series[nm]) series[nm] = {};
        if (!series[nm][key]) series[nm][key] = {};
        series[nm][key][pe] = [v4, cur, disp, qval];
      }
    }
  }
  const fcRaw = {};
  const fcAsofDates = new Set();
  for (const r of stems.forecasts || []) {
    const legal = col(r, "legal_name", "company");
    const nmNorm = normCo(legal);
    const val = numn(col(r, "float_value", "value"));
    const period = String(col(r, "period_end", "period"));
    const asof = String(col(r, "as_of_date", "as_of")).slice(0, 10);
    if (!nmNorm || val == null || !period || !asof) continue;
    const key = metricKey(col(r, "mnemonic"), col(r, "name", "metric_name"));
    if (!metricsMeta[key]) {
      const unit = col(r, "unit_type", "unit") || "Number";
      const rtype = col(r, "report_type") || null;
      metricsMeta[key] = {
        key,
        label: metricLabel(col(r, "name"), key),
        unit,
        reportType: rtype,
        agg: aggMode(col(r, "mnemonic"), col(r, "name"), rtype)
      };
      metricOrder.push(key);
    }
    if (!displayName[nmNorm]) displayName[nmNorm] = legal;
    fcAsofDates.add(asof);
    if (!fcRaw[nmNorm]) fcRaw[nmNorm] = {};
    if (!fcRaw[nmNorm][key]) fcRaw[nmNorm][key] = {};
    if (!fcRaw[nmNorm][key][period]) fcRaw[nmNorm][key][period] = {};
    fcRaw[nmNorm][key][period][asof] = [Math.round(val * 1e4) / 1e4, col(r, "currency") || null];
  }
  function buildForecast(byKey) {
    const latest = {}, vintages = {};
    for (const [key, byPeriod] of Object.entries(byKey)) {
      const lp = [];
      const perAsof = {};
      for (const [period, byAsof] of Object.entries(byPeriod)) {
        const newest = Object.keys(byAsof).sort().pop();
        lp.push([period, byAsof[newest][0], newest]);
        for (const [asof, [av]] of Object.entries(byAsof)) {
          if (!perAsof[asof]) perAsof[asof] = [];
          perAsof[asof].push([period, av]);
        }
      }
      lp.sort((a, b) => a[0] < b[0] ? -1 : 1);
      latest[key] = lp.map(([p, v, a]) => ({ d: p, v, asOf: a }));
      const vint = [];
      for (const asof of Object.keys(perAsof).sort()) {
        const pts = perAsof[asof].sort((a, b) => a[0] < b[0] ? -1 : 1);
        vint.push({ asOf: asof, points: pts.map(([p, v]) => ({ d: p, v })) });
      }
      vintages[key] = vint;
    }
    return [latest, vintages];
  }
  const ppsBy = {};
  const retBy = {};
  const tagsBy = {};
  const soiBy = {};
  const closedSoi = {};
  const costByFund = {};
  for (const r of stems.holdings || []) {
    const nm = normCo(col(r, "issuer_name", "issuer"));
    if (!nm) continue;
    if (!displayName[nm]) displayName[nm] = col(r, "issuer_name", "issuer");
    for (const [cat, vals] of Object.entries(parseTags(col(r, "tags_json")))) {
      if (!tagsBy[nm]) tagsBy[nm] = {};
      if (!tagsBy[nm][cat]) tagsBy[nm][cat] = new Set();
      for (const v of vals) tagsBy[nm][cat].add(v);
    }
    const sh = numn(col(r, "count_remaining_shares", "shares"));
    const cost = numn(col(r, "total_cost"));
    const val = numn(col(r, "remaining_value"));
    const proc = numn(col(r, "total_proceeds"));
    if (!sh && !cost && !val && !proc) {
      closedSoi[nm] = (closedSoi[nm] || 0) + 1;
      continue;
    }
    if (!soiBy[nm]) soiBy[nm] = [];
    soiBy[nm].push({
      fund: fundNameOf[col(r, "fund_uuid")] || null,
      asset: col(r, "asset_name") || null,
      assetClass: col(r, "asset_class_type") || null,
      shares: sh,
      cost,
      value: val,
      pps: numn(col(r, "remaining_value_per_share", "value_per_share")),
      unrealized: numn(col(r, "total_unrealized_gain_loss")),
      proceeds: proc,
      investmentDate: String(col(r, "investment_date")).slice(0, 10) || null,
      fmvDate: String(col(r, "latest_fmv_effective_date", "fmv_date")).slice(0, 10) || null,
      isWarrant: String(col(r, "is_option_or_warrant_asset")).toLowerCase() === "true"
    });
    const agg = retBy[nm] || (retBy[nm] = { cost: null, fmv: null, proceeds: null, unrealized: null, firstDate: null });
    for (const [fld, src] of [["cost", "total_cost"], ["fmv", "remaining_value"], ["proceeds", "total_proceeds"], ["unrealized", "total_unrealized_gain_loss"]]) {
      const v = numn(col(r, src));
      if (v != null) agg[fld] = (agg[fld] || 0) + v;
    }
    const idt = String(col(r, "investment_date")).slice(0, 10);
    if (idt && idt !== "None" && (!agg.firstDate || idt < agg.firstDate)) agg.firstDate = idt;
    const fu = col(r, "fund_uuid");
    const fc = numn(col(r, "total_cost"));
    if (fu && fc != null) costByFund[nm + ":" + fu] = (costByFund[nm + ":" + fu] || 0) + fc;
    const pps = numn(col(r, "remaining_value_per_share", "value_per_share"));
    const warr = String(col(r, "is_option_or_warrant_asset")).toLowerCase() === "true";
    if (pps == null || pps <= 0 || !sh || warr) continue;
    const dt = String(col(r, "latest_fmv_effective_date", "fmv_date")).slice(0, 10);
    const rv = numn(col(r, "remaining_value")) || 0;
    const cur = ppsBy[nm];
    if (!cur || dt > cur.asOf || dt === cur.asOf && rv > cur.rv) {
      ppsBy[nm] = { pps: Math.round(pps * 1e6) / 1e6, asOf: dt, security: col(r, "asset_name") || null, rv };
    }
  }
  const soiHistRows = {};
  for (const r of stems.holdings_history || []) {
    const nm = normCo(col(r, "issuer_name", "issuer"));
    if (!nm) continue;
    const eff = String(col(r, "effective_date", "as_of_date", "snapshot_date", "performance_quarter_end_date", "period_end")).slice(0, 10);
    if (!eff || eff === "None" || !parseDate(eff)) continue;
    if (!displayName[nm]) displayName[nm] = col(r, "issuer_name", "issuer");
    let nxt = String(col(r, "next_effective_date")).slice(0, 10);
    if (!nxt || nxt === "None" || !parseDate(nxt)) nxt = null;
    if (!soiHistRows[nm]) soiHistRows[nm] = [];
    soiHistRows[nm].push({
      eff,
      nxt,
      warr: String(col(r, "is_option_or_warrant_asset")).toLowerCase() === "true",
      cost: numn(col(r, "total_cost")),
      val: numn(col(r, "remaining_value")),
      pps: numn(col(r, "remaining_value_per_share", "value_per_share")),
      proceeds: numn(col(r, "total_proceeds"))
    });
  }
  const soiHistBy = {};
  for (const [nm, rows] of Object.entries(soiHistRows)) {
    const dates = [...new Set(rows.map((r) => r.eff))].sort();
    const pts = [];
    for (const d of dates) {
      let fmv = null, cost = null, proceeds = null, bestRv = -1, pps = null;
      for (const r of rows) {
        if (r.eff <= d && (r.nxt == null || r.nxt > d)) {
          if (r.val != null) fmv = (fmv || 0) + r.val;
          if (r.cost != null) cost = (cost || 0) + r.cost;
          if (r.proceeds != null) proceeds = (proceeds || 0) + r.proceeds;
          if (!r.warr && r.pps != null && r.pps > 0) {
            const rv = r.val != null ? r.val : 0;
            if (rv > bestRv) {
              bestRv = rv;
              pps = Math.round(r.pps * 1e6) / 1e6;
            }
          }
        }
      }
      pts.push({
        d,
        pps,
        fmv: fmv != null ? Math.round(fmv * 100) / 100 : null,
        cost: cost != null ? Math.round(cost * 100) / 100 : null,
        proceeds: proceeds != null ? Math.round(proceeds * 100) / 100 : null
      });
    }
    if (pts.length) soiHistBy[nm] = pts;
  }
  const fdBy = {};
  const fdRows = {};
  for (const r of stems.fdshares || []) {
    const nm = normCo(col(r, "name", "investment_name", "company"));
    const fd = numn(col(r, "fd_shares", "fully_diluted"));
    if (!nm || !fd || fd <= 0) continue;
    if (!displayName[nm]) displayName[nm] = col(r, "name", "investment_name");
    let own = numn(col(r, "own_pct", "ownership_percentage", "percentage"));
    if (own != null && own <= 0) own = null;
    if (own != null && own > 1) own = null;
    let qty = numn(col(r, "own_qty", "ownership_quantity"));
    if (qty != null && qty <= 0) qty = null;
    const asOf2 = String(col(r, "as_of", "as_of_date")).slice(0, 10);
    let rec = fdBy[nm];
    if (!rec) {
      rec = {
        fdShares: fd,
        asOf: asOf2,
        round: col(r, "round") || null,
        postMoney: numn(col(r, "post_money", "post_money_valuation")),
        roundDate: String(col(r, "round_date")).slice(0, 10) || null,
        ownPct: null,
        ownQty: null
      };
      fdBy[nm] = rec;
    }
    if (asOf2 && (!rec.asOf || asOf2 > rec.asOf)) {
      rec.asOf = asOf2;
      rec.fdShares = fd;
    }
    if (own != null) {
      rec.ownPct = (rec.ownPct || 0) + own;
      if (!fdRows[nm]) fdRows[nm] = [];
      fdRows[nm].push({ fundId: col(r, "fund_id") || "", pct: own, asOf: asOf2 || null });
    }
    if (qty != null) rec.ownQty = (rec.ownQty || 0) + qty;
  }
  for (const rec of Object.values(fdBy)) {
    if (rec.ownPct != null && rec.ownPct > 1) rec.ownPct = null;
  }
  const corpAlias = {};
  function addAlias(cid, ...names) {
    if (!cid) return;
    if (!corpAlias[cid]) corpAlias[cid] = [];
    for (const n of names) {
      const nn = normCo(n);
      if (nn && !corpAlias[cid].includes(nn)) corpAlias[cid].push(nn);
    }
  }
  const capRaw = {};
  for (const r of stems.capstack || []) {
    const nm = normCo(col(r, "corp_name", "legal_name", "name"));
    if (!nm) continue;
    addAlias(col(r, "corporation_id"), col(r, "corp_name"), col(r, "legal_name"));
    if (!displayName[nm]) displayName[nm] = col(r, "corp_name", "legal_name", "name");
    const clsName = col(r, "security_class_name");
    if (!clsName) continue;
    const asOf2 = String(col(r, "as_of_date")).slice(0, 10) || null;
    const capKey = nm + ":" + col(r, "corporation_id");
    if (!capRaw[capKey]) capRaw[capKey] = { nm, cid: col(r, "corporation_id"), asOf: asOf2, classes: [] };
    const ent = capRaw[capKey];
    if (asOf2 && (!ent.asOf || asOf2 > ent.asOf)) ent.asOf = asOf2;
    const b = String(col(r, "participating_preferred")).toLowerCase();
    const comp = String(col(r, "is_compounding")).toLowerCase();
    ent.classes.push({
      id: col(r, "security_class_id") || clsName,
      name: clsName,
      type: col(r, "security_class_type") || null,
      kind: col(r, "security_class_type_detailed") || null,
      asConverted: col(r, "as_converted_shareclass_name") || null,
      outstanding: numn(col(r, "outstanding_shares")),
      fd: numn(col(r, "fully_diluted_quantity")),
      authorized: numn(col(r, "authorized_shares")),
      fdPct: numn(col(r, "fully_diluted_ownership")),
      planSize: numn(col(r, "plan_size")),
      available: numn(col(r, "shares_available_under_plan")),
      wtdExercise: numn(col(r, "weighted_average_exercise_price")),
      oip: numn(col(r, "original_issue_price")),
      conversionRatio: numn(col(r, "conversion_ratio")),
      conversionPrice: numn(col(r, "conversion_price")),
      seniority: numn(col(r, "seniority")),
      multiplier: numn(col(r, "multiplier")),
      participating: b === "true" || b === "1" ? true : b === "false" || b === "0" ? false : null,
      preferenceCap: numn(col(r, "preference_cap")),
      dividendCoupon: numn(col(r, "dividend_coupon")),
      dividendType: col(r, "dividend_type") || null,
      dividendAccrual: col(r, "dividend_accrual") || null,
      compounding: comp === "true" || comp === "1",
      cashRaised: numn(col(r, "cash_raised_usd", "cash_raised")),
      principal: numn(col(r, "principal_usd", "principal")),
      interest: numn(col(r, "interest_usd", "interest")),
      firstIssue: String(col(r, "earliest_issue_date")).slice(0, 10) || null
    });
  }
  const irrByFund = {};
  for (const r of stems.deal_irr || []) {
    const nm = normCo(col(r, "issuer_name", "issuer"));
    let v = numn(col(r, "deal_irr"));
    if (!nm || v == null) continue;
    if (v === 0) v = null;
    else if (v <= -0.999) v = -1;
    else if (v > 5) v = null;
    if (v != null) {
      if (!irrByFund[nm]) irrByFund[nm] = {};
      irrByFund[nm][col(r, "fund_uuid") || ""] = v;
    }
  }
  let irrBy = {}, irrScope = {};
  for (const [nm, byFund] of Object.entries(irrByFund)) {
    const entries = Object.entries(byFund);
    const [fu, v] = entries.reduce((a, b) => {
      const ca = costByFund[nm + ":" + a[0]] || 0;
      const cb = costByFund[nm + ":" + b[0]] || 0;
      return ca >= cb ? a : b;
    });
    irrBy[nm] = v;
    if (entries.length > 1) {
      const vals = entries.map((e) => e[1]).sort((a, b) => a - b);
      irrScope[nm] = { funds: entries.length, fund: fundNameOf[fu], min: vals[0], max: vals[vals.length - 1] };
    }
  }
  const canon = new Set([...Object.keys(series), ...Object.keys(fcRaw)]);
  const canonTokens = [...canon].map((c) => [c, new Set(c.split(/\s+/))]);
  const remappedCompFunds = remap(
    Object.fromEntries(Object.entries(compFunds).map(([k, v]) => [k, v])),
    canon,
    canonTokens,
    (a, b) => {
      const s = new Set(a);
      for (const x of b) s.add(x);
      return s;
    }
  );
  const remappedPps = remap(ppsBy, canon, canonTokens);
  const remappedFd = remap(fdBy, canon, canonTokens);
  const remappedFdRows = remap(fdRows, canon, canonTokens);
  for (const [nm, rows] of Object.entries(remappedFdRows)) {
    for (const row of rows) {
      const fn = fundNameOf[row.fundId] || row.fundId;
      if (fn) {
        if (!remappedCompFunds[nm]) remappedCompFunds[nm] = new Set();
        if (remappedCompFunds[nm] instanceof Set) remappedCompFunds[nm].add(fn);
      }
    }
  }
  irrBy = remap(irrBy, canon, canonTokens);
  irrScope = remap(irrScope, canon, canonTokens);
  const remappedRet = remap(retBy, canon, canonTokens, mergeRet);
  const remappedTags = remap(
    Object.fromEntries(Object.entries(tagsBy).map(([k, v]) => {
      const o = {};
      for (const [cat, s] of Object.entries(v)) o[cat] = s instanceof Set ? [...s] : s;
      return [k, o];
    })),
    canon,
    canonTokens,
    mergeTags
  );
  const remappedSoi = remap(soiBy, canon, canonTokens, (a, b) => [...a, ...b]);
  const remappedClosedSoi = remap(closedSoi, canon, canonTokens, (a, b) => a + b);
  const remappedSoiHist = remap(soiHistBy, canon, canonTokens, mergeSoiHist);
  function companyFor(cid, fallback) {
    for (const a of corpAlias[cid] || []) {
      if (canon.has(a)) return a;
    }
    for (const a of corpAlias[cid] || []) {
      const r = resolve(a, canon, canonTokens);
      if (canon.has(r)) return r;
    }
    return resolve(fallback, canon, canonTokens);
  }
  const capGroups = {};
  for (const ent of Object.values(capRaw)) {
    const nm = companyFor(ent.cid, ent.nm);
    if (!capGroups[nm]) capGroups[nm] = [];
    capGroups[nm].push(ent);
  }
  const capBy = {}, capCid = {};
  for (const [nm, lst] of Object.entries(capGroups)) {
    const best = lst.reduce((a, b) => a.classes.length > b.classes.length || a.classes.length === b.classes.length && (a.asOf || "") >= (b.asOf || "") ? a : b);
    capBy[nm] = { asOf: best.asOf, classes: best.classes };
    capCid[nm] = best.cid;
  }
  function captableFd(nm) {
    const ent = capBy[nm];
    if (!ent) return null;
    let tot = 0, seen = false;
    for (const c of ent.classes) {
      if (c.fd != null) {
        tot += c.fd;
        seen = true;
      }
    }
    if (!seen || tot <= 0) return null;
    return [tot, ent.asOf];
  }
  const valNorms = new Set(Object.keys(remappedPps).filter((n) => n in remappedFd));
  const retNorms = new Set(Object.keys(remappedRet).filter((n) => {
    const a = remappedRet[n];
    return a.cost != null && a.cost > 0;
  }));
  const allNames = new Set([...Object.keys(series), ...Object.keys(fcRaw), ...valNorms, ...retNorms]);
  const companies = [];
  const allPeriods = new Set();
  for (const nmNorm of [...allNames].sort((a, b) => (displayName[a] || a).toLowerCase() < (displayName[b] || b).toLowerCase() ? -1 : 1)) {
    const name = displayName[nmNorm] || nmNorm;
    const recSeries = {};
    for (const [key, pts] of Object.entries(series[nmNorm] || {})) {
      const ordered = Object.entries(pts).sort((a2, b) => a2[0] < b[0] ? -1 : 1);
      for (const [p] of ordered) allPeriods.add(p);
      recSeries[key] = ordered.map(([p, [v, c, s, f]]) => seriesPoint(p, v, c, s, f));
    }
    const entry = { id: slugify(name), name, funds: [...remappedCompFunds[nmNorm] instanceof Set ? remappedCompFunds[nmNorm] : []].sort(), series: recSeries };
    entry.lastResponded = lastResponded[nmNorm] || null;
    const coTags = remappedTags[nmNorm] || {};
    if (Object.keys(coTags).length) {
      entry.tags = Object.keys(coTags).sort().flatMap((c) => (coTags[c] || []).sort().map((v) => ({ cat: c, value: v })));
    }
    if (fcRaw[nmNorm]) {
      const [latest, vintages] = buildForecast(fcRaw[nmNorm]);
      entry.forecast = latest;
      entry.forecastVintages = vintages;
    }
    if (valNorms.has(nmNorm)) {
      const p = remappedPps[nmNorm], f = remappedFd[nmNorm];
      const capFd = captableFd(nmNorm);
      const [fdShares, fdAsOf, fdSource] = capFd ? [capFd[0], capFd[1], "capTable"] : [f.fdShares, f.asOf, "ownership"];
      entry.valuation = {
        pps: p.pps,
        ppsAsOf: p.asOf,
        ppsSecurity: p.security,
        fdShares,
        fdAsOf,
        fdSource,
        impliedValuation: Math.round(p.pps * fdShares * 100) / 100
      };
    }
    const a = remappedRet[nmNorm];
    if (a && a.cost != null && a.cost > 0) {
      const cur = a.fmv == null && a.proceeds == null ? null : (a.fmv || 0) + (a.proceeds || 0);
      const moic = cur == null ? null : cur / a.cost;
      entry.returns = {
        cost: Math.round(a.cost * 100) / 100,
        fmv: a.fmv != null ? Math.round(a.fmv * 100) / 100 : null,
        proceeds: a.proceeds != null ? Math.round(a.proceeds * 100) / 100 : null,
        unrealized: a.unrealized != null ? Math.round(a.unrealized * 100) / 100 : null,
        moic: moic != null ? Math.round(moic * 1e3) / 1e3 : null,
        firstDate: a.firstDate,
        sector: firstTag(coTags, "Industry"),
        country: firstTag(coTags, "Country")
      };
    }
    const fRec = remappedFd[nmNorm];
    if (fRec && (fRec.round || fRec.postMoney)) {
      entry.lastRound = { round: fRec.round, postMoney: fRec.postMoney, date: fRec.roundDate };
    }
    if (fRec && fRec.ownPct != null) {
      entry.ownership = {
        pct: Math.round(fRec.ownPct * 1e6) / 1e6,
        asOf: fRec.asOf,
        quantity: fRec.ownQty,
        fdShares: fRec.fdShares
      };
      const rows = remappedFdRows[nmNorm];
      if (rows) {
        entry.ownership.byFund = rows.map((x) => ({
          fund: fundNameOf[x.fundId] || x.fundId || "Unknown fund",
          pct: Math.round(x.pct * 1e6) / 1e6,
          asOf: x.asOf
        })).sort((a2, b) => b.pct - a2.pct);
      }
    }
    if (irrBy[nmNorm] != null) {
      entry.dealIrr = irrBy[nmNorm];
      if (irrScope[nmNorm]) entry.dealIrrScope = irrScope[nmNorm];
    }
    if (capBy[nmNorm] && capBy[nmNorm].classes.length) entry.capTable = capBy[nmNorm];
    if (remappedSoi[nmNorm]) entry.soi = remappedSoi[nmNorm];
    if (remappedClosedSoi[nmNorm]) entry.soiClosed = remappedClosedSoi[nmNorm];
    if ((remappedSoiHist[nmNorm] || []).length >= 2) entry.soiHistory = remappedSoiHist[nmNorm];
    companies.push(entry);
  }
  const metrics = metricOrder.map((k) => metricsMeta[k]);
  const fundDim = [...new Set(companies.flatMap((c) => c.funds))].sort();
  const tagVals = {};
  for (const c of companies) for (const t of c.tags || []) {
    if (!tagVals[t.cat]) tagVals[t.cat] = new Set();
    tagVals[t.cat].add(t.value);
  }
  const tagDim = Object.keys(tagVals).sort().map((c) => ({ cat: c, values: [...tagVals[c]].sort() }));
  // Null when the data never said. Naming a currency we did not read
  // mislabels every amount for a firm that reports in another one.
  const currency = meta.currency || finCurrency || null;
  const today = (new Date()).toISOString().slice(0, 10);
  const past = [...allPeriods].filter((p) => p <= today);
  const asOf = meta.navAsOf || (past.length ? past.sort().pop() : [...allPeriods].sort().pop() || null);
  return {
    source: {
      firm: firmName,
      slug,
      asOf,
      currency,
      firmId: meta.firmId || null,
      firmUuid: meta.firmUuid || null,
      cartaEnvironment: meta.cartaEnvironment || "production",
      provider: "carta-fund-admin",
      since: meta.since || null,
      builtAt: (new Date()).toISOString().replace(/\.\d{3}Z$/, "Z"),
      datasets: [
        { key: "kpis", label: "Operating KPIs", stems: ["financials"], present: (stems.financials || []).length > 0, fetchedAt: (new Date()).toISOString() },
        { key: "forecasts", label: "Forecasts", stems: ["forecasts"], present: (stems.forecasts || []).length > 0, fetchedAt: (new Date()).toISOString() },
        { key: "holdings", label: "Holdings & returns", stems: ["holdings", "holdings_history", "deal_irr"], present: (stems.holdings || []).length > 0, fetchedAt: (new Date()).toISOString() },
        { key: "ownership", label: "Ownership & cap tables", stems: ["fdshares", "capstack", "funds"], present: (stems.fdshares || []).length > 0, fetchedAt: (new Date()).toISOString() }
      ]
    },
    metrics,
    companies,
    hasQualitative: metrics.some((m) => m.kind),
    hasForecast: Object.keys(fcRaw).length > 0,
    hasValuation: valNorms.size > 0,
    hasReturns: companies.some((c) => c.returns),
    hasOwnership: companies.some((c) => c.ownership),
    hasTags: companies.some((c) => c.tags),
    hasCapTable: companies.some((c) => c.capTable),
    hasSoi: companies.some((c) => c.soi),
    hasSoiHistory: companies.some((c) => c.soiHistory),
    forecastAsOfDates: [...fcAsofDates].sort(),
    dimensions: {
      funds: fundDim,
      tags: tagDim,
      periods: [...allPeriods].filter((p) => !asOf || p <= asOf).sort()
    }
  };
}
