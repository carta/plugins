// Shown as the Strategy step.
import { useMemo, useState } from "react";
import { FS, sans } from "../../ui/theme.js";
import { Btn, Dropdown, Segmented, TextInput, StatBar, InfoTip } from "../../ui/components.jsx";
import { fmtMIn, fmtFullIn, fmtX, fmtPct, fmtOwn } from "../../ui/format.js";
import { FOLLOW_ON_MODES, defaultAllocation, defaultFollowOns, validateAllocations, validateSectors, stepLabel, horizonYears, evenYearlyCounts } from "../../model/construction/plan.js";
import { companyTemplate } from "../../model/construction/engine.js";
import { FOLLOW_ON_PRESETS, followOnPreset, applyFollowOnPreset } from "../../model/construction/followOns.js";
import { marketSummary } from "../../model/construction/market.js";
import BenchmarkPanel from "./BenchmarkPanel.jsx";
import { C_TVPI } from "./charts.jsx";
import { StepHeader, Field, NumInput, AmountInput, PctInput, ErrorLine, fmtCount, grid, cellNum, UsdDefaultsNotice } from "./fields.jsx";

const subtle = { color: "var(--ink-color-global-text-subtle)" };
const Tip = ({ label, children, width = 320 }) => (
  <InfoTip portal placement="top" width={width} label={label}><div style={{ display: "grid", gap: 6 }}>{children}</div></InfoTip>
);
const Label = ({ children, tip }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{children}{tip}</span>
);
const groupTitle = { ...sans, fontSize: FS.body, fontWeight: 600, margin: "0 0 10px" };
const Group = ({ title, children }) => (
  <section style={{ marginTop: 20 }}>
    <div style={{ ...sans, fontSize: FS.micro, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--ink-color-global-text-subtle)", display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>{title}</div>
    {children}
  </section>
);
const COLS = "minmax(150px, 2fr) minmax(76px, 1fr) 96px repeat(4, minmax(72px, 1fr)) 72px";

/** When first checks go out: evenly over the horizon, or by the companies typed for each year. */
function Pacing({ a, r, edit }) {
  const years = horizonYears(a);
  const byYear = a.pacing === "byYear";
  const counts = Array.from({ length: years }, (_, y) => a.yearlyCounts?.[y] ?? null);
  const typed = counts.reduce((s, v) => s + (v > 0 ? v : 0), 0);
  // Switching to "By year" starts from an even split of the companies the capital supports.
  const setMode = (mode) => edit((x) => {
    if (mode === "byYear" && !(x.yearlyCounts?.length)) x.yearlyCounts = evenYearlyCounts(r ? r.initialDeals : years * 5, horizonYears(x));
    x.pacing = mode;
  });
  const setYear = (y, v) => edit((x) => {
    const list = Array.from({ length: horizonYears(x) }, (_, i) => x.yearlyCounts?.[i] ?? 0);
    list[y] = v;
    x.yearlyCounts = list;
  });
  return (
    <div data-testid={`pacing-${a.id}`} style={{ marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Label tip={<Tip label="About: Pacing of first checks">
          <div>Even spreads first checks evenly over the investment horizon.</div>
          <div>By year lets you say how many companies to back in each year, for example 10, 8 and 2. Those numbers set the pace. The total still comes from the allocation's share of capital.</div>
        </Tip>}><span style={{ ...sans, fontSize: FS.small, fontWeight: 600 }}>Pacing of first checks</span></Label>
        <Segmented small value={byYear ? "byYear" : "even"} options={[{ id: "even", label: "Even" }, { id: "byYear", label: "By year", testId: `pacing-byyear-${a.id}` }]} onChange={setMode} />
      </div>
      {byYear && (
        <>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 10 }}>
            {counts.map((v, y) => (
              <label key={y} style={{ ...sans, fontSize: FS.small, display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={subtle}>Year {y + 1}</span>
                <NumInput value={v} decimals={2} width={80} onChange={(n) => setYear(y, n)} testId={`year-${a.id}-${y}`} ariaLabel={`Companies in year ${y + 1}`} />
              </label>
            ))}
          </div>
          <div data-testid={`pacing-note-${a.id}`} style={{ ...sans, fontSize: FS.micro, ...subtle, marginTop: 6 }}>
            {typed > 0
              ? `Adds up to ${fmtCount(typed)} companies${r ? `; this allocation's capital supports ${fmtCount(r.initialDeals)}` : ""}. The years set the pace: ${counts.map((v) => fmtPct((v > 0 ? v : 0) / typed, 0)).join(" · ")} of first checks. The total still comes from the allocation's share of capital.`
              : "Enter the companies for each year."}
          </div>
        </>
      )}
    </div>
  );
}

function ProRataCheck({ i, st, funnel, a, ccy }) {
  const into = funnel?.find((f) => f.stage === i);
  const before = funnel?.find((f) => f.stage === i - 1);
  if (!into?.check || !before) return <span data-testid={`prorata-${i}`}>Pro-rata</span>;
  const priorFollowOn = i - 1 > a.entryStage;
  return (
    <InfoTip portal placement="top" width={300} trigger={
      <span data-testid={`prorata-${i}`} tabIndex={0} style={{ borderBottom: "1px dotted currentColor", cursor: "help" }}>
        ≈ {fmtFullIn(into.check, ccy)}
      </span>
    }>
      <div data-testid={`prorata-math-${i}`} style={{ fontVariantNumeric: "tabular-nums" }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Pro-rata check into {st.name}</div>
        <div>{fmtOwn(before.ownership)} ownership going into {st.name}</div>
        <div>× {fmtFullIn(st.roundSize, ccy)} round size</div>
        <div style={{ fontWeight: 600, marginTop: 4 }}>= {fmtFullIn(into.check, ccy)}</div>
        {priorFollowOn && (
          <div style={{ marginTop: 8, opacity: 0.8 }}>
            Ownership is the average across companies you did and didn't follow on into earlier.
          </div>
        )}
      </div>
    </InfoTip>
  );
}

function AllocationEditor({ a, plan, result, update, error, canRemove, onClose }) {
  const ccy = plan.general.currency;
  const sector = plan.sectors.find((s) => s.id === a.sectorId);
  const r = result?.ok ? result.allocations.find((x) => x.id === a.id) : null;
  // Needs only this allocation and its sector, so checks stay visible while other steps are incomplete.
  const tpl = useMemo(() => {
    if (!sector || Object.keys(validateSectors([sector])).length) return null;
    const entry = sector.stages[a.entryStage];
    const sized = a.checkMode === "ownership" ? a.entryOwnership > 0 && a.entryOwnership < 1 : a.initialCheck > 0;
    return entry && sized ? companyTemplate(a, sector) : null;
  }, [a, sector]);
  const path = (i) => tpl?.funnel.find((f) => f.stage === i);
  const edit = (fn) => update((p) => { fn(p.allocations.find((x) => x.id === a.id), p); });
  const set = (key, v) => edit((x) => { x[key] = v; });
  const preset = followOnPreset(a, sector);
  // A new entry round or profile keeps the chosen follow-on preset (custom starts from the default).
  const reset = (x, s) => {
    x.followOns = defaultFollowOns(s.stages.length, x.entryStage);
    applyFollowOnPreset(x, s, preset === "custom" ? "standard" : preset);
  };
  const setEntry = (stage) => edit((x) => {
    const s = plan.sectors.find((y) => y.id === x.sectorId);
    x.entryStage = stage;
    reset(x, s);
  });
  const setSector = (id) => edit((x) => {
    const s = plan.sectors.find((y) => y.id === id);
    x.sectorId = id;
    x.entryStage = Math.min(x.entryStage, s.stages.length - 1);
    reset(x, s);
  });
  const setFo = (i, patch) => edit((x) => {
    const next = { ...x.followOns[i], ...patch };
    // Switching to a fixed amount starts from the pro-rata check, so the box is never blank.
    if (patch.mode === "amount" && !(next.amount > 0) && path(i - 1)) {
      next.amount = Math.round(path(i - 1).ownership * sector.stages[i].roundSize);
    }
    x.followOns[i] = next;
    x.followOnPreset = "custom";
  });
  const entry = sector?.stages[a.entryStage];
  const check = tpl?.initial ?? (a.checkMode === "amount" ? a.initialCheck : null);
  const checkHint = tpl ? (a.checkMode === "ownership"
    ? `${fmtMIn(tpl.initial, ccy)} per company, ${fmtPct(tpl.initial / entry.roundSize, 0)} of the round`
    : `${fmtOwn(tpl.entryOwnership)} ownership at entry, ${fmtPct(tpl.initial / entry.roundSize, 0)} of the ${entry.name} round`) : undefined;
  const checkTooBig = entry && check > entry.roundSize
    ? `More than the whole ${entry.name} round in this market (${fmtMIn(entry.roundSize, ccy)}). Lower the check or pick a later round.` : undefined;
  const later = sector ? sector.stages.map((st, i) => ({ st, i })).filter(({ i }) => i > a.entryStage) : [];
  const showTable = preset === "custom";
  const summary = later.map(({ st, i }) => ({ st, fo: a.followOns?.[i] })).filter(({ fo }) => fo && fo.mode !== "none");

  return (
    <div data-testid={`alloc-${a.id}`} style={{ padding: "16px 18px 18px", background: "var(--ink-color-global-surface-background-default)",
      borderTop: "1px solid var(--ink-color-global-border-subtle)" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
        <TextInput value={a.name} onChange={(e) => set("name", e.target.value)} aria-label="Allocation name" style={{ fontWeight: 600, maxWidth: 260 }} />
        <span style={{ flex: 1 }} />
        {canRemove && <Btn kind="danger" onClick={() => update((p) => { p.allocations = p.allocations.filter((x) => x.id !== a.id); })} data-testid={`remove-${a.id}`}>Remove</Btn>}
        <Btn onClick={onClose} data-testid={`close-${a.id}`}>Done</Btn>
      </div>

      {r && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ ...groupTitle, display: "flex", alignItems: "center", gap: 6 }}>
            What it produces
            <Tip label="About: What it produces">
              <div>The number of companies isn't typed in. It's worked out: the allocation's capital, less what's held for follow-ons, divided by the first check.</div>
              <div>Counts are averages across all companies, so they can be fractions.</div>
            </Tip>
          </div>
          <StatBar serif={false} stats={[
            { key: "n", label: "Initial investments", value: fmtCount(r.initialDeals) },
            { key: "f", label: "Follow-on checks", value: fmtCount(r.followOns) },
            { key: "ic", label: "Initial capital", value: fmtMIn(r.initialCapital, ccy) },
            { key: "fc", label: "Follow-on capital", value: fmtMIn(r.followOnCapital, ccy) },
            { key: "rr", label: "Held for follow-ons", value: r.reserveRatio == null ? "—" : fmtPct(r.reserveRatio / (1 + r.reserveRatio), 0) },
            { key: "m", label: "Expected multiple", value: fmtX(r.moic) },
          ]} />
        </div>
      )}

      <Group title="What">
        <div style={grid}>
          <Field label={<Label tip={<Tip label="About: Market profile"><div>The market this allocation's companies raise in, set in the Market step. It sets their odds, round sizes and prices.</div></Tip>}>Market profile</Label>}
            hint={<span data-testid={`market-summary-${a.id}`}>{marketSummary(sector)}</span>}>
            <Dropdown minWidth={200} value={a.sectorId} options={plan.sectors.map((s) => ({ id: s.id, label: s.name }))} onChange={setSector} />
          </Field>
          <Field label="Entry round" hint={entry ? <span data-testid={`entry-price-${a.id}`}>Raises {fmtMIn(entry.roundSize, ccy)} at {fmtMIn(entry.preMoney, ccy)} pre-money in this market</span> : undefined}>
            <Dropdown minWidth={160} value={a.entryStage} options={(sector?.stages ?? []).map((s, i) => ({ id: i, label: s.name }))} onChange={setEntry} testId={`entry-${a.id}`} />
          </Field>
        </div>
      </Group>

      <Group title="How much">
        <Field label={<Label tip={<Tip label="About: First check">
          <div>Amount: the average first check, in the plan's currency.</div>
          <div>Target ownership: the stake you want at entry. The check is worked out from the entry round's valuation.</div>
        </Tip>}>First check</Label>}
          hint={checkHint} error={checkTooBig}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <Segmented small value={a.checkMode} options={[{ id: "amount", label: "Amount" }, { id: "ownership", label: "Target ownership" }]} onChange={(v) => set("checkMode", v)} />
            {a.checkMode === "ownership"
              ? <PctInput value={a.entryOwnership} onChange={(v) => set("entryOwnership", v)} width={100} testId={`own-${a.id}`} />
              : <AmountInput ccy={ccy} value={a.initialCheck} onChange={(v) => set("initialCheck", v)} width={160} testId={`check-${a.id}`} />}
          </div>
        </Field>
      </Group>

      <Group title="When">
        <div style={grid}>
          <Field label={<Label tip={<Tip label="About: Investment horizon"><div>The months over which this allocation writes its first checks, counted from the fund's start.</div><div>Follow-ons come later, as companies raise their next rounds.</div></Tip>}>Investment horizon</Label>}>
            <NumInput value={a.horizonMonths} decimals={0} suffix="months" width={100} onChange={(v) => set("horizonMonths", v)} />
          </Field>
        </div>
        <Pacing a={a} r={r} edit={edit} />
      </Group>

      {later.length > 0 && (
        <Group title={<>Follow-ons
          <Tip label="About: Follow-ons">
            <div>Follow-ons are later checks into companies that raise their next round. They come out of this allocation's capital, so bigger follow-ons leave fewer first checks.</div>
            <div>Pro-rata keeps your ownership: your stake going into the round × the round size.</div>
            <div>Participation is the share of the companies that raise that round which you follow on into.</div>
          </Tip></>}>
          <Segmented value={preset} onChange={(id) => edit((x) => applyFollowOnPreset(x, sector, id))}
            options={FOLLOW_ON_PRESETS.map((pr) => ({ id: pr.id, label: pr.short, title: pr.blurb, testId: `fo-preset-${pr.id}-${a.id}` }))} />
          <div data-testid={`fo-blurb-${a.id}`} style={{ ...sans, fontSize: FS.small, ...subtle, marginTop: 8, maxWidth: "75ch" }}>{FOLLOW_ON_PRESETS.find((pr) => pr.id === preset)?.blurb}</div>
          {!showTable && (
            <div data-testid={`fo-summary-${a.id}`} style={{ ...sans, fontSize: FS.small, marginTop: 8 }}>
              {summary.length
                ? summary.map(({ st, fo }) => `${st.name}: ${fo.mode === "prorata" ? "pro-rata" : fmtMIn(fo.amount, ccy)} in ${fmtPct(fo.participation ?? 0, 0)} of companies`).join(" · ")
                : "No follow-on checks."}
              {" "}<Btn kind="link" onClick={() => edit((x) => applyFollowOnPreset(x, sector, "custom"))} data-testid={`fo-customize-${a.id}`} style={{ fontSize: "inherit" }}>Customize</Btn>
            </div>
          )}
          {showTable && (
            <div style={{ overflowX: "auto", marginTop: 12 }}>
              <table className="ledger" style={{ minWidth: 720 }}>
                <thead><tr>
                  <th style={{ textAlign: "left" }}>Round</th><th style={{ textAlign: "left" }}>Strategy</th><th>Check{ccy ? ` (${ccy})` : ""}</th>
                  <th><Label tip={<Tip label="About: Participation"><div>The share of companies that raise this round which you follow on into.</div></Tip>}>Participation</Label></th>
                  <th><Label tip={<Tip label="About: Ownership after round"><div>Your average stake after this round's dilution, across companies you did and didn't follow on into.</div></Tip>}>Ownership after round</Label></th>
                  <th>Expected follow-ons</th>
                </tr></thead>
                <tbody>
                  {later.map(({ st, i }) => {
                    const fo = a.followOns?.[i] ?? { mode: "none", participation: 0 };
                    const funnel = r?.funnel.find((f) => f.stage === i);
                    const own = path(i);
                    return (
                      <tr key={i}>
                        <td style={{ whiteSpace: "nowrap" }}>{st.name}</td>
                        <td><Segmented small value={fo.mode} options={FOLLOW_ON_MODES} onChange={(v) => setFo(i, { mode: v })} /></td>
                        <td style={cellNum}>{fo.mode === "amount" ? <AmountInput width={130} value={fo.amount} onChange={(v) => setFo(i, { amount: v })} ariaLabel={`${st.name} follow-on amount`} /> : fo.mode === "prorata" ? <ProRataCheck i={i} st={st} funnel={tpl?.funnel} a={a} ccy={ccy} /> : "—"}</td>
                        <td style={cellNum}>{fo.mode === "none" ? "—" : <PctInput width={70} value={fo.participation} onChange={(v) => setFo(i, { participation: v })} ariaLabel={`${st.name} participation`} />}</td>
                        <td style={cellNum} data-testid={`own-after-${i}`}>{own ? fmtOwn(own.ownership) : "—"}</td>
                        <td style={cellNum}>{funnel && fo.mode !== "none" ? fmtCount(funnel.reached * (fo.participation ?? 0)) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Group>
      )}
      <ErrorLine>{error}</ErrorLine>
    </div>
  );
}

function SummaryRow({ a, plan, result, update, open, onToggle, error }) {
  const ccy = plan.general.currency;
  const sector = plan.sectors.find((s) => s.id === a.sectorId);
  const r = result?.ok ? result.allocations.find((x) => x.id === a.id) : null;
  const check = r ? r.initialCheck : a.checkMode === "amount" ? a.initialCheck : null;
  const cell = { ...sans, fontSize: FS.small, ...cellNum };
  return (
    <div data-testid={`strategy-row-${a.id}`} style={{ display: "grid", gridTemplateColumns: COLS, gap: 8, alignItems: "center", padding: "10px 14px",
      background: open ? "var(--accent-soft)" : "transparent" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ ...sans, fontSize: FS.small, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name || "Untitled"}</div>
        {a.source && <div data-testid={`source-${a.id}`} style={{ ...sans, fontSize: FS.micro, ...subtle }}>From {a.source.fund} · {a.source.companies} companies</div>}
        {error && <div role="alert" style={{ ...sans, fontSize: FS.micro, color: "var(--ink-color-global-feedback-negative-strong)" }}>Needs attention</div>}
      </div>
      <span style={{ ...sans, fontSize: FS.small }}>{sector?.stages[a.entryStage]?.name ?? "—"}</span>
      <PctInput value={a.capitalPct} onChange={(v) => update((p) => { p.allocations.find((x) => x.id === a.id).capitalPct = v; })} testId={`pct-${a.id}`} width={58} ariaLabel={`${a.name} share of capital`} />
      <span style={cell}>{check != null ? fmtMIn(check, ccy) : "—"}</span>
      <span style={cell}>{r ? fmtCount(r.initialDeals) : "—"}</span>
      <span style={cell}>{r?.reserveRatio != null ? fmtPct(r.reserveRatio / (1 + r.reserveRatio), 0) : "—"}</span>
      <span style={cell}>{r ? fmtX(r.moic) : "—"}</span>
      <Btn onClick={onToggle} data-testid={`edit-${a.id}`} aria-expanded={open}>{open ? "Close" : "Edit"}</Btn>
    </div>
  );
}

export default function AllocationsStep({ plan, update, result, snapshot, firm }) {
  const errors = validateAllocations(plan.allocations, plan.sectors);
  const total = plan.allocations.reduce((s, a) => s + (a.capitalPct || 0), 0);
  const [openId, setOpenId] = useState(null);
  const [bench, setBench] = useState(false);
  const off = Math.abs(total - 1) > 1e-6;
  const add = () => {
    const a = defaultAllocation(plan.sectors[0], { name: "Series A", entryStage: Math.min(2, plan.sectors[0].stages.length - 1), capitalPct: Math.max(0, Math.round((1 - total) * 1e4) / 1e4) });
    update((p) => { p.allocations.push(a); });
    setOpenId(a.id);
  };
  // Scale every share so they add up to 100%; rounding drift goes to the largest.
  const balance = () => update((p) => {
    const t = p.allocations.reduce((s, a) => s + (a.capitalPct || 0), 0);
    if (!(t > 0)) { p.allocations.forEach((a) => { a.capitalPct = Math.round(1e4 / p.allocations.length) / 1e4; }); }
    else p.allocations.forEach((a) => { a.capitalPct = Math.round(((a.capitalPct || 0) / t) * 1e4) / 1e4; });
    const drift = 1 - p.allocations.reduce((s, a) => s + a.capitalPct, 0);
    const big = p.allocations.reduce((x, y) => (y.capitalPct > x.capitalPct ? y : x));
    big.capitalPct = Math.round((big.capitalPct + drift) * 1e4) / 1e4;
  });
  const head = { ...sans, fontSize: FS.micro, fontWeight: 600, ...subtle, textAlign: "right" };
  const blockedElsewhere = !result?.ok && result?.blockedBy && !result.blockedBy.includes("strategy");

  return (
    <div data-testid="allocations-step">
      <StepHeader title="Strategy">
        How the fund invests. Each allocation takes a share of the capital, enters at one round and can follow on into later rounds. Open one to change its settings.
      </StepHeader>
      <UsdDefaultsNotice ccy={plan.general.currency} amounts="round sizes, valuations and checks" />

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <Btn kind="primary" onClick={add} data-testid="add-allocation">+ Add allocation</Btn>
        <Btn onClick={() => setBench((v) => !v)} data-testid="toggle-benchmark" aria-expanded={bench}>Build from your fund history</Btn>
        <Tip label="About: Build from your fund history">
          <div>Looks at the checks one of your funds actually wrote and creates one allocation per entry round, with its median check and follow-on pattern.</div>
          <div>It replaces the current allocations, after you confirm.</div>
        </Tip>
      </div>
      {bench && <BenchmarkPanel plan={plan} update={update} snapshot={snapshot} firm={firm} defaultOpen onClose={() => setBench(false)} />}
      {blockedElsewhere && (
        <div style={{ ...sans, fontSize: FS.small, ...subtle, marginBottom: 12 }}>
          Live figures appear once these steps are complete: {result.blockedBy.map(stepLabel).join(", ")}.
        </div>
      )}

      <div className="card" data-testid="strategy-table" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: 700 }}>
            <div style={{ display: "grid", gridTemplateColumns: COLS, gap: 8, padding: "10px 14px", borderBottom: "1px solid var(--ink-color-global-border-subtle)" }}>
              <span style={{ ...head, textAlign: "left" }}>Allocation</span>
              <span style={{ ...head, textAlign: "left" }}>Enters at</span>
              <span style={{ ...head, textAlign: "left", display: "inline-flex", alignItems: "center", gap: 4 }}>Share of capital
                <Tip label="About: Share of capital"><div>The part of the fund's investable capital this allocation puts to work, first checks and follow-ons together. All allocations add up to 100%.</div></Tip>
              </span>
              <span style={head}>First check</span>
              <span style={head}>Companies</span>
              <span style={head}>Held for follow-ons</span>
              <span style={head}>Expected multiple</span>
              <span />
            </div>
          </div>
        </div>
        {plan.allocations.map((a) => (
          <div key={a.id} style={{ borderBottom: "1px solid var(--ink-color-global-border-subtle)" }}>
            <div style={{ overflowX: "auto" }}>
              <div style={{ minWidth: 700 }}>
                <SummaryRow a={a} plan={plan} result={result} update={update} error={errors[a.id]} open={openId === a.id}
                  onToggle={() => setOpenId(openId === a.id ? null : a.id)} />
              </div>
            </div>
            {openId === a.id && (
              <AllocationEditor a={a} plan={plan} result={result} update={update} error={errors[a.id]} canRemove={plan.allocations.length > 1}
                onClose={() => setOpenId(null)} />
            )}
          </div>
        ))}
        <div style={{ padding: "12px 14px" }}>
          <div aria-hidden="true" style={{ height: 8, borderRadius: 4, background: "var(--track)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.min(100, Math.max(0, total * 100))}%`, background: off && total > 1 ? "var(--ink-color-global-feedback-negative-strong)" : C_TVPI }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
            <span data-testid="alloc-total" style={{ ...sans, fontSize: FS.small, color: off ? "var(--ink-color-global-feedback-negative-strong)" : "var(--ink-color-global-text-default)" }}>
              Allocated: {fmtPct(total, 1)} of investable capital
              {!off ? " ✓" : total < 1 ? ` · ${fmtPct(1 - total, 1)} left to allocate` : ` · ${fmtPct(total - 1, 1)} over`}
            </span>
            {off && plan.allocations.length > 0 && <Btn onClick={balance} data-testid="balance-allocations">Balance to 100%</Btn>}
          </div>
        </div>
      </div>
      <ErrorLine>{errors.total}</ErrorLine>
    </div>
  );
}
