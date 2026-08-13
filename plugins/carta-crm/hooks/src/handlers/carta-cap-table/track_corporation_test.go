package captable

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func readPrefs(t *testing.T, dataDir string) prefsFile {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(dataDir, "prefs.json"))
	if err != nil {
		t.Fatalf("read prefs.json: %v", err)
	}
	var prefs prefsFile
	if err := json.Unmarshal(data, &prefs); err != nil {
		t.Fatalf("unmarshal prefs.json: %v", err)
	}
	return prefs
}

func TestTrackCorporation_RecordsCorporationIDFromNumber(t *testing.T) {
	dataDir := isolateEnv(t)
	stdin := `{"tool_name":"mcp__carta-local__fetch","tool_input":{"params":{"corporation_id":12345}}}`

	if _, err := TrackCorporation([]byte(stdin)); err != nil {
		t.Fatal(err)
	}
	prefs := readPrefs(t, dataDir)
	var last string
	if err := json.Unmarshal(prefs["last_corporation_id"], &last); err != nil {
		t.Fatal(err)
	}
	if last != "12345" {
		t.Errorf("last_corporation_id = %q, want %q", last, "12345")
	}
}

func TestTrackCorporation_RecordsCorporationIDFromString(t *testing.T) {
	dataDir := isolateEnv(t)
	stdin := `{"tool_name":"fetch","tool_input":{"params":{"corporation_id":"98765"}}}`

	if _, err := TrackCorporation([]byte(stdin)); err != nil {
		t.Fatal(err)
	}
	prefs := readPrefs(t, dataDir)
	var last string
	if err := json.Unmarshal(prefs["last_corporation_id"], &last); err != nil {
		t.Fatal(err)
	}
	if last != "98765" {
		t.Errorf("last_corporation_id = %q, want %q", last, "98765")
	}
}

func TestTrackCorporation_NoCorporationIDIsNoop(t *testing.T) {
	dataDir := isolateEnv(t)
	stdin := `{"tool_name":"fetch","tool_input":{"params":{}}}`

	if _, err := TrackCorporation([]byte(stdin)); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "prefs.json")); !os.IsNotExist(err) {
		t.Errorf("expected no prefs.json, err = %v", err)
	}
}

func TestTrackCorporation_IgnoresNonFetchTool(t *testing.T) {
	dataDir := isolateEnv(t)
	stdin := `{"tool_name":"discover","tool_input":{"params":{"corporation_id":1}}}`

	if _, err := TrackCorporation([]byte(stdin)); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "prefs.json")); !os.IsNotExist(err) {
		t.Errorf("expected no prefs.json, err = %v", err)
	}
}

func TestTrackCorporation_RecentCorporationsDedupesAndCapsAtTen(t *testing.T) {
	dataDir := isolateEnv(t)
	for i := 0; i < 12; i++ {
		stdin := fmt.Sprintf(`{"tool_name":"fetch","tool_input":{"params":{"corporation_id":%d}}}`, i)
		if _, err := TrackCorporation([]byte(stdin)); err != nil {
			t.Fatal(err)
		}
	}
	// Re-fetch id 5: must move to the end, not duplicate.
	if _, err := TrackCorporation([]byte(`{"tool_name":"fetch","tool_input":{"params":{"corporation_id":5}}}`)); err != nil {
		t.Fatal(err)
	}

	prefs := readPrefs(t, dataDir)
	var recent []string
	if err := json.Unmarshal(prefs["recent_corporations"], &recent); err != nil {
		t.Fatal(err)
	}
	if len(recent) != maxRecentCorporations {
		t.Fatalf("recent_corporations length = %d, want %d", len(recent), maxRecentCorporations)
	}
	if recent[len(recent)-1] != "5" {
		t.Errorf("last entry = %q, want %q (re-fetched id must move to end)", recent[len(recent)-1], "5")
	}
	seen := map[string]int{}
	for _, id := range recent {
		seen[id]++
	}
	if seen["5"] != 1 {
		t.Errorf("id %q appears %d times, want 1", "5", seen["5"])
	}
}

func TestTrackCorporation_UnknownPrefsKeysSurvive(t *testing.T) {
	dataDir := isolateEnv(t)
	preexisting := `{"some_other_setting":"keep-me"}`
	if err := os.WriteFile(filepath.Join(dataDir, "prefs.json"), []byte(preexisting), 0o644); err != nil {
		t.Fatal(err)
	}

	stdin := `{"tool_name":"fetch","tool_input":{"params":{"corporation_id":1}}}`
	if _, err := TrackCorporation([]byte(stdin)); err != nil {
		t.Fatal(err)
	}

	prefs := readPrefs(t, dataDir)
	var kept string
	if err := json.Unmarshal(prefs["some_other_setting"], &kept); err != nil {
		t.Fatalf("some_other_setting missing after rewrite: %v", err)
	}
	if kept != "keep-me" {
		t.Errorf("some_other_setting = %q, want %q", kept, "keep-me")
	}
}

func TestTrackCorporation_ParamsAsJSONEncodedString(t *testing.T) {
	dataDir := isolateEnv(t)
	stdin := `{"tool_name":"fetch","tool_input":{"params":"{\"corporation_id\":42}"}}`

	if _, err := TrackCorporation([]byte(stdin)); err != nil {
		t.Fatal(err)
	}
	prefs := readPrefs(t, dataDir)
	var last string
	if err := json.Unmarshal(prefs["last_corporation_id"], &last); err != nil {
		t.Fatal(err)
	}
	if last != "42" {
		t.Errorf("last_corporation_id = %q, want %q", last, "42")
	}
}

func TestTrackCorporation_UnparsableParamsStringIsNoop(t *testing.T) {
	dataDir := isolateEnv(t)
	stdin := `{"tool_name":"fetch","tool_input":{"params":"not json"}}`

	if _, err := TrackCorporation([]byte(stdin)); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "prefs.json")); !os.IsNotExist(err) {
		t.Errorf("expected no prefs.json, err = %v", err)
	}
}

func TestTrackCorporation_NoopWhenPluginDataUnset(t *testing.T) {
	t.Setenv("CLAUDE_PLUGIN_DATA", "")
	stdin := `{"tool_name":"fetch","tool_input":{"params":{"corporation_id":1}}}`

	out, err := TrackCorporation([]byte(stdin))
	if err != nil {
		t.Fatal(err)
	}
	if string(out) != `{"hookSpecificOutput":{"hookEventName":"PostToolUse"}}` {
		t.Errorf("output = %s", out)
	}
}
