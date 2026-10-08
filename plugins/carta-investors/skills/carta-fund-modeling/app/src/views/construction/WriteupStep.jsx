import { useMemo, useState } from "react";
import { FS, sans, inkNum } from "../../ui/theme.js";
import { Btn, Checkbox, InfoTip, TextArea } from "../../ui/components.jsx";
import ConfirmDialog from "../../ui/ConfirmDialog.jsx";
import { WRITEUP_SECTIONS, sectionState, writeupDocument, writeupDraft, writeupFacts, writeupText, isIncluded } from "../../model/construction/writeup.js";
import { buildFaq } from "../../model/construction/faq.js";
import { breakevenExits, runScenarios, tornado } from "../../model/construction/analysis.js";
import { trackClick } from "../../analytics.js";
import { Sections } from "./StepSections.jsx";
import { StepHeader } from "./fields.jsx";

const subtle = "var(--ink-color-global-text-subtle)";
const words = (t) => (t.trim() ? t.trim().split(/\s+/).length : 0);

/** What the drafts read from: the LP due diligence answers (with their costly extras) and the firm's funds. */
export function useWriteupContext(plan, res, snapshot, companies) {
  const light = plan.mode === "light";
  const extras = useMemo(() => (light || !res?.ok ? {} : { scenarios: runScenarios(plan, res), sensitivity: tornado(plan, "tvpi"), breakeven: breakevenExits(plan) }), [light, plan, res]);
  const faq = useMemo(() => (res?.ok ? buildFaq(plan, res, extras) : []), [plan, res, extras]);
  return useMemo(() => ({ snapshot, companies, extras, faq }), [snapshot, companies, extras, faq]);
}

export async function copyWriteup(plan, doc) {
  trackClick("FundModeling.FundConstruction.Writeup.Copy");
  try { await navigator.clipboard.writeText(writeupText(plan, doc.filter((d) => d.included))); return true; } catch { return false; }
}

/** Excluding a section keeps its text. */
function IncludeBox({ plan, update, sid }) {
  const on = isIncluded(plan, sid);
  return (
    <span data-testid={`writeup-${sid}-include`}>
      <Checkbox checked={on} label="Add to write-up" title="Show this section in the model view, the copied write-up and the summary report"
        onChange={(v) => {
          trackClick(`FundModeling.FundConstruction.Writeup.${v ? "Include" : "Exclude"}`);
          update((p) => {
            p.writeup = p.writeup ?? { sections: {} };
            const cur = p.writeup.sections[sid] ?? {};
            if (v) p.writeup.sections[sid] = { ...cur, included: true };
            else { const { included, ...rest } = cur; if (Object.keys(rest).length) p.writeup.sections[sid] = rest; else delete p.writeup.sections[sid]; }
          });
        }} />
    </span>
  );
}

const TILE = { ...sans, fontSize: FS.micro, color: subtle, marginBottom: 2 };
const RULE = "1px solid var(--ink-color-global-border-subtle)";

export function Facts({ id, facts, heading = true }) {
  if (!facts.length) {
    return id === "team"
      ? <div style={{ ...sans, fontSize: FS.small, color: subtle, margin: "0 0 12px" }}>No earlier funds in Carta yet. Describe the team's investing experience instead.</div>
      : null;
  }
  const funds = facts.filter((f) => f.fund), cos = facts.filter((f) => f.company);
  const tiles = facts.filter((f) => !f.fund && !f.company && !f.wide), wide = facts.filter((f) => f.wide);
  return (
    <div data-testid={`writeup-${id}-facts`} style={{ borderTop: RULE, borderBottom: RULE, padding: "10px 0", margin: "0 0 12px" }}>
      {heading && <div style={{ ...sans, fontSize: FS.micro, fontWeight: 600, letterSpacing: "0.04em", color: subtle, marginBottom: 8 }}>{funds.length || cos.length ? "TRACK RECORD IN CARTA" : "FROM THE MODEL"}</div>}
      {tiles.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(132px, 1fr))", gap: "10px 20px" }}>
          {tiles.map((f) => (
            <div key={f.label} style={{ minWidth: 0 }}>
              <div style={TILE}>{f.label}</div>
              <div style={{ ...inkNum, fontSize: FS.body, fontWeight: 600 }}>{f.value}</div>
            </div>
          ))}
        </div>
      )}
      {wide.map((f) => (
        <div key={f.label} style={{ display: "flex", gap: "4px 14px", flexWrap: "wrap", alignItems: "baseline", marginTop: tiles.length ? 10 : 0 }}>
          <span style={{ ...TILE, marginBottom: 0 }}>{f.label}</span>
          {f.parts.map((p) => <span key={p} style={{ ...inkNum, fontSize: FS.small, fontWeight: 600, whiteSpace: "nowrap" }}>{p}</span>)}
        </div>
      ))}
      {funds.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table className="ledger" style={{ minWidth: 520 }}>
            <thead><tr><th style={{ textAlign: "left" }}>Fund</th><th>Vintage</th><th>Size</th><th>Net TVPI</th><th>DPI</th><th>Net IRR</th></tr></thead>
            <tbody>{funds.map(({ fund: f }) => (
              <tr key={`${f.name}-${f.vintage}`}><td>{f.name}</td><td style={{ textAlign: "right" }}>{f.vintage ?? "—"}</td>
                {[f.size, f.tvpi, f.dpi, f.netIrr].map((v, i) => <td key={i} style={{ ...inkNum, textAlign: "right" }}>{v}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {cos.length > 0 && (
        <div style={{ overflowX: "auto", marginTop: funds.length ? 12 : 0 }} data-testid={`writeup-${id}-companies`}>
          <div style={{ ...TILE, marginBottom: 4 }}>Top portfolio companies, by multiple on invested capital (realized plus current value)</div>
          <table className="ledger" style={{ minWidth: 560 }}>
            <thead><tr><th style={{ textAlign: "left" }}>Company</th><th style={{ textAlign: "left" }}>Fund</th><th>Invested</th><th>Value</th><th>Multiple</th><th>IRR</th></tr></thead>
            <tbody>{cos.map(({ company: c }) => (
              <tr key={c.name}><td>{c.name}</td><td>{c.funds}</td>
                {[c.invested, c.value, c.multiple, c.irr].map((v, i) => <td key={i} style={{ ...inkNum, textAlign: "right" }}>{v}</td>)}</tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function WriteupSection({ sid, plan, update, result, ctx }) {
  const s = WRITEUP_SECTIONS.find((x) => x.id === sid);
  const draft = useMemo(() => writeupDraft(sid, plan, result, ctx), [sid, plan, result, ctx]);
  const facts = useMemo(() => writeupFacts(sid, plan, result, ctx), [sid, plan, result, ctx]);
  const st = sectionState(plan, sid, draft);
  const [confirm, setConfirm] = useState(false);
  const write = (text) => update((p) => {
    p.writeup = p.writeup ?? { sections: {} };
    const cur = p.writeup.sections[sid];
    p.writeup.sections[sid] = { ...cur, text, draftBase: cur?.text != null ? cur.draftBase ?? null : draft };
  });
  const useDraft = () => {
    trackClick("FundModeling.FundConstruction.Writeup.Redraft");
    update((p) => {
      const cur = p.writeup?.sections?.[sid];
      if (!cur) return;
      if (cur.included) p.writeup.sections[sid] = { included: true };
      else delete p.writeup.sections[sid];
    });
    setConfirm(false);
  };
  const outline = () => write(s.questions.map((q) => `${q}\n`).join("\n"));
  return (
    <div data-testid={`writeup-${sid}`}>
      <div style={{ ...sans, fontSize: FS.body, display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <span style={{ fontWeight: 600 }}>What to cover</span>
        <InfoTip label={`Why LPs ask about ${s.title.toLowerCase()}`} portal width={300}>{s.why}</InfoTip>
      </div>
      <ul style={{ ...sans, fontSize: FS.body, margin: "0 0 12px", paddingLeft: 18, display: "grid", gap: 2, maxWidth: "75ch" }}>
        {s.questions.map((q) => <li key={q}>{q}</li>)}
      </ul>
      <Facts id={sid} facts={facts} />
      <TextArea id={`writeup-text-${sid}`} aria-label={s.title} data-testid={`writeup-${sid}-text`} value={st.text}
        onChange={(e) => write(e.target.value)} placeholder={`For example: ${s.example}`} minRows={s.autofill === "draft" ? 5 : 4} />
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 6, ...sans, fontSize: FS.small, color: subtle }}>
        <span data-testid={`writeup-${sid}-status`}>
          {st.source === "draft" ? "Draft from the model. It updates with the plan until you edit it." : st.source === "written" ? "Your text." : "Not written yet."}
        </span>
        <span>{words(st.text)} words</span>
        <span style={{ flex: 1 }} />
        {st.source === "empty" && <Btn kind="link" onClick={outline} data-testid={`writeup-${sid}-outline`}>Start from the questions</Btn>}
        {draft && st.source === "written" && <Btn kind="link" onClick={() => setConfirm(true)} data-testid={`writeup-${sid}-redraft`}>Re-draft from model</Btn>}
      </div>
      {st.stale && (
        <div role="status" data-testid={`writeup-${sid}-stale`} style={{ ...sans, fontSize: FS.small, marginTop: 6, color: "var(--ink-color-global-feedback-warning-strong, inherit)" }}>
          The model has changed since you edited this, so its figures may be out of date.{" "}
          <Btn kind="link" onClick={() => setConfirm(true)}>Re-draft from model</Btn>
        </div>
      )}
      {confirm && <ConfirmDialog title="Replace your text with the model's draft?" message="Your text in this section is replaced by a fresh draft from the model, which then updates with the plan."
        confirmLabel="Use the draft" onConfirm={useDraft} onCancel={() => setConfirm(false)} />}
    </div>
  );
}

// One stable component per section, so typing never remounts the text box.
const VIEWS = Object.fromEntries(WRITEUP_SECTIONS.map((s) => [s.id, (props) => <WriteupSection sid={s.id} {...props} />]));

const summaryOf = (d) => (d.source === "written" ? (d.text.length > 110 ? `${d.text.slice(0, 110)}…` : d.text) : d.source === "draft" ? "Draft from the model" : "Not written yet");

export default function WriteupStep(props) {
  const { plan, result, snapshot, companies } = props;
  const ctx = useWriteupContext(plan, result, snapshot, companies);
  const doc = useMemo(() => writeupDocument(plan, result, ctx), [plan, result, ctx]);
  const [copied, setCopied] = useState(false);
  const written = doc.filter((d) => d.source === "written").length;
  const added = doc.filter((d) => d.included).length;
  const sections = WRITEUP_SECTIONS.map((s, i) => ({
    id: s.id, label: s.title, view: VIEWS[s.id], optional: !!s.optional, ok: doc[i].included, summary: summaryOf(doc[i]),
    aside: <IncludeBox plan={plan} update={props.update} sid={s.id} />,
  }));
  return (
    <div data-testid="writeup-step">
      <StepHeader title="Fund write-up (optional)">
        The story LPs read beside the numbers, in the order of the standard LP due diligence questionnaire (ILPA DDQ 2.0). Sections the model can answer start as a draft from your plan and stay up to date until you edit them. Tick "Add to write-up" on each section you want in the model's LP due diligence tab, the copied write-up and the summary report. Nothing is added until you tick it.
      </StepHeader>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", margin: "0 0 12px", ...sans, fontSize: FS.body }}>
        <span data-testid="writeup-progress"><b>{added}</b> of {WRITEUP_SECTIONS.length} sections added to the write-up</span>
        <span style={{ color: subtle }}>· {written} written · {doc.filter((d) => d.source === "draft").length} drafted from the model</span>
        <span style={{ flex: 1 }} />
        <Btn onClick={async () => { setCopied(await copyWriteup(plan, doc)); setTimeout(() => setCopied(false), 2000); }} disabled={!added} data-testid="writeup-copy">{copied ? "Copied" : "Copy write-up"}</Btn>
      </div>
      <Sections testId="writeup-sections" sections={sections} {...props} ctx={ctx} jumpBar={false} />
    </div>
  );
}
WriteupStep.flat = true;

/** `faq` reuses the answers the model view already built. */
export function WriteupDoc({ plan, res, snapshot, companies, faq, onEdit }) {
  const ctx = useMemo(() => ({ snapshot, companies, faq }), [snapshot, companies, faq]);
  const doc = useMemo(() => writeupDocument(plan, res, ctx), [plan, res, ctx]);
  const [copied, setCopied] = useState(false);
  const shown = doc.filter((d) => d.included);
  return (
    <div data-testid="writeup-doc">
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ ...sans, fontSize: FS.body, color: subtle, flex: "1 1 320px", maxWidth: "75ch" }}>
          The fund's write-up, in the order of the standard LP due diligence questionnaire (ILPA DDQ 2.0). Sections marked as drafts come from the model and update with the plan.
        </div>
        {onEdit && <Btn onClick={() => onEdit("writeup")} data-testid="writeup-edit">Edit write-up</Btn>}
        <Btn onClick={async () => { setCopied(await copyWriteup(plan, doc)); setTimeout(() => setCopied(false), 2000); }} disabled={!shown.length} data-testid="writeup-doc-copy">{copied ? "Copied" : "Copy write-up"}</Btn>
      </div>
      {shown.length === 0 ? (
        <div data-testid="writeup-doc-empty" className="card" style={{ ...sans, fontSize: FS.body, color: subtle, padding: "16px 20px", maxWidth: 880 }}>
          No sections added yet. In the Fund write-up step, tick "Add to write-up" on each section you want to show here.
        </div>
      ) : <article className="card" style={{ padding: "8px 24px 20px", maxWidth: 880 }}>
        {shown.map((d) => (
          <section key={d.id} data-testid={`writeup-doc-${d.id}`} style={{ padding: "14px 0", borderBottom: "1px solid var(--ink-color-global-border-subtle)" }}>
            <h3 style={{ ...sans, fontSize: FS.bodyLg, fontWeight: 600, margin: "0 0 6px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {d.title}
              {d.source === "draft" && <span style={{ fontSize: FS.micro, fontWeight: 600, color: subtle, border: "1px solid var(--ink-color-global-border-subtle)", borderRadius: 10, padding: "0 8px" }}>Draft from the model</span>}
            </h3>
            {d.text
              ? <div style={{ ...sans, fontSize: FS.body, lineHeight: 1.6, whiteSpace: "pre-wrap", maxWidth: "75ch" }}>{d.text}</div>
              : <div style={{ ...sans, fontSize: FS.small, color: subtle }}>Not written yet.{onEdit && <> <Btn kind="link" onClick={() => onEdit("writeup", d.id)} data-testid={`writeup-doc-${d.id}-write`}>Write it</Btn></>}</div>}
            {d.facts.length > 0 && <div style={{ marginTop: 10 }}><Facts id={d.id} facts={d.facts} heading={false} /></div>}
          </section>
        ))}
      </article>}
    </div>
  );
}
