package handlers

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"com.carta.claude_plugins.hooks/internal/session"
)

func setupPluginRoot(t *testing.T, name, version string) {
	t.Helper()
	root := t.TempDir()
	dir := filepath.Join(root, ".claude-plugin")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	manifest, _ := json.Marshal(map[string]string{"name": name, "version": version})
	if err := os.WriteFile(filepath.Join(dir, "plugin.json"), manifest, 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CLAUDE_PLUGIN_ROOT", root)
}

func isolateEnv(t *testing.T) {
	t.Helper()
	t.Setenv("CLAUDE_PLUGIN_DATA", t.TempDir())
	t.Setenv("CARTA_SESSION_STATE_DIR", t.TempDir())
}

func parsePreToolUseUpdatedInput(t *testing.T, out []byte) map[string]json.RawMessage {
	t.Helper()
	var resp struct {
		HookSpecificOutput struct {
			UpdatedInput json.RawMessage `json:"updatedInput"`
		} `json:"hookSpecificOutput"`
	}
	if err := json.Unmarshal(out, &resp); err != nil {
		t.Fatalf("unmarshal output: %v", err)
	}
	var updated map[string]json.RawMessage
	if err := json.Unmarshal(resp.HookSpecificOutput.UpdatedInput, &updated); err != nil {
		t.Fatalf("unmarshal updatedInput: %v", err)
	}
	return updated
}

func TestInjectInstrumentation_TopLevelForOtherTools(t *testing.T) {
	isolateEnv(t)
	setupPluginRoot(t, "carta-crm", "1.0.0")

	stdin := `{"tool_name":"some_tool","tool_input":{"foo":"bar"},"session_id":"s1"}`
	out, err := InjectInstrumentation([]byte(stdin))
	if err != nil {
		t.Fatal(err)
	}
	updated := parsePreToolUseUpdatedInput(t, out)
	if _, ok := updated["_instrumentation_v2"]; !ok {
		t.Errorf("expected top-level _instrumentation_v2, got %v", updated)
	}
	if _, ok := updated["foo"]; !ok {
		t.Error("expected original tool_input fields preserved")
	}
}

func TestInjectInstrumentation_ParamsToolsObjectParams(t *testing.T) {
	isolateEnv(t)
	setupPluginRoot(t, "carta-crm", "1.0.0")

	stdin := `{"tool_name":"mcp__carta__fetch","tool_input":{"params":{"a":1}},"session_id":"s1"}`
	out, err := InjectInstrumentation([]byte(stdin))
	if err != nil {
		t.Fatal(err)
	}
	updated := parsePreToolUseUpdatedInput(t, out)
	if _, ok := updated["_instrumentation_v2"]; ok {
		t.Error("expected NO top-level _instrumentation_v2 for a params tool")
	}
	var params map[string]json.RawMessage
	if err := json.Unmarshal(updated["params"], &params); err != nil {
		t.Fatal(err)
	}
	if _, ok := params["_instrumentation_v2"]; !ok {
		t.Error("expected _instrumentation_v2 nested under params")
	}
	if _, ok := params["a"]; !ok {
		t.Error("expected original params fields preserved")
	}
}

func TestInjectInstrumentation_ParamsToolsStringParams(t *testing.T) {
	isolateEnv(t)
	setupPluginRoot(t, "carta-crm", "1.0.0")

	stdin := `{"tool_name":"mcp__carta__mutate","tool_input":{"params":"{\"a\":1}"},"session_id":"s1"}`
	out, err := InjectInstrumentation([]byte(stdin))
	if err != nil {
		t.Fatal(err)
	}
	updated := parsePreToolUseUpdatedInput(t, out)
	var params map[string]json.RawMessage
	if err := json.Unmarshal(updated["params"], &params); err != nil {
		t.Fatalf("expected params (originally JSON-encoded string) parsed into an object: %v", err)
	}
	if _, ok := params["_instrumentation_v2"]; !ok {
		t.Error("expected _instrumentation_v2 nested under parsed params")
	}
	if _, ok := params["a"]; !ok {
		t.Error("expected original string-encoded params fields preserved")
	}
}

// TestInjectInstrumentation_ParamsToolsNonObjectParamsPreserved guards against
// silently discarding a caller-supplied params value that is neither an
// object nor a JSON-encoded object string (e.g. an array) — injection is
// skipped, but the original data must survive untouched.
func TestInjectInstrumentation_ParamsToolsNonObjectParamsPreserved(t *testing.T) {
	isolateEnv(t)
	setupPluginRoot(t, "carta-crm", "1.0.0")

	stdin := `{"tool_name":"mcp__carta__fetch","tool_input":{"params":[1,2,3]},"session_id":"s1"}`
	out, err := InjectInstrumentation([]byte(stdin))
	if err != nil {
		t.Fatal(err)
	}
	updated := parsePreToolUseUpdatedInput(t, out)
	var params []int
	if err := json.Unmarshal(updated["params"], &params); err != nil {
		t.Fatalf("expected original array params preserved, got unparseable %s: %v", updated["params"], err)
	}
	if len(params) != 3 || params[0] != 1 {
		t.Errorf("params = %v, want [1 2 3] preserved unchanged", params)
	}
}

func TestInjectInstrumentation_EffortObjectRoundtrips(t *testing.T) {
	isolateEnv(t)
	setupPluginRoot(t, "carta-crm", "1.0.0")

	stdin := `{"tool_name":"some_tool","tool_input":{},"session_id":"s1","effort":{"level":"medium"}}`
	out, err := InjectInstrumentation([]byte(stdin))
	if err != nil {
		t.Fatal(err)
	}
	updated := parsePreToolUseUpdatedInput(t, out)
	var instr map[string]json.RawMessage
	if err := json.Unmarshal(updated["_instrumentation_v2"], &instr); err != nil {
		t.Fatal(err)
	}
	var effort map[string]string
	if err := json.Unmarshal(instr["effort"], &effort); err != nil {
		t.Fatalf("expected effort object to round-trip unchanged: %v", err)
	}
	if effort["level"] != "medium" {
		t.Errorf("effort.level = %q, want %q", effort["level"], "medium")
	}
}

func TestInjectInstrumentation_EffortStringRoundtrips(t *testing.T) {
	isolateEnv(t)
	setupPluginRoot(t, "carta-crm", "1.0.0")

	stdin := `{"tool_name":"some_tool","tool_input":{},"session_id":"s1","effort":"medium"}`
	out, err := InjectInstrumentation([]byte(stdin))
	if err != nil {
		t.Fatal(err)
	}
	updated := parsePreToolUseUpdatedInput(t, out)
	var instr map[string]json.RawMessage
	if err := json.Unmarshal(updated["_instrumentation_v2"], &instr); err != nil {
		t.Fatal(err)
	}
	var effort string
	if err := json.Unmarshal(instr["effort"], &effort); err != nil {
		t.Fatalf("expected effort string to round-trip unchanged: %v", err)
	}
	if effort != "medium" {
		t.Errorf("effort = %q, want %q", effort, "medium")
	}
}

// TestInjectInstrumentation_UnionAcrossPlugins is the KAF-2892 regression:
// when another plugin has already contributed a record to the session's
// shared registry, this plugin's inject-instrumentation call must see the
// union of both, regardless of which one ran "last".
func TestInjectInstrumentation_UnionAcrossPlugins(t *testing.T) {
	isolateEnv(t)
	setupPluginRoot(t, "carta-crm", "1.0.0")

	if err := session.WriteRecord("s1", "carta-investors", "2.0.0", []string{"carta-investors:list-firms"}); err != nil {
		t.Fatal(err)
	}

	stdin := `{"tool_name":"some_tool","tool_input":{},"session_id":"s1"}`
	out, err := InjectInstrumentation([]byte(stdin))
	if err != nil {
		t.Fatal(err)
	}
	updated := parsePreToolUseUpdatedInput(t, out)
	var instr struct {
		Plugins []struct {
			Name string `json:"name"`
		} `json:"plugins"`
		Skills []string `json:"skills"`
	}
	if err := json.Unmarshal(updated["_instrumentation_v2"], &instr); err != nil {
		t.Fatal(err)
	}
	if len(instr.Plugins) != 2 {
		t.Errorf("plugins = %v, want 2 (union of carta-crm + carta-investors)", instr.Plugins)
	}
	found := false
	for _, s := range instr.Skills {
		if s == "carta-investors:list-firms" {
			found = true
		}
	}
	if !found {
		t.Errorf("skills = %v, want to contain carta-investors:list-firms", instr.Skills)
	}
}

func TestInjectInstrumentation_PluginRootUnsetFailsOpenNoWrites(t *testing.T) {
	isolateEnv(t)
	t.Setenv("CLAUDE_PLUGIN_ROOT", "")
	registryDir := os.Getenv("CARTA_SESSION_STATE_DIR")

	stdin := `{"tool_name":"some_tool","tool_input":{"foo":"bar"},"session_id":"s1"}`
	out, err := InjectInstrumentation([]byte(stdin))
	if err != nil {
		t.Fatal(err)
	}

	want := `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}`
	if string(out) != want {
		t.Errorf("output = %s, want %s", out, want)
	}

	entries, _ := os.ReadDir(registryDir)
	if len(entries) != 0 {
		t.Errorf("expected zero writes to the registry dir, found %v", entries)
	}
}
