# PIU-only fields

Read this file only when `security_type = piu`, resolved in [SKILL.md § Resolve
security_type](../SKILL.md#resolve-security_type). Vesting and acceleration are shared with the
other two types and stay in [engine.md § Shared resolution
helpers](engine.md#shared-resolution-helpers).

A PIU is a **profits interest**: the holder shares only in value **above a threshold**.
That threshold is the security's economic term, so a PIU has **no price of any kind** — no
exercise price, no price per share. It also has no legend and no Rule 144 date.

---

## PIU row

Fill literally, under [engine.md § Row templates](engine.md#row-templates)'s rule: every slot
holds a value before review, and a `None` or empty is a skill bug.

```python
{
    "name":                    <stakeholder.name>,                # always
    "email":                   <stakeholder.email>,               # always
    "stakeholder_id":          <stakeholder.id>,                  # always
    "stakeholder_kind":        <stakeholder.kind | "INDIVIDUAL">, # always
    "issue_date_relationship": <stakeholder.event_relationship>,  # always
    "prefix":                  <unit_class.prefix>,               # always — NOT share_class
    "quantity":                <user>,                            # always
    "currency":                <corp currency, e.g. "USD">,       # always
    "threshold_value":         <user>,                            # always — never defaulted
    "threshold_value_type":    "Unit" | "Overall",                # always — never guessed
    "issue_date":              <user, YYYY-MM-DD>,                # always
    "exemption":               "Section 4(a)(2)",                  # always — US default
    "option_plan":             <plan.id as str or OMIT>,          # optional — omit = off the unit class
    "board_approval_date":     <user, YYYY-MM-DD, or omit>,       # optional — no pending state
    "document_set_id":         <doc_set.id or omit>,              # see Document set below
    "vesting_template":        <template.id or omit>,             # opt-in
    "vesting_start_date":      <MM/DD/YYYY>,                      # only with a non-milestone template (CharField)
    "acceleration_template":   <template.id or omit>,             # optional — only once vesting is set
    "corresponding_interest":  <bool or omit>,                    # only when the unit class has the link
    "prefix_number":           <digits or omit>,                  # optional — server auto-numbers
    "cash_paid":               <user or omit>,                    # optional — UK growth shares only
    "is_flexible_issue_date":  <bool or omit>,                    # optional
    "notes":                   <user or omit>,                    # optional
    "draft_pk":                <previous_save.draft_pk or omit>,  # retry only
}
```

**`equity_plan_id` is never sent for a PIU.** Unlike an option grant, the plan is a *row*
field (`option_plan`), not a set field — `CreateDraftSetView` takes only a name. Passing
`equity_plan_id` on the first mutate is a copy-paste from the grant path.

### Review-only fields (PIU) — never sent to the mutate

Stamp these onto every resolved row for the review surfaces to render:

| Key | Value |
|---|---|
| `unit_class_label` | the resolved unit class's `name` |
| `equity_plan_label` | the resolved plan's `name`, or unset when the row has no plan |
| `document_set_label` | the resolved document set's `name` |
| `threshold_noun` | the issuer's own word — `issuance_init`'s `draft_set_init.thresholdNoun` |

---

## Resolution helpers (PIU)

### Unit-class reconciliation

Use the `certificate_share_classes` section from the Phase 0.5 `issuance_init` payload.
**Read it as the unit classes** — a PIU uses the same share-class endpoint and the same
response shape as a certificate, so the section keeps that name (and with it its
`cap_table:get:certificate_share_classes` — wire
`cap_table__get__certificate_share_classes` — per-section fallback).

Match a user-supplied class name case-insensitively; capture the **`prefix`**, which is
what the payload carries. The unmatched-name and ambiguous-match handling is identical to
[certificate-fields.md § Share-class
reconciliation](certificate-fields.md#share-class-reconciliation-certificate) — with two
differences:

- **Label it "Unit class" everywhere the user sees it**, never "Share class".
- **Ignore `dividend`.** `DraftPIU` has no dividend-accrual field, so the
  non-cash-dividend prompt that governs certificates does not apply.

The default rule is the same one, and deliberately so: a sole class is pre-selected, two or
more leave the control **required and unselected** with `missingFields()` holding **Review**
on `a unit class`. An explicitly named class is still honoured, row-level or via
the prefix the prompt named; carry one in **only when the prompt actually named one.**

### Equity-plan reconciliation — per row, optional, prefix-matched

The one helper with no analogue anywhere else in this skill. Three rules, each load-bearing:

1. **Empty is a real answer.** A PIU issued with no plan draws on the **unit class's own
   authorized total**; one issued from a plan draws on the **plan's pool**. Which ceiling
   carta-web checks is decided by this field alone.
2. **Never default a plan.** Every other picker in this skill defaults when there is
   exactly one option. Do **not** apply the option-grant rule *"one non-expired plan →
   default silently"* here: attaching a pool to a PIU that was meant to come straight off
   the unit class moves real numbers on a real cap table, and nothing downstream catches
   it. The default is **no plan**; the surface offers the list.
3. **The plan's unit class must match the row's.** `DraftOptionPlanFieldValidator` rejects
   a mismatch with *"Equity plan share class must match the selected share class"*. Follow
   the Drafts grid: a chosen plan sets the unit class to its `common_share_class_prefix`
   and locks it; a chosen class with no plan narrows the picker to that class's plans.
   A plan row with no prefix falls back to a `common_share_class_name` only one class
   carries; with neither, do not pre-validate (SKILL.md hard rule 4) and surface the
   server's message verbatim on rejection.

`option_plan` carries the plan's **primary key as a string**, not its name, even though
the underlying field is a `CharField`. Skip expired plans (`is_expired: true`) and never
recompute `available_quantity`.

> **A plan that vanishes from a reloaded draft was not the issuer's.** `save_drafts`
> silently blanks an `option_plan` the corporation does not own
> (`SaveDraftTaskRunnerV2._validate_option_plan_ownership`) rather than erroring. If
> `load_drafts` comes back with the field empty after a save that set it, the plan
> belonged to another corporation — say so rather than re-sending it.

### Threshold value and type

**Neither is ever defaulted.** The threshold is a term of the grant: a wrong one is a
wrong security, and unlike a wrong quantity it looks entirely plausible on the ledger.

- `threshold_value` — a decimal, `>= 0`, at most 12 decimal places. A genuine `0` is
  valid (the unit shares in value from the first dollar) and must survive serialization.
- `threshold_value_type` — exactly **`Unit`** or **`Overall`**. Explain the jargon on
  first use: *"`Unit` states the threshold for each unit; `Overall` states it once for the
  whole grant."*

> **Two contradictory vocabularies exist in carta-web.** The *field manifest*
> (`eshares/issuables/field_manifest/field_metadata/certificate.py`) declares this field as
> `FAIR_MARKET_VALUE` / `OTHER`. That is a different, CLI-facing surface. The drafts path
> this skill uses accepts only `Unit` / `Overall` —
> `DraftThresholdValueTypeFieldValidator` rejects anything else with *"X is not a valid
> threshold value type"*. Never "reconcile" the skill to the manifest.

**The issuer's own noun.** `issuance_init`'s `draft_set_init` section carries
`thresholdNoun` — `"threshold"` by default, `"hurdle"` on the UK growth-shares preset.
Title-case it and use it in every label and review column. Default to "threshold" when the
section is absent, and stamp it on each row as the review-only `threshold_noun`.

### Board approval

**Optional, and there is no `needs_board_approval` field** — that field does not exist on
`DraftPIU`, and sending it fails the whole mutate. There is also deliberately **no
ordering rule** against the issue date (`DraftPIUApprovalDateFieldValidator`; LLC board
processes differ from a C-corp's).

| Label | `board_approval_date` |
|---|---|
| `"Yes — board approved today"` | today (`YYYY-MM-DD`), tagged `(default — today)` |
| `"Yes — approved on a different date"` | follow-up; `YYYY-MM-DD` or `MM/DD/YYYY` |
| `"No board approval date"` | **omit the key entirely** |

Render the review's Board approval cell as `—` when absent — **never** "Pending", which
is the grant flow's state and does not exist here.

### Document set

Two slots, `purchase_agreement_doc` ("Form of Grant Agreement") and
`equity_incentive_plan_doc` ("Equity Incentive Plan"). Send `document_set_id` only; the
server resolves both from it. Never emit the doc fields or `attachments_uuid`.

Two conditional server rules, neither of them predictable from here — the corporation
properties behind them are not readable through any MCP command, so the server is
authoritative (SKILL.md hard rule 4):

- the grant agreement is required when the issuer's properties demand one;
- the equity incentive plan document is required **only for a plan-issued row**.

That is why the [account-setup gate](engine.md#account-setup-gate-option-grant-and-piu)
is soft for PIUs: a corp with no PIU document set may still be able to issue.

### Vesting

Shared with the other two types — see [engine.md § Vesting
resolution](engine.md#vesting-resolution). PIU takes the **certificate posture: opt-in,
defaulting to No vesting.** The field manifest does not mark `vesting_template` required
for a PIU, and the import template calls it *"Required, if applicable"*; the only
server-side rule is that a vesting start date with no schedule fails. Warn on neither.

### Corresponding interest

Offered **only** when the resolved unit class carries a truthy
`has_corresponding_interest`. The skill never reads a feature flag; it reads this field.

**An absent key means UNKNOWN, not "no".** `ShareClassView` gates the serializer field on
the `CORRESPONDING_INTEREST_ADMIN_ISSUANCE` flag, evaluated per corporation, and pops it
when the flag is off — so *"this class has no link"* and *"this read could not see links
at all"* arrive as the same missing key. The read cannot tell them apart, and neither can
you. Absence must never raise, and must never be reported as fact.

| What you see | What it means | What to say |
|---|---|---|
| `true` | The class carries the link | Offer the row |
| `false` | The class has no link | No row; say so only if asked |
| **key absent** | **Unknown — flag off, or a trimmed/partial read** | **Never assert "no link is configured"** |

**Never state a configuration fact you inferred from an absent key.** Saying *"Carta shows
no corresponding-interest link for this unit class"* on the strength of a missing field is
an assertion the evidence does not support — it was reported to a user once, on a corp
whose manage-share-classes page showed the link plainly.

**Which class is "the resolved unit class".** The same precedence the unit-class buttons
use to pre-select one (`default_share_class_prefix`), in order:

1. the row's own `share_class_prefix`,
2. a prefix the prompt named,
3. the sole class, when the corp has exactly one,
4. otherwise nothing — several classes and none named leaves the field unselected.

Step 3 is load-bearing: the skill carries no prefix in unless the prompt named
a unit class, so for the ordinary request (*"issue a PIU to X for 112 units"*) the first two
are empty. Reading only a named prefix is what kept this row from ever rendering.

Step 4 is deliberate. The class sets the holder's liquidation preference, price and
economics, so a default picked for them hides the decision the field exists to ask. When
several classes exist the gate reads "unresolved" and the user chooses.

**The gate is not build-time only.** The link belongs to the unit class, so clicking a
different class changes the answer. Any class carrying the link puts the row in the DOM
for every class, tagged `data-conditional="corresponding_interest"` and hidden when the
selected class has no link; `syncCorrespondingInterest()` re-toggles it on each class
click, on load, and on a cloned block, reading the per-prefix map the form emits as
`CORRESPONDING_INTEREST_BY_PREFIX`. When *no* class carries the link the row never enters
the DOM at all.

Batch mode renders it once in shared terms, from where it expands onto every submitted
row.

One line for the user: *"Yes also issues the matching interest in the linked operating
company."* The server then checks permission on that company, its available units, and a
same-named vesting schedule there; surface those messages verbatim. Only `true` is
meaningful — the form omits the key entirely whenever the row is not visible.

#### An explicit request is never silently dropped

When the prompt **asks for a corresponding interest** and the resolved class does not
report `true`, the read is not the authority — the server is. Do not drop the request and
issue anyway: that ships a one-sided grant, a PIU in the ManCo with no matching interest
in the OpCo, and nothing on screen says so.

**Send `corresponding_interest: true` and let the server rule.**
`DraftCorrespondingInterestValidator` accepts it or rejects it with a precise message
(*"This unit class has no per-interest corresponding-interest link…"*), which is a fact,
unlike anything inferrable from the read. Surface that message verbatim.

The one case to resolve before issuing, not after: when the key is **absent** (unknown)
and the user asked for the designation, **block the review** and say what you are blocked
on — *"You asked for a corresponding interest; this cap table's share-class read does not
report whether this unit class has one. Issue without it, or check the unit class in
Carta first?"* Issuing silently is the one thing that is never acceptable, because the
result is a grant that reads as complete and is not.
