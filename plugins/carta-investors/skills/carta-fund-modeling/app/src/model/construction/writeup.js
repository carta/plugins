// Write-up drafts reuse the LP due diligence answers, so the two always agree.
import { fmtMIn, fmtPct, fmtX, fundNameOnly } from "../../ui/format.js";
import { buildFaq } from "./faq.js";
import { storyline } from "./summary.js";
import { whatItTakes } from "./light.js";
import { positionCurrencies } from "./riskMarket.js";

/** In reading order. `faq` lists the answers a draft is built from; `autofill` is "draft", "facts" (figures beside the user's text) or "none". */
export const WRITEUP_SECTIONS = [
  {
    id: "summary", title: "Executive summary", autofill: "draft",
    why: "The first thing an LP reads. It decides whether they read the rest.",
    questions: ["What does the fund invest in, at what stage, and how big is it?", "Why is this team the one to do it?", "What does the fund aim to return, and how?"],
    example: "Fund III is a $150M seed fund backing about 35 vertical-software companies in North America, led by a team that has backed 12 companies through Series B together.",
  },
  {
    id: "thesis", title: "Investment thesis", autofill: "none",
    why: "LPs want a view of the world that's specific enough to be wrong. A thesis that fits every fund tells them nothing.",
    questions: ["What do you believe that most investors don't?", "Which sectors, business models and founders does it point you to, and which does it rule out?", "Name two or three companies that fit, and one that doesn't."],
    example: "Too broad: \"B2B SaaS is underserved.\" Specific: \"Seed-stage vertical SaaS in the GCC has no dedicated institutional lead investor.\"",
  },
  {
    id: "market", title: "Market opportunity and why now", autofill: "none",
    why: "LPs ask why this fund should exist now, and what in the market makes the timing right.",
    questions: ["How large is the opportunity, and how is it changing?", "What has shifted (technology, regulation, capital, talent) to open it now?", "Who else is investing here, and why aren't they enough?"],
    example: "Since 2023, three regulatory changes have let non-bank lenders operate across the region, and seed funding for them still trails the US by five years.",
  },
  {
    id: "strategy", title: "Strategy: stage, sector and geography", autofill: "draft", faq: ["allocation", "ownership", "entryprices"],
    why: "LPs want check sizes, pace, holding periods, geography, sector and stage in one clear answer.",
    questions: ["Which stages do you lead or follow, and with what check sizes?", "Which sectors and geographies, and in what mix?", "How does this compare with your previous fund?"],
    example: "We lead seed rounds with $1–2M checks for 10–12% ownership, 80% in North America and 20% in Europe.",
  },
  {
    id: "construction", title: "Portfolio construction", autofill: "draft", faq: ["companies", "reserves", "deploy", "concentration"],
    why: "Portfolio construction turns the thesis into numbers: how many companies, how much in each, and how much is held back.",
    questions: ["How many companies, at what check size and ownership?", "How much is reserved for follow-ons, and how do you decide who gets it?", "How fast will you deploy, and what are your concentration limits?"],
    example: "About 30 companies over 3 years, with 45% of the fund reserved for the top third of the portfolio.",
  },
  {
    id: "sourcing", title: "Sourcing and investment process", autofill: "none",
    why: "LPs want to know where your deals come from and how a yes gets made, step by step.",
    questions: ["Where do your best deals come from, and what share is proprietary?", "What are your screening criteria and red lines?", "Who decides, how, and how long does it take?"],
    example: "60% of our last fund's investments came from founders we'd backed before or their referrals; every investment needs two partners' approval.",
  },
  {
    id: "valueadd", title: "Value-add and portfolio support", autofill: "none",
    why: "Founders choose investors as much as investors choose founders. LPs want proof the help is real.",
    questions: ["What do you do for companies after you invest?", "Give one example where it changed an outcome.", "How do you plan for exits?"],
    example: "Our talent partner placed 14 senior hires across the last fund, including two CEOs.",
  },
  {
    id: "team", title: "Team and track record", autofill: "draft",
    why: "Many LPs treat track record as the most important signal. For a first fund, relevant experience stands in for it.",
    questions: ["Who are the partners, and how long have they worked together?", "Which past investments best show your edge, and what did you learn from the misses?", "What's the plan if a key person leaves?"],
    example: "The three partners have invested together since 2016; their 41 joint investments include 4 exits above 10×.",
  },
  {
    id: "terms", title: "Fund terms and alignment", autofill: "draft", faq: ["size", "term", "fees", "carry", "recycling", "gpcarry"],
    why: "LPs check that the GP wins only when they do: fees, carry and the GP's own commitment.",
    questions: ["What are the size, term, fees and carry?", "How much is the GP committing, and in cash?", "Anything unusual in the terms, and why?"],
    example: "The GP commits 2% in cash, and carry is paid only after LPs get their capital back plus an 8% preferred return.",
  },
  {
    id: "returns", title: "Projected returns and liquidity", autofill: "draft", faq: ["net", "gross", "target", "scenarios", "moneyback", "jcurve"],
    why: "LPs compare your projection with your track record and the market, and care most about when cash comes back.",
    questions: ["What net returns do you project, and on what assumptions?", "What happens in a tougher market?", "When do LPs get their money back?"],
    example: "The base case returns 3.0× net, with LPs' money back by year 7; a downside case still returns 1.8×.",
  },
  {
    id: "risks", title: "Key risks and mitigants", autofill: "facts", faq: ["drivers", "breakeven", "exitsens", "loss"],
    why: "Naming the risks yourself builds trust. Every focus in the strategy is also a concentration risk.",
    questions: ["What could make this fund underperform?", "How concentrated is the portfolio by sector, stage or company?", "What key-person, market or execution risks are there, and how do you reduce them?"],
    example: "The fund is concentrated in one sector by design; we cap any single company at 15% of commitments.",
  },
  {
    id: "esg", title: "ESG and responsible investing", autofill: "none", optional: true,
    why: "Many institutional LPs must report on responsible investing and ask every manager the same questions.",
    questions: ["Do you have a responsible investment policy?", "How do you assess and monitor ESG risks in portfolio companies?", "What do you report to LPs?"],
    example: "We screen every deal against our exclusion list and ask portfolio companies for a yearly diversity and emissions survey.",
  },
];

const join = (parts) => parts.filter(Boolean).join(" ");

/** The firm's earlier funds, newest first, from the booked figures: what the track record table shows. */
export function trackRecord(snapshot) {
  return (snapshot?.funds ?? [])
    .filter((f) => f.type !== "SPV" && f.committed > 0)
    .map((f) => {
      const paid = f.lpPaidIn || 0, dist = f.lpDistributed || 0, nav = f.lpNav ?? f.overviewLpNav ?? null;
      return {
        id: f.id, name: fundNameOnly(f.name) || f.id, vintage: f.vintage ?? null, committed: f.committed, currency: f.currency ?? null,
        dpi: f.lpDpi ?? (paid > 0 ? dist / paid : null),
        tvpi: f.lpTvpi ?? (paid > 0 && nav != null ? (dist + nav) / paid : null),
        netIrr: f.netLpIrr ?? null,
      };
    })
    .sort((a, b) => (b.vintage ?? 0) - (a.vintage ?? 0) || b.committed - a.committed);
}

const squash = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Best companies by multiple at Carta's booked marks, skipping the firm's own fund entities and companies held in mixed currencies. */
export function topCompanies(companies, snapshot, { max = 5 } = {}) {
  const funds = Object.fromEntries((snapshot?.funds ?? []).map((f) => [f.id, f]));
  const own = new Set((snapshot?.funds ?? []).flatMap((f) => [squash(fundNameOnly(f.name)), squash(f.id)]));
  return (companies ?? [])
    .filter((c) => !c.archived && !own.has(squash(c.name)))
    .map((c) => {
      const pos = c.positions ?? [];
      const ccys = positionCurrencies(pos, snapshot);
      if (ccys.size > 1) return null;
      const invested = pos.reduce((t, p) => t + (p.cost || 0), 0);
      const realized = pos.reduce((t, p) => t + (p.proceeds || 0), 0);
      const value = realized + pos.reduce((t, p) => t + (p.cartaFv || 0), 0);
      const fundNames = [...new Set(pos.map((p) => fundNameOnly(funds[p.fundId]?.name) ?? p.fundId))];
      return invested > 0 ? { id: c.id, name: c.name, funds: fundNames, currency: [...ccys][0], invested, realized, value, multiple: value / invested, irr: c.dealIrr ?? null } : null;
    })
    .filter((c) => c && c.multiple > 1)
    .sort((a, b) => b.multiple - a.multiple || b.value - a.value)
    .slice(0, max);
}

/** The model's starting text for a section, or null where the user writes it from scratch. */
export function writeupDraft(id, plan, res, ctx = {}) {
  const section = WRITEUP_SECTIONS.find((s) => s.id === id);
  if (!section || !res?.ok) return null;
  const faq = ctx.faq ?? buildFaq(plan, res, ctx.extras ?? {});
  const answer = (fid) => faq.find((q) => q.id === fid)?.answer ?? null;
  const ccy = plan.general.currency;
  const light = plan.mode === "light";
  if (id === "summary") {
    const name = plan.general.fundName?.trim();
    const [first, ...rest] = storyline(plan, res);
    // "A $100M fund backing 30 companies returns…" reads as "Fund III, a $100M fund backing 30 companies, returns…".
    const named = name && first ? first.replace(/^A (.+?) returns /, (_, fund) => `${name}, a ${fund}, returns `) : first;
    return join([named, ...rest]);
  }
  if (id === "strategy" && light) {
    const l = plan.light;
    const w = whatItTakes(l, plan.general.committed);
    return join([
      `The fund backs ${l.companies} companies with first checks of ${fmtMIn(l.initialCheck, ccy)} and holds ${fmtPct(l.reservePct, 0)} of what it invests for follow-ons.`,
      answer("allocation"),
      w?.multipleToReturnFund ? `One company returns the whole fund at a ${fmtX(w.multipleToReturnFund, 1)} exit on what's invested in it.` : null,
    ]);
  }
  if (id === "team") {
    const funds = trackRecord(ctx.snapshot), tops = topCompanies(ctx.companies, ctx.snapshot);
    if (!funds.length && !tops.length) return null;
    const best = funds.filter((f) => f.tvpi != null).sort((a, b) => b.tvpi - a.tvpi)[0];
    return join([
      funds.length ? `The firm has managed ${funds.length} earlier ${funds.length === 1 ? "fund" : "funds"} on Carta${best ? `, led by ${best.name}${best.vintage ? ` (${best.vintage})` : ""} at ${fmtX(best.tvpi)} net TVPI${best.netIrr != null ? ` and ${fmtPct(best.netIrr, 1)} net IRR` : ""}` : ""}.` : null,
      tops.length ? `Its strongest investments include ${tops.map((c) => `${c.name} (${fmtX(c.multiple, 1)} on ${fmtMIn(c.invested, c.currency ?? ccy)} invested)`).join(", ")}.` : null,
    ]);
  }
  if (section.autofill === "draft") return join((section.faq ?? []).map(answer)) || null;
  return null;
}

// Runs of related figures read better as one line than as a row each.
const GROUPS = [
  { test: /^By year (\d+)$/, label: "Capital deployed by", part: (m, v) => `year ${m[1]}: ${v}` },
  { test: /^(.+) share of proceeds$/, label: "Share of exit proceeds", part: (m, v) => `${m[1]} ${v}` },
];

/** Repeated labels dropped, and grouped runs folded into one `wide` fact. */
function tidy(facts) {
  const out = [], seen = new Set();
  for (const f of facts) {
    const g = GROUPS.map((x) => [x, f.label.match(x.test)]).find(([, m]) => m);
    if (g) {
      const [x, m] = g;
      let row = out.find((o) => o.label === x.label);
      if (!row) { row = { label: x.label, parts: [], wide: true }; out.push(row); }
      row.parts.push(x.part(m, f.value));
    } else if (!seen.has(f.label)) {
      seen.add(f.label);
      out.push(f);
    }
  }
  return out.map((f) => (f.parts ? { label: f.label, value: f.parts.join(" · "), parts: f.parts, wide: true } : f));
}

/** `wide` marks a grouped run (with its `parts`) and `fund` a track record row. */
export function writeupFacts(id, plan, res, ctx = {}) {
  if (!res?.ok) return [];
  const ccy = plan.general.currency;
  if (id === "team") {
    const tops = topCompanies(ctx.companies, ctx.snapshot).map((c) => ({
      company: { name: c.name, funds: c.funds.join(", "), invested: fmtMIn(c.invested, c.currency ?? ccy), value: fmtMIn(c.value, c.currency ?? ccy), multiple: fmtX(c.multiple, 1), irr: c.irr == null ? "—" : fmtPct(c.irr, 1) },
      label: c.name, value: `${fmtX(c.multiple, 1)} on ${fmtMIn(c.invested, c.currency ?? ccy)} invested${c.irr != null ? ` · ${fmtPct(c.irr, 1)} IRR` : ""}`,
    }));
    return [...trackRecord(ctx.snapshot).map((f) => ({
      fund: { name: f.name, vintage: f.vintage, size: fmtMIn(f.committed, f.currency ?? ccy), tvpi: fmtX(f.tvpi), dpi: fmtX(f.dpi), netIrr: f.netIrr == null ? "—" : fmtPct(f.netIrr, 1) },
      label: `${f.name}${f.vintage ? ` (${f.vintage})` : ""}`,
      value: [fmtMIn(f.committed, f.currency ?? ccy), f.tvpi != null ? `${fmtX(f.tvpi)} TVPI` : null, f.dpi != null ? `${fmtX(f.dpi)} DPI` : null, f.netIrr != null ? `${fmtPct(f.netIrr, 1)} net IRR` : null].filter(Boolean).join(" · "),
    })), ...tops];
  }
  const section = WRITEUP_SECTIONS.find((s) => s.id === id);
  if (!section?.faq) return [];
  const faq = ctx.faq ?? buildFaq(plan, res, ctx.extras ?? {});
  return tidy(section.faq.flatMap((fid) => faq.find((q) => q.id === fid)?.figures ?? []));
}

/** A section's state: what to show, and whether the model has moved on since the user edited it. */
export function sectionState(plan, id, draft) {
  const saved = plan.writeup?.sections?.[id];
  const edited = saved?.text != null;
  return {
    text: edited ? saved.text : draft ?? "",
    source: edited ? (saved.text.trim() ? "written" : "empty") : draft ? "draft" : "empty",
    stale: edited && draft != null && saved.draftBase != null && saved.draftBase !== draft,
  };
}

/** Every section ready to read or export: the user's text where written, the model's draft otherwise. */
export function writeupDocument(plan, res, ctx = {}) {
  const faq = res?.ok ? ctx.faq ?? buildFaq(plan, res, ctx.extras ?? {}) : [];
  const c = { ...ctx, faq };
  return WRITEUP_SECTIONS.map((s) => {
    const draft = writeupDraft(s.id, plan, res, c);
    const st = sectionState(plan, s.id, draft);
    return { id: s.id, title: s.title, optional: !!s.optional, included: isIncluded(plan, s.id), text: st.text.trim(), source: st.source, stale: st.stale, facts: writeupFacts(s.id, plan, res, c) };
  });
}

/** Sections reach the model view, the copy and the report only once the user adds them. */
export const isIncluded = (plan, id) => !!plan.writeup?.sections?.[id]?.included;
export const includedCount = (plan) => WRITEUP_SECTIONS.filter((s) => isIncluded(plan, s.id)).length;

export const writtenCount = (plan) => Object.values(plan.writeup?.sections ?? {}).filter((s) => s?.text?.trim()).length;

export function writeupText(plan, doc) {
  const name = plan.general.fundName?.trim() || plan.name || "Fund";
  const parts = [`${name}: fund write-up`];
  for (const s of doc) {
    if (!s.text && !s.facts.length) continue;
    parts.push("", s.title.toUpperCase());
    if (s.text) parts.push(s.text);
    if (s.facts.length) parts.push(...s.facts.map((f) => `- ${f.label}: ${f.value}`));
  }
  return parts.join("\n");
}
