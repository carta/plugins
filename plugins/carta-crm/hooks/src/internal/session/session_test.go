package session

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSanitize(t *testing.T) {
	cases := map[string]string{
		"":                  "no-session",
		"abc-123.def_456":   "abc-123.def_456",
		"has space/slash":   "has_space_slash",
		"weird!@#$%^&*()id": "weird__________id",
	}
	for in, want := range cases {
		if got := Sanitize(in); got != want {
			t.Errorf("Sanitize(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestPluginStateDirDerivation(t *testing.T) {
	t.Setenv("CLAUDE_PLUGIN_DATA", "")
	if got, want := PluginStateDir("carta-crm"), "/tmp/claude-carta-crm"; got != want {
		t.Errorf("PluginStateDir(carta-crm) = %q, want %q", got, want)
	}
}

func TestPluginStateDirDerivationWithPluginData(t *testing.T) {
	t.Setenv("CLAUDE_PLUGIN_DATA", "/var/data")
	if got, want := PluginStateDir("carta-crm"), filepath.Join("/var/data", "sessions"); got != want {
		t.Errorf("PluginStateDir(carta-crm) = %q, want %q", got, want)
	}
}

func TestReadSkillsEmptySessionID(t *testing.T) {
	t.Setenv("CLAUDE_PLUGIN_DATA", t.TempDir())
	if skills := ReadSkills("carta-crm", ""); len(skills) != 0 {
		t.Errorf("ReadSkills with empty session id = %v, want empty", skills)
	}
}

func TestReadSkillsNoStateFile(t *testing.T) {
	t.Setenv("CLAUDE_PLUGIN_DATA", t.TempDir())
	if skills := ReadSkills("carta-crm", "sess-1"); len(skills) != 0 {
		t.Errorf("ReadSkills with no state file = %v, want empty", skills)
	}
}

func TestAppendSkillAndReadBack(t *testing.T) {
	t.Setenv("CLAUDE_PLUGIN_DATA", t.TempDir())
	if err := AppendSkill("carta-crm", "sess-1", "list-deals"); err != nil {
		t.Fatal(err)
	}
	if err := AppendSkill("carta-crm", "sess-1", "list-deals"); err != nil { // dedupe
		t.Fatal(err)
	}
	if err := AppendSkill("carta-crm", "sess-1", "create-deal"); err != nil {
		t.Fatal(err)
	}
	got := ReadSkills("carta-crm", "sess-1")
	want := []string{"list-deals", "create-deal"}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Errorf("ReadSkills = %v, want %v", got, want)
	}
}

func TestAppendSkillEmptySessionIDNoop(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CLAUDE_PLUGIN_DATA", dir)
	if err := AppendSkill("carta-crm", "", "list-deals"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "sessions")); err == nil {
		t.Error("expected no state dir to be created for empty session id")
	}
}

// TestSanitizeEverywhereRegression is the KAF regression test: a session id
// containing characters outside [A-Za-z0-9._-] must round-trip correctly
// between the write path (track-active-skill's AppendSkill) and the read
// path (inject-instrumentation's ReadSkills) — both go through Sanitize, so
// there is no split-brain divergence between them.
func TestSanitizeEverywhereRegression(t *testing.T) {
	t.Setenv("CLAUDE_PLUGIN_DATA", t.TempDir())
	weirdSessionID := "session with spaces/and/slashes"

	if err := AppendSkill("carta-cap-table", weirdSessionID, "create-round"); err != nil {
		t.Fatal(err)
	}

	got := ReadSkills("carta-cap-table", weirdSessionID)
	if len(got) != 1 || got[0] != "create-round" {
		t.Errorf("ReadSkills after round-trip = %v, want [create-round]", got)
	}
}

func TestMergeSessionStateUnion(t *testing.T) {
	t.Setenv("CARTA_SESSION_STATE_DIR", t.TempDir())
	sessionID := "sess-union"

	if err := WriteRecord(sessionID, "carta-crm", "1.0.0", []string{"carta-crm:list-deals"}); err != nil {
		t.Fatal(err)
	}
	if err := WriteRecord(sessionID, "carta-investors", "2.0.0", []string{"carta-investors:list-firms"}); err != nil {
		t.Fatal(err)
	}

	plugins, skills, _, ok := MergeSessionState(sessionID)
	if !ok {
		t.Fatal("expected ok=true")
	}
	if len(plugins) != 2 {
		t.Errorf("plugins = %v, want 2 entries", plugins)
	}
	if len(skills) != 2 {
		t.Errorf("skills = %v, want 2 entries", skills)
	}
}

func TestWriteRecordLeavesNoTempFile(t *testing.T) {
	t.Setenv("CARTA_SESSION_STATE_DIR", t.TempDir())
	sessionID := "sess-atomic"

	if err := WriteRecord(sessionID, "carta-crm", "1.0.0", []string{"carta-crm:list-deals"}); err != nil {
		t.Fatal(err)
	}

	entries, err := os.ReadDir(SessionStateDir(sessionID))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != "carta-crm.json" {
		t.Errorf("dir entries = %v, want exactly [carta-crm.json]", entries)
	}
}

func TestMergeSessionStateEmpty(t *testing.T) {
	t.Setenv("CARTA_SESSION_STATE_DIR", t.TempDir())
	_, _, _, ok := MergeSessionState("no-such-session")
	if ok {
		t.Error("expected ok=false for a session with no registry records")
	}
}

func TestMergeSessionStateRecencyReorder(t *testing.T) {
	t.Setenv("CARTA_SESSION_STATE_DIR", t.TempDir())
	sessionID := "sess-recency"

	if err := WriteRecord(sessionID, "carta-crm", "1.0.0", []string{"carta-crm:list-deals", "carta-crm:create-deal"}); err != nil {
		t.Fatal(err)
	}
	if err := WriteRecord(sessionID, "carta-investors", "2.0.0", []string{"carta-investors:list-firms"}); err != nil {
		t.Fatal(err)
	}
	if err := WriteLastSkill(sessionID, "carta-crm:list-deals"); err != nil {
		t.Fatal(err)
	}

	_, skills, _, ok := MergeSessionState(sessionID)
	if !ok {
		t.Fatal("expected ok=true")
	}
	if last := skills[len(skills)-1]; last != "carta-crm:list-deals" {
		t.Errorf("last skill = %q, want %q (moved to end by recency)", last, "carta-crm:list-deals")
	}
	if len(skills) != 3 {
		t.Errorf("skills = %v, want 3 entries", skills)
	}
}

func TestMergeSessionStateModel(t *testing.T) {
	t.Setenv("CARTA_SESSION_STATE_DIR", t.TempDir())
	sessionID := "sess-model"

	if err := WriteRecord(sessionID, "carta-crm", "1.0.0", nil); err != nil {
		t.Fatal(err)
	}
	if err := WriteModel(sessionID, "claude-sonnet-5"); err != nil {
		t.Fatal(err)
	}

	_, _, model, ok := MergeSessionState(sessionID)
	if !ok {
		t.Fatal("expected ok=true")
	}
	if model != "claude-sonnet-5" {
		t.Errorf("model = %q, want %q", model, "claude-sonnet-5")
	}
}

func TestSessionStateDirDerivation(t *testing.T) {
	t.Setenv("CARTA_SESSION_STATE_DIR", "")
	base := SessionStateBaseDir()
	if want := filepath.Join(os.TempDir(), "carta-instrumentation"); base != want {
		t.Errorf("SessionStateBaseDir() = %q, want %q", base, want)
	}
}
