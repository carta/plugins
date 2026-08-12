package captable

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"

	"com.carta.claude_plugins.hooks/internal/hookio"
	"com.carta.claude_plugins.hooks/registry"
)

func init() {
	registry.Register("track-corporation", registry.PostToolUse, TrackCorporation)
}

const maxRecentCorporations = 10

// TrackCorporation records the corporation_id passed to a fetch() call in
// CLAUDE_PLUGIN_DATA/prefs.json, so skills can default to the
// most-recently-used corporation instead of asking every time.
func TrackCorporation(stdin []byte) ([]byte, error) {
	var evt hookio.PostToolUseEvent
	if err := json.Unmarshal(stdin, &evt); err != nil {
		return hookio.PostToolUseOK(), nil
	}
	if hookio.ShortToolName(evt.ToolName) != "fetch" {
		return hookio.PostToolUseOK(), nil
	}

	corpID, ok := extractCorporationID(evt.ToolInput)
	if !ok {
		return hookio.PostToolUseOK(), nil
	}

	dataDir := os.Getenv("CLAUDE_PLUGIN_DATA")
	if dataDir == "" {
		return hookio.PostToolUseOK(), nil
	}

	updatePrefs(dataDir, corpID)
	return hookio.PostToolUseOK(), nil
}

// extractCorporationID reads tool_input.params.corporation_id. params may
// itself be JSON-encoded as a string rather than an object; a params string
// that fails to parse as JSON gives up on tracking entirely, rather than
// falling back to "no params" the way a genuinely absent params would.
func extractCorporationID(toolInput json.RawMessage) (string, bool) {
	if len(toolInput) == 0 {
		return "", false
	}
	var wrapper struct {
		Params json.RawMessage `json:"params"`
	}
	if err := json.Unmarshal(toolInput, &wrapper); err != nil {
		return "", false
	}

	params := wrapper.Params
	if len(params) == 0 || string(params) == "null" {
		params = json.RawMessage("{}")
	}

	var asString string
	if err := json.Unmarshal(params, &asString); err == nil {
		if !json.Valid([]byte(asString)) {
			return "", false
		}
		params = json.RawMessage(asString)
	}

	var fields struct {
		CorporationID json.RawMessage `json:"corporation_id"`
	}
	if err := json.Unmarshal(params, &fields); err != nil {
		return "", false
	}
	return rawScalarToString(fields.CorporationID)
}

// rawScalarToString stringifies a JSON scalar the way JS's String() would: a
// JSON string decodes to its content; any other scalar (number, bool) passes
// through as its literal JSON text, preserving precision a float64 round-trip
// could lose. Absent/null reports not-present.
func rawScalarToString(raw json.RawMessage) (string, bool) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || string(trimmed) == "null" {
		return "", false
	}
	var s string
	if err := json.Unmarshal(trimmed, &s); err == nil {
		return s, true
	}
	return string(trimmed), true
}

type prefsFile map[string]json.RawMessage

// updatePrefs reads CLAUDE_PLUGIN_DATA/prefs.json (if present), updates
// last_corporation_id and the recent_corporations MRU list, and writes it
// back. Reads/writes through a raw-message map so any key another writer
// added survives the round-trip untouched.
func updatePrefs(dataDir, corpID string) {
	prefsPath := filepath.Join(dataDir, "prefs.json")

	prefs := prefsFile{}
	if data, err := os.ReadFile(prefsPath); err == nil {
		_ = json.Unmarshal(data, &prefs)
	}
	if prefs == nil {
		prefs = prefsFile{}
	}

	recent := appendMRU(readRecentCorporations(prefs), corpID, maxRecentCorporations)

	idBytes, _ := json.Marshal(corpID)
	prefs["last_corporation_id"] = idBytes
	recentBytes, _ := json.Marshal(recent)
	prefs["recent_corporations"] = recentBytes
	updatedBytes, _ := json.Marshal(nowISO())
	prefs["updated_at"] = updatedBytes

	data, err := json.Marshal(prefs)
	if err != nil {
		return
	}
	_ = os.WriteFile(prefsPath, data, 0o644)
}

func readRecentCorporations(prefs prefsFile) []string {
	raw, ok := prefs["recent_corporations"]
	if !ok {
		return []string{}
	}
	var recent []string
	if err := json.Unmarshal(raw, &recent); err != nil {
		return []string{}
	}
	return recent
}

// appendMRU moves id to the end of recent (removing an existing occurrence
// first) and caps the result to the most recent max entries.
func appendMRU(recent []string, id string, max int) []string {
	out := make([]string, 0, len(recent)+1)
	for _, existing := range recent {
		if existing != id {
			out = append(out, existing)
		}
	}
	out = append(out, id)
	if len(out) > max {
		out = out[len(out)-max:]
	}
	return out
}
