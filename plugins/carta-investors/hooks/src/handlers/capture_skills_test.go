package handlers

import (
	"os"
	"path/filepath"
	"testing"

	"com.carta.claude_plugins.hooks/internal/session"
)

const preToolUseAllowJSON = `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}`

func TestCaptureActiveSkill_RecordsOwnSkill(t *testing.T) {
	isolateEnv(t)
	setupPluginRoot(t, "carta-crm", "1.0.0")

	stdin := `{"tool_input":{"skill":"carta-crm:list-deals"},"session_id":"s1"}`
	out, err := CaptureActiveSkill([]byte(stdin))
	if err != nil {
		t.Fatal(err)
	}
	if string(out) != preToolUseAllowJSON {
		t.Errorf("output = %s, want %s", out, preToolUseAllowJSON)
	}

	skills := session.ReadSkills("carta-crm", "s1")
	if len(skills) != 1 || skills[0] != "list-deals" {
		t.Errorf("recorded skills = %v, want [list-deals]", skills)
	}
}

func TestCaptureActiveSkill_IgnoresForeignPluginSkill(t *testing.T) {
	isolateEnv(t)
	setupPluginRoot(t, "carta-crm", "1.0.0")
	sessionStateBase := os.Getenv("CARTA_SESSION_STATE_DIR")

	stdin := `{"tool_input":{"skill":"carta-investors:list-firms"},"session_id":"s1"}`
	out, err := CaptureActiveSkill([]byte(stdin))
	if err != nil {
		t.Fatal(err)
	}
	if string(out) != preToolUseAllowJSON {
		t.Errorf("output = %s, want %s", out, preToolUseAllowJSON)
	}

	skills := session.ReadSkills("carta-crm", "s1")
	if len(skills) != 0 {
		t.Errorf("expected no skills recorded for a foreign-plugin skill, got %v", skills)
	}
	entries, _ := os.ReadDir(sessionStateBase)
	if len(entries) != 0 {
		t.Errorf("expected no session-state writes, found %v", entries)
	}
}

func TestCaptureActiveSkill_WritesLastSkillMarker(t *testing.T) {
	isolateEnv(t)
	setupPluginRoot(t, "carta-crm", "1.0.0")

	stdin := `{"tool_input":{"skill":"carta-crm:list-deals"},"session_id":"s1"}`
	if _, err := CaptureActiveSkill([]byte(stdin)); err != nil {
		t.Fatal(err)
	}

	sessionDir := filepath.Join(os.Getenv("CARTA_SESSION_STATE_DIR"), "s1")
	data, err := os.ReadFile(filepath.Join(sessionDir, ".last-skill"))
	if err != nil {
		t.Fatalf("expected .last-skill marker: %v", err)
	}
	if string(data) != "carta-crm:list-deals" {
		t.Errorf(".last-skill = %q, want %q", data, "carta-crm:list-deals")
	}
}

func TestCaptureActiveSkill_PluginRootUnsetFailsOpenNoWrites(t *testing.T) {
	isolateEnv(t)
	t.Setenv("CLAUDE_PLUGIN_ROOT", "")
	stateBase := os.Getenv("CLAUDE_PLUGIN_DATA")
	sessionStateBase := os.Getenv("CARTA_SESSION_STATE_DIR")

	stdin := `{"tool_input":{"skill":"carta-crm:list-deals"},"session_id":"s1"}`
	out, err := CaptureActiveSkill([]byte(stdin))
	if err != nil {
		t.Fatal(err)
	}
	if string(out) != preToolUseAllowJSON {
		t.Errorf("output = %s, want %s", out, preToolUseAllowJSON)
	}

	if entries, _ := os.ReadDir(filepath.Join(stateBase, "sessions")); len(entries) != 0 {
		t.Errorf("expected no state writes, found %v", entries)
	}
	if entries, _ := os.ReadDir(sessionStateBase); len(entries) != 0 {
		t.Errorf("expected no session-state writes, found %v", entries)
	}
}

// setupPluginRootWithSkill extends setupPluginRoot with a skills/<name> dir,
// for capture-slash-skill's bare-command existence check.
func setupPluginRootWithSkill(t *testing.T, pluginName, version, skillName string) {
	t.Helper()
	setupPluginRoot(t, pluginName, version)
	root := os.Getenv("CLAUDE_PLUGIN_ROOT")
	if err := os.MkdirAll(filepath.Join(root, "skills", skillName), 0o755); err != nil {
		t.Fatal(err)
	}
}

func assertNeverWritesToStdout(t *testing.T, stdin string) []byte {
	t.Helper()
	out, err := CaptureSlashSkill([]byte(stdin))
	if err != nil {
		t.Fatalf("CaptureSlashSkill returned an error (should never): %v", err)
	}
	if len(out) != 0 {
		t.Errorf("output = %q, want zero bytes", out)
	}
	return out
}

func TestCaptureSlashSkill_NeverWritesToStdout(t *testing.T) {
	isolateEnv(t)
	setupPluginRootWithSkill(t, "carta-crm", "1.0.0", "list-deals")

	cases := map[string]string{
		"no prompt at all":                     `{"session_id":"s1"}`,
		"non-slash prompt":                     `{"prompt":"hello there","session_id":"s1"}`,
		"own-plugin bare skill":                `{"prompt":"/list-deals","session_id":"s1"}`,
		"foreign-plugin qualified skill":       `{"prompt":"/carta-investors:list-firms","session_id":"s1"}`,
		"unknown bare command":                 `{"prompt":"/not-a-real-skill","session_id":"s1"}`,
		"unparseable stdin":                    `not json`,
		"missing session id":                   `{"prompt":"/list-deals"}`,
		"own-plugin qualified skill with args": `{"prompt":"/carta-crm:list-deals do the thing","session_id":"s1"}`,
	}
	for name, stdin := range cases {
		t.Run(name, func(t *testing.T) {
			assertNeverWritesToStdout(t, stdin)
		})
	}
}

func TestCaptureSlashSkill_RecordsOwnBareSkill(t *testing.T) {
	isolateEnv(t)
	setupPluginRootWithSkill(t, "carta-crm", "1.0.0", "list-deals")

	assertNeverWritesToStdout(t, `{"prompt":"/list-deals","session_id":"s1"}`)

	skills := session.ReadSkills("carta-crm", "s1")
	if len(skills) != 1 || skills[0] != "list-deals" {
		t.Errorf("recorded skills = %v, want [list-deals]", skills)
	}
}

func TestCaptureSlashSkill_RecordsOwnQualifiedSkill(t *testing.T) {
	isolateEnv(t)
	setupPluginRoot(t, "carta-crm", "1.0.0")

	assertNeverWritesToStdout(t, `{"prompt":"/carta-crm:list-deals","session_id":"s1"}`)

	skills := session.ReadSkills("carta-crm", "s1")
	if len(skills) != 1 || skills[0] != "list-deals" {
		t.Errorf("recorded skills = %v, want [list-deals]", skills)
	}
}

func TestCaptureSlashSkill_IgnoresForeignQualifiedSkill(t *testing.T) {
	isolateEnv(t)
	setupPluginRoot(t, "carta-crm", "1.0.0")

	assertNeverWritesToStdout(t, `{"prompt":"/carta-investors:list-firms","session_id":"s1"}`)

	skills := session.ReadSkills("carta-crm", "s1")
	if len(skills) != 0 {
		t.Errorf("expected no skills recorded, got %v", skills)
	}
}

func TestCaptureSlashSkill_IgnoresUnknownBareCommand(t *testing.T) {
	isolateEnv(t)
	setupPluginRoot(t, "carta-crm", "1.0.0") // no skills dir entries

	assertNeverWritesToStdout(t, `{"prompt":"/not-a-real-skill","session_id":"s1"}`)

	skills := session.ReadSkills("carta-crm", "s1")
	if len(skills) != 0 {
		t.Errorf("expected no skills recorded, got %v", skills)
	}
}

func TestCaptureSlashSkill_WritesLastSkillMarker(t *testing.T) {
	isolateEnv(t)
	setupPluginRootWithSkill(t, "carta-crm", "1.0.0", "list-deals")

	assertNeverWritesToStdout(t, `{"prompt":"/list-deals","session_id":"s1"}`)

	sessionDir := filepath.Join(os.Getenv("CARTA_SESSION_STATE_DIR"), "s1")
	data, err := os.ReadFile(filepath.Join(sessionDir, ".last-skill"))
	if err != nil {
		t.Fatalf("expected .last-skill marker: %v", err)
	}
	if string(data) != "carta-crm:list-deals" {
		t.Errorf(".last-skill = %q, want %q", data, "carta-crm:list-deals")
	}
}

func TestCaptureSlashSkill_PluginRootUnsetFailsOpenNoWrites(t *testing.T) {
	isolateEnv(t)
	t.Setenv("CLAUDE_PLUGIN_ROOT", "")
	stateBase := os.Getenv("CLAUDE_PLUGIN_DATA")
	sessionStateBase := os.Getenv("CARTA_SESSION_STATE_DIR")

	assertNeverWritesToStdout(t, `{"prompt":"/list-deals","session_id":"s1"}`)

	if entries, _ := os.ReadDir(filepath.Join(stateBase, "sessions")); len(entries) != 0 {
		t.Errorf("expected no state writes, found %v", entries)
	}
	if entries, _ := os.ReadDir(sessionStateBase); len(entries) != 0 {
		t.Errorf("expected no session-state writes, found %v", entries)
	}
}
