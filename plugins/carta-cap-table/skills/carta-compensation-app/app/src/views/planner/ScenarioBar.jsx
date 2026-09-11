// The scenario switcher — named drafts of a refresh plan.
//
// A refresh cycle is not decided in one sitting. Someone builds a cohort, sets a
// target, sees the pool draw, then wants to try it another way: a wider cohort at a
// lower multiple, engineering-only at a higher one. This is how they keep both.
//
// SWITCHING IS SAFE OR IT DOES NOT HAPPEN
// Every action flushes the pending save for the draft being left before it touches
// the document. A flush that fails aborts the action and leaves the user where they
// are, with their edits on screen — being moved away from unsaved work is worse
// than not switching at all.
//
// DELETING IS THE ONLY DESTRUCTIVE ACT HERE, so it is the only one that confirms.
// Everything else is reversible by switching back.
//
// A native <select> for the switch itself: ui/components.jsx explains why this
// codebase prefers one, and that reasoning holds. The actions cannot live inside it
// — an <option> holds text, not buttons — so they sit alongside as siblings.

import { useEffect, useRef, useState } from "react";
import { C, FS, RADIUS } from "../../ui/theme.js";
import { Select, Tag } from "../../ui/components.jsx";

const BTN = {
  height: 40,
  padding: "0 12px",
  fontSize: FS.md,
  fontWeight: 500,
  fontFamily: "inherit",
  borderRadius: RADIUS,
  cursor: "pointer",
};

function Btn({ onClick, children, title, primary, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={{
        ...BTN,
        cursor: disabled ? "not-allowed" : "pointer",
        color: disabled ? C.textQuiet : primary ? C.onPrimary : C.textDefault,
        background: disabled ? C.surfaceUnderlay
          : primary ? C.interactivePrimary : C.surfaceDefault,
        border: `1px solid ${disabled ? C.borderDefault
          : primary ? C.interactivePrimary : C.borderDefault}`,
      }}
    >
      {children}
    </button>
  );
}

/** When this draft was last written, as a wall-clock time.
 *
 *  Absolute rather than relative: "did it save before I switched?" is a question
 *  about a moment, and a relative label would need a ticking timer to stay true.
 */
function savedLabel(updatedAt) {
  if (!updatedAt) return "Not saved yet";
  const d = new Date(updatedAt);
  if (Number.isNaN(d.getTime())) return "Not saved yet";
  return `Saved ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

export default function ScenarioBar({
  scenarios, activeId, saving, conflict, futureDoc,
  onSwitch, onCreate, onDuplicate, onRename, onDelete, onReload,
  // Injectable so the delete path can be tested. happy-dom implements no
  // window.confirm at all, so calling it directly makes this branch both
  // untestable and a throw in any environment that omits it.
  confirmDelete = (message) => (
    typeof window !== "undefined" && window.confirm ? window.confirm(message) : true
  ),
}) {
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (renaming && inputRef.current) inputRef.current.select();
  }, [renaming]);

  // Nothing to switch between until the document has loaded.
  if (!scenarios || !scenarios.length) return null;

  const active = scenarios.find((s) => s.id === activeId) || scenarios[0];
  const only = scenarios.length === 1;

  const commitRename = () => {
    const next = draftName.trim();
    setRenaming(false);
    if (next && next !== active.name) onRename(active.id, next);
  };

  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`, borderRadius: RADIUS,
      padding: "10px 16px", display: "grid", gap: 10,
    }}>
      {/* Two rows: which plan this is, then what you can do to it.
          On one line the four actions took a third of the bar and sat at the same
          weight as the name, so the answer to "which draft am I in?" competed with
          controls nobody needs on most visits. */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {/* The name as a HEADING, not only as the selected value in a control.
            Reading a form field to learn which plan you are looking at is the wrong
            way round — with several drafts open, "which one is this?" is the
            question the bar exists to answer. The dropdown switches; this says
            where you are. */}
        {/* No "SCENARIO" eyebrow above the name. It labelled a title that already
            says what it is, and the two-line stack stood 48px tall against the
            switcher's 40 — so centring the stack left the name itself sitting 12px
            below the control beside it. One line, one baseline. */}
        {!renaming && (
          <span
            title={active.name}
            style={{
              fontSize: FS.lg, fontWeight: 600, color: C.textDefault,
              // Matches the switcher's height so both sit on the same centre line
              // rather than being centred as boxes of different sizes.
              height: 40, display: "inline-flex", alignItems: "center",
              // Truncates rather than wrapping: a long name would otherwise push
              // the pool bar and the table down on every step.
              maxWidth: 360, minWidth: 0, overflow: "hidden",
              textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}
          >
            {active.name}
          </span>
        )}

        {renaming ? (
          <input
            ref={inputRef}
            value={draftName}
            aria-label="Scenario name"
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              // Escape abandons the edit. A rename half-typed and then dismissed is
              // not an instruction, so it must not become one.
              if (e.key === "Escape") setRenaming(false);
            }}
            style={{
              height: 40, minWidth: 220, padding: "0 10px", fontSize: FS.md,
              fontFamily: "inherit", color: C.textDefault, background: C.surfaceDefault,
              border: `1px solid ${C.borderDefault}`, borderRadius: RADIUS,
            }}
          />
        ) : (
          <Select
            label=""
            value={active.id}
            onChange={onSwitch}
            options={scenarios.map((sc) => ({ value: sc.id, label: sc.name }))}
            minWidth={150}
          />
        )}

        {!only && (
          <span
            style={{ fontSize: FS.xs, color: C.textQuiet }}
            title={`${scenarios.length} saved drafts of this plan`}
          >
            {scenarios.indexOf(active) + 1} of {scenarios.length}
          </span>
        )}

        {/* Save state rides with the NAME, not with the buttons: it describes this
            draft, and reading "Saved 14:32" beside a Delete button invites parsing
            it as the outcome of an action. */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {futureDoc ? (
            <Tag tone="notice" title="Saving is disabled so this build cannot overwrite a file it does not understand.">
              Saved by a newer version — read only
            </Tag>
          ) : conflict ? (
            <>
              {/* Un-dismissable on purpose: saving has stopped, and a notice the
                  user can wave away is how an afternoon of edits goes nowhere. */}
              <Tag tone="notice" title="Another console saved this file first. Nothing is being saved until this is resolved.">
                Not saving — changed elsewhere
              </Tag>
              <Btn onClick={onReload} title="Discard what is on screen and load the other console's version">
                Reload theirs
              </Btn>
            </>
          ) : (
            <span
              style={{ fontSize: FS.xs, color: C.textQuiet }}
              title={active.updatedAt || "This draft has not been saved yet"}
            >
              {saving ? "Saving…" : savedLabel(active.updatedAt)}
            </span>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {/* Duplicate leads: "the same cohort at a lower multiple" is the reason
            this feature exists, and it should be the obvious next click. */}
        <Btn
          primary
          onClick={() => onDuplicate(active.id)}
          title="Copy this draft — cohort, grants and settings — as a starting point"
        >
          Duplicate
        </Btn>
        <Btn onClick={() => onCreate()} title="Start an empty draft">New</Btn>
        <Btn
          onClick={() => { setDraftName(active.name); setRenaming(true); }}
          title="Rename this draft"
        >
          Rename
        </Btn>
        <Btn
          disabled={only}
          onClick={() => {
            // The one destructive action here, and a draft can be an afternoon of
            // work, so it asks. Naming it in the prompt is the point — "are you
            // sure?" alone does not tell you what you are about to lose.
            if (confirmDelete(`Delete the scenario "${active.name}"? This cannot be undone.`)) {
              onDelete(active.id);
            }
          }}
          title={only
            ? "The last scenario cannot be deleted — there would be no plan to show"
            : `Delete "${active.name}"`}
        >
          Delete
        </Btn>
      </div>
    </div>
  );
}
