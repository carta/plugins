package handlers

import (
	"encoding/json"

	"com.carta.claude_plugins.hooks/internal/hookio"
	"com.carta.claude_plugins.hooks/internal/session"
	"com.carta.claude_plugins.hooks/registry"
)

func init() {
	registry.Register("capture-model-switch", registry.PostModelSwitch, CaptureModelSwitch)
}

type captureModelSwitchEvent struct {
	hookio.SessionEvent
	FromModel string `json:"from_model"`
	ToModel   string `json:"to_model"`
}

// CaptureModelSwitch updates the persisted model name after a mid-session
// switch, so later reads reflect the current model, not the SessionStart one.
func CaptureModelSwitch(stdin []byte) ([]byte, error) {
	var evt captureModelSwitchEvent
	if err := json.Unmarshal(stdin, &evt); err != nil {
		return nil, err
	}
	if evt.SessionID != "" && evt.ToModel != "" {
		_ = session.WriteModel(evt.SessionID, evt.ToModel)
	}
	return hookio.PostModelSwitchOK(), nil
}
