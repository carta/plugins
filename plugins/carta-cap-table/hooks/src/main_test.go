package main

import (
	"bytes"
	"strings"
	"testing"

	"com.carta.claude_plugins.hooks/registry"
)

func TestRun_UnknownHandlerFailsOpenEmpty(t *testing.T) {
	var stderr bytes.Buffer
	out := run([]string{"hooks", "does-not-exist"}, strings.NewReader(""), &stderr)
	if len(out) != 0 {
		t.Errorf("output = %q, want empty (no registered event to fail open into)", out)
	}
	if stderr.Len() == 0 {
		t.Error("expected a diagnostic on stderr for an unknown handler")
	}
}

func TestRun_MissingArgFailsOpenEmpty(t *testing.T) {
	var stderr bytes.Buffer
	out := run([]string{"hooks"}, strings.NewReader(""), &stderr)
	if len(out) != 0 {
		t.Errorf("output = %q, want empty", out)
	}
}

func TestDispatch_PreToolUseFailOpenOnError(t *testing.T) {
	var stderr bytes.Buffer
	out := dispatch(func(stdin []byte) ([]byte, error) {
		return nil, errBoom
	}, registry.PreToolUse, strings.NewReader("{}"), &stderr)

	want := `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}`
	if string(out) != want {
		t.Errorf("output = %s, want %s", out, want)
	}
}

func TestDispatch_SessionStartFailOpenOnError(t *testing.T) {
	var stderr bytes.Buffer
	out := dispatch(func(stdin []byte) ([]byte, error) {
		return nil, errBoom
	}, registry.SessionStart, strings.NewReader("{}"), &stderr)

	want := `{"hookSpecificOutput":{"hookEventName":"SessionStart"}}`
	if string(out) != want {
		t.Errorf("output = %s, want %s", out, want)
	}
}

func TestDispatch_UserPromptSubmitFailOpenOnErrorIsEmpty(t *testing.T) {
	var stderr bytes.Buffer
	out := dispatch(func(stdin []byte) ([]byte, error) {
		return nil, errBoom
	}, registry.UserPromptSubmit, strings.NewReader("{}"), &stderr)

	if len(out) != 0 {
		t.Errorf("output = %q, want empty", out)
	}
}

func TestDispatch_PanicRecoveredFailsOpen(t *testing.T) {
	var stderr bytes.Buffer
	out := dispatch(func(stdin []byte) ([]byte, error) {
		panic("boom")
	}, registry.PreToolUse, strings.NewReader("{}"), &stderr)

	want := `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}`
	if string(out) != want {
		t.Errorf("output = %s, want %s", out, want)
	}
	if stderr.Len() == 0 {
		t.Error("expected a diagnostic on stderr for a recovered panic")
	}
}

func TestDispatch_SuccessPassesThroughHandlerOutput(t *testing.T) {
	var stderr bytes.Buffer
	out := dispatch(func(stdin []byte) ([]byte, error) {
		return []byte("handler output"), nil
	}, registry.PreToolUse, strings.NewReader("{}"), &stderr)

	if string(out) != "handler output" {
		t.Errorf("output = %q, want %q", out, "handler output")
	}
}

type stubErr string

func (e stubErr) Error() string { return string(e) }

var errBoom = stubErr("boom")
