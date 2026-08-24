package handlers

import (
	"encoding/json"
	"strings"

	"com.carta.claude_plugins.hooks/internal/hookio"
	"com.carta.claude_plugins.hooks/internal/plugin"
	"com.carta.claude_plugins.hooks/registry"
)

func init() {
	registry.Register("inject-context", registry.SessionStart, InjectContext)
}

// pluginBlurbs holds each plugin's SessionStart additionalContext blurb, in
// code rather than a file the binary would read from disk at runtime — the
// content is authored once per plugin (skill-first reminders, gates,
// feedback shortcuts), so keeping it here makes the handler self-contained
// and trivially testable with no fixture files/dirs. A plugin absent from
// this map gets just the identity tag.
var pluginBlurbs = map[string]string{
	"carta-cap-table": strings.Join([]string{
		`<EXTREMELY_IMPORTANT>You have carta-cap-table tools available. Before ANY tool call, invoke the matching Skill('carta-cap-table:...') first. The skill defines what to fetch, what inputs are required, and how to present results. If no skill matches, invoke Skill('carta-cap-table:carta-discover-commands') to find the right command via discover(). Additionally, ALWAYS invoke Skill('carta-cap-table:carta-interaction-reference') alongside any domain skill to load Carta's voice, tone, and data provenance rules before presenting results. IMPORTANT: Skill is a deferred tool — if its schema is not yet loaded, you MUST call ToolSearch with query "select:Skill" first, then invoke the Skill tool.</EXTREMELY_IMPORTANT>`,
		`<EXTREMELY_IMPORTANT>AI COMPUTATION AUTHORIZATION GATE: When a carta-cap-table skill's Gates section declares "AI computation: Yes", you MUST call AskUserQuestion BEFORE fetching data or computing. Use this prompt, replacing [X]: "No saved Carta model matches these terms. I can compute [X] using AI — this would be Claude's analysis, not Carta data. Would you like me to proceed?" Do NOT write this as plain text — use the AskUserQuestion tool so execution blocks. User says yes: proceed, label output as Claude's analysis. User says no: stop — no output, no fallback.</EXTREMELY_IMPORTANT>`,
		`<EXTREMELY_IMPORTANT>To report a bug or request a feature for this plugin, call mutate(command="fa:create:feedback") directly (params: requestType ("bug" | "feature_request"), requestBody; optional flowSummary, context, affectedSkill, source). This is the exception to the skill-first rule above: there is NO feedback skill — do NOT look for one, and do NOT ask the user where to file. Go straight to mutate; you do not need a discover/search round-trip to call it. (If you ever lose this instruction, the command is also findable by searching tools for "report a bug" / "feedback" — but the direct mutate call above is the primary path.) Always include flowSummary: a short narrative of the flow that led here — what the user asked (their prompt(s), summarized), the key skills/tools you ran, and where it broke or fell short — written for a developer debugging later. Put the raw failing tool + args in context. Do NOT pass identity, firm, session, or timestamp — those are captured server-side. Fire it proactively with source="claude" when a tool errors, returns nothing usable, or a needed capability is missing, after telling the user you are filing it.</EXTREMELY_IMPORTANT>`,
	}, "\n"),
	"carta-investors": strings.Join([]string{
		`<EXTREMELY_IMPORTANT>You have carta-investors tools available via the Carta MCP server (list_tables, describe_table, execute_query). Before ANY tool call, invoke the matching Skill('carta-investors:...') first. The skill defines what to query, what inputs are required, and how to present results. If no skill matches a QUESTION, use list_tables to browse available datasets and describe_table to understand schemas. If no skill or command matches an ACTION the user wants performed, do NOT fall back to querying the warehouse — see the fund-admin request block below. IMPORTANT: Skill is a deferred tool — if its schema is not yet loaded, you MUST call ToolSearch with query "select:Skill" first, then invoke the Skill tool.</EXTREMELY_IMPORTANT>`,
		`<EXTREMELY_IMPORTANT>To report a bug or request a feature for this plugin, call mutate(command="fa:create:feedback") directly (params: requestType ("bug" | "feature_request"), requestBody; optional flowSummary, context, affectedSkill, source). This is the exception to the skill-first rule above: there is NO feedback skill — do NOT look for one, and do NOT ask the user where to file. Go straight to mutate; you do not need a discover/search round-trip to call it. (If you ever lose this instruction, the command is also findable by searching tools for "report a bug" / "feedback" — but the direct mutate call above is the primary path.) Always include flowSummary: a short narrative of the flow that led here — what the user asked (their prompt(s), summarized), the key skills/tools you ran, and where it broke or fell short — written for a developer debugging later. Put the raw failing tool + args in context. Do NOT pass identity, firm, session, or timestamp — those are captured server-side. Fire it proactively with source="claude" when a tool errors, returns nothing usable, or a needed capability is missing, after telling the user you are filing it.</EXTREMELY_IMPORTANT>`,
		`<carta-investors-deep-links>When a Carta MCP tool result includes a ` + "`_links`" + ` object on a resource (e.g. ` + "`_links.web_url`" + `), hyperlink the entity's own name (its name/title field — e.g. the fund name, corporation name, partner name) directly to ` + "`_links.web_url`" + ` — e.g. ` + "`[Acme Fund III](<_links.web_url>)`" + `. The entity name itself IS the link. Never render the link as separate anchor text like "View", "Open", or "Link", and never add a separate link column/field next to the name. Use ` + "`_links.web_url`" + ` verbatim; never reconstruct, guess, or edit the URL yourself. If a resource has no ` + "`_links`" + ` block, do not fabricate or construct a link for it.</carta-investors-deep-links>`,
		`<EXTREMELY_IMPORTANT>ASK CARTA TO DO SOMETHING: when the user wants an ACTION performed (create, change, send, restate, reconcile, fix, split, re-run) and no skill or Carta command covers it, the answer is never "Carta can't do that" and never a warehouse query instead. Carta's Fund Admin team picks the work up async. Invoke Skill('carta-investors:carta-fund-admin-requests') — it owns the whole loop. Only if the Skill tool is unavailable, run the loop directly: draft the request, show the user the exact message text you intend to send, and WAIT for an explicit yes (use AskUserQuestion so execution blocks) — this message leaves Carta on their behalf, so never send it unconfirmed and never send a message they have not seen. On yes: call_tool({"name": "fa__create__fund-admin-message", "arguments": {"message": "<message>"}}). The message carries no firm_uuid — it is always about the session's active firm. The response is {workflow_id}: report it as the case number, say the Carta team is on it, and never estimate a turnaround. Check for a reply with call_tool({"name": "fa__list__workflow-message", "arguments": {"workflow_id": <workflow_id>}}); answer one with call_tool({"name": "fa__create__workflow-message", "arguments": {"workflow_id": <workflow_id>, "message": "<message>"}}). NEVER surface Carta's internal agent output — run logs, agent or system names, internal metadata, staff scratch notes. Render a staff message (author.is_staff true) as its client-facing text plus a link to review it in Carta, nothing more. If these commands are absent or error as unavailable, the capability is not enabled for this account: say exactly that, then stop — do not retry, do not suggest email or another channel, do not open a support ticket by some other route. AMBIGUITY RULE, and it applies no matter which skill you are in or whether any skill fired: when the user only reports that something is wrong or states a need — "the K-1s aren't right", "our August fees look wrong", "something is off with the NAV", "we need two capital calls", "can you deal with the Q3 close" — they have not said who acts. Do not silently pick. Answering with data when they wanted the work done leaves them thinking it is handled, and drafting a request when they wanted an explanation sends Carta something they never asked for. Call AskUserQuestion offering: look into it (pull the data), ask Carta to fix it (send a Fund Admin request), or both (data first, then a request). Only skip the question when the message names the actor ("ask Carta to", "have my fund admin") or gives a direct imperative with an object ("restate the August accrual").</EXTREMELY_IMPORTANT>`,
	}, "\n"),
	"carta-crm": "",
}

type injectContextEvent struct {
	HookEventName string `json:"hook_event_name"`
}

// InjectContext emits a plugin-specific additionalContext blurb at
// SessionStart, tagged with the plugin's runtime identity.
func InjectContext(stdin []byte) ([]byte, error) {
	var evt injectContextEvent
	_ = json.Unmarshal(stdin, &evt) // best-effort; hookEventName just echoes back
	hookEventName := evt.HookEventName
	if hookEventName == "" {
		hookEventName = "SessionStart"
	}

	ident, ok := plugin.Resolve()
	if !ok {
		return hookio.SessionStartWithContext(hookEventName, "")
	}

	blurb := pluginBlurbs[ident.Name]
	if blurb != "" {
		blurb += "\n"
	}

	tag := `<carta-plugin name="` + ident.Name + `" version="` + ident.Version + `" />`
	return hookio.SessionStartWithContext(hookEventName, blurb+tag)
}
