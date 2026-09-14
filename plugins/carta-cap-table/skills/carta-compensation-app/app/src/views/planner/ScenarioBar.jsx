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
import { C, FS, HEADING, RADIUS } from "../../ui/theme.js";
import { Menu, Select, Tag } from "../../ui/components.jsx";

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
      // Ink's vertical spacing scale (small / xsmall): 12px of breathing room
      // around the bar's contents, and 8px between the title and the controls
      // under it — Section's own header-to-body relationship, which is what this
      // is. Was 10px/10px, off the scale in both places.
      padding: "12px 16px", display: "grid", gap: 8,
    }}>
      {/* The name on its own line, above the controls.
          As a HEADING, not only as the selected value in a control: reading a form
          field to learn which plan you are looking at is the wrong way round, and
          with several drafts open "which one is this?" is the question the bar
          exists to answer. The dropdown switches; this says where you are.

          On its own line it also needs no truncation at 360px and no height
          matching — it is not sharing a baseline with anything, so a long name
          reads in full. */}
      {!renaming && (
        // An h2, not a span. Ink's Heading renders a real text element and takes an
        // `as`, and product code reaches for heading-3 exactly here — the title of a
        // named thing beside its controls (car/reporting's report folders do the
        // same). A span left the one line that says which plan you are looking at
        // with no heading semantics at all.
        //
        // h2 rather than h1 because the page's own <h1> is the corporation name.
        <h2
          title={active.name}
          style={{
            // Ink's heading-2: 20px/36px at weight 500, base sans.
            //
            // heading-3 is the ordinary card title, but Ink keeps heading-2 for a
            // card that heads a whole screen rather than sitting among others —
            // RFIBlock overrides Section's default for exactly that, and
            // StandardTopBar and BillingSummary do the same. This bar names the
            // plan every one of the three steps below it is about, which is that
            // case.
            //
            // NOT the serif: only heading-1 carries SangBleu, and in product code
            // heading-1 is a page, app-shell or modal title — nothing labels a card
            // with it. It would also compete with the "Meetly" h1 above.
            ...HEADING.h2, color: C.textDefault,
            // Ink's `trim`, which its own card titles pass: the variant carries a
            // 16px bottom margin meant for prose, and the grid gap already spaces
            // this from the controls under it.
            margin: 0,
            minWidth: 0, overflow: "hidden",
            textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}
        >
          {active.name}
        </h2>
      )}

      {/* Controls: switcher and position on the left, save state and actions on
          the right. */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
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

          {/* Duplicate leads, and is the ONLY action kept at full size: "the same
              cohort at a lower multiple" is the reason this feature exists, and it
              should be the obvious next click.

              The other three are occasional — New and Rename are rare, and Delete
              is the one destructive act on the screen. On one row all four stood at
              equal weight, which put Delete permanently beside the control people
              reach for most; splitting them onto a second row relieved the
              crowding without changing that, and cost 50px of height on all three
              steps. Behind the menu, the bar is one row again and the destructive
              action takes a deliberate step to reach. */}
          <Btn
            primary
            onClick={() => onDuplicate(active.id)}
            title="Copy this draft — cohort, grants and settings — as a starting point"
          >
            Duplicate
          </Btn>
          <Menu
            label="More scenario actions"
            align="right"
            items={[
              {
                label: "New scenario",
                title: "Start an empty draft",
                onSelect: () => onCreate(),
              },
              {
                label: "Rename…",
                title: "Rename this draft",
                onSelect: () => { setDraftName(active.name); setRenaming(true); },
              },
              {
                label: "Delete scenario",
                // Ruled off because it is a different KIND of action from the two
                // above, not because it is tinted — Ink's menus carry no
                // destructive colour, and the confirm dialog is what guards it.
                separated: true,
                // Kept VISIBLE but disabled on the last one. Hiding it would leave
                // "why can't I delete this?" unanswered; the reason rides on the
                // control instead.
                disabled: only,
                title: only
                  ? "The last scenario cannot be deleted — there would be no plan to show"
                  : `Delete "${active.name}"`,
                onSelect: () => {
                  // A draft can be an afternoon of work, so it asks. Naming it in
                  // the prompt is the point — "are you sure?" alone does not tell
                  // you what you are about to lose.
                  if (confirmDelete(
                    `Delete the scenario "${active.name}"? This cannot be undone.`,
                  )) {
                    onDelete(active.id);
                  }
                },
              },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
