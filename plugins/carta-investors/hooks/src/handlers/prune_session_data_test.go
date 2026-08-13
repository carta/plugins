package handlers

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestPruneSessionData_PrunesStaleSessions(t *testing.T) {
	isolateEnv(t)
	dataDir := os.Getenv("CLAUDE_PLUGIN_DATA")
	sessionsDir := filepath.Join(dataDir, "sessions")
	if err := os.MkdirAll(sessionsDir, 0o755); err != nil {
		t.Fatal(err)
	}

	stale := filepath.Join(sessionsDir, "old.json")
	fresh := filepath.Join(sessionsDir, "new.json")
	if err := os.WriteFile(stale, []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(fresh, []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	oldTime := time.Now().Add(-25 * time.Hour)
	if err := os.Chtimes(stale, oldTime, oldTime); err != nil {
		t.Fatal(err)
	}

	if _, err := PruneSessionData([]byte(`{}`)); err != nil {
		t.Fatal(err)
	}

	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Errorf("expected stale session file to be pruned, err = %v", err)
	}
	if _, err := os.Stat(fresh); err != nil {
		t.Errorf("expected fresh session file to remain: %v", err)
	}
}

func TestPruneSessionData_NoopWhenSessionsDirMissing(t *testing.T) {
	isolateEnv(t)

	out, err := PruneSessionData([]byte(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	want := `{"hookSpecificOutput":{"hookEventName":"SessionStart"}}`
	if string(out) != want {
		t.Errorf("output = %s, want %s", out, want)
	}
}

func TestPruneSessionData_NoopWhenDataDirUnset(t *testing.T) {
	t.Setenv("CLAUDE_PLUGIN_DATA", "")

	out, err := PruneSessionData([]byte(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	want := `{"hookSpecificOutput":{"hookEventName":"SessionStart"}}`
	if string(out) != want {
		t.Errorf("output = %s, want %s", out, want)
	}
}
