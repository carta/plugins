package captable

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// isolateEnv points CLAUDE_PLUGIN_DATA at a fresh temp dir for the duration
// of t. Local to this package since the handlers package's own isolateEnv
// isn't importable across packages.
func isolateEnv(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("CLAUDE_PLUGIN_DATA", dir)
	return dir
}

// toolResponseEnvelope builds the real Claude Code PostToolUse shape:
// tool_response is a JSON-encoded string of {"result": "<json-encoded
// string>"}, itself the tool's own {"commands": [...]} payload — two
// string-decode passes, confirmed against a live carta-mcp discover() call.
func toolResponseEnvelope(t *testing.T, innerJSON string) string {
	t.Helper()
	result, err := json.Marshal(map[string]string{"result": innerJSON})
	if err != nil {
		t.Fatal(err)
	}
	outer, err := json.Marshal(string(result))
	if err != nil {
		t.Fatal(err)
	}
	return string(outer)
}

func TestCacheCommands_CachesDiscoverResult(t *testing.T) {
	dataDir := isolateEnv(t)
	// Deliberately out-of-alphabetical-order keys: verifies the cache
	// preserves the exact bytes rather than round-tripping through a Go
	// map, which would sort them.
	inner := `{"commands":[{"description":"List stakeholders","command":"cap_table:list:stakeholders"}],"count":1}`
	stdin := `{"tool_name":"mcp__carta-local__discover","tool_response":` + toolResponseEnvelope(t, inner) + `}`

	out, err := CacheCommands([]byte(stdin))
	if err != nil {
		t.Fatal(err)
	}
	if string(out) != `{"hookSpecificOutput":{"hookEventName":"PostToolUse"}}` {
		t.Errorf("output = %s", out)
	}

	data, err := os.ReadFile(filepath.Join(dataDir, "cache", "commands.json"))
	if err != nil {
		t.Fatalf("read cache: %v", err)
	}
	want := `{"cached_at":`
	if len(data) < len(want) || string(data[:len(want)]) != want {
		t.Errorf("cache = %s", data)
	}
	var cached commandCache
	if err := json.Unmarshal(data, &cached); err != nil {
		t.Fatalf("unmarshal cache: %v", err)
	}
	wantCommands := `[{"description":"List stakeholders","command":"cap_table:list:stakeholders"}]`
	if string(cached.Commands) != wantCommands {
		t.Errorf("commands = %s, want %s (key order must survive verbatim)", cached.Commands, wantCommands)
	}
}

func TestCacheCommands_IgnoresNonDiscoverTool(t *testing.T) {
	dataDir := isolateEnv(t)
	stdin := `{"tool_name":"mcp__carta-local__fetch","tool_response":` + toolResponseEnvelope(t, `{"commands":[]}`) + `}`

	if _, err := CacheCommands([]byte(stdin)); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "cache", "commands.json")); !os.IsNotExist(err) {
		t.Errorf("expected no cache file, err = %v", err)
	}
}

func TestCacheCommands_MalformedResultTextWritesNothing(t *testing.T) {
	dataDir := isolateEnv(t)
	stdin := `{"tool_name":"discover","tool_response":` + toolResponseEnvelope(t, `not json`) + `}`

	if _, err := CacheCommands([]byte(stdin)); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "cache", "commands.json")); !os.IsNotExist(err) {
		t.Errorf("expected no cache file, err = %v", err)
	}
}

func TestCacheCommands_NoopWhenPluginDataUnset(t *testing.T) {
	t.Setenv("CLAUDE_PLUGIN_DATA", "")
	stdin := `{"tool_name":"discover","tool_response":` + toolResponseEnvelope(t, `{"commands":[]}`) + `}`

	out, err := CacheCommands([]byte(stdin))
	if err != nil {
		t.Fatal(err)
	}
	if string(out) != `{"hookSpecificOutput":{"hookEventName":"PostToolUse"}}` {
		t.Errorf("output = %s", out)
	}
}
