package handlers

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func parseSessionStartOutput(t *testing.T, out []byte) (hookEventName, additionalContext string) {
	t.Helper()
	var resp struct {
		HookSpecificOutput struct {
			HookEventName     string `json:"hookEventName"`
			AdditionalContext string `json:"additionalContext"`
		} `json:"hookSpecificOutput"`
	}
	if err := json.Unmarshal(out, &resp); err != nil {
		t.Fatalf("unmarshal output: %v", err)
	}
	return resp.HookSpecificOutput.HookEventName, resp.HookSpecificOutput.AdditionalContext
}

func TestInjectContext_KnownPluginWithBlurb(t *testing.T) {
	setupPluginRoot(t, "carta-cap-table", "1.0.0")

	out, err := InjectContext([]byte(`{"hook_event_name":"SessionStart"}`))
	if err != nil {
		t.Fatal(err)
	}
	hookEventName, additionalContext := parseSessionStartOutput(t, out)
	if hookEventName != "SessionStart" {
		t.Errorf("hookEventName = %q, want %q", hookEventName, "SessionStart")
	}
	want := `<EXTREMELY_IMPORTANT>You have carta-cap-table tools available. Before ANY Carta cap table tool call, invoke the matching Skill('carta-cap-table:...') first. For a single fact or a short answer, or when no other skill matches, invoke Skill('carta-cap-table:carta-cap-table'): it has the read commands, the answer rules and how to report a bug. In every answer: give the as-of date of each Carta figure, never invent a value, give no legal, tax or financial advice, ask with AskUserQuestion before you compute figures Carta has not saved and label them Claude's analysis, and make no change until the user confirms it. IMPORTANT: Skill is a deferred tool — if its schema is not yet loaded, you MUST call ToolSearch with query "select:Skill" first, then invoke the Skill tool.</EXTREMELY_IMPORTANT>` +
		"\n" + `<carta-plugin name="carta-cap-table" version="1.0.0" />`
	if additionalContext != want {
		t.Errorf("additionalContext = %q, want %q", additionalContext, want)
	}
}

// The cap table blurb is in every session's context, so it stays under 200
// tokens, counted at the usual 4 characters per token.
func TestInjectContext_CapTableBlurbFitsTokenBudget(t *testing.T) {
	const maxTokens = 200
	if tokens := len(pluginBlurbs["carta-cap-table"]) / 4; tokens > maxTokens {
		t.Errorf("carta-cap-table blurb is about %d tokens, want at most %d", tokens, maxTokens)
	}
}

func TestInjectContext_CapTableBlurbSkillsExist(t *testing.T) {
	refs := regexp.MustCompile(`Skill\('carta-cap-table:([a-z0-9-]+)'\)`).FindAllStringSubmatch(pluginBlurbs["carta-cap-table"], -1)
	if len(refs) != 1 {
		t.Fatalf("blurb names %d skills, want 1", len(refs))
	}
	for _, ref := range refs {
		path := filepath.Join("..", "..", "..", "plugins", "carta-cap-table", "skills", ref[1], "SKILL.md")
		if _, err := os.Stat(path); err != nil {
			t.Errorf("blurb names Skill('carta-cap-table:%s'), but %s does not exist", ref[1], path)
		}
	}
}

func TestInjectContext_InvestorsBlurbIncludesDeepLinks(t *testing.T) {
	setupPluginRoot(t, "carta-investors", "2.0.0")

	out, err := InjectContext([]byte(`{"hook_event_name":"SessionStart"}`))
	if err != nil {
		t.Fatal(err)
	}
	_, additionalContext := parseSessionStartOutput(t, out)
	if !strings.Contains(additionalContext, "carta-investors-deep-links") {
		t.Errorf("additionalContext = %q, want carta-investors' deep-links block", additionalContext)
	}
	if strings.Contains(additionalContext, "AI COMPUTATION AUTHORIZATION GATE") {
		t.Errorf("additionalContext = %q, carta-investors has no AI-computation-gate block", additionalContext)
	}
}

// Without this block an unmatched action falls through to list_tables, turning
// "do this for me" into a warehouse query.
func TestInjectContext_InvestorsBlurbRoutesActionsToFundAdmin(t *testing.T) {
	setupPluginRoot(t, "carta-investors", "2.0.0")

	out, err := InjectContext([]byte(`{"hook_event_name":"SessionStart"}`))
	if err != nil {
		t.Fatal(err)
	}
	_, additionalContext := parseSessionStartOutput(t, out)
	for _, want := range []string{
		"carta-investors:carta-fund-admin-requests",
		`"fa__create__fund-admin-message"`,
		`"fa__list__workflow-message"`,
		`"fa__create__workflow-message"`,
	} {
		if !strings.Contains(additionalContext, want) {
			t.Errorf("additionalContext = %q, want it to contain %q", additionalContext, want)
		}
	}
	// The blurb is the fallback the model runs when Skill is unavailable, so it
	// must teach the same call_tool surface the skill does — not the colon form.
	if strings.Contains(additionalContext, "fa:create:fund-admin-message") {
		t.Errorf("additionalContext = %q, want the fund-admin commands on call_tool, not fetch/mutate", additionalContext)
	}
	// The read fallback still points at the warehouse, but only for questions.
	if !strings.Contains(additionalContext, "If no skill matches a QUESTION") {
		t.Errorf("additionalContext = %q, want the warehouse fallback scoped to questions", additionalContext)
	}
	// The ambiguity rule lives here, not in a skill: a skill that is never
	// selected cannot gate anything.
	if !strings.Contains(additionalContext, "AMBIGUITY RULE") {
		t.Errorf("additionalContext = %q, want the ambiguity rule", additionalContext)
	}
}

// feedbackRuleFragments are the load-bearing feedback rules. carta-investors'
// feedbackBlurb and the carta-cap-table core skill each carry them.
var feedbackRuleFragments = []string{
	`call_tool({"name": "fa__create__feedback"`,
	`search_tools("report a bug feedback")`,
	`do not retry a call that came back "Unknown tool"`,
}

func missingFeedbackRules(text string) []string {
	var missing []string
	for _, fragment := range feedbackRuleFragments {
		if !strings.Contains(strings.ToLower(text), strings.ToLower(fragment)) {
			missing = append(missing, fragment)
		}
	}
	return missing
}

func TestInjectContext_CapTableSkillCarriesFeedbackRules(t *testing.T) {
	path := filepath.Join("..", "..", "..", "plugins", "carta-cap-table", "skills", "carta-cap-table", "SKILL.md")
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	_, section, found := strings.Cut(string(body), "\n## Report a bug or request a feature\n")
	if !found {
		t.Fatalf("%s has no \"Report a bug or request a feature\" section", path)
	}
	if missing := missingFeedbackRules(section); len(missing) != 0 {
		t.Errorf("%s feedback section is missing %q", path, missing)
	}
	if !strings.Contains(section, "Never call `mutate` for it.") {
		t.Errorf("%s feedback section does not rule out the mutate gateway path", path)
	}
}

// The feedback command is reachable only through call_tool, and only when its
// own feature flag is on. A blurb that names `mutate` or fires blind turns
// every handled error into a second, unhandled one.
func TestInjectContext_FeedbackBlurbNamesCallToolAndChecksAvailability(t *testing.T) {
	setupPluginRoot(t, "carta-investors", "1.0.0")

	out, err := InjectContext([]byte(`{"hook_event_name":"SessionStart"}`))
	if err != nil {
		t.Fatal(err)
	}
	_, additionalContext := parseSessionStartOutput(t, out)

	if missing := missingFeedbackRules(feedbackBlurb); len(missing) != 0 {
		t.Errorf("feedbackBlurb is missing %q", missing)
	}
	if !strings.Contains(additionalContext, feedbackBlurb) {
		t.Error("additionalContext does not carry feedbackBlurb")
	}
	if !strings.Contains(additionalContext, "CHECK THE COMMAND IS THERE BEFORE YOU CALL IT") {
		t.Error("additionalContext is missing the availability check")
	}
	// `mutate` is gateway-gated off by default, so the blurb may only
	// name it to forbid it.
	if strings.Contains(additionalContext, `call mutate(command="fa:create:feedback") directly`) {
		t.Error("the blurb still tells the model to file feedback through the mutate gateway")
	}
	if !strings.Contains(additionalContext, `Do NOT call mutate(command="fa:create:feedback")`) {
		t.Error("the blurb does not rule out the mutate gateway path")
	}
}

func TestInjectContext_PluginWithNoBlurb(t *testing.T) {
	setupPluginRoot(t, "carta-crm", "1.0.0")

	out, err := InjectContext([]byte(`{"hook_event_name":"SessionStart"}`))
	if err != nil {
		t.Fatal(err)
	}
	_, additionalContext := parseSessionStartOutput(t, out)
	if additionalContext != `<carta-plugin name="carta-crm" version="1.0.0" />` {
		t.Errorf("additionalContext = %q, want just the identity tag", additionalContext)
	}
}

func TestInjectContext_UnknownPluginGetsJustTag(t *testing.T) {
	setupPluginRoot(t, "carta-unknown-plugin", "0.1.0")

	out, err := InjectContext([]byte(`{"hook_event_name":"SessionStart"}`))
	if err != nil {
		t.Fatal(err)
	}
	_, additionalContext := parseSessionStartOutput(t, out)
	if additionalContext != `<carta-plugin name="carta-unknown-plugin" version="0.1.0" />` {
		t.Errorf("additionalContext = %q, want just the identity tag", additionalContext)
	}
}

func TestInjectContext_PluginRootUnsetFailsOpen(t *testing.T) {
	t.Setenv("CLAUDE_PLUGIN_ROOT", "")

	out, err := InjectContext([]byte(`{"hook_event_name":"SessionStart"}`))
	if err != nil {
		t.Fatal(err)
	}
	hookEventName, additionalContext := parseSessionStartOutput(t, out)
	if hookEventName != "SessionStart" {
		t.Errorf("hookEventName = %q, want %q", hookEventName, "SessionStart")
	}
	if additionalContext != "" {
		t.Errorf("additionalContext = %q, want empty when plugin identity can't be resolved", additionalContext)
	}
}

func TestInjectContext_DefaultsHookEventNameOnUnparseableStdin(t *testing.T) {
	setupPluginRoot(t, "carta-crm", "1.0.0")

	out, err := InjectContext([]byte(`not json`))
	if err != nil {
		t.Fatal(err)
	}
	hookEventName, _ := parseSessionStartOutput(t, out)
	if hookEventName != "SessionStart" {
		t.Errorf("hookEventName = %q, want default %q", hookEventName, "SessionStart")
	}
}
