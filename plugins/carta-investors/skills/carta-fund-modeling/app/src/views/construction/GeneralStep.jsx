import { FS, sans, inkNum } from "../../ui/theme.js";
import { Btn, Dropdown, Segmented, Toggle, TextInput } from "../../ui/components.jsx";
import { CURRENCIES, fmtMIn, fmtFullIn, fmtPct } from "../../ui/format.js";
import { CALL_FREQUENCIES, addMonthsYm, deriveGeneral, gpCommitPctOf, validateGeneral, effectiveGeneral } from "../../model/construction/plan.js";
import { dropForeignBenchmark } from "../../model/construction/market.js";
import { EVERGREEN_YEARS, termYearsOf } from "../../model/construction/feeTiers.js";
import { StepHeader, Field, NumInput, MonthPicker, MonthField, AmountInput, PctInput, UnitToggle, fmtYm, sourceLabel } from "./fields.jsx";

const afterStart = (m) => (m === 0 ? "at the start" : `${m} ${m === 1 ? "month" : "months"} after start`);

function ClosesEditor({ closes, onChange, currency, committed, error, startDate }) {
  const set = (i, patch) => onChange(closes.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const name = (i) => (i === 0 ? "First close" : i === closes.length - 1 ? "Final close" : `Close ${i + 1}`);
  return (
    <Field error={error} hint="When LP money is committed. Fees on committed capital and capital calls start from each close.">
      <div className="fc-closes" role="table" aria-label="Commitment closes">
        <div className="fc-closes-row fc-closes-head" role="row">
          <span role="columnheader">Close</span><span role="columnheader">Date</span><span role="columnheader">% of commitments</span>
          <span role="columnheader" style={{ textAlign: "right" }}>Amount{currency ? ` (${currency})` : ""}</span><span />
        </div>
        {closes.map((c, i) => (
          <div key={i} className="fc-closes-row" role="row" data-testid={`close-${i}`}>
            <span role="cell">
              <div style={{ fontWeight: 600 }}>{name(i)}</div>
              {c.month != null && <div style={{ fontSize: FS.micro, color: subtle }} data-testid={`close-month-${i}-count`}>{afterStart(c.month)}</div>}
            </span>
            <span role="cell"><MonthPicker value={c.month} base={0} count={() => null} startDate={startDate} width="100%"
              onChange={(v) => set(i, { month: v == null ? null : Math.round(v) })} testId={`close-month-${i}`} ariaLabel={`${name(i)} date`} /></span>
            <span role="cell"><PctInput value={c.pct} width="100%" suffix={undefined} onChange={(v) => set(i, { pct: v })} testId={`close-pct-${i}`} ariaLabel={`${name(i)} percent of commitments`} /></span>
            <span role="cell" style={{ ...inkNum, textAlign: "right" }}>{committed > 0 && c.pct != null ? fmtMIn(committed * c.pct, currency) : "—"}</span>
            <span role="cell" style={{ textAlign: "right" }}>{closes.length > 1 && <Btn kind="link" onClick={() => onChange(closes.filter((_, j) => j !== i))} aria-label={`Remove ${name(i).toLowerCase()}`}>Remove</Btn>}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12 }}>
        <Btn onClick={() => onChange([...closes, { month: (closes.at(-1)?.month ?? 0) + 6, pct: 0 }])} data-testid="add-close">+ Add close</Btn>
      </div>
    </Field>
  );
}

// Three bands on one 3-column grid, so every box in a row shares its edges and baseline.
const CSS = `
.fc-gen { container-type: inline-size; display: grid; gap: 28px; }
.fc-gen-group { display: grid; gap: 14px; }
.fc-gen-head { font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-color-global-text-subtle);
  padding-bottom: 8px; border-bottom: 1px solid var(--ink-color-global-border-subtle); }
.fc-gen-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px 24px; align-items: start; }
.fc-gen-row > .wide { grid-column: span 2; }
.fc-gen .fc-ctl > div { display: block !important; }
.fc-gen .fc-ctl .dd-trigger { width: 100%; min-width: 0 !important; max-width: none !important; }
.fc-closes { font-size: 14px; }
.fc-closes-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr) minmax(0, 1fr) minmax(0, 0.8fr) 64px; gap: 16px;
  align-items: center; padding: 10px 0; border-bottom: 1px solid var(--ink-color-global-border-subtle); }
.fc-closes-head { padding: 0 0 8px; font-size: 12px; font-weight: 600; color: var(--ink-color-global-text-subtle); border-bottom-color: var(--ink-color-global-border-default); }
@container (max-width: 560px) {
  .fc-closes-head { display: none; }
  .fc-closes-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
}
@container (max-width: 720px) { .fc-gen-row { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@container (max-width: 460px) { .fc-gen-row { grid-template-columns: minmax(0, 1fr); } .fc-gen-row > .wide { grid-column: auto; } }
`;

const full = { width: "100%" };
const subtle = "var(--ink-color-global-text-subtle)";

/** Every General field takes the fixed-height label row, so inputs line up across a row. */
const Cell = ({ aside = null, ...props }) => <Field aside={aside} {...props} />;

function Group({ title, children, testId }) {
  return (
    <section className="fc-gen-group" data-testid={testId}>
      <div className="fc-gen-head">{title}</div>
      {children}
    </section>
  );
}

function CommitSplit({ g, d }) {
  if (!(g.committed > 0)) return null;
  const gpShare = Math.min(1, Math.max(0, d.gpCommitted / g.committed));
  return (
    <div data-testid="general-split" style={{ display: "grid", gap: 6 }}>
      <div aria-hidden="true" style={{ display: "flex", gap: 2, height: 8 }}>
        <span style={{ flex: 1 - gpShare, background: "var(--ink-color-global-data-viz-blue-3)", borderRadius: "4px 0 0 4px" }} />
        {gpShare > 0 && <span style={{ flex: gpShare, minWidth: 3, background: "var(--ink-color-global-data-viz-yellow-3)", borderRadius: "0 4px 4px 0" }} />}
      </div>
      <div style={{ ...sans, fontSize: FS.small, color: subtle, display: "flex", gap: 20, flexWrap: "wrap", ...inkNum }}>
        <span>LP commitments <strong style={{ color: "var(--ink-color-global-text-default)" }}>{fmtMIn(d.lpCommitted, g.currency)}</strong></span>
        <span>GP commitment <strong style={{ color: "var(--ink-color-global-text-default)" }}>{fmtMIn(d.gpCommitted, g.currency)}</strong></span>
      </div>
    </div>
  );
}

function Timeline({ g, d, closes }) {
  if (!/^\d{4}-\d{2}$/.test(g.startDate ?? "")) return null;
  const termM = Math.round(termYearsOf(g, 0) * 12);
  const ipM = Math.round((g.investmentPeriodYears || 0) * 12);
  if (!(termM > 0)) return null;
  const ipPct = Math.min(100, (ipM / termM) * 100);
  const end = d.endDate ?? addMonthsYm(g.startDate, termM);
  const mid = Math.min(78, Math.max(22, ipPct));
  const label = (text, date, pos, align) => (
    <div style={{ position: "absolute", left: `${pos}%`, transform: align === "center" ? "translateX(-50%)" : align === "end" ? "translateX(-100%)" : "none",
      textAlign: align === "center" ? "center" : align, whiteSpace: "nowrap" }}>
      <div style={{ ...sans, fontSize: FS.micro, color: subtle }}>{text}</div>
      <div style={{ ...sans, ...inkNum, fontSize: FS.small, fontWeight: 600 }}>{date}</div>
    </div>
  );
  return (
    <div data-testid="general-timeline" style={{ paddingTop: 6 }}>
      <div style={{ position: "relative", height: 10, display: "flex", gap: 2 }} aria-hidden="true">
        <span style={{ width: `${ipPct}%`, background: "var(--ink-color-global-data-viz-blue-3)", borderRadius: ipPct >= 100 ? 5 : "5px 0 0 5px" }} />
        {ipPct < 100 && <span style={{ flex: 1, background: "var(--ink-color-global-data-viz-neutral-3)", opacity: 0.45, borderRadius: "0 5px 5px 0" }} />}
        {(closes ?? []).filter((c) => c.month > 0 && c.month < termM).map((c, i) => (
          <span key={i} title={`Close ${i + 2}: ${fmtYm(addMonthsYm(g.startDate, c.month))}`}
            style={{ position: "absolute", left: `${(c.month / termM) * 100}%`, top: -4, width: 2, height: 18, background: "var(--ink-color-global-text-default)", borderRadius: 1 }} />
        ))}
      </div>
      <div style={{ position: "relative", height: 40, marginTop: 8 }}>
        {label("Start", fmtYm(g.startDate), 0, "left")}
        {ipPct < 100 && label("Investment period ends", fmtYm(d.investmentPeriodEnd), mid, "center")}
        {label(g.evergreen ? "Evergreen · modeled to" : "Fund ends", fmtYm(end), 100, "end")}
      </div>
      <div style={{ ...sans, fontSize: FS.micro, color: subtle, display: "flex", gap: 16, flexWrap: "wrap" }}>
        <span><span aria-hidden="true" style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, marginRight: 6, background: "var(--ink-color-global-data-viz-blue-3)" }} />New investments</span>
        <span><span aria-hidden="true" style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, marginRight: 6, background: "var(--ink-color-global-data-viz-neutral-3)", opacity: 0.45 }} />Follow-ons and exits</span>
        {(closes ?? []).some((c) => c.month > 0) && <span><span aria-hidden="true" style={{ display: "inline-block", width: 2, height: 10, marginRight: 6, verticalAlign: "-1px", background: "var(--ink-color-global-text-default)" }} />Later closes</span>}
      </div>
    </div>
  );
}

export default function GeneralStep({ plan, update }) {
  const g = plan.general;
  const errors = validateGeneral(effectiveGeneral(plan));
  const d = deriveGeneral(g);
  const sug = plan.suggestions || {};
  // Editing a field drops its "suggested from" note: the value is now the user's own.
  const set = (key, value) => update((p) => {
    p.general[key] = value;
    if (key === "fundName") p.name = value;
    if (key === "currency") p.sectors = p.sectors.map((s) => dropForeignBenchmark(s, value));
    if (p.suggestions) delete p.suggestions[key === "gpCommitAmount" ? "gpCommitPct" : key];
  });
  const hintFor = (key, fallback) => (sug[key] ? `Suggested from ${sourceLabel(sug[key])}` : fallback);
  const ccy = g.currency;
  const gpByAmount = g.gpCommitMode === "amount";
  // Switching entry mode carries the current value across, so the GP commitment doesn't jump.
  const setGpMode = (mode) => update((p) => {
    const pg = p.general;
    if (mode === "amount" && pg.gpCommitMode !== "amount") pg.gpCommitAmount = pg.committed > 0 ? Math.round((pg.gpCommitPct ?? 0) * pg.committed) : null;
    if (mode === "pct" && pg.gpCommitMode === "amount") pg.gpCommitPct = gpCommitPctOf(pg);
    pg.gpCommitMode = mode;
  });
  const gpOther = g.committed > 0
    ? (gpByAmount ? `${fmtPct(gpCommitPctOf(g), 2)} of total commitments` : `${fmtFullIn(d.gpCommitted, ccy)} of total commitments`)
    : "Enter total committed capital to see the other figure.";
  const gpHint = sug.gpCommitPct ? `${gpOther} · Suggested from ${sourceLabel(sug.gpCommitPct)}` : gpOther;
  const advanced = plan.mode !== "light";
  return (
    <div data-testid="general-step">
      <style>{CSS}</style>
      <StepHeader title="General">The fund's basic terms. Later steps use these to size fees, pace investments and time distributions.</StepHeader>

      <div className="fc-gen">
        <Group title="Fund" testId="general-fund">
          <div className="fc-gen-row">
            <div className="wide">
              <Cell label="Fund name" error={errors.fundName} testId="field-fundName">
                <TextInput value={g.fundName ?? ""} onChange={(e) => set("fundName", e.target.value)} data-testid="input-fundName" style={full} />
              </Cell>
            </div>
            <Cell label="Fund currency" error={errors.currency} hint={hintFor("currency", "Every amount in this plan uses it.")} testId="field-currency">
              <div className="fc-ctl">
                <Dropdown testId="input-currency" minWidth={0} value={ccy} nullLabel="Pick a currency"
                  options={CURRENCIES.map((c) => ({ id: c, label: c }))} onChange={(c) => set("currency", c)} />
              </div>
            </Cell>
          </div>
        </Group>

        <Group title="Size" testId="general-size">
          <div className="fc-gen-row">
            <Cell label={`Total committed capital${ccy ? ` (${ccy})` : ""}`} error={errors.committed} hint={hintFor("committed", "LP plus GP commitments.")} testId="field-committed">
              <AmountInput value={g.committed} onChange={(v) => set("committed", v)} testId="input-committed" invalid={!!errors.committed} width="100%" />
            </Cell>
            <Cell label="GP commitment" aside={<UnitToggle label="GP commitment as" value={gpByAmount ? "amount" : "pct"} onChange={setGpMode} options={[{ id: "pct", label: "%", testId: "gp-mode-pct" }, { id: "amount", label: "amount", testId: "gp-mode-amount" }]} />}
              error={errors.gpCommitPct} hint={gpHint} testId="field-gpCommitPct">
              {gpByAmount
                ? <AmountInput value={g.gpCommitAmount} onChange={(v) => set("gpCommitAmount", v)} testId="input-gpCommitAmount" invalid={!!errors.gpCommitPct} width="100%" />
                : <PctInput value={g.gpCommitPct} onChange={(v) => set("gpCommitPct", v)} testId="input-gpCommitPct" width="100%" suffix={undefined} />}
            </Cell>
            <Cell label="Capital calls" hint="How often capital is called from LPs." testId="field-callFrequency">
              <div className="fc-ctl">
                <Dropdown testId="input-callFrequency" minWidth={0} value={g.callFrequency} options={CALL_FREQUENCIES} onChange={(v) => set("callFrequency", v)} />
              </div>
            </Cell>
          </div>
          <CommitSplit g={g} d={d} />
        </Group>

        <Group title="Timeline" testId="general-timeline-group">
          <div className="fc-gen-row">
            <Cell label="Start date" error={errors.startDate} hint="The fund's first month." testId="field-startDate">
              <MonthField value={g.startDate ?? ""} onChange={(ym) => set("startDate", ym)} testId="input-startDate" ariaLabel="Start date" width="100%" />
            </Cell>
            <Cell label={g.evergreen ? "Fund term" : "Fund term (years)"} aside={<Toggle small checked={!!g.evergreen} labels={["Evergreen", "Evergreen"]} onChange={(v) => set("evergreen", v)} />}
              error={errors.termYears} hint={g.evergreen ? `Evergreen: modeled over ${EVERGREEN_YEARS} years.` : d.endDate ? `Ends ${fmtYm(d.endDate)}` : "Years from start to the end of the fund."} testId="field-termYears">
              {g.evergreen
                ? <div style={{ ...sans, fontSize: FS.body, color: subtle, height: 40, display: "flex", alignItems: "center" }}>No fixed end</div>
                : <NumInput value={g.termYears} width="100%" onChange={(v) => set("termYears", v)} testId="input-termYears" />}
            </Cell>
            <Cell label="Investment period (years)" error={errors.investmentPeriodYears} hint={d.investmentPeriodEnd ? `Ends ${fmtYm(d.investmentPeriodEnd)}` : "Years during which the fund makes new investments."} testId="field-investmentPeriodYears">
              <NumInput value={g.investmentPeriodYears} width="100%" onChange={(v) => set("investmentPeriodYears", v)} testId="input-investmentPeriodYears" />
            </Cell>
          </div>
          <Timeline g={g} d={d} closes={advanced ? g.closes : null} />
        </Group>

        {advanced && (
          <Group title="Commitment closes" testId="general-closes">
            <ClosesEditor closes={g.closes ?? []} onChange={(v) => set("closes", v)} currency={ccy} committed={g.committed} error={errors.closes} startDate={g.startDate} />
          </Group>
        )}
      </div>
    </div>
  );
}
