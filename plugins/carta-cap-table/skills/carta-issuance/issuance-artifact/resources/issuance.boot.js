/* ---------- bring-up ---------- */
// Baked at build time. SEED is what the prompt supplied — stakeholders, quantity,
// issue_date, rows — never a server payload. Identity comes from the build, because
// the page's title and build id are per company and per security type.
const CORP_ID = {{CORPORATION_ID}};
const COMPANY_NAME = {{COMPANY_NAME_JSON}};
const SECURITY_TYPE = "{{SECURITY_TYPE}}";
const SEED = {{SEED_JSON}};

const seedQty = () => (SEED.quantity == null || SEED.quantity === "" ? "" : String(SEED.quantity));
const seedNames = () => (Array.isArray(SEED.stakeholders) ? SEED.stakeholders : []);
/** A resume. Its rows came from load_drafts already resolved, and each carries the
    draft_pk that makes a save update rather than insert. */
const RESUMING = SEED.draft_set_id != null && SEED.draft_set_id !== "";

/** The prompt's knowns in the shape ingest() already reads, so the form is filled on
    first paint with no round trip. A quantity with nobody named is one recipient
    getting it, never one row per unit. */
function promptPrefill() {
  const qty = seedQty();
  let rows = Array.isArray(SEED.rows) && SEED.rows.length
    ? SEED.rows
    : seedNames().map((name) => ({ name: String(name), quantity: qty }));
  if (!rows.length && qty) rows = [{ quantity: qty }];
  const p = {};
  if (rows.length) p.rows = rows;
  if (SEED.issue_date) p.issueDate = SEED.issue_date;
  return p;
}

const firstPaint = () => ({
  corporationId: CORP_ID, corporationName: COMPANY_NAME, securityType: SECURITY_TYPE,
  draftSetId: RESUMING ? SEED.draft_set_id : null,
  prefill: promptPrefill(),
});

/** What first paint produced, so an edit is anything that differs from it. */
function snapshot() {
  return {
    shared: Object.assign({}, S.shared),
    rows: S.rows.map((r) => Object.assign({}, r, { ov: Object.assign({}, r.ov) })),
  };
}

const ROW_EDITABLE = ["name", "email", "quantity", "kind", "relationship", "query",
  "stakeholderId", "isNew"];

/** Put back whatever changed between first paint and now, so a re-seed cannot discard a
    value typed while bootstrap was in flight. Rows join by position — that is the only
    join available, since a re-seed mints fresh keys. */
function reapplyEdits(base, edited) {
  for (const k of Object.keys(edited.shared)) {
    if (edited.shared[k] !== base.shared[k]) S.shared[k] = edited.shared[k];
  }
  edited.rows.forEach((was, i) => {
    const now = S.rows[i], from = base.rows[i];
    if (!now || !from) return;
    for (const k of ROW_EDITABLE) if (was[k] !== from[k]) now[k] = was[k];
    if (Object.keys(was.ov).length) now.ov = was.ov;
  });
  for (let i = base.rows.length; i < edited.rows.length; i++) S.rows.push(edited.rows[i]);
}

/** The one two-path branch in this page: `issuance_bootstrap` is not deployed on
    every MCP yet, so an unknown-command rejection is expected, not an error to
    show — loadTerms()'s reference-data fan-out covers that case by itself.
    Returns true when the payload carried the reference data too, which is what
    lets the whole form arrive in this one round trip. */
async function bootstrap(base) {
  /* `"true"`, not `true`. The gateway types a plain command's scalars as
     `str | int | dict | list` — no `bool` — so a JSON boolean arrives as `1`, the
     server's `is True` check misses it, and the sections come back absent with no error
     to show for it. Measured: the whole one-call boot silently became seven calls.
     long-comment-ok: a wire quirk that reads as a typo and reverts itself otherwise. */
  const args = { security_type: SECURITY_TYPE, include_sections: "true" };
  /* The page resolves the company itself when the build was given only a name — one
     round trip the model no longer spends before this page exists. Exactly one of the
     two goes on the wire: sending both earns a `corporation.name_ignored` warning. A
     name it cannot pin down comes back with no id and one `corporation.unresolved`
     hard stop naming the candidates, which is the blockers section's job to show. */
  if (CORP_ID == null) args.corporation = COMPANY_NAME;
  else args.corporation_id = CORP_ID;
  // Forwarding the knowns is the point of the call: it resolves each name to a
  // stakeholder id, email, kind and relationship, and reports the unmatched ones.
  if (seedNames().length) args.stakeholders = seedNames();
  if (seedQty()) args.quantity = seedQty();
  if (SEED.issue_date) args.issue_date = SEED.issue_date;
  let res;
  try { res = await one("cap_table__get__issuance_bootstrap", args); }
  catch (err) {
    if (isMissingCommand(err) || isUnknownParam(err, "include_sections")) return false;
    throw err;
  }
  const d = payload(res);
  const edited = snapshot();
  ingest(d);
  reapplyEdits(base, edited);
  const fat = ingestSections(d);
  if (fat) settleTerms(); else render();
  return fat;
}

/** An unresolved prompt row reads as a brand-new person, and a duplicate stakeholder on
    a live cap table is the worst outcome here. Exact matches only — the user picks. */
async function resolveSeededNames() {
  const pending = () => S.rows.filter(
    (r) => !r.isNew && r.stakeholderId == null && (r.query || "").trim());
  for (const r of pending()) resolveExact(r);
  // One search per name still unresolved. `search` AND-s its terms and matches one
  // person, so names are never joined into a single query.
  for (const r of pending()) {
    await searchRoster(r.query);
    resolveExact(r);
  }
  applyDerived();
  softRender();
}

/** Settle the page on a company the server could not pin down. The blocker carries the
    candidates; there is nothing left to load, so nothing should still say it is. */
function stopUnresolved() {
  S.termsLoading = false;
  S.rosterLoading = false;
  render();
  flag();
}

(async () => {
  // 1. Paint from the prompt. Nothing here awaits the transport.
  ingest(firstPaint());
  const base = snapshot();
  // 2. No connector is a state, not a crash: say what to do and stop.
  if (!(await connect())) { degrade(); return; }
  // Unawaited, and first paint is already done: a capability this view does not serve
  // answers only after ~10s, and the hand-off must not wait for that answer.
  openStore();
  // 3. One call: resolve the named people server-side and take the reference data
  //    with them. Skipped on a resume — re-seeding those rows drops the draft_pk
  //    map, which inserts duplicates into the set being edited.
  let fat = false;
  if (!RESUMING) {
    try { fat = await bootstrap(base); }
    catch (err) {
      console.error("issuance artifact: bootstrap failed", err);
      // No live Carta: the page says so once, and nothing further is called.
      if (deadRead(err)) return;
      noteFailures(["bootstrap"]);
    }
  }
  // 4. The fan-out addresses every command by corporation id, so an unresolved company
  //    has nothing to ask — and its hard stop is already on screen.
  if (S.corpId == null) { stopUnresolved(); return; }
  if (!fat) await boot();
  // 5. Anything bootstrap could not resolve, match against the roster instead.
  await resolveSeededNames();
})();
