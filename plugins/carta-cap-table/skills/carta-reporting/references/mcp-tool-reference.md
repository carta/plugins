# MCP Tool Reference

Lazy-loaded reference for `carta-reporting`. `cat` this file on demand when resolving
required params (Step 3) or filter IDs — it is not part of the always-loaded SKILL.md.

```
# All commands invoked via call_tool

call_tool({"name": "reporting__create__report", "arguments": { corporation_id, report_type, as_of_date, report_name, export_format: "json" }})
  → { user_report_pk }
  # Always pass export_format: "json". Never pass "xlsx".
  #
  # OPTIONAL params (any report type):
  #   preview          — pass true for a faster partial report
  #
  #   Filter params — supported per report type:
  #   Full support (stakeholder_ids, equity_plan_ids, security_ids, share_class_ids, issued_from, issued_to):
  #     exercised_and_settled_report, equity_plan_report, vesting_details_report,
  #     historical_terminations_report, common_securities_report, equity_awards_outstanding,
  #     equity_plan_granted_report, options_outstanding_report, securities_ledger_report,
  #     share_registry_report, rule_701_report, canceled_and_returned_report, eightythreeb_elections_report
  #   termination_modeling_report: equity_plan_ids, security_ids, share_class_ids, issued_from, issued_to (stakeholder_ids not supported)
  #   stakeholder_ledger_report, stakeholder_details_report: stakeholder_ids only
  #   Passing unsupported filters for a report type has no effect.
  #   stakeholder_ids  — comma-separated integer IDs, e.g. "42,7,99"
  #   equity_plan_ids  — comma-separated integer IDs
  #   security_ids     — comma-separated TYPE:ID strings, e.g. "CERTIFICATE:42,OPTION:7"
  #     valid types: CERTIFICATE, RSA, RSU, OPTION, SAR, CBU, PIU, WARRANT, CONVERTIBLE_NOTE
  #   share_class_ids  — comma-separated integer IDs
  #   issued_from      — grant issuance start date, MM/DD/YYYY
  #   issued_to        — grant issuance end date, MM/DD/YYYY
  #
  # REQUIRED params by report_type — the API fails silently or errors if these are omitted.
  # Collect any that the user has not already provided via AskUserQuestion BEFORE calling this command.
  #
  #   stakeholder_ownership_details_report
  #     stakeholder_pk       — the stakeholder to report on (REQUIRED)
  #
  #   termination_modeling_report
  #     stakeholder_pk       — the stakeholder to model (REQUIRED)
  #     termination_reason   — one of: voluntary | involuntary | with_cause |
  #                            retirement | disability | death (REQUIRED)
  #
  #   historical_terminations_report
  #     stakeholder_pk       — the stakeholder whose history to pull (REQUIRED)
  #
  #   vesting_details_report
  #     stakeholder_pk       — filter to a specific stakeholder (REQUIRED)
  #     issued_from          — grant issuance start date, MM/DD/YYYY (REQUIRED)
  #     issued_to            — grant issuance end date, MM/DD/YYYY (REQUIRED)
  #
  #   cap_table_summary_report
  #     reports              — comma-separated sub-reports to include (REQUIRED):
  #                            summary_cap | intermediate_cap | detailed_cap |
  #                            ledgers | summary_grouped_cap
  #     group_selected       — grouping dimension, e.g. 'Relationship', 'Cost Center',
  #                            'Job Title' (REQUIRED when reports includes summary_grouped_cap)
  #
  #   equity_plan_report
  #     starting_date        — report period start, MM/DD/YYYY (REQUIRED)
  #     ending_date          — report period end, MM/DD/YYYY (REQUIRED)
  #     show_stakeholder_sums_sheet  — true | false (REQUIRED)
  #     show_events_ledger_sheet     — true | false (REQUIRED)

# Filter ID lookup commands:
call_tool({"name": "cap_table__get__stakeholders", "arguments": { corporation_id }})
  → { count: N, by_type: { employee: N, investor: N, ... } }
  # Summary mode (no search param) — returns total stakeholder count and breakdown by type.
  # Use count to infer company size for status message branching (Step 4).

call_tool({"name": "cap_table__get__stakeholders", "arguments": { corporation_id, search: "<name>" }})
  → { results: [{ id, full_name, email, event_relationship }] }
  # Search mode — resolves a stakeholder name to its numeric id for use in stakeholder_ids.
  # search matches full_name and email. Available to all users.

call_tool({"name": "cap_table__get__certificate_share_classes", "arguments": { corporation_id }})
  → { results: [{ id, name, prefix }] }
  # Returns available share classes (Common, Series A, etc.) with their numeric id.
  # Staff-only — call may fail with 403 for non-staff users; fall back to AskUserQuestion.

call_tool({"name": "cap_table__get__option_plans", "arguments": { corporation_id }})
  → { results: [{ id, name, common_share_class_id, size, available_quantity, is_expired }] }
  # Returns equity plans with their numeric id and linked share class id.
  # Staff-only — call may fail with 403 for non-staff users; fall back to AskUserQuestion.
  # common_share_class_id links a plan to its share class — use to resolve equity_plan_ids
  # when the user filters by share class.

# security_ids — resolve label to TYPE:ID (all available to non-staff users):
call_tool({"name": "cap_table__get__certificate", "arguments": { corporation_id, label: "<label>" }})
  → { id, label, ... }   # CERTIFICATE:<id>

call_tool({"name": "cap_table__get__option_grant", "arguments": { corporation_id, label: "<label>" }})
  → { id, label, ... }   # OPTION:<id>

call_tool({"name": "cap_table__get__rsu", "arguments": { corporation_id, label: "<label>" }})
  → { id, label, ... }   # RSU:<id>

call_tool({"name": "cap_table__get__rsa", "arguments": { corporation_id, label: "<label>" }})
  → { id, label, ... }   # RSA:<id>

call_tool({"name": "cap_table__get__piu", "arguments": { corporation_id, label: "<label>" }})
  → { id, label, ... }   # PIU:<id>

call_tool({"name": "cap_table__get__warrant", "arguments": { corporation_id, label: "<label>" }})
  → { id, label, ... }   # WARRANT:<id>

call_tool({"name": "cap_table__list__sars", "arguments": { corporation_id, search: "<label>", detail: "minimal" }})
  → { results: [{ id, label, ... }] }   # SAR:<id>

call_tool({"name": "cap_table__list__cbus", "arguments": { corporation_id, search: "<label>", detail: "minimal" }})
  → { results: [{ id, label, ... }] }   # CBU:<id>

call_tool({"name": "reporting__search__report_types", "arguments": { corporation_id, query, json_export_supported: true }})
  → {
      reports: [{report_type, name, similarity, answers_question}],
      questions: [{question, similarity, answers, hide_from_ui}]
    }

call_tool({"name": "reporting__get__report_status", "arguments": { user_report_pk }})
  → { status }   # status: "pending" | "complete" | "error" | "not_found"
                 # corporation_id not required — endpoint is user-scoped

call_tool({"name": "reporting__get__download_url", "arguments": { user_report_pk, corporation_id }})
  → { download_url }   # S3 presigned URL — pass to report_processor.py, not WebFetch
```
