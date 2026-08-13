package registry

import "testing"

func TestRegisterAndLookup(t *testing.T) {
	Register("test-handler-lookup", PreToolUse, func(stdin []byte) ([]byte, error) {
		return []byte("ok"), nil
	})

	handler, event, ok := Lookup("test-handler-lookup")
	if !ok {
		t.Fatal("expected handler to be found")
	}
	if event != PreToolUse {
		t.Errorf("event = %q, want %q", event, PreToolUse)
	}
	out, err := handler(nil)
	if err != nil || string(out) != "ok" {
		t.Errorf("handler() = %q, %v", out, err)
	}
}

func TestLookupUnknown(t *testing.T) {
	_, _, ok := Lookup("does-not-exist")
	if ok {
		t.Error("expected ok=false for unknown handler name")
	}
}

func TestRegisterDuplicatePanics(t *testing.T) {
	Register("test-handler-dup", SessionStart, func(stdin []byte) ([]byte, error) { return nil, nil })
	defer func() {
		if recover() == nil {
			t.Error("expected panic on duplicate registration")
		}
	}()
	Register("test-handler-dup", SessionStart, func(stdin []byte) ([]byte, error) { return nil, nil })
}
