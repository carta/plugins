// Describe a filter, see what it would do, then apply it.
//
// THIS BOX DOES NOT EDIT THE APP
// Every other ask box on this console spawns a Claude subprocess that edits the
// source and reloads the page, which is right for "add a P60 column". Here it is
// wrong: "show only engineering" is a filter over the rows on screen, and as a
// code change it becomes durable, invisible in the UI, and undoable only by
// asking again. So this box asks Claude for a PREDICATE and applies it as a
// filter — the same kind of thing as the preset controls beside it.
//
// NOTHING IS APPLIED UNTIL THE USER SAYS SO
// The predicate is previewed against the current cohort, and only reaches the
// filter state on Apply. The count is the whole point: a filter that silently
// drops fourteen people from a grant cycle is a wrong plan, not a rendering bug,
// so the number is shown BEFORE the change rather than discovered after.
//
// A NO-OP SAYS SO
// When a filter would change nothing, that is stated outright. A phrase that
// looks applied and did nothing is how someone concludes the box is broken.
//
// REFUSALS ARE THE FEATURE, NOT THE FAILURE
// Claude has a closed vocabulary — there is no performance field, no manager, no
// promotion history — and is told to refuse rather than reach for the nearest
// available field. A wrong guess about who is in a grant cycle is worse than an
// honest "I could not express that", because the guess is invisible.

import { useEffect, useState } from "react";
import { C, FS, RADIUS } from "../../ui/theme.js";
import { Tag } from "../../ui/components.jsx";
import { applyPredicate, describe, validate } from "../../model/predicate.js";

const EXAMPLES = [
  "engineering above IC5",
  "tenure over 2 years",
  "no prior grants",
  "hired before 2023",
];

function Btn({ onClick, children, primary, disabled, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        height: 32, padding: "0 12px", fontSize: FS.md, fontWeight: primary ? 500 : 400,
        fontFamily: "inherit", borderRadius: RADIUS,
        cursor: disabled ? "not-allowed" : "pointer",
        color: disabled ? C.textQuiet : primary ? C.onPrimary : C.textDefault,
        background: disabled ? C.surfaceUnderlay : primary ? C.interactivePrimary : C.surfaceDefault,
        border: `1px solid ${disabled ? C.borderDefault : primary ? C.interactivePrimary : C.borderDefault}`,
      }}
    >
      {children}
    </button>
  );
}

/** The distinct values the cohort actually uses, for the request's vocabulary.
 *
 *  Read off the ROWS, never from taxonomy.json: that file is `source: "observed"`
 *  and was missing 2 of 22 job areas on a real corporation. A model told
 *  "Engineering" exists when the data says "Engineering & Product" writes a filter
 *  that matches nobody, and an empty cohort reads as a broken feature rather than
 *  as a bad guess.
 */
export function cohortVocabulary(rows) {
  const pick = (get) => {
    const seen = new Set();
    for (const r of rows || []) {
      const v = get(r);
      if (v != null && v !== "") seen.add(String(v));
    }
    return [...seen].sort();
  };
  return {
    job_area: pick((r) => r.job_area),
    job_track: pick((r) => r.job_track),
    job_level: pick((r) => r.job_level),
    location: pick((r) => r.location),
    job_focus: pick((r) => r.job_focus),
  };
}

export default function FilterBox({
  rows, asOf, filters, onApply, onRemove,
  // Injectable so tests can drive every branch without a subprocess. The default
  // is the real endpoint; a test passing its own has no network at all.
  askClaude = defaultAskClaude,
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);

  // A preview is a promise about a SPECIFIC cohort: "would remove 101, leaving
  // 33", counted against the rows as they were when Preview was clicked. Toggle a
  // preset in the parent — job area, level, vesting window — and those rows are no
  // longer what Apply would run against, so the card would state a number and then
  // do something else. Dropping it forces the question to be asked again against
  // the cohort it will actually apply to.
  //
  // Dropped rather than recounted, deliberately: silently updating the number
  // under someone mid-read is the same class of problem, just quieter.
  useEffect(() => { setPreview(null); }, [rows]);

  const submit = async (value) => {
    const phrase = (value ?? text).trim();
    if (!phrase || busy) return;
    setBusy(true);
    setPreview(null);
    try {
      const reply = await askClaude(phrase, cohortVocabulary(rows));
      setPreview(toPreview(reply, phrase, rows, asOf));
    } catch {
      // A failed request is a refusal, not a silent no-op: the box has to say
      // something went wrong, or the user assumes the filter applied. The card
      // below already says nothing was filtered, so this says only what broke.
      setPreview({ error: "Could not reach Claude." });
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!preview || preview.error) return;
    onApply({ text: preview.text, node: preview.node, sentence: preview.sentence });
    setText("");
    setPreview(null);
  };

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="Describe who to keep — e.g. engineering above IC5"
          aria-label="Describe a filter"
          disabled={busy}
          style={{
            flex: "1 1 260px", minWidth: 0, height: 32, padding: "0 10px",
            fontSize: FS.md, fontFamily: "inherit", color: C.textDefault,
            background: C.surfaceDefault, border: `1px solid ${C.borderDefault}`,
            borderRadius: RADIUS,
          }}
        />
        <Btn onClick={() => submit()} disabled={busy || !text.trim()}
             title={text.trim() ? "See what this filter would do" : "Describe a filter first"}>
          {busy ? "Reading…" : "Preview"}
        </Btn>
      </div>

      {!preview && !busy && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: FS.xs, color: C.textQuiet }}>Try:</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => { setText(ex); submit(ex); }}
              style={{
                background: "none", border: "none", padding: 0, font: "inherit",
                fontSize: FS.xs, color: C.linkDefault, cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {preview && preview.error && (
        <div style={{
          padding: "10px 12px", borderRadius: RADIUS,
          background: C.feedbackNoticeSubtle, border: `1px solid ${C.feedbackNotice}`,
          // Not feedbackNotice: that pairing is 3.09:1 on this ground, and a
          // refusal nobody can read defeats the whole point of refusing.
          fontSize: FS.sm, color: C.feedbackNoticeText, lineHeight: 1.55,
        }}>
          <div>{preview.error}</div>
          <div style={{ marginTop: 6, color: C.textSubtle }}>
            Nothing has been filtered. Try describing it another way, or use the
            controls above.
          </div>
        </div>
      )}

      {preview && !preview.error && (
        <div style={{
          padding: "10px 12px", borderRadius: RADIUS,
          background: C.surfaceUnderlay, border: `1px solid ${C.borderDefault}`,
          display: "grid", gap: 8,
        }}>
          <div style={{ fontSize: FS.md, color: C.textDefault }}>
            Keep where <strong>{preview.sentence}</strong>
          </div>
          <div style={{ fontSize: FS.sm, color: C.textSubtle }}>
            {preview.removed === 0
              // Said outright: a filter that looks applied and changed nothing is
              // how someone concludes the box does not work.
              ? `This changes nothing — all ${preview.kept} shown already match.`
              : `Would remove ${preview.removed}, leaving ${preview.kept}.`}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn onClick={apply} primary disabled={preview.removed === 0}
                 title={preview.removed === 0
                   ? "This filter would change nothing"
                   : "Add this filter"}>
              Apply
            </Btn>
            <Btn onClick={() => setPreview(null)}>Discard</Btn>
          </div>
        </div>
      )}

      {filters.length > 0 && (
        <div style={{ display: "grid", gap: 6 }}>
          {filters.map((f) => (
            <div
              key={f.id}
              style={{
                display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
                fontSize: FS.sm, color: C.textDefault,
              }}
            >
              <Tag tone="notice" title={`Asked as: ${f.text}`}>Claude filter</Tag>
              {/* The predicate as a sentence, so a committed filter can be audited
                  by whoever inherits the plan — not only by whoever asked for it. */}
              <span>{f.sentence}</span>
              <button
                type="button"
                onClick={() => onRemove(f.id)}
                title="Remove this filter"
                style={{
                  background: "none", border: "none", padding: 0, font: "inherit",
                  fontSize: FS.xs, color: C.linkDefault, cursor: "pointer",
                  textDecoration: "underline",
                }}
              >
                remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** A reply from the server turned into what the preview card renders.
 *
 *  `validate` runs here and not only on the server, because this is the gate the
 *  file header promises: a predicate that has not passed it never reaches
 *  `evaluate`. A server bug, a future endpoint change or a hand-crafted response
 *  all land in the same place, and all are refused rather than applied.
 */
export function toPreview(reply, phrase, rows, asOf) {
  if (!reply || typeof reply !== "object") {
    return { error: "Claude's reply could not be read." };
  }
  if (reply.refusal) return { error: reply.refusal };
  if (!reply.predicate) {
    return { error: "Claude did not return a filter." };
  }

  const check = validate(reply.predicate);
  if (!check.ok) return { error: check.error };

  const kept = applyPredicate(rows, reply.predicate, { asOf });
  return {
    text: phrase,
    node: reply.predicate,
    sentence: describe(reply.predicate),
    kept: kept.length,
    removed: rows.length - kept.length,
  };
}

/** Ask the local server for a predicate. */
async function defaultAskClaude(phrase, vocabulary) {
  const res = await fetch(`/api/filter${window.location.search}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phrase, vocabulary }),
  });
  return res.json();
}
