package main

// Contract tests for dispatch.sh — the POSIX shim that forwards hook
// invocations to the compiled Go hooks binary. Exercises shell-level behavior
// (fail-open shapes, binary resolution) alongside the Go unit tests in
// main_test.go that assert the same fail-open shapes internally
// (TestDispatch_*FailOpenOnError).

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

// copyDispatchScript copies tools/hooks/dispatch.sh into a fresh temp dir
// with no bin/ sibling, so no binary can ever resolve — isolating the
// fail-open path from whatever tools/hooks/bin/ contains on this checkout.
func copyDispatchScript(t *testing.T) string {
	t.Helper()
	src, err := os.ReadFile("dispatch.sh")
	if err != nil {
		t.Fatalf("read dispatch.sh: %v", err)
	}
	dir := t.TempDir()
	dest := filepath.Join(dir, "dispatch.sh")
	if err := os.WriteFile(dest, src, 0o755); err != nil {
		t.Fatalf("write dispatch.sh copy: %v", err)
	}
	return dest
}

func runDispatch(t *testing.T, scriptPath string, args ...string) string {
	t.Helper()
	cmd := exec.Command("sh", append([]string{scriptPath}, args...)...)
	out, err := cmd.Output()
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			t.Fatalf("dispatch.sh %v exited nonzero: %v, stderr: %s", args, err, ee.Stderr)
		}
		t.Fatalf("dispatch.sh %v failed: %v", args, err)
	}
	return string(out)
}

func TestDispatchShim_FailOpenShapes(t *testing.T) {
	script := copyDispatchScript(t)
	tests := []struct {
		subcommand string
		want       string
	}{
		{"capture-model", `{"hookSpecificOutput":{"hookEventName":"SessionStart"}}`},
		{"inject-context", `{"hookSpecificOutput":{"hookEventName":"SessionStart"}}`},
		{"capture-active-skill", `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}`},
		{"inject-instrumentation", `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}`},
		{"prune-session-data", `{"hookSpecificOutput":{"hookEventName":"SessionStart"}}`},
		{"cache-commands", `{"hookSpecificOutput":{"hookEventName":"PostToolUse"}}`},
		{"track-corporation", `{"hookSpecificOutput":{"hookEventName":"PostToolUse"}}`},
		{"capture-slash-skill", ""},
		{"does-not-exist", ""},
		{"", ""},
	}
	for _, tc := range tests {
		t.Run(tc.subcommand, func(t *testing.T) {
			out := runDispatch(t, script, tc.subcommand)
			if out != tc.want {
				t.Errorf("subcommand %q: output = %q, want %q", tc.subcommand, out, tc.want)
			}
		})
	}
}

// TestDispatchShim_ResolvesAndExecsStubBinary proves dispatch.sh finds and
// execs whatever executable sits at bin/hooks-<os>-<arch> next to it,
// without needing a real compiled Go binary.
func TestDispatchShim_ResolvesAndExecsStubBinary(t *testing.T) {
	var goos string
	switch runtime.GOOS {
	case "darwin":
		goos = "darwin"
	case "linux":
		goos = "linux"
	default:
		t.Skipf("unsupported test host OS %q for stub-exec check", runtime.GOOS)
	}
	arch := "amd64"
	if runtime.GOARCH == "arm64" {
		arch = "arm64"
	}

	dest := copyDispatchScript(t)
	dir := filepath.Dir(dest)
	binDir := filepath.Join(dir, "bin")
	if err := os.Mkdir(binDir, 0o755); err != nil {
		t.Fatalf("mkdir bin: %v", err)
	}

	stubPath := filepath.Join(binDir, "hooks-"+goos+"-"+arch)
	stub := "#!/bin/sh\necho \"stub-invoked: $1\"\n"
	if err := os.WriteFile(stubPath, []byte(stub), 0o755); err != nil {
		t.Fatalf("write stub binary: %v", err)
	}

	out := runDispatch(t, dest, "capture-model")
	want := "stub-invoked: capture-model\n"
	if out != want {
		t.Errorf("output = %q, want %q", out, want)
	}
}

// TestDispatchShim_WalksUpToMarketplaceClone reproduces a cache-copy install
// with no bin/ sibling but a marketplaces/<name>/tools/hooks/bin/ sibling.
func TestDispatchShim_WalksUpToMarketplaceClone(t *testing.T) {
	var goos string
	switch runtime.GOOS {
	case "darwin":
		goos = "darwin"
	case "linux":
		goos = "linux"
	default:
		t.Skipf("unsupported test host OS %q for stub-exec check", runtime.GOOS)
	}
	arch := "amd64"
	if runtime.GOARCH == "arm64" {
		arch = "arm64"
	}

	root := t.TempDir()
	hooksDir := filepath.Join(root, "cache", "carta-development-tools", "carta-cap-table", "1.0.0", "hooks")
	if err := os.MkdirAll(hooksDir, 0o755); err != nil {
		t.Fatalf("mkdir hooks dir: %v", err)
	}
	src, err := os.ReadFile("dispatch.sh")
	if err != nil {
		t.Fatalf("read dispatch.sh: %v", err)
	}
	dest := filepath.Join(hooksDir, "dispatch.sh")
	if err := os.WriteFile(dest, src, 0o755); err != nil {
		t.Fatalf("write dispatch.sh copy: %v", err)
	}

	binDir := filepath.Join(root, "marketplaces", "carta-development-tools", "tools", "hooks", "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatalf("mkdir bin dir: %v", err)
	}
	stubPath := filepath.Join(binDir, "hooks-"+goos+"-"+arch)
	stub := "#!/bin/sh\necho \"stub-invoked: $1\"\n"
	if err := os.WriteFile(stubPath, []byte(stub), 0o755); err != nil {
		t.Fatalf("write stub binary: %v", err)
	}

	out := runDispatch(t, dest, "capture-model")
	want := "stub-invoked: capture-model\n"
	if out != want {
		t.Errorf("output = %q, want %q", out, want)
	}
}

// TestDispatchShim_NoMarketplaceSiblingFailsOpen proves a copy with no bin/
// sibling and no reachable marketplaces/ ancestor still fails open cleanly.
func TestDispatchShim_NoMarketplaceSiblingFailsOpen(t *testing.T) {
	root := t.TempDir()
	hooksDir := filepath.Join(root, "some", "unrelated", "nesting", "hooks")
	if err := os.MkdirAll(hooksDir, 0o755); err != nil {
		t.Fatalf("mkdir hooks dir: %v", err)
	}
	src, err := os.ReadFile("dispatch.sh")
	if err != nil {
		t.Fatalf("read dispatch.sh: %v", err)
	}
	dest := filepath.Join(hooksDir, "dispatch.sh")
	if err := os.WriteFile(dest, src, 0o755); err != nil {
		t.Fatalf("write dispatch.sh copy: %v", err)
	}

	out := runDispatch(t, dest, "capture-model")
	want := `{"hookSpecificOutput":{"hookEventName":"SessionStart"}}`
	if out != want {
		t.Errorf("output = %q, want %q", out, want)
	}
}
