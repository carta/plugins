package handlers

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCaptureModelSwitch_WritesModelFile(t *testing.T) {
	isolateEnv(t)

	stdin := `{"session_id":"s1","from_model":"claude-sonnet-5","to_model":"claude-opus-5"}`
	out, err := CaptureModelSwitch([]byte(stdin))
	if err != nil {
		t.Fatal(err)
	}
	want := `{"hookSpecificOutput":{"hookEventName":"PostModelSwitch"}}`
	if string(out) != want {
		t.Errorf("output = %s, want %s", out, want)
	}

	regDir := filepath.Join(os.Getenv("CARTA_SESSION_STATE_DIR"), "s1")
	data, err := os.ReadFile(filepath.Join(regDir, ".model"))
	if err != nil {
		t.Fatalf("expected .model file to be written: %v", err)
	}
	if string(data) != "claude-opus-5" {
		t.Errorf(".model contents = %q, want %q", data, "claude-opus-5")
	}
}

func TestCaptureModelSwitch_MissingFieldsNoWrite(t *testing.T) {
	isolateEnv(t)
	regBase := os.Getenv("CARTA_SESSION_STATE_DIR")

	out, err := CaptureModelSwitch([]byte(`{"session_id":"s1","from_model":"claude-sonnet-5"}`))
	if err != nil {
		t.Fatal(err)
	}
	want := `{"hookSpecificOutput":{"hookEventName":"PostModelSwitch"}}`
	if string(out) != want {
		t.Errorf("output = %s, want %s", out, want)
	}
	entries, _ := os.ReadDir(regBase)
	if len(entries) != 0 {
		t.Errorf("expected no writes when to_model is missing, found %v", entries)
	}
}

func TestCaptureModelSwitch_BadStdinFailsOpen(t *testing.T) {
	isolateEnv(t)
	_, err := CaptureModelSwitch([]byte(`not json`))
	if err == nil {
		t.Error("expected an error for unparseable stdin")
	}
}
