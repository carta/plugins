// Package session implements the on-disk state shared across hook
// invocations: per-plugin skill state (PluginState*) and cross-plugin
// per-session state (SessionState*) used to union instrumentation across
// plugins and track recency of skill invocation.
//
// Every path derived from a session id goes through Sanitize, on both the
// read and write side, for every consumer — this is the single point of
// convergence that prevents a split-brain where one hook sanitizes a
// session id and another doesn't, so a write and a later read silently
// land on different paths.
package session

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

var sanitizeRe = regexp.MustCompile(`[^A-Za-z0-9._-]`)

// Sanitize replaces any character outside [A-Za-z0-9._-] with '_'. An empty
// session id is treated as "no-session".
func Sanitize(sessionID string) string {
	if sessionID == "" {
		sessionID = "no-session"
	}
	return sanitizeRe.ReplaceAllString(sessionID, "_")
}

// PluginStateDir returns the per-plugin directory holding per-session skill
// state: $CLAUDE_PLUGIN_DATA/sessions if CLAUDE_PLUGIN_DATA is set, else
// /tmp/claude-<pluginName>.
func PluginStateDir(pluginName string) string {
	if dataDir := os.Getenv("CLAUDE_PLUGIN_DATA"); dataDir != "" {
		return filepath.Join(dataDir, "sessions")
	}
	return "/tmp/claude-" + pluginName
}

// PluginStatePath returns the sanitized per-session state file path within a
// plugin's state dir.
func PluginStatePath(pluginName, sessionID string) string {
	return filepath.Join(PluginStateDir(pluginName), Sanitize(sessionID)+".json")
}

type stateFile struct {
	Skills []string `json:"skills"`
}

// ReadSkills returns the skills recorded for this plugin+session, or an
// empty slice if there is none / it can't be read. sessionID == "" always
// yields an empty slice without touching disk (matching the JS: `if
// (!sessionId) return [];`).
func ReadSkills(pluginName, sessionID string) []string {
	if sessionID == "" {
		return []string{}
	}
	data, err := os.ReadFile(PluginStatePath(pluginName, sessionID))
	if err != nil {
		return []string{}
	}
	var sf stateFile
	if err := json.Unmarshal(data, &sf); err != nil {
		return []string{}
	}
	if sf.Skills == nil {
		return []string{}
	}
	return sf.Skills
}

// AppendSkill records skillName for this plugin+session if not already
// present, creating the state dir/file as needed. No-op if sessionID == "".
func AppendSkill(pluginName, sessionID, skillName string) error {
	if sessionID == "" {
		return nil
	}
	dir := PluginStateDir(pluginName)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	path := PluginStatePath(pluginName, sessionID)
	var sf stateFile
	if data, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(data, &sf)
	}
	if sf.Skills == nil {
		sf.Skills = []string{}
	}
	found := false
	for _, s := range sf.Skills {
		if s == skillName {
			found = true
			break
		}
	}
	if !found {
		sf.Skills = append(sf.Skills, skillName)
	}
	data, err := json.Marshal(sf)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

// SessionStateBaseDir returns the root of the cross-plugin session state:
// $CARTA_SESSION_STATE_DIR if set, else os.TempDir()/carta-instrumentation.
func SessionStateBaseDir() string {
	if base := os.Getenv("CARTA_SESSION_STATE_DIR"); base != "" {
		return base
	}
	return filepath.Join(os.TempDir(), "carta-instrumentation")
}

// SessionStateDir returns the sanitized per-session directory within the
// session state base.
func SessionStateDir(sessionID string) string {
	return filepath.Join(SessionStateBaseDir(), Sanitize(sessionID))
}

// Record is one plugin's contribution to a session's shared state.
type Record struct {
	Plugin  string   `json:"plugin"`
	Version string   `json:"version"`
	Skills  []string `json:"skills"`
}

// WriteRecord writes this plugin's contribution to the shared session
// state dir. Writes are atomic, so readers never see a torn record.
func WriteRecord(sessionID, pluginName, version string, skills []string) error {
	dir := SessionStateDir(sessionID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	rec := Record{Plugin: pluginName, Version: version, Skills: skills}
	data, err := json.Marshal(rec)
	if err != nil {
		return err
	}
	return writeFileAtomic(filepath.Join(dir, pluginName+".json"), data, 0o644)
}

// writeFileAtomic writes via temp file + rename so readers never see a torn write.
func writeFileAtomic(path string, data []byte, perm os.FileMode) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), filepath.Base(path)+".tmp-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)

	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmpPath, perm); err != nil {
		return err
	}
	return os.Rename(tmpPath, path)
}

// PluginRef identifies a plugin contributing to the merged instrumentation.
type PluginRef struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

// MergeSessionState reads every record in the session's shared state
// directory and returns the union of plugins and deduped skills (in
// directory-sort, ~alphabetical-by-plugin order), reordered so that the
// skill named by the ".last-skill" marker (if any and if present in the
// union) is moved to the end. ok is false if the directory has no readable
// records at all (caller should fall back to a self-only view).
func MergeSessionState(sessionID string) (plugins []PluginRef, skills []string, model string, ok bool) {
	dir := SessionStateDir(sessionID)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, nil, "", false
	}

	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".json") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)

	plugins = []PluginRef{}
	skills = []string{}
	seen := map[string]bool{}
	for _, name := range names {
		data, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			continue
		}
		var rec Record
		if err := json.Unmarshal(data, &rec); err != nil {
			continue
		}
		pluginName := rec.Plugin
		if pluginName == "" {
			pluginName = strings.TrimSuffix(name, ".json")
		}
		plugins = append(plugins, PluginRef{Name: pluginName, Version: rec.Version})
		for _, s := range rec.Skills {
			if !seen[s] {
				seen[s] = true
				skills = append(skills, s)
			}
		}
	}
	if len(plugins) == 0 {
		return nil, nil, "", false
	}

	if last, err := os.ReadFile(filepath.Join(dir, ".last-skill")); err == nil {
		lastSkill := strings.TrimSpace(string(last))
		if lastSkill != "" {
			idx := -1
			for i, s := range skills {
				if s == lastSkill {
					idx = i
					break
				}
			}
			if idx > -1 {
				skills = append(skills[:idx], skills[idx+1:]...)
				skills = append(skills, lastSkill)
			}
		}
	}

	if m, err := os.ReadFile(filepath.Join(dir, ".model")); err == nil {
		model = strings.TrimSpace(string(m))
	}

	return plugins, skills, model, true
}

// WriteLastSkill records skillFull (the full namespaced skill string, e.g.
// "carta-crm:list-deals") as the most recently invoked skill for this
// session.
func WriteLastSkill(sessionID, skillFull string) error {
	dir := SessionStateDir(sessionID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, ".last-skill"), []byte(skillFull), 0o644)
}

// WriteModel records the active model name for this session's shared state.
func WriteModel(sessionID, model string) error {
	dir := SessionStateDir(sessionID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, ".model"), []byte(model), 0o644)
}
