// Package diagnostics records, on the local machine only, what a hook received.
package diagnostics

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"com.carta.claude_plugins.hooks/internal/session"
)

// FileName has no ".json" suffix so it is never read as a plugin record.
const FileName = ".hook-diagnostics"

// stdinValueKeys are the hook input fields whose string value is kept; any
// other string is reduced to its length, so prompt or tool text never lands here.
var stdinValueKeys = map[string]bool{
	"session_id": true, "hook_event_name": true, "permission_mode": true, "tool_name": true,
	"tool_use_id": true, "agent_id": true, "agent_type": true, "prompt_id": true,
	"cwd": true, "transcript_path": true,
}

// stdinObjectValueKeys names, per object, the fields whose value is kept; mcp_server
// says where the server runs, which may mark a call that runs elsewhere.
var stdinObjectValueKeys = map[string]map[string]bool{
	"mcp_server": {"name": true, "source": true},
}

// envValuePattern keeps short flag-like values ("1", "claude-desktop") and rejects
// URLs, JSON and long values; secretMarkers drops credential-named variables.
var envValuePattern = regexp.MustCompile(`^[A-Za-z0-9._-]{0,40}$`)

var secretMarkers = []string{"TOKEN", "KEY", "SECRET", "AUTH", "PASS", "CREDENTIAL", "COOKIE", "JWT", "BEARER", "PRIVATE", "SIGNATURE"}

// Snapshot is the recorded view of one hook invocation.
type Snapshot struct {
	WrittenAt string         `json:"written_at"`
	Platform  string         `json:"platform"`
	Plugin    string         `json:"plugin"`
	Version   string         `json:"version"`
	Stdin     map[string]any `json:"stdin"`
	Env       map[string]any `json:"env"`
}

// Path returns the session's diagnostics file.
func Path(sessionID string) string {
	return filepath.Join(session.SessionStateDir(sessionID), FileName)
}

// Record writes a snapshot unless the session already has one.
// Every error is dropped: diagnostics must never change what the hook returns.
func Record(sessionID string, stdin []byte, platform, pluginName, version string) {
	if sessionID == "" {
		return
	}
	path := Path(sessionID)
	if _, err := os.Stat(path); err == nil {
		return
	}
	snap := Snapshot{
		WrittenAt: time.Now().UTC().Format(time.RFC3339),
		Platform:  platform,
		Plugin:    pluginName,
		Version:   version,
		Stdin:     describeStdin(stdin),
		Env:       describeEnv(os.Environ()),
	}
	data, err := json.MarshalIndent(snap, "", "  ")
	if err != nil {
		return
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return
	}
	_ = session.WriteFileAtomic(path, data, 0o600)
}

// describeStdin keeps allowlisted strings and non-string scalars, reduces allowlisted
// objects to their allowlisted fields, other objects to their sorted keys and arrays
// to a length, so tool_input values are never kept.
func describeStdin(stdin []byte) map[string]any {
	var top map[string]json.RawMessage
	if err := json.Unmarshal(stdin, &top); err != nil {
		return map[string]any{"unparseable": true}
	}
	out := make(map[string]any, len(top))
	for key, raw := range top {
		var value any
		if err := json.Unmarshal(raw, &value); err != nil {
			continue
		}
		switch v := value.(type) {
		case string:
			if stdinValueKeys[key] {
				out[key] = v
			} else {
				out[key] = map[string]any{"string_len": len(v)}
			}
		case map[string]any:
			if allowed, ok := stdinObjectValueKeys[key]; ok {
				out[key] = allowedFields(v, allowed)
				continue
			}
			keys := make([]string, 0, len(v))
			for k := range v {
				keys = append(keys, k)
			}
			sort.Strings(keys)
			out[key] = map[string]any{"keys": keys}
		case []any:
			out[key] = map[string]any{"array_len": len(v)}
		default:
			out[key] = v
		}
	}
	return out
}

// allowedFields keeps an allowed field's scalar value, reduces any other string to
// its length, and drops the rest.
func allowedFields(obj map[string]any, allowed map[string]bool) map[string]any {
	out := make(map[string]any, len(obj))
	for k, v := range obj {
		switch v := v.(type) {
		case map[string]any, []any:
		case string:
			if allowed[k] {
				out[k] = v
			} else {
				out[k] = map[string]any{"string_len": len(v)}
			}
		default:
			if allowed[k] {
				out[k] = v
			}
		}
	}
	return out
}

// describeEnv lists every CLAUDE*/ANTHROPIC* name. It keeps a value only for a
// CLAUDE_CODE_* name that doesn't look like a credential, and only when it is flag-like.
func describeEnv(environ []string) map[string]any {
	out := map[string]any{}
	for _, kv := range environ {
		name, value, _ := strings.Cut(kv, "=")
		if !strings.HasPrefix(name, "CLAUDE") && !strings.HasPrefix(name, "ANTHROPIC") {
			continue
		}
		if strings.HasPrefix(name, "CLAUDE_CODE_") && !looksSecret(name) && envValuePattern.MatchString(value) {
			out[name] = value
		} else {
			out[name] = nil
		}
	}
	return out
}

func looksSecret(name string) bool {
	for _, marker := range secretMarkers {
		if strings.Contains(name, marker) {
			return true
		}
	}
	return false
}
