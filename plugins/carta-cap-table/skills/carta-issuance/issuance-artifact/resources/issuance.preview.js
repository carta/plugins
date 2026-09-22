/* ---------- the preview harness ----------  long-comment-ok: what this file is, and
   the two facts about it that the code cannot state.

   A `--preview` build appends this file (and issuance.preview.css) to the page a
   product owner clicks through: one page for all three security types, each type's
   form, each type's review, and the validation-error state. A production build
   carries none of it, and nothing in the four production resources knows it exists.

   1. It rebinds `one` and `store`. Both are plain function declarations in the same
      concatenated script, so a later assignment rebinds the name every caller in
      issuance.form.js resolves at call time. That is the whole enforcement: a write
      is refused inside the page, before the wire, not by hiding a button.
   2. Reads stay real. The allowlist is `cap_table__get__*`, so the form shows this
      corporation's own plans, share classes, legends and valuations. */

const PREVIEW_TYPES = [["option_grant", "Option grant"], ["certificate", "Certificate"],
  ["piu", "PIU"]];
const PREVIEW_STAGES = [["form", "Form"], ["review", "Review"], ["errors", "Validation errors"]];
/** The whole allowlist. Deny by default: a command this page has never needed is
    refused and named, rather than assumed harmless. */
const PREVIEW_READ = "cap_table__get__";
const PREVIEW = { stage: "form", refusals: 0, busy: false };

/* ---------- transport guard ---------- */
const previewSend = one;
const previewRealStore = store;

/** Refuse, say so everywhere someone might be looking, and hand back the error the
    caller will reject with. */
function previewRefuse(what, why) {
  PREVIEW.refusals += 1;
  const line = `REFUSED ${what} — ${why}. Nothing was sent to Carta.`;
  console.error("[issuance preview] " + line);
  previewNote(line, true);
  previewCount();
  // submit()'s own catch writes a generic banner; a task lands after it, so the
  // page's status line says who refused rather than "could not reach Carta".
  setTimeout(() => { S.banner = "Preview — " + line; S.bannerBad = true; render(); }, 0);
  const err = new Error(line);
  err.code = "preview_write_refused";
  err.previewRefused = true;
  return err;
}

one = function previewOne(name, args) {
  if (typeof name !== "string" || name.indexOf(PREVIEW_READ) !== 0) {
    return Promise.reject(previewRefuse(String(name),
      `a preview only reads, and ${PREVIEW_READ}* is the whole allowlist`));
  }
  return previewSend(name, args);
};

store = async function previewStore() {
  const real = await previewRealStore();
  const refuse = (op) => {
    throw previewRefuse("artifact store " + op, "a preview leaves no hand-off behind");
  };
  return {
    doc: (path) => {
      const d = real && real.doc ? real.doc(path) : null;
      return {
        get: () => (d ? d.get() : null),
        set: () => refuse("set " + path),
        update: () => refuse("update " + path),
        delete: () => refuse("delete " + path),
      };
    },
  };
};

/* ---------- example values ----------
   Recipients and quantities are invented and say so. Every term around them — the
   plan, the share classes, the legends, the valuation — is the corporation's own,
   read live, because a preview of the form has to show the real form. */
const PREVIEW_PEOPLE = [
  { name: "Sample Recipient One (example)", email: "sample-one@example.invalid", quantity: "1000" },
  { name: "Sample Recipient Two (example)", email: "sample-two@example.invalid", quantity: "2500" },
];
/** A stand-in price for a form Carta could not price itself. */
const PREVIEW_PRICE = "1.00";

/** The first real option on a required select, the issue date on a required date, an
    obviously round number on a required price. */
function previewValue(d) {
  if (d.kind === "sel") {
    const o = (d.opts || []).find((x) => String(x[0]) !== "");
    return o ? String(o[0]) : "";
  }
  if (d.kind === "date") return S.shared.issue_date || today();
  if (d.kind === "num") return PREVIEW_PRICE;
  return "";
}

/** Answer every required blank, then look again: a filled select can reveal a field
    that did not exist a moment ago — a jurisdiction brings its grant types, a share
    class its dividend date. */
function previewFillShared() {
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const d of spec()) {
      if (!d.req || "val" in d) continue;
      const v = S.shared[d.k];
      if (v !== "" && v != null) continue;
      const next = previewValue(d);
      if (next === "") continue;
      S.shared[d.k] = next;
      changed = true;
      if (d.k === "so_type" || d.k === "jurisdiction") applySoFill();
      if (d.k === "option_plan_id") S.shared.grant_expiration_date = grantExpiry();
    }
    if (!changed) break;
  }
}

/** A filled-in form, example people and all. */
function previewFill() {
  S.rows = PREVIEW_PEOPLE.map((p) => mkRow({
    name: p.name, email: p.email, quantity: p.quantity, isNew: true, relationship: "Employee",
  }));
  S.drafts = {};
  S.errs = {}; S.srv = {};
  // A real schedule where the corporation has one: the review's job is to show what a
  // holder is actually being offered, and "No vesting" shows the least of it.
  if (S.vesting.length && S.shared.vesting_template === NONE) {
    S.shared.vesting_template = String(S.vesting[0].id);
  }
  previewFillShared();
  applyDerived();
  previewFillShared();
}

/* ---------- stages ---------- */
function previewFormStage() {
  S.srv = {}; S.errs = {}; S.banner = ""; S.bannerBad = false;
  const back = el("back-to-edit");
  if (S.stage === "review" && back && !back.hidden && !back.disabled) back.click();
  else { S.stage = "edit"; render(); }
  previewNote("", false);
}

/** The page's own Review and issue button, so what renders is the page's own
    reviewHtml() after the page's own validation. */
function previewReviewStage() {
  previewFill();
  render();
  const go = el("confirm-issue");
  if (go && !go.hidden && !go.disabled) go.click();
  else { S.stage = "review"; S.banner = ""; render(); }
  previewNote(S.stage === "review"
    ? "Example values, carried into the review by the page's own Review and issue button."
    : "The form's own checks stopped this at the fields marked below. That is the real validation.",
  S.stage !== "review");
}

/** Both error shapes Carta sends back: per-draft field errors, which absorb() maps to
    the row that owns them, and the batch-level notes, which belong to no row. */
function previewErrorPayload() {
  const errors = {};
  const pks = S.rows.map((r, i) => {
    const pk = 900001 + i;
    S.drafts[r.key] = pk;
    return String(pk);
  });
  errors[pks[0]] = {
    quantity: ["Quantity exceeds the shares remaining in this plan."],
    issue_date: ["Issue date cannot be earlier than the board approval date."],
  };
  if (pks[1]) {
    errors[pks[1]] = { email: ["A stakeholder with this email is already on the cap table."] };
  }
  errors.issuance = ["This draft set has more securities than the plan can cover."];
  errors.corporation = { option_plan: ["This plan expired before the issue date on this set."] };
  return { validation: { errors } };
}

function previewErrorStage() {
  previewFill();
  S.stage = "edit";
  absorb(previewErrorPayload());
  render();
  previewNote("Row errors land on the fields that own them; the rest are batch-level notes at the top.",
    false);
}

/* ---------- type switching ---------- */
/** Everything the terms load owns, so one type can never answer with another's data. */
const PREVIEW_REFS = ["plans", "classes", "vesting", "accel", "docSets", "legends", "vals"];

async function previewSwitchType(type) {
  if (PREVIEW.busy || type === S.type) return;
  PREVIEW.busy = true;
  PREVIEW.stage = "form";
  for (const k of PREVIEW_REFS) S[k] = [];
  S.intl = { active: [], history: [] }; S.intlOk = false; S.manifest = {};
  S.isLLC = null; S.thresholdNoun = "Threshold";
  S.loadFailed = []; S.loadErr = ""; S.srv = {}; S.errs = {};
  S.banner = ""; S.bannerBad = false; S.stage = "edit"; S.busy = false;
  S.draftSetId = null; S.drafts = {};
  S.termsLoading = true;
  // The page's own first paint for the new type: seedShared() and seedRows() run
  // inside it, so no field of the previous type survives.
  ingest({ corporationId: CORP_ID, corporationName: COMPANY_NAME, securityType: type,
    draftSetId: null, prefill: {} });
  previewRenderBar();
  previewNote(`Loading ${type.replace(/_/g, " ")} reference data from Carta…`, false);
  // The roster is the corporation's, not the type's, and it is already loaded.
  try { await loadTerms(); }
  finally {
    PREVIEW.busy = false;
    previewNote("", false);
    previewRenderBar();
  }
}

/* ---------- the bar ---------- */
function previewNote(text, bad) {
  const n = el("preview-note");
  if (!n) return;
  n.textContent = text;
  n.className = "pv-note" + (bad ? " bad" : "");
  n.hidden = !text;
}

function previewCount() {
  const n = el("preview-refusals");
  if (!n) return;
  n.textContent = PREVIEW.refusals
    ? `${PREVIEW.refusals} write${PREVIEW.refusals > 1 ? "s" : ""} refused`
    : "no write attempted yet";
}

const previewSeg = (name, items, active) => items.map(([v, label]) =>
  `<button type="button" class="pv-b" id="preview-${name}-${v}" data-testid="preview-${name}-${v}"
    data-pv-${name}="${v}" aria-pressed="${String(v === active)}">${esc(label)}</button>`).join("");

function previewRenderBar() {
  const types = el("preview-types"), stages = el("preview-stages");
  if (!types || !stages) return;
  types.innerHTML = previewSeg("type", PREVIEW_TYPES, S.type);
  stages.innerHTML = previewSeg("stage", PREVIEW_STAGES, PREVIEW.stage);
  previewCount();
}

function previewClick(ev) {
  const t = ev.target.closest
    ? ev.target.closest("[data-pv-type],[data-pv-stage],[data-testid='preview-try-save']")
    : null;
  if (!t) return;
  if (t.getAttribute("data-testid") === "preview-try-save") {
    previewNote("Asking the page to save, so you can watch the transport refuse it…", false);
    submit("draft");
    return;
  }
  const type = t.getAttribute("data-pv-type");
  if (type) { previewSwitchType(type); return; }
  PREVIEW.stage = t.getAttribute("data-pv-stage");
  if (PREVIEW.stage === "form") previewFormStage();
  else if (PREVIEW.stage === "review") previewReviewStage();
  else previewErrorStage();
  previewRenderBar();
}

function previewMount() {
  const host = document.querySelector(".container");
  if (!host || !host.parentNode) return;
  const bar = document.createElement("div");
  bar.className = "pv";
  bar.setAttribute("data-testid", "preview-toolbar");
  bar.innerHTML = `<div class="pv-row">
      <span class="pv-tag">Preview</span>
      <span class="pv-lab">Type</span>
      <span class="pv-seg" data-testid="preview-types"></span>
      <span class="pv-lab">Stage</span>
      <span class="pv-seg" data-testid="preview-stages"></span>
      <button type="button" class="pv-b pv-try" id="preview-try-save"
        data-testid="preview-try-save">Try to save</button>
      <span class="pv-count" data-testid="preview-refusals"></span>
    </div>
    <p class="pv-say" data-testid="preview-banner">This is a preview of the issuance form,
      not the form itself. Every recipient, quantity and price shown is an example. Nothing
      here is written to Carta: the page refuses its own writes before they reach the
      wire.</p>
    <p class="pv-note" data-testid="preview-note" hidden></p>`;
  host.parentNode.insertBefore(bar, host);
  bar.addEventListener("click", previewClick);
  previewRenderBar();
}

previewMount();
