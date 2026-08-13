package handlers

import (
	"encoding/json"

	"com.carta.claude_plugins.hooks/internal/hookio"
	"com.carta.claude_plugins.hooks/internal/session"
	"com.carta.claude_plugins.hooks/registry"
)

func init() {
	registry.Register("capture-model", registry.SessionStart, CaptureModel)
}

type captureModelEvent struct {
	hookio.SessionEvent
	Model string `json:"model"`
}

// CaptureModel records the active model name for the session, so a later
// PreToolUse hook (which never receives the model on stdin) can include it.
// The model is the same for every plugin in a session, so a plain
// last-writer-wins write needs no plugin identity or cross-plugin merge.
func CaptureModel(stdin []byte) ([]byte, error) {
	var evt captureModelEvent
	if err := json.Unmarshal(stdin, &evt); err != nil {
		return nil, err
	}
	if evt.SessionID != "" && evt.Model != "" {
		_ = session.WriteModel(evt.SessionID, evt.Model)
	}
	return hookio.SessionStartOK(), nil
}
