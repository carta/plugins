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

// TestInjectInstrumentation_ParamsToolsStringNullParamsNoPanic guards against
// a nil map assignment panic: params encoded as the JSON string "null"
// decodes to a nil map, which must fall back to an empty params object.
func TestInjectInstrumentation_ParamsToolsStringNullParamsNoPanic(t *testing.T) {
	isolateEnv(t)
	setupPluginRoot(t, "carta-crm", "1.0.0")

	stdin := `{"tool_name":"mcp__carta__fetch","tool_input":{"params":"null"},"session_id":"s1"}`
	out, err := InjectInstrumentation([]byte(stdin))
	if err != nil {
		t.Fatal(err)
	}
	updated := parsePreToolUseUpdatedInput(t, out)
	var params map[string]json.RawMessage
	if err := json.Unmarshal(updated["params"], &params); err != nil {
		t.Fatalf("expected params object, got unparseable %s: %v", updated["params"], err)
	}
	if _, ok := params["_instrumentation_v2"]; !ok {
		t.Error("expected _instrumentation_v2 injected despite string-encoded null params")
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

// injectWithAISupplied runs InjectInstrumentation with the given AI-supplied
// _instrumentation_v2 already present and returns the resulting fields.
func injectWithAISupplied(t *testing.T, aiSuppliedInstrJSON string) map[string]json.RawMessage {
	t.Helper()
	isolateEnv(t)
	setupPluginRoot(t, "carta-crm", "1.0.0")
	stdin := `{"tool_name":"some_tool","tool_input":{"_instrumentation_v2":` + aiSuppliedInstrJSON + `},"session_id":"s1"}`
	out, err := InjectInstrumentation([]byte(stdin))
	if err != nil {
		t.Fatal(err)
	}
	updated := parsePreToolUseUpdatedInput(t, out)
	var instr map[string]json.RawMessage
	if err := json.Unmarshal(updated["_instrumentation_v2"], &instr); err != nil {
		t.Fatal(err)
	}
	return instr
}

func fieldAsString(t *testing.T, fields map[string]json.RawMessage, key string) *string {
	t.Helper()
	raw, ok := fields[key]
	if !ok || isMissingJSON(raw) {
		return nil
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		t.Fatal(err)
	}
	return &s
}

// TestInjectInstrumentation_FallbackModelBackfilledWhenHookHasNone covers a
// missing .model marker: the AI-supplied model must survive.
func TestInjectInstrumentation_FallbackModelBackfilledWhenHookHasNone(t *testing.T) {
	instr := injectWithAISupplied(t, `{"model":"claude-sonnet-5"}`)
	if model := fieldAsString(t, instr, "model"); model == nil || *model != "claude-sonnet-5" {
		t.Errorf("model = %v, want backfilled \"claude-sonnet-5\"", model)
	}
	var fromHook bool
	if err := json.Unmarshal(instr["from_hook"], &fromHook); err != nil || !fromHook {
		t.Error("expected from_hook to remain true even when model is backfilled")
	}
}

// TestInjectInstrumentation_HookModelWinsOverFallback covers the hook having
// its own .model value: the AI-supplied fallback must not override it.
func TestInjectInstrumentation_HookModelWinsOverFallback(t *testing.T) {
	isolateEnv(t)
	setupPluginRoot(t, "carta-crm", "1.0.0")
	if err := session.WriteModel("s1", "claude-opus-5"); err != nil {
		t.Fatal(err)
	}

	stdin := `{"tool_name":"some_tool","tool_input":{"_instrumentation_v2":{"model":"claude-sonnet-5"}},"session_id":"s1"}`
	out, err := InjectInstrumentation([]byte(stdin))
	if err != nil {
		t.Fatal(err)
	}
	updated := parsePreToolUseUpdatedInput(t, out)
	var instr map[string]json.RawMessage
	if err := json.Unmarshal(updated["_instrumentation_v2"], &instr); err != nil {
		t.Fatal(err)
	}
	if model := fieldAsString(t, instr, "model"); model == nil || *model != "claude-opus-5" {
		t.Errorf("model = %v, want hook's own \"claude-opus-5\" to win", model)
	}
}

// TestInjectInstrumentation_NonAllowlistedFallbackFieldIgnored guards against
// scope creep: skills is deliberately excluded from fallbackPreserveFields.
func TestInjectInstrumentation_NonAllowlistedFallbackFieldIgnored(t *testing.T) {
	instr := injectWithAISupplied(t, `{"skills":["fake:skill"]}`)
	var skills []string
	if err := json.Unmarshal(instr["skills"], &skills); err != nil {
		t.Fatal(err)
	}
	for _, s := range skills {
		if s == "fake:skill" {
			t.Errorf("skills = %v, fake:skill must not be adopted from AI fallback", skills)
		}
	}
}

// TestInjectInstrumentation_MalformedFallbackPayloadIgnored covers an
// AI-supplied _instrumentation_v2 that isn't a JSON object: the hook payload
// must still inject cleanly with no error.
func TestInjectInstrumentation_MalformedFallbackPayloadIgnored(t *testing.T) {
	isolateEnv(t)
	setupPluginRoot(t, "carta-crm", "1.0.0")

	stdin := `{"tool_name":"some_tool","tool_input":{"_instrumentation_v2":"not-an-object"},"session_id":"s1"}`
	out, err := InjectInstrumentation([]byte(stdin))
	if err != nil {
		t.Fatal(err)
	}
	updated := parsePreToolUseUpdatedInput(t, out)
	var instr struct {
		FromHook bool `json:"from_hook"`
	}
	if err := json.Unmarshal(updated["_instrumentation_v2"], &instr); err != nil {
		t.Fatal(err)
	}
	if !instr.FromHook {
		t.Error("expected hook payload injected normally despite malformed prior")
	}
}

// TestInjectInstrumentation_ParamsToolsFallbackBackfilled exercises the same
// merge for the params-nested injection site used by fetch/mutate.
func TestInjectInstrumentation_ParamsToolsFallbackBackfilled(t *testing.T) {
	isolateEnv(t)
	setupPluginRoot(t, "carta-crm", "1.0.0")

	stdin := `{"tool_name":"mcp__carta__fetch","tool_input":{"params":{"a":1,"_instrumentation_v2":{"model":"claude-sonnet-5"}}},"session_id":"s1"}`
	out, err := InjectInstrumentation([]byte(stdin))
	if err != nil {
		t.Fatal(err)
	}
	updated := parsePreToolUseUpdatedInput(t, out)
	var params map[string]json.RawMessage
	if err := json.Unmarshal(updated["params"], &params); err != nil {
		t.Fatal(err)
	}
	var instr struct {
		Model *string `json:"model"`
	}
	if err := json.Unmarshal(params["_instrumentation_v2"], &instr); err != nil {
		t.Fatal(err)
	}
	if instr.Model == nil || *instr.Model != "claude-sonnet-5" {
		t.Errorf("model = %v, want backfilled \"claude-sonnet-5\" under params", instr.Model)
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

func injectAndGetInstr(t *testing.T, stdin string) map[string]json.RawMessage {
	t.Helper()
	out, err := InjectInstrumentation([]byte(stdin))
	if err != nil {
		t.Fatal(err)
	}
	updated := parsePreToolUseUpdatedInput(t, out)
	var instr map[string]json.RawMessage
	if err := json.Unmarshal(updated["_instrumentation_v2"], &instr); err != nil {
		t.Fatal(err)
	}
	return instr
}

// TestInjectInstrumentation_EntrypointResolvesToSurface covers every mapped
// entrypoint. Unmapped-but-present entrypoints pass through raw (see
// TestInjectInstrumentation_UnmappedEntrypointPassesThroughRaw).
func TestInjectInstrumentation_EntrypointResolvesToSurface(t *testing.T) {
	cases := []struct {
		entrypoint string
		want       string
	}{
		{"cli", "code-terminal"},
		{"claude-desktop", "code-desktop"},
		{"local-agent", "cowork"},
		{"sdk-cli", "sdk-cli"},
		{"sdk-ts", "sdk-typescript"},
		{"sdk-py", "sdk-python"},
	}
	for _, tc := range cases {
		t.Run(tc.entrypoint, func(t *testing.T) {
			isolateEnv(t)
			setupPluginRoot(t, "carta-crm", "1.0.0")
			t.Setenv("CLAUDE_CODE_ENTRYPOINT", tc.entrypoint)

			stdin := `{"tool_name":"some_tool","tool_input":{"foo":"bar"},"session_id":"s1"}`
			instr := injectAndGetInstr(t, stdin)
			if typ := fieldAsString(t, instr, "surface"); typ == nil || *typ != tc.want {
				t.Errorf("surface = %v, want %q", typ, tc.want)
			}
		})
	}
}

// TestInjectInstrumentation_UnmappedEntrypointPassesThroughRaw: the hook can't
// emit metrics, so an unrecognized entrypoint is passed through, not coerced
// to "other" — carta-mcp does that coercion where it can also log the raw value.
func TestInjectInstrumentation_UnmappedEntrypointPassesThroughRaw(t *testing.T) {
	for _, entrypoint := range []string{"claude-vscode", "claude-desktop-3p", "some-future-token-we-have-never-seen"} {
		t.Run(entrypoint, func(t *testing.T) {
			isolateEnv(t)
			setupPluginRoot(t, "carta-crm", "1.0.0")
			t.Setenv("CLAUDE_CODE_ENTRYPOINT", entrypoint)

			stdin := `{"tool_name":"some_tool","tool_input":{"foo":"bar"},"session_id":"s1"}`
			instr := injectAndGetInstr(t, stdin)
			if typ := fieldAsString(t, instr, "surface"); typ == nil || *typ != entrypoint {
				t.Errorf("surface = %v, want raw entrypoint %q passed through", typ, entrypoint)
			}
		})
	}
}

// TestInjectInstrumentation_RemoteResolvesToCodeRemote covers CLAUDE_CODE_REMOTE
// alone, with no entrypoint set.
func TestInjectInstrumentation_RemoteResolvesToCodeRemote(t *testing.T) {
	for _, val := range []string{"1", "true", "yes", "on", "TRUE"} {
		t.Run(val, func(t *testing.T) {
			isolateEnv(t)
			setupPluginRoot(t, "carta-crm", "1.0.0")
			t.Setenv("CLAUDE_CODE_ENTRYPOINT", "")
			t.Setenv("CLAUDE_CODE_REMOTE", val)

			stdin := `{"tool_name":"some_tool","tool_input":{"foo":"bar"},"session_id":"s1"}`
			instr := injectAndGetInstr(t, stdin)
			if typ := fieldAsString(t, instr, "surface"); typ == nil || *typ != "code-remote" {
				t.Errorf("surface = %v, want \"code-remote\"", typ)
			}
		})
	}
}

// TestInjectInstrumentation_RemoteWinsOverEntrypoint: a remote cli session is
// "code-remote", not "code-terminal" — CLAUDE_CODE_REMOTE takes precedence.
func TestInjectInstrumentation_RemoteWinsOverEntrypoint(t *testing.T) {
	isolateEnv(t)
	setupPluginRoot(t, "carta-crm", "1.0.0")
	t.Setenv("CLAUDE_CODE_ENTRYPOINT", "cli")
	t.Setenv("CLAUDE_CODE_REMOTE", "true")

	stdin := `{"tool_name":"some_tool","tool_input":{"foo":"bar"},"session_id":"s1"}`
	instr := injectAndGetInstr(t, stdin)
	if typ := fieldAsString(t, instr, "surface"); typ == nil || *typ != "code-remote" {
		t.Errorf("surface = %v, want \"code-remote\" to win over entrypoint \"cli\"", typ)
	}
}

// TestInjectInstrumentation_NoSignalOmitsSurface covers a client with no
// entrypoint and no remote signal: surface must be absent, not an empty
// string, so mergeFallback treats it as missing and lets the AI fallback fill
// it in — isMissingJSON does not treat "" as present.
func TestInjectInstrumentation_NoSignalOmitsSurface(t *testing.T) {
	isolateEnv(t)
	setupPluginRoot(t, "carta-crm", "1.0.0")
	t.Setenv("CLAUDE_CODE_ENTRYPOINT", "")
	t.Setenv("CLAUDE_CODE_REMOTE", "")

	stdin := `{"tool_name":"some_tool","tool_input":{"foo":"bar"},"session_id":"s1"}`
	instr := injectAndGetInstr(t, stdin)
	if typ := fieldAsString(t, instr, "surface"); typ != nil {
		t.Errorf("surface = %v, want absent with no entrypoint and no remote signal", *typ)
	}
}

// TestInjectInstrumentation_FallbackTypeBackfilledWhenHookHasNone mirrors the model test.
func TestInjectInstrumentation_FallbackTypeBackfilledWhenHookHasNone(t *testing.T) {
	t.Setenv("CLAUDE_CODE_ENTRYPOINT", "")
	t.Setenv("CLAUDE_CODE_REMOTE", "")
	instr := injectWithAISupplied(t, `{"surface":"chat"}`)
	if typ := fieldAsString(t, instr, "surface"); typ == nil || *typ != "chat" {
		t.Errorf("surface = %v, want backfilled \"chat\"", typ)
	}
}

// TestInjectInstrumentation_HookTypeWinsOverFallback mirrors the model precedence test.
func TestInjectInstrumentation_HookTypeWinsOverFallback(t *testing.T) {
	isolateEnv(t)
	setupPluginRoot(t, "carta-crm", "1.0.0")
	t.Setenv("CLAUDE_CODE_ENTRYPOINT", "cli")

	stdin := `{"tool_name":"some_tool","tool_input":{"_instrumentation_v2":{"surface":"chat"}},"session_id":"s1"}`
	instr := injectAndGetInstr(t, stdin)
	if typ := fieldAsString(t, instr, "surface"); typ == nil || *typ != "code-terminal" {
		t.Errorf("surface = %v, want hook's own resolved \"code-terminal\" to win", typ)
	}
}
