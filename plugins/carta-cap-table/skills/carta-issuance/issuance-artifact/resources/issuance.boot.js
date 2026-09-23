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

/** A row added or removed since first paint, which a join by position would misplace. */
const rowsEdited = (base, edited) => base.rows.map((r) => r.key).join() !== edited.rows.map((r) => r.key).join();

/** Put back whatever changed between first paint and now, so a re-seed cannot discard a
    value typed while bootstrap was in flight. Rows join by position — that is the only
    join available, since a re-seed mints fresh keys. */
function reapplyEdits(base, edited) {
  for (const k of Object.keys(edited.shared)) {
    if (edited.shared[k] !== base.shared[k]) S.shared[k] = edited.shared[k];
  }
  if (S.rows === edited.rows) return;
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
async function bootstrap(base, resume) {
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
  const drafts = Object.assign({}, S.drafts);
  const kept = { docPicked: S.docPicked, curFor: S.curFor };
  ingest(d);
  // A resume takes its rows and terms from the set itself; the bootstrap is only its
  // reference data, so nothing the page already holds is re-seeded from it.
  if (resume) {
    S.rows = edited.rows; S.drafts = drafts; S.shared = edited.shared;
    Object.assign(S, kept);
    const fat = ingestSections(d);
    if (fat) settleTerms(); else render();
    return fat;
  }
  // Rows added or removed while this was in flight no longer line up with first paint
  // by position, so they are kept whole and matched by name afterwards.
  if (rowsEdited(base, edited)) S.rows = edited.rows;
  else keepSeededRows(base.rows, d);
  reapplyEdits(base, edited);
  const fat = ingestSections(d);
  if (fat) settleTerms(); else render();
  return fat;
}

/** The bootstrap answers with a row only for a name it matched, and ingest() seeds from
    that, so every other person the prompt named would vanish. They come back in the
    prompt's order — which keeps reapplyEdits()' join by position on the same person: an
    unmatched name as a new stakeholder, an ambiguous one as a row still to pick. */
function keepSeededRows(seeded, d) {
  const p = (d && d.prefill) || {};
  const unmatched = new Set(arr(p.unmatched).map(nameKey));
  const ambiguous = new Set(objs(p.ambiguous).map((a) => nameKey(a.term)));
  const found = S.rows.filter((r) => r.stakeholderId != null);
  const has = (v) => String(v == null ? "" : v).trim() !== "";
  const toPick = (s) => Object.assign(mkRow({ quantity: s.quantity, email: s.email }), { query: s.name });
  // Exact name or email first, then a name that contains the term — Carta matches
  // "Tagg" to "Tagg Palmer". A term neither finds is never handed someone else's row:
  // past the ten names Carta lists it only counts, so an unlisted term is searched for.
  const claim = (key) => {
    let at = found.findIndex((r) => nameKey(r.name) === key || nameKey(r.email) === key);
    if (at < 0) {
      const near = found.filter((r) => nameKey(r.name).includes(key) || nameKey(r.email).includes(key));
      at = near.length === 1 ? found.indexOf(near[0]) : -1;
    }
    return at >= 0 ? found.splice(at, 1)[0] : null;
  };
  const out = [];
  for (const s of seeded) {
    const key = nameKey(s.name);
    if (!key) { if (has(s.quantity)) out.push(mkRow({ quantity: s.quantity })); continue; }
    if (unmatched.has(key)) {
      out.push(mkRow({ name: s.name, email: s.email, quantity: s.quantity, isNew: true }));
      continue;
    }
    if (ambiguous.has(key)) { out.push(toPick(s)); continue; }
    const hit = claim(key);
    if (hit && has(s.quantity)) hit.quantity = String(s.quantity);
    out.push(hit || toPick(s));
  }
  out.push(...found);
  if (out.length) S.rows = out;
}

/** An unresolved prompt row reads as a brand-new person, and a duplicate stakeholder on
    a live cap table is the worst outcome here. Exact matches only — the user picks. */
async function resolveSeededNames() {
  // A name Carta already found more than once stays the user's pick: the notice above
  // says so, and a first match here would quietly choose for them.
  const ambiguous = new Set(objs(S.prefill.ambiguous).map((a) => nameKey(a.term)));
  const pending = () => S.rows.filter((r) => !r.isNew && r.stakeholderId == null
    && (r.query || "").trim() && !ambiguous.has(nameKey(r.query)));
  // A full first page may hold one namesake while another sits on the next, and one
  // match on this page is then no proof there is only one — so search before picking.
  if (headcount() < PAGE) for (const r of pending()) resolveExact(r);
  // One search per name still unresolved. `search` AND-s its terms and matches one
  // person, so names are never joined into a single query.
  for (const r of pending()) {
    await searchRoster(r.query);
    resolveExact(r);
  }
  applyDerived();
  softRender();
}

/** Settle the page on a boot that produced no company. The notice above carries the
    reason; there is nothing left to load, so nothing should still say it is. */
function stopUnresolved() {
  S.termsLoading = false;
  S.rosterLoading = false;
  render();
  flag();
}

/** First paint, which every later load diffs against so a re-run cannot discard a value
    typed while it was in flight. */
let bootBase = null;
let bootDrafts = {};
let bootRunning = false;
let autoRetried = false;

/** The load itself: resolve the named people, take the reference data, match the rest.
    Reads only, so running it again is safe — nothing here writes to Carta. */
async function runBoot() {
  // 1. One call: the named people resolved server-side, reference data with them.
  //    Never over a draft set: re-seeding drops the draft_pk map and duplicates it.
  if (RESUMING) { await resumeBoot(); return; }
  let fat = false;
  if (S.draftSetId == null) {
    try { fat = await bootstrap(bootBase); }
    catch (err) {
      console.error("issuance artifact: bootstrap failed", err);
      // No live Carta: the page says so once, and nothing further is called.
      if (deadRead(err)) return;
      // Nothing was learned about the company, so localBlockers() must not blame its name.
      S.bootFailed = true;
      noteFailures(["bootstrap"]);
    }
  }
  // 2. The fan-out addresses every command by corporation id, so an unresolved company
  //    has nothing to ask — and its notice is already on screen.
  if (S.corpId == null) { stopUnresolved(); return; }
  if (!fat) await boot();
  // 3. Anything bootstrap could not resolve, match against the roster instead.
  await resolveSeededNames();
}

/** What load_drafts answered, or the failure it threw — never both, and never a throw. */
const loadStored = () => one("cap_table__get__load_drafts", { corporation_id: S.corpId,
  security_type: SECURITY_TYPE, draft_set_id: SEED.draft_set_id })
  .then((res) => ({ res: payload(res) }), (err) => ({ err }));

/** A resume: the same reference data a fresh page loads, and the set's own rows and terms
    read back from Carta, both at once when the company is already known. The rows the
    prompt carried are only the fallback for a load that failed. */
async function resumeBoot() {
  // A retry over a page already read back reloads reference data only: reading the set
  // again would drop every edit and bring back rows the user removed.
  const again = S.hydrated;
  const early = S.corpId != null && !again ? loadStored() : null;
  let fat = false;
  try { fat = await bootstrap(bootBase, true); }
  catch (err) {
    console.error("issuance artifact: bootstrap failed", err);
    if (deadRead(err)) return;
    S.bootFailed = true;
    noteFailures(["bootstrap"]);
  }
  if (S.corpId == null) { stopUnresolved(); return; }
  if (!fat) await boot();
  if (again) { render(); return; }
  const got = await (early || loadStored());
  if (got.err && deadRead(got.err)) return;
  if (got.err) console.error("issuance artifact: load_drafts failed", got.err);
  if (!hydrateFromDrafts(got.res)) {
    S.rows = bootBase.rows.map((r) => Object.assign({}, r, { ov: {} }));
    S.drafts = Object.assign({}, bootDrafts);
    markUnhydrated();
  }
  applyDerived();
  render();
}

/** Run the load again in place, from the failure notice or from the page coming back
    into view. One at a time: a second run in flight would mint a second set of rows. */
async function retryBoot() {
  if (bootRunning || bootBase == null || S.connErr) return;
  bootRunning = true;
  S.bootFailed = false;
  S.loadFailed = []; S.loadErr = "";
  S.termsLoading = true; S.rosterLoading = true; S.booted = false;
  render();
  flag();
  try { await runBoot(); }
  finally { bootRunning = false; autoRetried = false; }
}

/** A viewer who was away — or who has just granted the connector — is looking at the
    page again. Once per failure, and never over a load already running. */
function retryOnReturn() {
  // Never under a sheet or a write in flight: the reload redraws the form behind them.
  if (!S.loadErr || bootRunning || autoRetried || S.sheet || S.busy || S.stuck || S.issued
    || S.stage !== "edit") return;
  autoRetried = true;
  retryBoot();
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) retryOnReturn();
});
if (typeof window.addEventListener === "function") {
  window.addEventListener("focus", retryOnReturn);
}

(async () => {
  // Paint from the prompt. Nothing here awaits the transport.
  ingest(firstPaint());
  bootBase = snapshot();
  bootDrafts = Object.assign({}, S.drafts);
  // No connector is a state, not a crash: say what to do and stop.
  if (!(await connect())) { degrade(); return; }
  // Unawaited, and first paint is already done: a capability this view does not serve
  // answers only after ~10s, and the hand-off must not wait for that answer.
  openStore();
  bootRunning = true;
  try { await runBoot(); }
  finally { bootRunning = false; }
})();
