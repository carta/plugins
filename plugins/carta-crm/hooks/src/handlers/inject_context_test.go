package handlers

import (
	"encoding/json"
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
	if !strings.Contains(additionalContext, "AI COMPUTATION AUTHORIZATION GATE") {
		t.Errorf("additionalContext = %q, want carta-cap-table's AI-computation-gate block", additionalContext)
	}
	if !strings.Contains(additionalContext, `<carta-plugin name="carta-cap-table" version="1.0.0" />`) {
		t.Errorf("additionalContext = %q, want the identity tag", additionalContext)
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

// The feedback command is reachable only through call_tool, and only when its
// own feature flag is on. A blurb that names `mutate` or fires blind turns
// every handled error into a second, unhandled one.
func TestInjectContext_FeedbackBlurbNamesCallToolAndChecksAvailability(t *testing.T) {
	for _, plugin := range []string{"carta-cap-table", "carta-investors"} {
		t.Run(plugin, func(t *testing.T) {
			setupPluginRoot(t, plugin, "1.0.0")

			out, err := InjectContext([]byte(`{"hook_event_name":"SessionStart"}`))
			if err != nil {
				t.Fatal(err)
			}
			_, additionalContext := parseSessionStartOutput(t, out)

			for _, want := range []string{
				`call_tool({"name": "fa__create__feedback"`,
				`search_tools("report a bug feedback")`,
				"CHECK THE COMMAND IS THERE BEFORE YOU CALL IT",
				"do not retry a call that came back \"Unknown tool\"",
			} {
				if !strings.Contains(additionalContext, want) {
					t.Errorf("additionalContext is missing %q", want)
				}
			}
			// `mutate` is gateway-gated off by default, so the blurb may only
			// name it to forbid it.
			if strings.Contains(additionalContext, `call mutate(command="fa:create:feedback") directly`) {
				t.Error("the blurb still tells the model to file feedback through the mutate gateway")
			}
			if !strings.Contains(additionalContext, `Do NOT call mutate(command="fa:create:feedback")`) {
				t.Error("the blurb does not rule out the mutate gateway path")
			}
		})
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
