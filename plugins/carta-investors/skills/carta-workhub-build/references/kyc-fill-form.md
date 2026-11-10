# Fill in a Carta KYC form

Carta Workhub's KYC branch: `carta-workhub-build/SKILL.md` sends a Workhub KYC card's chat, or
a user who asks to fill in their KYC, here. Its steps run inside this skill.

Help the signed-in user fill in **their own** KYC forms, the way a compliance analyst would:
an investor's own KYC tasks, or, for a GP, the KYC of one of their firm's funds (Step 1b). Work
in a loop: say what each open task still needs, read the documents the user shares against
what the form asks, save the answers the user confirms, and go round again until nothing is
left that Claude can fill. Then, in a form reloaded after the last save, the user does
everything only the form can (Step 2) and submits each form themselves.

## When to Use

- "Help me fill in my KYC form."
- "Complete my Carta identity verification from these documents."
- "What does my KYC form still need?"
- "Here's my passport and our formation documents, can you do the KYC?"
- "This isn't working, I want to give feedback on the KYC form."
- "Help me complete our fund's KYC due diligence."
- A Carta Workhub KYC card's prompt, which names this skill's KYC branch and an
  `evaluation_reference_id`, with a `fund_uuid` for a fund's KYC.

## Rules

- **Never submit the form.** No command here submits it. Saving answers only fills it in;
  the user checks the form and presses Submit themselves.
- **Upload only what the user shared, after asking.** In Claude Code or Cowork, upload a
  document the user gave you as a file on their computer, once they confirm it (Step 7). In
  claude.ai chat there is no `Bash`, so every document is the user's to upload in the form:
  tell them which one, for which party. Never upload a file the user did not give you.
- **Show before you save.** Every answer goes to the user in a table first. Save only
  what they confirm, and save their correction instead when they give one.
- **Only what a document or the user states.** Never guess, infer or fill a value from
  memory. A field nothing answers stays empty and goes on the "still needed" list.
- **Only the user's own tasks.** Work only on an evaluation `kyc__list__tasks` returned, or,
  for a GP, one `fa__list__fund-kyc-task` returned (Step 1b). The write commands refuse any other.
- **Keep identity numbers out of the chat.** When you show a tax id, passport or national
  id number, show its last four characters only.
- **One of you at a time.** A save writes the party's whole record, and the form saves its
  own copy whenever a step advances, so each can undo the other. While Claude saves (Steps
  4–8), tell the user the form is for looking only (no uploads, no added parties, no edits),
  whenever you list what they must do in it and when it opens beside the chat. The user acts
  in the form only at Step 9, after reloading it. Once Step 9 starts, save again only after
  the user says they have finished in the form, and ask them to reload it before they edit it
  again.
- **The form has the last word.** It runs checks nothing here can, such as a proof of address
  dated within the last six months, and an upload from here skips them. Before anyone uploads a
  time-limited document, tell the user its date and that a reviewer may refuse one that is too
  old.

## Step 1 — Open the tasks page and say what each task needs

```
read_tool({"name": "kyc__list__tasks", "arguments": {}})
```

The result leads with `companion_url`, the user's KYC tasks page: follow its `how_to_reply`
and open it, so the user sees the same list beside the chat. Each task carries `task_type`,
`evaluation_reference_id`, a fund, partner or entity name, `form_url` (the task's own form),
`completion_status` and `completion_reopen`.

A Carta Workhub KYC card's prompt names this read with one task's `evaluation_id`:

```
read_tool({"name": "kyc__list__tasks", "arguments": {"evaluation_id": "<evaluation_reference_id>"}})
```

Then the result leads with `next_step` and `companion_url`, that task's own form: open it beside
the chat as `next_step` says, instead of the tasks page, and start with that task without asking
which. When the list no longer holds it, say it is no longer waiting on them and go on with the
rest.

Tell the user, task by task, by its fund or entity name (never the reference id):

| `completion_status` | Say |
| --- | --- |
| `EVALUATION_COMPLETION_STATUS_NOT_STARTED` | Not started |
| `EVALUATION_COMPLETION_STATUS_IN_PROGRESS` | In progress, and what is still missing, sorted as Step 2 shows (the form-only group waits for Step 9) |
| `EVALUATION_COMPLETION_STATUS_COMPLETE` | Ready for them to check and submit in the form |
| `EVALUATION_COMPLETION_STATUS_SUBMITTED` | Submitted, nothing to do |
| `null` | Its status could not be read; offer to look at it anyway |

When `completion_reopen` is set, say why the task is back with them under it, e.g.
"reopened by compliance for periodic review" (`reason`, `reopenedByRole`).

- No tasks: tell the user nothing is waiting on them, and stop.
- Several unfinished: ask with `AskUserQuestion` which to start with, one option per task,
  leaving out any task already found not to be a v2 form.

If `kyc__list__tasks` is not found, KYC through Claude is not available for this account
yet. Tell the user to fill in the form on Carta, and stop.

### Step 1b — A GP's fund KYC

Go here instead of the read above when the prompt comes from a Carta Workhub KYC card for a fund
(it names `fa__list__fund-kyc-task`, a `fund_uuid` and the fund's `evaluation_reference_id`), or a GP asks about their fund's KYC ("Complete KYC
due diligence"). Read the firm's fund KYC tasks assigned to the user, for the fund the prompt
names when it names one:

```
read_tool({"name": "fa__list__fund-kyc-task", "arguments": {"fund_uuid": "<fund_uuid>"}})
```

Leave out `fund_uuid` to list every fund's task. The read is for the active Carta firm: when it
says no firm is set, do what its message says and read again; never list another firm's funds.
With `fund_uuid`, the result leads with `companion_url`, that fund's KYC
form: follow its `how_to_reply` and open it beside the chat. Each task carries `task_type`,
`evaluation_reference_id`, `fund_name`, `form_url`, `completion_status` and `completion_reopen`,
so say what each needs with the table above, by `fund_name`.

From here, a fund task is the user's task for every later step: pass its
`evaluation_reference_id` as `evaluation_id`, and its form is the one the user reloads,
checks and submits (`form_url`, or the `companion_url` each save returns). The fund is the
evaluation's main entity, and its general partners and large investors are its parties.

- No tasks: tell the user no fund KYC is waiting on them at this firm, and stop.
- The user named a fund the result has no task for: tell them no fund KYC is waiting on them
  for that fund, and stop. Never start another fund's task in its place.
- Several unfinished: ask with `AskUserQuestion` which fund to start with, one option per task,
  by `fund_name`, leaving out any task already found not to be a v2 form.
- `fa__list__fund-kyc-task` not found: KYC through Claude is not available for this account
  yet. Tell the user to fill in the fund's KYC on Carta, and stop.

## Step 2 — Read what the task still needs, and who can fill it

```
read_tool({"name": "kyc__get__evaluation_completion",
           "arguments": {"evaluation_id": "<evaluation_reference_id>"}})
```

This is the same reading the tasks page shows:

| Part | What it says |
| --- | --- |
| `parties[].missing[]` | per party (`entityId`, `relationType`), each required field (`fieldId`) and document (`fileType`, `anyOf`) not yet answered, with the form's `label` |
| `rosterShortfalls[]` | a role with too few or too many people or entities (`minCount`/`maxCount`) |
| `ownershipShortfalls[]` | a member whose ownership is not stated or is below the role's `minOwnershipPct` |
| `roleMismatches[]` | a member of a kind its role does not take, or in a role no rule defines |
| `reopen` | why the form is back with the user |

Sort every item into one of two groups, and say both to the user, and that the second group
waits for Step 9:

- **Claude can fill it:** a field `kyc__mutate__answers` takes (Step 6), on a party already on
  the form (it has an `entityId` here), and a member's ownership in `ownershipShortfalls`. With
  `Bash` (Claude Code or Cowork), also a document for such a party that the user shares as a
  file (Step 7), unless it is already on the Step 9 list: a document declined, refused or
  failed in this session is left for the form and never asked about or sent again. The same
  goes for a field the form answers with a file, listed below.
- **Only the form can fill it:** every document in claude.ai chat, and any the user does not
  share as a file; a person or entity a `rosterShortfalls` role still needs, or one in
  `roleMismatches` (the user adds, removes or changes it in the form); the nature of business
  (`businessNature`), which the form picks from a closed list Carta's API does not give, so never
  propose a value for it; and the sections Step 6 leaves to the form.

A missing field with one of these `fieldId`s is answered by a file, not a value. Treat it as a
document, under the `fileType` shown (the form's own field-to-document table). Uploading the file
answers the field: a certificate uploaded as `FILE_TYPE_FORMATION_DOCUMENT` clears
`formationDocuments`.

| `fieldId` | Upload as |
| --- | --- |
| `documentVerification` | `FILE_TYPE_GOVERNMENT_ISSUED_ID`: that party's passport or other government-issued ID |
| `governmentId` | `FILE_TYPE_GOVERNMENT_ISSUED_ID` |
| `proofOfAddress` | `FILE_TYPE_PROOF_OF_ADDRESS` |
| `w8w9` | `FILE_TYPE_TAX_DOCUMENT` |
| `formationDocuments` | `FILE_TYPE_FORMATION_DOCUMENT`: a certificate of incorporation or other formation document |
| `certificateOfIncorporation` | `FILE_TYPE_CERTIFICATE_OF_INCORPORATION` |
| `certificateOfRegistration` | `FILE_TYPE_CERTIFICATE_OF_REGISTRATION` |
| `memorandumAndArticlesOfAssociation` | `FILE_TYPE_MEMORANDUM_AND_ARTCILES_OF_ASSOCIATION` (the type is spelled so) |
| `partnershipAgreement` | `FILE_TYPE_PARTNERSHIP_AGREEMENT` |
| `declarationOfTrust` | `FILE_TYPE_DECLARATION_OF_TRUST` |
| `registerOfShareholders` | `FILE_TYPE_REGISTER_OF_SHAREHOLDERS` |
| `registerOfDirectors` | `FILE_TYPE_REGISTER_OF_DIRECTORS` |
| `registerOfPartners` | `FILE_TYPE_REGISTER_OF_PARTNERS` |
| `structureChart` | `FILE_TYPE_STRUCTURE_CHART`: the ownership chart |
| `signatoryList` | `FILE_TYPE_SIGNATORY_LIST` |
| `certifiedBoardApproval` | `FILE_TYPE_CERTIFIED_BOARD_APPROVAL` |
| `certificateOfIncumbency` | `FILE_TYPE_CERTIFICATE_OF_INCUMBENCY` |
| `proofOfWealth` | `FILE_TYPE_PROOF_OF_WEALTH` |
| `comfortLetter` | `FILE_TYPE_COMFORT_LETTER` |
| `proofOfRegulationDoc` | `FILE_TYPE_PROOF_OF_REGULATION` |
| `selfCertificationForm` | `FILE_TYPE_CRS_SELF_CERTIFICATION` |
| `proofOfProfessionalClient` | `FILE_TYPE_PROOF_OF_PROFESSIONAL_CLIENT` |
| `proofOfWellInformed` | `FILE_TYPE_PROOF_OF_WELL_INFORMED` |
| `proofOfInstitutionalStatus` | `FILE_TYPE_PROOF_OF_INSTITUTIONAL_STATUS` |
| `ppmOrOfferingMemorandum` | `FILE_TYPE_OFFERING_MEMORANDUM` |

Step 3 describes `documentVerification` as nothing to supply, because the form fills it with an
identity check of its own. A government ID uploaded in Step 7 answers it just the same, and the
form then no longer asks for it. A US individual's form often lists no document at all and asks
for the ID only this way.

A roster shortfall is for the user to fix in the form at Step 9. If they then ask you to fill
the new party, read this again for its `entityId` once they say they have finished in the
form.

A form returned for more information can read `IN_PROGRESS` with every list empty: what the
reviewer asked for is not listed here. Tell the user to open its form (the task's `form_url`) and
read the request there.

## Step 3 — Read what the form asks for

```
read_tool({"name": "kyc__get__form_configuration",
           "arguments": {"evaluation_id": "<evaluation_reference_id>"}})
```

It gives the shapes and labels of what Step 2 listed as missing. It describes the investor
(the main party), in three parts:

| Part | What it says |
| --- | --- |
| `checks[].fields[]` | the questions: `fieldId`, `required`, `name`, `description` |
| `checks[].documents[]` | the documents: `fileType`, `required`, `anyOf` (any one of these types will do), `fieldId` for a document the firm wrote itself |
| `supportingEntityRules[]` | the people or entities the investor must add in the form: `relationType` (beneficial owner, control person, trustee…), `roleKey` for a role the firm wrote itself (empty for a standard role), `minCount`/`maxCount`, `minOwnershipPct` |

This read describes the investor only. To learn what a saved person or entity is asked for, read
it again with `entity_id` (and, for a party that holds several roles, `relation_type` and
`role_key` from the rule Step 6 has the user pick), once per
party: never take a supporting party's questions from any other part of the investor's read.

## Step 4 — Read the user's documents

Ask the user for the documents that answer what Claude can fill: an ID for each individual,
formation documents and an ownership chart for an entity. Read each one they share with
`Read`, and note what it states against each `fieldId`, per party, keeping which document each
answer came from.

With `Bash` (Claude Code or Cowork), ask for them as files on the user's computer, so the ones
the form asks for can be uploaded too (Step 7). Keep each file's path with what you read from
it.

## Step 5 — Propose the answers

Show one table per party: the question's `name`, the proposed value, and the document it
came from, masked as the Rules say. Below it, list what is still needed.

Ask with `AskUserQuestion`: `Save these answers` / `I'll correct some first` /
`Stop`. Save only on `Save these answers`, and ask again after any correction.

## Step 6 — Save the answers

One call per party. The field id **is** the property name, placed under `individual` or
`institution` by the party's kind, except the keys the table below puts beside them:

```
call_tool({"name": "kyc__mutate__answers",
           "arguments": {"evaluation_id": "<evaluation_reference_id>",
                         "answers": {"individual": {"firstName": "…", "lastName": "…",
                                                    "dateOfBirth": {"year": 1990, "month": 1, "day": 2}}}}})
```

Add `"entity_id"` (from Step 2) to save a supporting party's answers. Never save a supporting
party's answers without it: they would land on the investor. Only the fields you send change;
every other answer stays as it was.

A party that holds several roles (a beneficial owner who is also a control person, say) needs
the role the answers are for. When a save is refused for that, ask the user which role with
`AskUserQuestion`: one option per role in the investor's `supportingEntityRules` (Step 3) that
Step 2 lists for that `entityId`, by its name. Then send the same call again with that rule's
`relationType` as `"relation_type"`, and its `roleKey` as `"role_key"` when it isn't empty.

Shapes the form refuses otherwise:

| Field | Send |
| --- | --- |
| `dateOfBirth` and any other date | `{"year": 1990, "month": 1, "day": 2}`, never `"1990-01-02"` |
| `ownershipPercentage`, `ownershipInterests`, `controlByOtherMeans`, `isUsResident`, `isUsPerson`, `isSpecifiedUsPerson` | beside `individual`/`institution`, not inside; `ownershipPercentage` as `{"value": "25"}`, never `25` |
| an address | the **whole** address object. A section you send replaces the stored one, so a partial address loses the rest. |
| a field the other kind declares, or one the firm wrote | under `individual`/`institution` as `customFields`, keyed by its camelCase `fieldId` |

Not answered here, only in the form: tax reporting (`taxReportingDetails`), FATCA
(`fatcaDetails`), CRS (`crsDetails`), the PEP declaration and the other attestations, and the
nature of business (`businessNature`), a closed list only the form offers: never propose or save
a value for it.

The result names the `saved_fields`, never their values. A refusal names what went wrong;
fix the shape it points at and try once more, then leave that field for the user.

## Step 7 — Upload the documents the user shared

For each document Step 2 lists, and each field it lists that a file answers, by its `label`
and party:

- The user gave it as a file on their computer, and you have `Bash` → upload it as below.
- Otherwise (claude.ai chat, a document shown only as a picture in the chat, or none shared) →
  add it to the Step 9 list, with any time-limited warning the Rules ask for. Do not send the
  user to upload it yet.

> **If this plugin's files can't be found:** a path that still shows an unreplaced `${…}`
> variable, or a "not found" when you run the send script, means the skill loaded before this
> session's computer link was ready. Invoke this skill once more with the Skill tool and use the
> paths that copy gives. If they're still unreplaced, put the document on the Step 9 list. Don't
> search the disk for them.

### 7a — Check the files and ask once per party

Take every document to upload for one party together. Check their files in one call, without
opening them again:

```bash
ls -l "<file_path_1>" "<file_path_2>"
```

In Cowork, a file the user attached has a path under `/sessions/<session_id>/mnt/uploads/`;
use that path here and in 7c. Missing, unreadable or a directory → ask for the right path for
those files once, else put them on the Step 9 list. Carry on with the files that passed.

Then ask once for this party, listing every file with the requirement it answers:

> **Upload these documents for <party name>?** They go on your KYC form for
> <fund or entity name>, where Carta's compliance team reviews them. You can remove any of
> them in the form before you submit.
>
> | File | Uploads as |
> | --- | --- |
> | `<file_name>` | <label> |

Add the time-limited warning the Rules ask for under any file it applies to. Use
`AskUserQuestion`:

- Several files: `Upload all` ← recommended / `Choose which` / `Don't upload`.
- One file: `Upload this document` / `Don't upload`.

On `Upload all` or `Upload this document`, run 7b–7d for each listed file in turn, asking
nothing between files. On `Choose which`, ask once more with `AskUserQuestion`
(`multiSelect: true`), one option per file named by its file name and label. Split the files
into as few questions as it takes, each with two to four options (five files: three and two),
and upload only the files picked. On `Don't upload` or anything else, upload nothing.

The answer covers exactly the files listed in this question, once: never a file added later, a
file for another party, or a later round. Every listed file not uploaded goes on the Step 9
list, so it is never asked about again (Step 2).

### 7b — Get an upload link

```
call_tool({"name": "kyc__create__document_upload_link",
           "arguments": {"evaluation_id": "<evaluation_reference_id>"}})
```

Returns `url`, `fields` and `upload_id`. Get it only when you are about to send this file, and
once: never fetch links ahead for later files.

### 7c — Send the file

Run this on one line, exactly as written: `allowed-tools` matches the command text, so any other
form makes the user approve every file. `<fields_json>` is 7b's `fields` object as JSON,
unchanged. Single-quote every value; a value containing `'` is written `'\''`.

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-upload-firm-document/scripts/send_to_storage.py" '<url>' '<fields_json>' '<file_path>'
```

The script checks that `url` is Carta's document storage and that the file exists, and prints
one JSON line:

- `{"status": 204}` or any other `2xx` → sent. Go to 7d.
- `{"status": 403}` → the link most likely expired. Get **one** fresh link (7b) and send once
  more. That and 7d's resend are the only retries: at most two sends per document.
- Any other status, a second failure, `{"error": "connection"}` or `{"error": "refused", …}` →
  nothing is attached. Put the document on the Step 9 list, say it could not be uploaded, and go
  on. Do not change the command and try again, and do not try another way to upload.

### 7d — Attach it to the form

```
call_tool({"name": "kyc__create__document",
           "arguments": {"evaluation_id": "<evaluation_reference_id>",
                         "upload_id": "<upload_id from 7b>", "file_name": "<file_name>",
                         "file_type": "<fileType from Step 2>"}})
```

Add `"entity_id"` for a supporting party's document, exactly as in Step 6: without it the
document lands on the investor. Add `"field_id"` for a document the firm wrote itself
(`FILE_TYPE_OTHER`). When `anyOf` lists several types, send the one this file is. For a field a
file answers, send the `fileType` from Step 2's table.

Tell the user it was uploaded, for which party.

A refusal that says kyc-service "attached no document" cannot tell two causes apart: the file
did not reach storage (an expired link, a failed send), or its format is not accepted. When this
document has been sent only once, get one fresh link (7b), send it again (7c) and attach again.
If it was already sent twice, or the attach is refused again, upload nothing more: put it on the
Step 9 list and tell the user the form may need a clear PDF or image of it. Any other refusal,
put the document on the Step 9 list.

## Step 8 — Go round again

Read the task's completion again (Step 2) and tell the user what Claude can still fill or
upload. Repeat Steps 4–7 until nothing is left that Claude can fill or upload, or the user
stops. Then move to their next
unfinished task (Step 1, or Step 1b for a fund's KYC).

## Step 9 — The user finishes and submits each form themselves

For each task that reads `COMPLETE` or has only items the form can fill, Claude has finished
saving. Tell the user to reload its form (the task's `form_url`, from Step 1 or Step 1b), then
check every answer, do what is left and submit it there. The form runs its own checks and may still ask
for something. Summarise per task:

- what was saved and which documents were uploaded, per party,
- what the user still has to do in the form: everything Step 2 puts under "Only the form can
  fill it", and the documents on the Step 9 list with their warnings.

Never say a KYC is done or submitted: it is filled in, waiting for the user to finish and
submit it in the form.

## If a command is refused

| Refusal | Do |
| --- | --- |
| not one of the user's open KYC tasks | go back to Step 1, or Step 1b for a fund's KYC |
| not a v2 form (Step 2 or Step 3) | tell the user to fill that form on Carta, leave it out of the task choice, and move to their next unfinished task (Step 1, or Step 1b for a fund's KYC) |
| several roles (Step 3 or Step 6) | ask the user which role with `AskUserQuestion`, offering the investor's `supportingEntityRules` roles (Step 3) by name, then ask or save again with that rule's `relationType` as `relation_type`, and its `roleKey` as `role_key` when it isn't empty |
| no access | the user cannot open this evaluation; stop |
| refused these answers | a value's shape is wrong, or the form can no longer be edited; check the shape table, else stop |
| attached no document (Step 7d) | after one send, get a fresh link and send once more; refused again, put it on the Step 9 list and say the form may need a clear PDF or image (Step 7d) |
| sign-in not accepted | ask the user to reconnect Carta |
| anything this table does not resolve, or a refusal that comes back after the fix | file feedback (below), then tell the user what you could not do |

## When something gets stuck, file feedback

Offer to file a report to Carta whenever this skill gets stuck: a command errors or is
refused and the table above does not resolve it, a result is wrong or unusable, a step is too
slow, the user needs something this skill cannot do, or the user is stuck or unhappy. File one
when the user asks to give feedback, too.

1. Write the report, following the argument table and **No personal data** below.
2. When you offer it on your own (`source: claude`), show the `requestBody` you will send and
   ask once:
   > **Send this report to Carta?** "<the requestBody>"
   > Carta's team reads it to fix the KYC skill. It holds no personal data, and it cannot be
   > taken back once sent.

   Use `AskUserQuestion` with options `Send this report` / `Don't send`. Continue only on
   `Send this report`. On `Don't send` or anything else, do not call the command: tell the user
   nothing was sent and carry on with their work.

   When the user asked to give feedback (`source: user`), that request is the yes: show the
   `requestBody` and send it without asking again.
3. Send it:

```
call_tool({"name": "kyc__create__feedback",
           "arguments": {"requestType": "bug", "source": "claude",
                         "affectedSkill": "carta-investors:carta-workhub-build",
                         "step": "save_answers", "problem": "command_error",
                         "command": "kyc:mutate:answers", "errorCode": "INVALID_ARGUMENT",
                         "requestBody": "Saving the company's registered address was refused twice; the shape table did not say which key was wrong."}})
```

| Argument | Send |
| --- | --- |
| `requestType` | `bug`, or `feature_request` when the user needs something this skill cannot do |
| `source` | `claude` when you file it on your own, `user` when the user asked to give feedback |
| `step` | where it got stuck: `list_tasks` (Steps 1 and 1b), `read_completion` (Steps 2 and 8), `read_form_configuration` (Step 3), `read_documents` (Step 4), `propose_answers` (Step 5), `save_answers` (Step 6), `upload_documents` (Step 7), `finish_in_form` (Step 9), else `other` |
| `problem` | `command_error`, `wrong_or_unusable_result`, `too_slow`, `cannot_do`, `unclear_instructions`, `user_unhappy` or `other` |
| `command`, `errorCode` | the `kyc:` command involved and the error's code (an HTTP status or gRPC code name), when there is one |
| `requestBody` | what went wrong, in up to 500 characters of general terms |

**No personal data in a report.** Describe the problem, never the user's data: no names, no
numbers, dates, addresses, emails or ids, and nothing a document or the user said. Write "the
company's form configuration was too large to read", not the company's name. The command refuses
a report that holds a number, date, email, URL or id, but it cannot spot a name, an address or
what a document said: leaving those out is up to you. When a report is refused, rewrite it in
general terms and send it once more through the same steps, asking again when you offered it on
your own, then stop.

One report per problem, not one per retry, and never let a report hold up the user's work.
