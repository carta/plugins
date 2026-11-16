package diagnostics

import (
	"encoding/json"
	"os"
	"slices"
	"testing"
)

func readSnapshot(t *testing.T, sessionID string) Snapshot {
	t.Helper()
	data, err := os.ReadFile(Path(sessionID))
	if err != nil {
		t.Fatal(err)
	}
	var snap Snapshot
	if err := json.Unmarshal(data, &snap); err != nil {
		t.Fatal(err)
	}
	return snap
}

func recordStdin(t *testing.T, stdin string) map[string]any {
	t.Helper()
	t.Setenv("CARTA_SESSION_STATE_DIR", t.TempDir())
	Record("s1", []byte(stdin), "linux/arm64", "carta-investors", "7.0.0")
	return readSnapshot(t, "s1").Stdin
}

func asJSON(v any) string {
	data, _ := json.Marshal(v)
	return string(data)
}

func TestRecord_KeepsAllowlistedStringValues(t *testing.T) {
	stdin := recordStdin(t, `{"permission_mode":"default","cwd":"/home/u"}`)
	if stdin["permission_mode"] != "default" || stdin["cwd"] != "/home/u" {
		t.Errorf("stdin = %v, want allowlisted strings kept", stdin)
	}
}

func TestRecord_ReducesStdinValues(t *testing.T) {
	cases := []struct{ name, stdin, key, want string }{
		{"other strings keep only their length", `{"prompt":"Acme Fund NAV"}`, "prompt", `{"string_len":13}`},
		{"tool_input keeps only its keys", `{"tool_input":{"params":{"fund":"Acme Fund"},"name":"x"}}`, "tool_input", `{"keys":["name","params"]}`},
		{"mcp_server keeps name and source", `{"mcp_server":{"name":"carta","source":"claudeai","extra":{"x":1}}}`, "mcp_server", `{"name":"carta","source":"claudeai"}`},
		{"mcp_server unlisted strings keep only their length", `{"mcp_server":{"name":"carta","url":"https://x/?token=abc","port":443}}`, "mcp_server", `{"name":"carta","url":{"string_len":20}}`},
		{"arrays keep only their length", `{"extra":[1,2]}`, "extra", `{"array_len":2}`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := asJSON(recordStdin(t, c.stdin)[c.key]); got != c.want {
				t.Errorf("%s = %s, want %s", c.key, got, c.want)
			}
		})
	}
}

func TestRecord_KeepsNonStringScalarsAsIs(t *testing.T) {
	stdin := recordStdin(t, `{"stop_hook_active":true,"n":3}`)
	if stdin["stop_hook_active"] != true || stdin["n"] != float64(3) {
		t.Errorf("stdin = %v, want non-string scalars kept", stdin)
	}
}

func TestRecord_StampsPluginAndPlatform(t *testing.T) {
	t.Setenv("CARTA_SESSION_STATE_DIR", t.TempDir())
	Record("s1", []byte(`{}`), "linux/arm64", "carta-investors", "7.0.0")
	if snap := readSnapshot(t, "s1"); snap.Plugin != "carta-investors" || snap.Version != "7.0.0" || snap.Platform != "linux/arm64" {
		t.Errorf("identity = %+v", snap)
	}
}

func TestRecord_KeepsOnlyFlagLikeNonSecretValues(t *testing.T) {
	t.Setenv("CARTA_SESSION_STATE_DIR", t.TempDir())
	t.Setenv("CLAUDE_CODE_ENTRYPOINT", "claude-desktop")
	t.Setenv("CLAUDE_CODE_OAUTH_TOKEN", "sk-secret")
	t.Setenv("CLAUDE_CODE_EXTRA_BODY", `{"a":1}`)
	t.Setenv("ANTHROPIC_BASE_URL", "https://example")
	t.Setenv("ANTHROPIC_MODEL", "claude-opus")
	t.Setenv("CARTA_UNRELATED", "x")

	Record("s1", []byte(`{}`), "", "", "")

	env := readSnapshot(t, "s1").Env
	if _, listed := env["CARTA_UNRELATED"]; listed {
		t.Error("CARTA_UNRELATED listed, want only CLAUDE*/ANTHROPIC* names")
	}
	if env["CLAUDE_CODE_ENTRYPOINT"] != "claude-desktop" {
		t.Errorf("entrypoint = %v, want its value", env["CLAUDE_CODE_ENTRYPOINT"])
	}
	for _, name := range []string{"CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_EXTRA_BODY", "ANTHROPIC_BASE_URL", "ANTHROPIC_MODEL"} {
		value, listed := env[name]
		if !listed || value != nil {
			t.Errorf("%s = %v (listed=%v), want name only", name, value, listed)
		}
	}
}

func TestRecord_KeepsTheSessionsFirstSnapshot(t *testing.T) {
	t.Setenv("CARTA_SESSION_STATE_DIR", t.TempDir())

	Record("s1", []byte(`{"permission_mode":"default"}`), "", "first", "")
	Record("s1", []byte(`{"permission_mode":"auto"}`), "", "second", "")

	if snap := readSnapshot(t, "s1"); snap.Plugin != "first" {
		t.Errorf("plugin = %s, want the first snapshot kept", snap.Plugin)
	}
}

func TestRecord_UnparseableStdinIsMarked(t *testing.T) {
	t.Setenv("CARTA_SESSION_STATE_DIR", t.TempDir())

	Record("s1", []byte(`not json`), "", "", "")

	if got := readSnapshot(t, "s1").Stdin; !slices.Equal([]string{"unparseable"}, keysOf(got)) {
		t.Errorf("stdin = %v, want the unparseable marker", got)
	}
}

func TestRecord_SkipsCallsWithoutASession(t *testing.T) {
	t.Setenv("CARTA_SESSION_STATE_DIR", t.TempDir())

	Record("", []byte(`{}`), "", "", "")

	if _, err := os.Stat(Path("")); !os.IsNotExist(err) {
		t.Errorf("stat = %v, want no file for an empty session id", err)
	}
}

func keysOf(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}
