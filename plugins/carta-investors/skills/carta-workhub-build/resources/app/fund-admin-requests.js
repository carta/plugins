// ── Fund Admin requests: composer bar + grouped queue + thread overlay ──
// Depends on carta-workhub.app.js: _mcp, escHtml, showToast, trackWorkhub,
// _mcpResultCandidates, _benchmarkFirmId.

// Who the case waits on, from last_task.template. An unrecognised value shows
// as in-progress rather than disappearing.
const FAR_GROUP_BY_PENDING = {
  'pending-customer': 'todo',
  'pending-carta': 'progress',
  'new': 'progress',
};

// fa:list:workflow returns WorkflowStatus as an integer, not a string.
const FAR_STATUS_COMPLETE = 2;
const FAR_STATUS_CANCELED = 3;

// Each label is an event the payload can prove. There is no "received" here:
// nothing marks a read, so it would be a guess presented as a fact.
const FAR_STATUS_LABEL = {
  'new': 'Sent',
  'pending-carta': 'Working',
  'pending-customer': 'Ready for you',
};
// `canceled` rides on the row because it comes from the int status, not from
// last_task.template — which keeps naming a pending actor after the case closes.
function farStatusLabel(row) {
  if (row.group === 'done') return row.canceled ? 'Canceled' : 'Done';
  return FAR_STATUS_LABEL[row.state] ?? 'Working';
}

// Ids of requests this artifact created. Only read when no list command is
// reachable — see farFetchRequests() for why that path is partial.
const FAR_IDS_KEY = 'cartaWorkhub.fundAdminRequestIds';

// Plans are held here and nowhere else — Carta has no unsent-draft state, so a
// plan exists only in this artifact until it is sent.
const FAR_PLANS_KEY = 'cartaWorkhub.plannedRequests';

// fa:create:fund-admin-message takes only `message`, and the backend stamps
// request_type 'other'. So the type is carried two ways: as the message's first
// line (durable, and the team reads it) and cached here to avoid refetching.
const FAR_TYPES_KEY = 'cartaWorkhub.requestTypes';
const FAR_GENERIC_TYPES = new Set(['', 'other', 'general', 'request-generic', 'request generic']);
const FAR_HYDRATE_MAX = 8;   // bounded: a title is not worth a fetch storm

// Storage throws on an opaque origin, which is what a data: URL artifact gets.
// Probed once; when it fails, plans live in memory for the session and say so.
let _farMemPlans = [];
let _farStorageOk = null;

function farStorageOk() {
  if (_farStorageOk !== null) return _farStorageOk;
  try {
    localStorage.setItem('cartaWorkhub.probe', '1');
    localStorage.removeItem('cartaWorkhub.probe');
    _farStorageOk = true;
  } catch (e) {
    _farStorageOk = false;
  }
  return _farStorageOk;
}

const FAR_PAGE_SIZE = 50;
const FAR_DONE_PREVIEW = 5;   // completed rows shown before "+ N more"
const FAR_TITLE_MAX = 72;     // chars of the opening message used as a title

let _farRows = null;          // null = not fetched; [] = none; [...] = rows
let _farPartial = false;      // true when rows came from the localStorage path
let _farDoneOpen = false;
const _farThreadCache = {};   // workflow_id → normalized messages

// ── Result unwrapping ──

// Pick the first candidate carrying an array under `results`. The transport
// hands back a raw object, content[].text, or {result:"<json>"} by turns.
function farResults(res) {
  if (!res || res.isError) return null;
  for (const c of _mcpResultCandidates(res)) {
    if (c && Array.isArray(c.results)) return c.results;
    if (Array.isArray(c)) return c;
  }
  return null;
}

function farWorkflowId(res) {
  if (!res || res.isError) return null;
  for (const c of _mcpResultCandidates(res)) {
    const id = c && (c.workflow_id ?? c.id);
    if (id != null) return id;
  }
  return null;
}

// ── Normalizing ──

// content_text is null on HTML-only messages, so fall back to content_html with
// its tags stripped — a DM thread is text, and raw HTML must never reach innerHTML.
// The backend renders a GPX/Mobile message body as "        Additional Info:\n
// <indented body>". That preamble is Carta's own formatting, not something the
// sender wrote, so it is stripped everywhere the text is read or shown.
function farUnwrap(text) {
  return String(text ?? '')
    .replace(/^\s*Additional Info:\s*\n?/i, '')
    .replace(/^[ \t]+/gm, '')
    .trim();
}

// Deliberately not trimmed: this also runs on the fragments between anchors,
// where a trim glues the words on either side of a link together.
function farBlockText(html) {
  return String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// content_html carries the paragraphs the author wrote; content_text is the same
// message flattened. Tags are stripped either way — nothing here is ever inserted
// as HTML, so the blocks are safe to escape and render as separate paragraphs.
function farStripTags(html) {
  return farUnwrap(farBlockText(html));
}

function farMessageBlocks(m) {
  const source = farStripTags(m.content_html) || farUnwrap(m.content_text);
  return String(source).split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
}

// ── Links ──
// Anchors are the only markup kept from content_html; the rest is C-World editor
// styling that would override Ink. Each one is rebuilt from an escaped label and a
// checked href, so payload markup still never reaches innerHTML.

const FAR_ANCHOR_RE = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const FAR_HREF_RE = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

// Absolute http(s) only, which rejects javascript:, data:, protocol-relative
// //host and relative paths. A Carta deep link is always absolute.
function farSafeHref(raw) {
  const url = farBlockText(raw).trim();
  return /^https?:\/\/\S+$/i.test(url) ? url : null;
}

function farLinkHtml(href, label) {
  return `<a class="far-bubble-link" href="${escHtml(href)}" target="_blank"`
    + ` rel="noopener noreferrer">${escHtml(label)}</a>`;
}

// Text and link tokens. Text keeps its newlines so the block split below still
// works; a link stays inline in the block it was written in.
function farHtmlTokens(html) {
  const src = String(html ?? '');
  const tokens = [];
  let last = 0;
  let m;
  FAR_ANCHOR_RE.lastIndex = 0;
  while ((m = FAR_ANCHOR_RE.exec(src)) !== null) {
    tokens.push({ text: farBlockText(src.slice(last, m.index)) });
    const label = farBlockText(m[2]).replace(/\s+/g, ' ').trim();
    const href = farSafeHref((FAR_HREF_RE.exec(m[1]) || []).slice(1).find(v => v != null));
    // An anchor that fails either check keeps its words. Dropping the label would
    // lose the message, not just the link.
    if (label) tokens.push(href ? { text: label, href } : { text: label });
    last = FAR_ANCHOR_RE.lastIndex;
  }
  tokens.push({ text: farBlockText(src.slice(last)) });
  return tokens;
}

// farUnwrap's normalization across a token stream: the preamble can only open the
// message, and the trim has to land on block edges, not on every anchor boundary.
function farNormalizeTokens(tokens) {
  return tokens.map((t, i) => t.href ? t : {
    text: (i === 0 ? String(t.text).replace(/^\s*Additional Info:\s*\n?/i, '') : String(t.text))
      .replace(/^[ \t]+/gm, ''),
  });
}

// Whitespace at a block's edges is markup; inside a block it separates words.
function farTrimParts(parts) {
  const out = parts.filter((p, i) => p.href || p.text.trim() || (i > 0 && i < parts.length - 1));
  if (out.length && !out[0].href) out[0] = { text: out[0].text.replace(/^\s+/, '') };
  const end = out.length - 1;
  if (end >= 0 && !out[end].href) out[end] = { text: out[end].text.replace(/\s+$/, '') };
  return out.filter(p => p.href || p.text);
}

function farGroupBlocks(tokens) {
  const blocks = [];
  let parts = [];
  const flush = () => {
    const trimmed = farTrimParts(parts);
    if (trimmed.length) blocks.push(trimmed);
    parts = [];
  };
  tokens.forEach(t => {
    if (t.href) { parts.push(t); return; }
    String(t.text).split(/\n\s*\n/).forEach((piece, i) => {
      if (i > 0) flush();
      if (piece) parts.push({ text: piece });
    });
  });
  flush();
  return blocks;
}

// The rich counterpart to farMessageBlocks. content_html wins for the same reason
// it does there: that is where the authored structure — and the anchors — live.
function farRichBlocks(m) {
  const html = String(m.content_html ?? '');
  const tokens = farStripTags(html)
    ? farHtmlTokens(html)
    : [{ text: farUnwrap(m.content_text) }];
  return farGroupBlocks(farNormalizeTokens(tokens));
}

// content_text writes a link as "label <https://…>", and a customer can paste a
// bare URL, so the text path linkifies too. Without it every GPX/Mobile message —
// they all arrive with content_html empty — shows its URL as dead text.
const FAR_URL_RE = /<(https?:\/\/[^\s<>]+)>|(https?:\/\/[^\s<>"']+)/gi;

// Trailing sentence punctuation and an unbalanced ")" belong to the prose.
function farTrimUrl(url) {
  let out = String(url).replace(/[.,;:!?]+$/, '');
  while (out.endsWith(')') && (out.match(/\(/g) || []).length < (out.match(/\)/g) || []).length) {
    out = out.slice(0, -1);
  }
  return out;
}

function farLinkifyText(text) {
  const src = String(text ?? '');
  let out = '';
  let last = 0;
  let m;
  FAR_URL_RE.lastIndex = 0;
  while ((m = FAR_URL_RE.exec(src)) !== null) {
    out += escHtml(src.slice(last, m.index));
    const raw = m[1] ?? m[2];
    // The <…> form is explicitly delimited, so only a bare URL needs trimming.
    const url = m[1] ? raw : farTrimUrl(raw);
    out += farLinkHtml(url, url) + escHtml(raw.slice(url.length));
    last = FAR_URL_RE.lastIndex;
  }
  return out + escHtml(src.slice(last));
}

function farPartsHtml(parts) {
  return parts.map(p => p.href ? farLinkHtml(p.href, p.text) : farLinkifyText(p.text)).join('');
}

// The single-string form, still used for titles and hydration.
function farMessageText(m) {
  const text = farUnwrap(m.content_text);
  if (text) return text;
  return farStripTags(m.content_html);
}

// A filled template reads as a form, so render it as one. Only lines whose label
// carries a value survive — a bare "Anything else we should know:" is not content.
function farParseFields(text) {
  const lines = String(text ?? '').split('\n');
  const fields = [];
  let firstMatch = -1;
  let lastMatch = -1;
  lines.forEach((line, i) => {
    const m = /^\s*([A-Za-z][^:\n]{0,40}):\s*(.*)$/.exec(line);
    if (!m) return;
    if (firstMatch < 0) firstMatch = i;
    lastMatch = i;
    const value = m[2].trim();
    if (value) fields.push({ label: m[1].trim(), value });
  });
  // Text before the first field is the request's opening line. It is returned
  // rather than dropped — it is usually the type, which the panel title already
  // shows, but a request that ignores the template puts real content here.
  const lead = (firstMatch < 0 ? '' : lines.slice(0, firstMatch).join('\n')).trim();
  const rest = lines.slice(lastMatch + 1).join('\n').trim();
  return { fields, lead, rest };
}

// request-generic is a DM workflow, so `subject` is always null. The opening
// message is the only human-readable label the thread has.
function farTitleFrom(text) {
  const line = String(text ?? '').split('\n').find(l => l.trim()) ?? '';
  const clean = line.trim().replace(/[.:]+$/, '');
  if (!clean) return 'Request to Carta';
  return clean.length > FAR_TITLE_MAX ? clean.slice(0, FAR_TITLE_MAX - 1) + '…' : clean;
}

function farNormalizeMessages(rows) {
  return (rows ?? [])
    .map(m => ({
      id: m.id,
      text: farMessageText(m),
      html: m.content_html ?? '',
      isStaff: m.author?.is_staff === true,
      author: m.author?.name ?? null,
      at: m.message_timestamp ?? null,
    }))
    .sort((a, b) => farMs(a.at) - farMs(b.at));
}

// "Pending Carta" → "pending-carta". status_presentation is the display string;
// last_task.template already carries the machine form, so it wins.
function farPendingState(w) {
  const fromTask = String(w.last_task?.template ?? '').toLowerCase();
  if (fromTask) return fromTask;
  return String(w.status_presentation?.status ?? '').toLowerCase().replace(/\s+/g, '-');
}

// "investment wire" → "Investment wire". request_type names the job, so it beats
// message_snippet, which is whichever message landed last.
function farRequestTitle(w) {
  const remembered = farReadTypes()[String(w.id ?? w.workflow_id)];
  if (remembered) return remembered;
  const type = String(w.request_type ?? '').trim();
  if (type && !FAR_GENERIC_TYPES.has(type.toLowerCase())) {
    return type.charAt(0).toUpperCase() + type.slice(1);
  }
  const raw = farRawRequest(w);
  if (raw) return farTitleFrom(raw);
  // message_snippet is whichever message landed last, so it can be Carta's
  // reply. Only used until farHydrateTitles reads the opening message.
  const snippet = farUnwrap(w.thread_metadata?.message_snippet);
  if (snippet) return farTitleFrom(snippet);
  return 'Request to Carta';
}

// The request as sent. fa:list:workflow carries it on the row, so the title does
// not depend on reading the thread back.
function farRawRequest(w) {
  return farUnwrap(w.additional_info ?? w.context_json?.additional_info);
}

// True when the row carries no type we can trust, so its title is a placeholder.
function farNeedsTitle(w) {
  if (farReadTypes()[String(w.id ?? w.workflow_id)]) return false;
  if (farRawRequest(w)) return false;
  const type = String(w.request_type ?? '').trim().toLowerCase();
  return FAR_GENERIC_TYPES.has(type);
}

function farNormalizeWorkflow(w) {
  const status = Number(w.status);
  const pending = farPendingState(w);
  const group = (status === FAR_STATUS_COMPLETE || status === FAR_STATUS_CANCELED)
    ? 'done'
    : (FAR_GROUP_BY_PENDING[pending] ?? 'progress');
  return {
    id: w.id ?? w.workflow_id,
    title: farRequestTitle(w),
    firm: w.firm?.name?.trim() || null,
    group,
    state: pending,
    canceled: status === FAR_STATUS_CANCELED,
    needsTitle: farNeedsTitle(w),
    requested: w.created_at ?? null,
    lastActivity: w.last_activity_at ?? w.last_communication_at ?? w.created_at ?? null,
    // Deliberately NOT workflow_detail_url — that is a /staff/ route, so linking
    // a customer to it sends them somewhere they cannot open.
    webUrl: w.workflow_cta_url ?? null,
  };
}

// list_contexts answers "Unknown" for some firms even though the workflow rows
// carry the real name, so the placeholder is treated as no answer rather than
// printed at the customer. First real name wins; a later blank cannot clear it.
function farSetFirmName(name) {
  const clean = String(name ?? '').trim();
  if (!clean || clean.toLowerCase() === 'unknown') return;
  const sub = document.getElementById('far-firm');
  if (sub) sub.textContent = clean;
}

// ── Fetching ──

function farReadIds() {
  try {
    const raw = JSON.parse(localStorage.getItem(FAR_IDS_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter(n => Number.isFinite(Number(n))) : [];
  } catch (e) {
    return [];
  }
}

function farRecordId(id) {
  try {
    const ids = farReadIds();
    if (!ids.includes(id)) localStorage.setItem(FAR_IDS_KEY, JSON.stringify(ids.concat(id)));
  } catch (e) {
    /* the queue degrades to server-side listing; not worth surfacing */
  }
}

// ── Request types ──

function farReadTypes() {
  if (!farStorageOk()) return _farMemTypes;
  try {
    const raw = JSON.parse(localStorage.getItem(FAR_TYPES_KEY) ?? '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch (e) {
    return {};
  }
}

const _farMemTypes = {};

function farRememberType(id, label) {
  if (id == null || !label) return;
  _farMemTypes[String(id)] = label;
  if (!farStorageOk()) return;
  try {
    const all = farReadTypes();
    all[String(id)] = label;
    localStorage.setItem(FAR_TYPES_KEY, JSON.stringify(all));
  } catch (e) {
    /* the title falls back to the first message; not worth surfacing */
  }
}

// The tile if one was used, else whatever the text looks like, else nothing.
function farRequestLabel(message) {
  if (_farPresetName) return _farPresetName;
  const inferred = farInferType(message);
  return inferred ? inferred.name : null;
}

// ── Plans ──

function farReadPlans() {
  if (!farStorageOk()) return _farMemPlans;
  try {
    const raw = JSON.parse(localStorage.getItem(FAR_PLANS_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter(p => p && typeof p.message === 'string') : [];
  } catch (e) {
    return _farMemPlans;
  }
}

function farWritePlans(plans) {
  // Memory is the source of truth for the session; storage is the durable copy.
  _farMemPlans = plans;
  if (!farStorageOk()) return;
  try {
    localStorage.setItem(FAR_PLANS_KEY, JSON.stringify(plans));
  } catch (e) {
    _farStorageOk = false;
  }
}

// Two sentences: where the plan lives, then what has not happened yet. Storage
// is localStorage, so "this computer" is the normal case; the session wording is
// the fallback for an origin that cannot store at all.
function farPlanTip() {
  return farStorageOk()
    ? 'Planned work is saved on this computer. Nothing goes to Carta until you send.'
    : 'Planned work is saved in this session only. Nothing goes to Carta until you send.';
}

function farPlanScopeNote() {
  return farStorageOk()
    ? 'Save as plan keeps it on this computer only, until you send it.'
    : 'Save as plan keeps it for this session only — this artifact cannot save it.';
}

function farSavePlan() {
  const box = document.getElementById('far-compose-text');
  const message = (box?.value ?? '').trim();
  if (!message) { showToast('Add a description before saving.'); return; }
  trackWorkhub('click', 'CartaWorkhub.FundAdminRequests.SavePlan');
  farWritePlans(farReadPlans().concat({
    planId: 'plan-' + Date.now(),
    message,
    requested: new Date().toISOString(),
  }));
  closeFarCompose();
  showToast(farStorageOk()
    ? 'Saved as a plan on this computer. Nothing has gone to Carta yet.'
    : 'Saved as a plan for this session. Nothing has gone to Carta yet.');
  renderFarSection();
}

// Sending a plan drops it too, so the removal is split from the Discard button —
// otherwise a send would report a discard the user never made.
function farDropPlan(planId) {
  farWritePlans(farReadPlans().filter(p => p.planId !== planId));
  renderFarSection();
}

function farDiscardPlan(planId) {
  trackWorkhub('click', 'CartaWorkhub.FundAdminRequests.DiscardPlan');
  farDropPlan(planId);
}

// Reopens the plan at the review step, so sending it takes the same confirm as
// anything else. The plan is only dropped once the send succeeds.
function farReviewPlan(planId) {
  const plan = farReadPlans().find(p => p.planId === planId);
  if (!plan) return;
  openFarCompose();
  _farPlanId = planId;
  const box = document.getElementById('far-compose-text');
  if (box) box.value = plan.message;
  reviewFarCompose();
}

function farPlanRows() {
  return farReadPlans().map(p => ({
    id: p.planId,
    planId: p.planId,
    title: farTitleFrom(p.message),
    group: 'planned',
    state: 'planned',
    requested: p.requested,
    lastActivity: p.requested,
    webUrl: null,
  }));
}

// Hydrate ids this artifact created by reading each thread. No workflow state is
// available here, so the group comes from who spoke last and nothing reads "done".
async function farFetchFromIds() {
  const ids = farReadIds();
  const rows = [];
  for (const id of ids) {
    const msgs = await farFetchThread(id);
    if (!msgs || msgs.length === 0) continue;
    const last = msgs[msgs.length - 1];
    rows.push({
      id,
      title: farTitleFrom(msgs[0].text),
      group: last.isStaff ? 'todo' : 'progress',
      state: last.isStaff ? 'pending-customer' : 'pending-carta',
      requested: msgs[0].at,
      lastActivity: last.at,
      webUrl: null,
    });
  }
  return rows;
}

// Three sources, most complete first. fa:list:workflow is staff-only and
// fa:list:fund-admin-message may not be deployed, so the id path is the floor.
async function farFetchRequests() {
  let loaded = false;
  try {
    const scoped = await _mcp('fetch', {
      command: 'fa:list:fund-admin-message',
      params: { page_size: FAR_PAGE_SIZE },
    });
    let rows = farResults(scoped);

    if (!rows && _benchmarkFirmId) {
      const listed = await _mcp('fetch', {
        command: 'fa:list:workflow',
        params: {
          firm_uuid: _benchmarkFirmId,
          template_type: 'request-generic',
          page_size: FAR_PAGE_SIZE,
        },
      });
      rows = farResults(listed);
    }

    if (rows) {
      _farPartial = false;
      _farRows = rows.map(farNormalizeWorkflow).filter(r => r.id != null);
      farSetFirmName(_farRows.find(r => r.firm)?.firm);
    } else {
      _farPartial = true;
      _farRows = await farFetchFromIds();
    }
    loaded = true;
  } catch (e) {
    console.error('[far] request list unavailable —', e);
    _farPartial = true;
    _farRows = [];
  }
  renderFarSection();
  // Hydration only improves titles, so it stays outside the try above — sharing
  // that catch let a cosmetic failure reset _farRows and blank a loaded queue.
  if (loaded) await farHydrateTitles().catch(e => console.error('[far] title hydration —', e));
}

// A row created on another device has no cached type and a generic request_type,
// so its title is a placeholder. Read the opening message for those few and cache
// the result, bounded so a long queue cannot turn into a fetch storm.
async function farHydrateTitles() {
  const rows = (_farRows ?? []).filter(r => r.needsTitle).slice(0, FAR_HYDRATE_MAX);
  let changed = false;
  for (const row of rows) {
    const msgs = await farFetchThread(row.id);
    if (!msgs || msgs.length === 0) continue;
    const title = farTitleFrom(msgs[0].text);
    if (!title) continue;
    farRememberType(row.id, title);
    row.title = title;
    row.needsTitle = false;
    changed = true;
  }
  if (changed) renderFarSection();
}

// Not cached on failure: the thread is the overlay's only source, so holding an
// empty result would keep it blank for the rest of the session.
async function farFetchThread(workflowId) {
  if (_farThreadCache[workflowId]) return _farThreadCache[workflowId];
  try {
    const res = await _mcp('fetch', {
      command: 'fa:list:workflow-message',
      params: { workflow_id: Number(workflowId) },
    });
    const rows = farResults(res);
    if (!rows) {
      console.error('[far] fa:list:workflow-message failed —', res?.content?.[0]?.text ?? res);
      return null;
    }
    const msgs = farNormalizeMessages(rows);
    _farThreadCache[workflowId] = msgs;
    return msgs;
  } catch (e) {
    console.error('[far thread error]', e);
    return null;
  }
}

// No case number here on purpose: quoting Carta's internal handle at the sender
// implies it is how they follow up, when the thread is.
function farRenderSent() {
  trackWorkhub('render', 'CartaWorkhub.FundAdminRequests.Sent');
  const overlay = farEnsureOverlay('far-compose-overlay', 'far-overlay');
  overlay.innerHTML = `
    <div class="far-panel far-panel-sent">
      <div class="far-sent-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" width="32" height="32" fill="none">
          <path class="far-sent-tick" d="M8 16.8l5.2 5.2L24 11.2" stroke="currentColor"
                stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <h2 class="far-sent-title">Your Carta team is on it</h2>
      <p class="far-sent-body">You will be notified when the work is ready for review, or if we have any questions.</p>
      <p class="far-sent-note">Need to add something? Open the request from this page to reply or add a note in context.</p>
      <div class="far-panel-footer far-panel-footer-center">
        <button class="far-btn-primary" onclick="closeFarCompose()">Done</button>
      </div>
    </div>`;
  overlay.classList.add('far-overlay-visible');
}

// ── Sorting ──

// The queue is grouped by status and rendered into fixed containers, so a sort by
// status is a no-op — it reorders rows that are then re-partitioned by the same
// key. Requested date is the only axis with anything to say, so the control is a
// direction instead of a field.
let _farSort = 'newest';

function farSetSort(value) {
  _farSort = value;
  trackWorkhub('click', 'CartaWorkhub.FundAdminRequests.Sort');
  renderFarSection();
}

function farSorted(rows) {
  const dir = _farSort === 'oldest' ? -1 : 1;
  return rows.slice().sort((a, b) =>
    dir * (farMs(b.requested) - farMs(a.requested)));
}

// ── Rendering ──

function farAgo(ts) {
  const d = farToDate(ts);
  if (!d) return '';
  const ms = Date.now() - d.getTime();
  if (ms < 0) return '';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function farPlanCard(r) {
  const card = document.createElement('div');
  card.className = 'far-card far-card-planned';
  card.innerHTML = `
    <div class="far-card-title">${escHtml(r.title ?? 'Planned request')}</div>
    <div class="far-card-sub"><span class="far-card-muted">Not sent yet</span></div>
    <div class="far-card-status">
      <span class="far-dot far-dot-planned"></span>
      <span class="far-card-status-text">Drafted ${escHtml(farDate(r.requested))}</span>
    </div>
    <div class="far-card-footer">
      <button class="far-card-view" data-far-plan="${escHtml(r.planId)}">Review and send &rarr;</button>
      <button class="far-card-discard" data-far-plan="${escHtml(r.planId)}">Discard</button>
    </div>`;
  card.querySelector('.far-card-view').addEventListener('click', () => farReviewPlan(r.planId));
  card.querySelector('.far-card-discard').addEventListener('click', () => farDiscardPlan(r.planId));
  return card;
}

// Carta timestamps arrive without an offset and are UTC. `new Date` reads a
// naive string as local, which prints the UTC wall clock as if it were the
// viewer's — 5:15 PM PT showing up as 12:15 AM the next day. Every formatter
// below uses local getters, so parsing as UTC is what makes them convert.
function farToDate(ts) {
  if (!ts) return null;
  const s = String(ts).trim().replace(' ', 'T');
  const hasTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s);
  const hasZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(s.slice(10));
  const d = new Date(hasTime && !hasZone ? s + 'Z' : s);
  return isNaN(d) ? null : d;
}

function farMs(ts) {
  const d = farToDate(ts);
  return d ? d.getTime() : 0;
}

// "21 Aug, 4:39 PM" — no seconds, and no locale-dependent field order.
function farStamp(ts) {
  const d = farToDate(ts);
  if (!d) return '';
  const h = d.getHours();
  const mins = String(d.getMinutes()).padStart(2, '0');
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${farDate(ts)}, ${hour12}:${mins} ${h < 12 ? 'AM' : 'PM'}`;
}

// "18 Aug" / "18 Aug 25" — the year only once it is not the current one.
function farDate(ts) {
  const d = farToDate(ts);
  if (!d) return '';
  const month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
  const now = new Date();
  const year = d.getFullYear() === now.getFullYear() ? '' : ' ' + String(d.getFullYear()).slice(-2);
  return `${d.getDate()} ${month}${year}`;
}

function farCard(r, withTime) {
  if (r.group === 'planned') return farPlanCard(r);
  const isTodo = r.group === 'todo';
  const card = document.createElement('div');
  card.className = 'far-card' + (isTodo ? ' far-card-todo' : '');
  card.innerHTML = `
    <div class="far-card-title">${escHtml(r.title ?? 'Request to Carta')}</div>
    <div class="far-card-status">
      <span class="far-dot${isTodo ? ' far-dot-todo' : ''}"></span>
      <span class="far-card-status-text">${escHtml(farStatusLabel(r))}</span>
    </div>
    <div class="far-card-footer">
      <button class="far-card-view">${isTodo ? 'Review' : 'View'} &rarr;</button>
      <span class="far-card-age">Requested ${escHtml(withTime ? farStamp(r.requested) : farDate(r.requested))}</span>
    </div>`;
  card.querySelector('.far-card-view').addEventListener('click', () => openFarThread(r.id));
  return card;
}

function farRenderGroup(key, rows) {
  const wrap = document.getElementById('far-group-' + key);
  const cards = document.getElementById('far-cards-' + key);
  if (!wrap || !cards) return;
  wrap.style.display = rows.length > 0 ? '' : 'none';
  const label = wrap.querySelector('.far-group-count');
  if (label) label.textContent = String(rows.length);
  cards.innerHTML = '';
  const sameDay = farSameDayKeys(rows);
  rows.forEach(r => cards.appendChild(farCard(r, sameDay.has(farDayKey(r.requested)))));
}

function farDayKey(ts) {
  const d = farToDate(ts);
  return d ? d.toDateString() : '';
}

// Cards that share a calendar day print the same date, which makes a re-sort look
// like nothing happened. Those get the time as well.
function farSameDayKeys(rows) {
  const counts = {};
  rows.forEach(r => { const k = farDayKey(r.requested); if (k) counts[k] = (counts[k] ?? 0) + 1; });
  return new Set(Object.keys(counts).filter(k => counts[k] > 1));
}

function farRenderDone(rows) {
  const wrap = document.getElementById('far-group-done');
  const list = document.getElementById('far-cards-done');
  if (!wrap || !list) return;
  wrap.style.display = rows.length > 0 ? '' : 'none';
  const label = wrap.querySelector('.far-group-count');
  if (label) label.textContent = String(rows.length);

  const toggle = document.getElementById('far-done-toggle');
  if (toggle) toggle.textContent = _farDoneOpen ? '▾' : '▸';
  list.style.display = _farDoneOpen ? '' : 'none';
  if (!_farDoneOpen) return;

  const shown = rows.slice(0, FAR_DONE_PREVIEW);
  const rest = rows.length - shown.length;
  list.innerHTML = shown.map(r => `
    <div class="far-done-row" data-far-id="${escHtml(r.id)}">
      <span class="far-done-check">✓</span>
      <span class="far-done-title">${escHtml(r.title ?? 'Request to Carta')}</span>
      <span class="far-done-age">${escHtml(farAgo(r.lastActivity))}</span>
    </div>`).join('') + (rest > 0 ? `<div class="far-done-more">+ ${rest} more</div>` : '');
  list.querySelectorAll('.far-done-row').forEach(el =>
    el.addEventListener('click', () => openFarThread(el.dataset.farId)));
}

function toggleFarDone() {
  trackWorkhub('click', 'CartaWorkhub.FundAdminRequests.ExpandCompleted');
  _farDoneOpen = !_farDoneOpen;
  renderFarSection();
}

// The composer never hides. With no queue to show it is still the off-ramp, and
// a section that vanishes entirely takes the entry point with it.
function renderFarSection() {
  const section = document.getElementById('far-section');
  if (!section) return;
  section.style.display = '';

  const rows = farSorted((_farRows ?? []).concat(farPlanRows()));
  farRenderGroup('planned', rows.filter(r => r.group === 'planned'));
  farRenderGroup('todo', rows.filter(r => r.group === 'todo'));
  farRenderGroup('progress', rows.filter(r => r.group === 'progress'));
  farRenderDone(rows.filter(r => r.group === 'done'));

  const sortWrap = document.getElementById('far-sort-wrap');
  if (sortWrap) sortWrap.style.display = rows.length > 1 ? '' : 'none';

  const note = document.getElementById('far-partial-note');
  if (note) note.style.display = _farPartial && rows.length > 0 ? '' : 'none';

  const empty = document.getElementById('far-empty');
  if (empty) empty.style.display = rows.length === 0 ? '' : 'none';

  const tip = document.getElementById('far-plan-tip');
  if (tip) tip.textContent = farPlanTip();
}


// ── Composer ──

function farEnsureOverlay(id, className) {
  let overlay = document.getElementById(id);
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = id;
    overlay.className = className;
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.classList.remove(className + '-visible');
    });
    document.body.appendChild(overlay);
  }
  return overlay;
}

// Tiles come from TASK_PRESETS in carta-workhub.config.js. Index, not the prompt
// text, rides the DOM so quotes and newlines cannot break out of the attribute.
function farPresetTiles() {
  const presets = typeof TASK_PRESETS === 'undefined' ? [] : TASK_PRESETS;
  return presets.map((p, i) =>
    `<button type="button" class="far-preset" data-far-preset="${i}"
       onclick="applyFarPreset(${i})">${escHtml(p.name)}</button>`).join('');
}

function applyFarPreset(i) {
  const preset = (typeof TASK_PRESETS === 'undefined' ? [] : TASK_PRESETS)[i];
  const box = document.getElementById('far-compose-text');
  if (!preset || !box) return;
  trackWorkhub('click', 'CartaWorkhub.FundAdminRequests.Preset');
  _farPresetName = preset.name;
  box.value = preset.template.join('\n');
  box.focus();
  // Land on the first blank, not the end — that is the next thing to fill in.
  const firstBlank = box.value.indexOf(':\n');
  const at = firstBlank === -1 ? box.value.length : firstBlank + 1;
  box.selectionStart = box.selectionEnd = at;
}

function openFarCompose() {
  trackWorkhub('click', 'CartaWorkhub.FundAdminRequests.Compose');
  _farPlanId = null;
  _farPresetName = null;
  const overlay = farEnsureOverlay('far-compose-overlay', 'far-overlay');
  overlay.innerHTML = `
    <div class="far-panel">
      <div class="far-panel-header">
        <span class="far-panel-title">Ask Carta to do something</span>
        <button class="far-panel-close" onclick="closeFarCompose()" aria-label="Close">✕</button>
      </div>
      <div class="far-panel-body">
        <p class="far-compose-hint">Describe what you need, or start from one of these.</p>
        <div class="far-presets">${farPresetTiles()}</div>
        <textarea id="far-compose-text" class="far-textarea" rows="6"
          placeholder="Anything your fund admin team can do — capital calls, investments, valuations, payments, transfers, or closes."></textarea>
      </div>
      <div class="far-panel-footer">
        <button class="far-btn-secondary" onclick="closeFarCompose()">Cancel</button>
        <button class="far-btn-secondary" id="far-compose-plan" onclick="farSavePlan()">Save as plan</button>
        <button class="far-btn-primary" id="far-compose-review" onclick="reviewFarCompose()">Review request</button>
      </div>
      <p class="far-compose-caveat">${farPlanScopeNote()}</p>
    </div>`;
  overlay.classList.add('far-overlay-visible');
  document.getElementById('far-compose-text')?.focus();
}

// ── Request analysis ──
// Deterministic, not inferred: the artifact has no model. Each preset declares
// what the team needs and a pattern that proves it is present.

function farPresets() {
  return typeof TASK_PRESETS === 'undefined' ? [] : TASK_PRESETS;
}

// Label-only lines ("Due date:") are the template, not an answer. Dropping them
// means an untouched template reads as empty rather than as fully specified.
function farAnswered(message) {
  return String(message ?? '')
    .split('\n')
    .filter(l => !/^\s*[A-Za-z][^:]*:\s*$/.test(l))
    .join('\n');
}

function farInferType(message) {
  const body = String(message ?? '').toLowerCase();
  for (const preset of farPresets()) {
    if (!preset.detect) continue;
    if (new RegExp(preset.detect, 'i').test(body)) return preset;
  }
  return null;
}

// Returns the requirements this request has not met yet.
function farOpenItems(message) {
  const preset = farInferType(message);
  if (!preset || !Array.isArray(preset.requires)) return [];
  const body = farAnswered(message);
  return preset.requires.filter(req => !new RegExp(req.has, 'i').test(body));
}

// Puts the type on its own first line unless the message already opens with it.
function farWithTypeLine(message, label) {
  if (!label || !message) return message;
  const first = message.split('\n')[0].trim().toLowerCase().replace(/[.:]$/, '');
  if (first === label.toLowerCase()) return message;
  return `${label}\n${message}`;
}

function farOpenItemsHtml(items) {
  if (items.length === 0) return '';
  const names = items.map(it => escHtml(it.label)).join(', ');
  return `<div class="far-items">
      <p class="far-items-title">Your Carta team will probably ask for ${names}.</p>
      <textarea id="far-item-extra" class="far-textarea far-textarea-short" rows="3"
        placeholder="Add it here, or send as is and they will follow up."></textarea>
    </div>`;
}

// Nothing leaves Carta without the sender reading it back first, so Send is two
// steps: the draft is shown verbatim and the send button lives only on step two.
let _farDraft = '';
let _farPlanId = null;
let _farPresetName = null;

// Capture, then render. Answering an open item re-renders without re-reading the
// composer, so the panel never depends on the textarea still being there.
function reviewFarCompose() {
  const message = (document.getElementById('far-compose-text')?.value ?? '').trim();
  if (!message) { showToast('Add a description before sending.'); return; }
  _farDraft = message;
  trackWorkhub('click', 'CartaWorkhub.FundAdminRequests.Review');
  farRenderReview();
}

function farRenderReview() {
  const message = _farDraft;
  const overlay = farEnsureOverlay('far-compose-overlay', 'far-overlay');
  overlay.innerHTML = `
    <div class="far-panel">
      <div class="far-panel-header">
        <span class="far-panel-title">Review summary</span>
        <button class="far-panel-close" onclick="closeFarCompose()" aria-label="Close">✕</button>
      </div>
      <div class="far-panel-body">
        <p class="far-compose-hint">Summary of what goes to your Carta fund admin team. They pick it up, start the work, and reply here.</p>
        <div class="far-review" id="far-review-text">${escHtml(message)}</div>
        ${farOpenItemsHtml(farOpenItems(message))}
      </div>
      <div class="far-panel-footer">
        <button class="far-btn-secondary" onclick="openFarComposeWithDraft()">Back to edit</button>
        <button class="far-btn-primary" id="far-compose-send" onclick="submitFarCompose()">Send to Carta</button>
      </div>
    </div>`;
  overlay.classList.add('far-overlay-visible');
  document.getElementById('far-compose-send')?.focus();
}

// Back from review keeps what they wrote — retyping it would be its own bug.
function openFarComposeWithDraft() {
  const draft = _farDraft;
  openFarCompose();
  const box = document.getElementById('far-compose-text');
  if (box) { box.value = draft; box.focus(); }
}

function closeFarCompose() {
  document.getElementById('far-compose-overlay')?.classList.remove('far-overlay-visible');
}

async function submitFarCompose() {
  // Reads the draft captured at review, not the textarea — step two replaced it.
  const extra = (document.getElementById('far-item-extra')?.value ?? '').trim();
  if (extra) _farDraft = `${_farDraft.replace(/\s+$/, '')}\n${extra}`;
  const label = farRequestLabel(_farDraft);
  const message = farWithTypeLine(_farDraft.trim(), label);
  if (!message) { showToast('Add a description before sending.'); return; }

  trackWorkhub('click', 'CartaWorkhub.FundAdminRequests.Send');
  const btn = document.getElementById('far-compose-send');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

  try {
    const res = await _mcp('mutate', {
      command: 'fa:create:fund-admin-message',
      params: { message },
    });
    if (res.isError) throw new Error(res.content?.[0]?.text ?? 'Unknown error');
    const id = farWorkflowId(res);
    if (id == null) throw new Error('no workflow id returned');

    farRecordId(id);
    farRememberType(id, label);
    if (_farPlanId) { farDropPlan(_farPlanId); _farPlanId = null; }
    // Shown immediately rather than after a refetch: the list command lags the
    // write, and a request that vanishes after sending reads as a failure.
    const now = new Date().toISOString();
    _farRows = (_farRows ?? []).concat({
      id,
      title: label ?? farTitleFrom(message),
      group: 'progress',
      state: 'pending-carta',
      canceled: false,
      // Without `requested` the card shows a blank date and sorts to the bottom.
      requested: now,
      lastActivity: now,
      webUrl: null,
    });
    renderFarSection();
    farRenderSent();
  } catch (e) {
    console.error('[far send error]', e);
    showToast('Could not send that to Carta — please try again.');
    if (btn) { btn.disabled = false; btn.textContent = 'Send to Carta'; }
  }
}

// ── Thread overlay ──

let _farOpenThreadId = null;

async function openFarThread(workflowId) {
  trackWorkhub('click', 'CartaWorkhub.FundAdminRequests.OpenThread');
  _farOpenThreadId = workflowId;
  const row = (_farRows ?? []).find(r => String(r.id) === String(workflowId));
  const overlay = farEnsureOverlay('far-thread-overlay', 'far-overlay');
  overlay.innerHTML = `
    <div class="far-panel far-panel-thread">
      <div class="far-panel-header">
        <span class="far-panel-title">${escHtml(row?.title ?? 'Request to Carta')}</span>
        <button class="far-panel-close" onclick="closeFarThread()" aria-label="Close">✕</button>
      </div>
      <div class="far-panel-body" id="far-thread-body">
        <div class="loading-row" style="padding:20px 0;">Loading conversation…</div>
      </div>
      <div class="far-panel-footer far-thread-footer">
        <textarea id="far-reply-text" class="far-textarea far-textarea-reply" rows="3"
          placeholder="Reply to your Carta team…"></textarea>
        <div class="far-thread-actions">
          <button class="far-btn-secondary" onclick="closeFarThread()">Close</button>
          <button class="far-btn-primary" id="far-reply-send" onclick="submitFarReply()">Send</button>
        </div>
      </div>
    </div>`;
  overlay.classList.add('far-overlay-visible');

  const msgs = await farFetchThread(workflowId);
  const body = document.getElementById('far-thread-body');
  // A second card was opened while this thread was in flight.
  if (!body || String(_farOpenThreadId) !== String(workflowId)) return;

  if (!msgs) {
    body.innerHTML = '<div class="loading-row" style="padding:16px 0;">Conversation failed to load. Close and reopen to retry.</div>';
    return;
  }
  body.innerHTML = msgs.map((m, i) => farBubble(m, row?.webUrl, i, row?.title)).join('');
}

// Staff messages render as their client-facing text plus a link into Carta —
// never Carta's internal agent output, run logs, or system metadata.
//
// Attribution is positional because it cannot be read from the payload: every
// message comes back with the same author and is_staff true, Carta's replies
// included. Index 0 is always the request that opened the thread, and a reply
// sent in this session is appended with isStaff false.
function farBubble(m, webUrl, i, title) {
  const mine = i === 0 || m.isStaff === false;
  const side = mine ? 'far-bubble-you' : 'far-bubble-carta';
  const who = mine ? 'You' : 'Carta';
  const cta = !mine && webUrl
    ? `<a class="far-bubble-cta" href="${escHtml(webUrl)}" target="_blank" rel="noopener">Review in Carta &rarr;</a>`
    : '';
  return `
    <div class="far-bubble ${side}">
      <div class="far-bubble-head">
        <span class="far-bubble-who">${who}</span>
        <span class="far-bubble-at">${escHtml(farStamp(m.at))}</span>
      </div>
      ${farBodyHtml(m, mine, title)}
      ${cta}
    </div>`;
}

// The sender's own opening message is a filled template; a reply is prose.
function farBodyHtml(m, mine, title) {
  const source = { content_html: m.html, content_text: m.text };
  if (mine) {
    // Field parsing stays on the flat text — its label regex is line-oriented.
    const { fields, lead, rest } = farParseFields(farMessageBlocks(source).join('\n\n'));
    if (fields.length > 0) {
      const rows = fields.map(f =>
        `<div class="far-field-label">${escHtml(f.label)}</div>` +
        `<div class="far-field-value">${farLinkifyText(f.value)}</div>`).join('');
      // Drop the lead only when the panel heading already says it.
      const dup = farSameHeading(lead, title);
      return (lead && !dup ? `<p class="far-bubble-p">${farLinkifyText(lead)}</p>` : '') +
        `<div class="far-fields">${rows}</div>` +
        (rest ? `<p class="far-bubble-p">${farLinkifyText(rest)}</p>` : '');
    }
  }
  return farRichBlocks(source).map(b => `<p class="far-bubble-p">${farPartsHtml(b)}</p>`).join('');
}

function farSameHeading(a, b) {
  const norm = v => String(v ?? '').trim().replace(/[.:]+$/, '').toLowerCase();
  return !!norm(a) && norm(a) === norm(b);
}

function closeFarThread() {
  _farOpenThreadId = null;
  document.getElementById('far-thread-overlay')?.classList.remove('far-overlay-visible');
}

async function submitFarReply() {
  const workflowId = _farOpenThreadId;
  const box = document.getElementById('far-reply-text');
  const message = (box?.value ?? '').trim();
  if (!workflowId || !message) { showToast('Write a reply before sending.'); return; }

  trackWorkhub('click', 'CartaWorkhub.FundAdminRequests.Reply');
  const btn = document.getElementById('far-reply-send');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }

  try {
    const res = await _mcp('mutate', {
      command: 'fa:create:workflow-message',
      params: { workflow_id: Number(workflowId), message },
    });
    if (res.isError) throw new Error(res.content?.[0]?.text ?? 'Unknown error');

    // The thread is cached, so append rather than refetch — and the ball is back
    // with Carta, so the card leaves "Tasks to complete".
    const msgs = _farThreadCache[workflowId] ?? [];
    msgs.push({ id: null, text: message, html: '', isStaff: false, author: null, at: new Date().toISOString() });
    _farThreadCache[workflowId] = msgs;
    const row = (_farRows ?? []).find(r => String(r.id) === String(workflowId));
    if (row) { row.group = 'progress'; row.state = 'pending-carta'; row.lastActivity = new Date().toISOString(); }

    if (box) box.value = '';
    const body = document.getElementById('far-thread-body');
    if (body) body.innerHTML = msgs.map((m, i) => farBubble(m, row?.webUrl, i, row?.title)).join('');
    showToast('Reply sent to your Carta team.');
    renderFarSection();
  } catch (e) {
    console.error('[far reply error]', e);
    showToast('Could not send that reply — please try again.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Send'; }
  }
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (document.getElementById('far-thread-overlay')?.classList.contains('far-overlay-visible')) {
    closeFarThread();
    return;
  }
  if (document.getElementById('far-compose-overlay')?.classList.contains('far-overlay-visible')) {
    closeFarCompose();
  }
});
