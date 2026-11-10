// ── KYC cards ──
//
// The KYC forms waiting on the viewer, from two reads: their own KYC tasks (an invited fund's
// KYC, an LP's identity verification, an entity's), and the active firm's fund KYC tasks
// assigned to them (fund-admin's "Complete KYC due diligence"). Both are gated server-side, so
// each is read only when search_tools offers it, and one that is refused or fails leaves its
// cards out while the rest of the queue shows. A card opens a chat that fills the form in
// with this skill's KYC branch, beside the form itself.

const KYC_OWN_TASKS_COMMAND = "kyc:list:tasks";
const KYC_FUND_TASKS_COMMAND = "fa:list:fund-kyc-task";
const KYC_COMPLETION_COMMAND = "kyc:get:evaluation_completion";
// Completion reads out at once: enough to fill a page of cards quickly without a burst.
const KYC_COMPLETION_READS_AT_ONCE = 3;
const KYC_SKILL = "carta-investors:carta-workhub-build";
// fund-admin's fund KYC workflow; its rows name the fund they are for.
const KYC_FUND_TASK_TYPE = "review-kyc";
const KYC_SUBMITTED = "EVALUATION_COMPLETION_STATUS_SUBMITTED";
const KYC_COMPLETE = "EVALUATION_COMPLETION_STATUS_COMPLETE";
const KYC_IN_PROGRESS = "EVALUATION_COMPLETION_STATUS_IN_PROGRESS";

// The card title, by task type, as Carta's own task pages name each.
const KYC_TASK_TITLES = {
  [KYC_FUND_TASK_TYPE]: "Complete KYC due diligence",
  "kyc-invite-vc-fund": "Complete KYC due diligence",
  "kyc-invite-fund-admin-lps-domestic": "Identity verification",
  "kyc-invite-existing-entity": "Complete identity verification",
};
const KYC_STATUS_LABELS = {
  EVALUATION_COMPLETION_STATUS_NOT_STARTED: "Not started",
  [KYC_IN_PROGRESS]: "In progress",
  [KYC_COMPLETE]: "Ready to check and submit",
  [KYC_SUBMITTED]: "Submitted",
};
const KYC_REOPEN_LABELS = {
  REOPEN_REASON_PERIODIC_REVIEW: "Reopened for periodic review",
  REOPEN_REASON_ONBOARDING: "Reopened for onboarding",
};

// The tasks a read returned, or [] for a refused, failed or unreadable one.
function kycTasksFrom(res) {
  if (!res || res.isError) return [];
  for (const c of _mcpResultCandidates(res)) {
    if (c && Array.isArray(c.tasks)) return c.tasks.filter(t => t && t.evaluation_reference_id);
  }
  return [];
}

function kycRead(command, params) {
  return mcpCommandAvailable(command)
    .then(ok => (ok ? mcpRead(command, params) : null))
    .then(kycTasksFrom)
    .catch(e => { console.error(`[kyc] ${command} —`, e); return []; });
}

// One task per evaluation: a fund KYC both reads return shows once, as the fund's row, which
// names the fund the form is for.
function kycMergeTasks(own, fund) {
  const byEvaluation = new Map();
  for (const t of own) byEvaluation.set(String(t.evaluation_reference_id).toLowerCase(), t);
  for (const t of fund) byEvaluation.set(String(t.evaluation_reference_id).toLowerCase(), t);
  return [...byEvaluation.values()];
}

function kycEntityName(t) {
  return String(t.entity_name ?? t.partner_name ?? t.fund_name ?? "").trim() || null;
}

// The form's status, for the card's date line.
function kycFootnote(t) {
  return KYC_STATUS_LABELS[t.completion_status] ?? null;
}

// Why the form is back with the viewer. It leads the card's own line, which wraps, so the date
// line's ellipsis never cuts it off.
function kycReopenLabel(t) {
  return t.completion_reopen ? (KYC_REOPEN_LABELS[t.completion_reopen.reason] ?? "Reopened") : null;
}

// ── What a form still lacks ──
//
// One line under a card's status, from the form's completion: counts only, since each missing
// entry's label names a party's field. A read that is not offered, refused (a v1 form) or fails
// leaves the card as it was.

const kycPlural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const kycList = (v) => (Array.isArray(v) ? v : []);

function kycCompletionFrom(res) {
  if (!res || res.isError) return null;
  for (const c of _mcpResultCandidates(res)) {
    if (c && typeof c === "object" && "status" in c && Array.isArray(c.parties)) return c;
  }
  return null;
}

// "Missing 4 answers · 2 documents · 1 party to add or fix", or the reviewer's request on a
// reopened form whose lists are all empty, or null when there is nothing to say.
function kycLackLine(completion, reopened) {
  const missing = kycList(completion.parties).flatMap(p => kycList(p && p.missing));
  const answers = missing.filter(m => m && m.fieldId).length;
  const documents = missing.filter(m => m && !m.fieldId && (m.fileType || kycList(m.anyOf).length)).length;
  const parties = kycList(completion.rosterShortfalls).length + kycList(completion.ownershipShortfalls).length
    + kycList(completion.roleMismatches).length;
  const lacks = [];
  if (answers || documents) {
    lacks.push("Missing " + [
      answers ? kycPlural(answers, "answer", "answers") : null,
      documents ? kycPlural(documents, "document", "documents") : null,
    ].filter(Boolean).join(" · "));
  }
  if (parties) lacks.push(kycPlural(parties, "party", "parties") + " to add or fix");
  if (lacks.length) return lacks.join(" · ");
  if (completion.status === KYC_IN_PROGRESS && (reopened || completion.reopen)) {
    return "Open the form to see what the reviewer asked";
  }
  return null;
}

// Runs `work` over `items`, at most `limit` at a time.
async function kycEachLimited(items, limit, work) {
  let next = 0;
  const runner = async () => { while (next < items.length) await work(items[next++]); };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
}

// Fills each open card's lack line. A form already complete or submitted needs no read.
async function kycAddLackLines(rows) {
  const open = rows.filter(r => r.kyc && r.kyc.status !== KYC_COMPLETE);
  if (!open.length || !(await mcpCommandAvailable(KYC_COMPLETION_COMMAND).catch(() => false))) return;
  await kycEachLimited(open, KYC_COMPLETION_READS_AT_ONCE, async (r) => {
    try {
      const completion = kycCompletionFrom(await mcpRead(KYC_COMPLETION_COMMAND, { evaluation_id: r.kyc.evaluationId }));
      if (completion) {
        r.detail = [r.kyc.reopenLabel, kycLackLine(completion, Boolean(r.kyc.reopenLabel))]
          .filter(Boolean).join(" · ") || null;
      }
    } catch (e) {
      console.error(`[kyc] ${KYC_COMPLETION_COMMAND} —`, e);
    }
  });
}

// What the new chat is prefilled with: the skill and its KYC branch, the evaluation, and the
// read whose companion_url is the task's form, to open beside the chat: the fund read on its
// fund for a fund task, the viewer's own task list on that evaluation for their own.
function kycPrompt(k, firm) {
  const name = k.entity || "this KYC task";
  if (k.fundUuid) {
    const where = firm ? ` (${firm})` : "";
    return `Fill in the Carta KYC form for ${name}${where} with the ${KYC_SKILL} skill's KYC branch, `
      + `on evaluation_reference_id "${k.evaluationId}" and fund_uuid "${k.fundUuid}": call read_tool with name `
      + `"${mcpToolName(KYC_FUND_TASKS_COMMAND)}" and arguments ${JSON.stringify({ fund_uuid: k.fundUuid })}, `
      + "then open its companion_url beside this chat as its next_step says.";
  }
  return `Fill in the Carta KYC form for ${name} with the ${KYC_SKILL} skill's KYC branch, `
    + `on evaluation_reference_id "${k.evaluationId}": call read_tool with name `
    + `"${mcpToolName(KYC_OWN_TASKS_COMMAND)}" and arguments ${JSON.stringify({ evaluation_id: k.evaluationId })}, `
    + "then open its companion_url beside this chat as its next_step says.";
}

// A queue card per task. A submitted form is out of the viewer's hands, so it waits With
// Carta and opens nothing; every other one is the viewer's to fill in.
function kycQueueRow(t) {
  const submitted = t.completion_status === KYC_SUBMITTED;
  const fund = t.task_type === KYC_FUND_TASK_TYPE && t.fund_uuid ? String(t.fund_uuid) : null;
  return {
    id: `kyc-${t.evaluation_reference_id}`,
    title: KYC_TASK_TITLES[t.task_type] ?? "Complete KYC",
    subtitle: kycEntityName(t),
    tab: submitted ? "progress" : "todo",
    displayGroup: TASK_GROUP_KYC,
    state: submitted ? "pending-carta" : "pending-customer",
    canceled: false,
    needsTitle: false,
    requested: t.requested_on ?? null,
    lastActivity: t.requested_on ?? null,
    footnote: kycFootnote(t),
    webUrl: null,
    detail: kycReopenLabel(t),
    kyc: submitted ? null : {
      evaluationId: String(t.evaluation_reference_id),
      fundUuid: fund,
      entity: kycEntityName(t),
      status: t.completion_status ?? null,
      reopenLabel: kycReopenLabel(t),
    },
  };
}

async function kycFetchRows() {
  const [own, fund] = await Promise.all([
    kycRead(KYC_OWN_TASKS_COMMAND, {}),
    kycRead(KYC_FUND_TASKS_COMMAND, {}),
  ]);
  const rows = kycMergeTasks(own, fund).map(kycQueueRow);
  await kycAddLackLines(rows);
  return rows;
}

// Every load replaces the KYC cards, so a task finished elsewhere leaves the queue.
async function kycAttachRows() {
  const rows = await kycFetchRows();
  _farRows = (_farRows || []).filter(r => !String(r.id).startsWith("kyc-")).concat(rows);
  return rows.length > 0;
}

function kycOpenInChat(k) {
  trackWorkhub("click", "CartaWorkhub.Queue.OpenKycInChat");
  openClaudeChat(kycPrompt(k, _farFirmName));
}
