package handlers

import (
	"os"
	"path/filepath"
	"time"

	"com.carta.claude_plugins.hooks/internal/hookio"
	"com.carta.claude_plugins.hooks/registry"
)

func init() {
	registry.Register("prune-session-data", registry.SessionStart, PruneSessionData)
}

// maxSessionAge is how long a stale session file is kept in the sessions
// dir before PruneSessionData prunes it on the next SessionStart.
const maxSessionAge = 24 * time.Hour

// PruneSessionData prunes session files older than maxSessionAge from
// CLAUDE_PLUGIN_DATA/sessions. It is a no-op when CLAUDE_PLUGIN_DATA is
// unset or the sessions dir doesn't exist yet, and is fully best-effort: any
// filesystem error is swallowed so a broken data dir never blocks the
// session.
//
// It does not create CLAUDE_PLUGIN_DATA/{sessions,cache} itself — each
// writer (session.AppendSkill, session.WriteModel, cache-commands' cache
// writes, etc.) creates its own directory lazily on first write, so a
// central mkdir here would be redundant.
func PruneSessionData(stdin []byte) ([]byte, error) {
	dataDir := os.Getenv("CLAUDE_PLUGIN_DATA")
	if dataDir == "" {
		return hookio.SessionStartOK(), nil
	}

	pruneStaleSessions(filepath.Join(dataDir, "sessions"))

	return hookio.SessionStartOK(), nil
}

func pruneStaleSessions(sessionsDir string) {
	entries, err := os.ReadDir(sessionsDir)
	if err != nil {
		return
	}
	now := time.Now()
	for _, entry := range entries {
		path := filepath.Join(sessionsDir, entry.Name())
		info, err := entry.Info()
		if err != nil {
			continue
		}
		if now.Sub(info.ModTime()) > maxSessionAge {
			_ = os.Remove(path)
		}
	}
}
