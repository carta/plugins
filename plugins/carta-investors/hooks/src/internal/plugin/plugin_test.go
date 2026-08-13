package plugin

import (
	"os"
	"path/filepath"
	"testing"
)

func writeManifest(t *testing.T, root, contents string) {
	t.Helper()
	dir := filepath.Join(root, ".claude-plugin")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "plugin.json"), []byte(contents), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestResolveUnsetPluginRoot(t *testing.T) {
	t.Setenv("CLAUDE_PLUGIN_ROOT", "")
	_, ok := Resolve()
	if ok {
		t.Error("expected ok=false when CLAUDE_PLUGIN_ROOT is unset")
	}
}

func TestResolveSuccess(t *testing.T) {
	root := t.TempDir()
	writeManifest(t, root, `{"name":"carta-crm","version":"1.2.3"}`)
	t.Setenv("CLAUDE_PLUGIN_ROOT", root)

	ident, ok := Resolve()
	if !ok {
		t.Fatal("expected ok=true")
	}
	if ident.Name != "carta-crm" || ident.Version != "1.2.3" {
		t.Errorf("ident = %+v", ident)
	}
}

func TestResolveMissingManifest(t *testing.T) {
	root := t.TempDir()
	t.Setenv("CLAUDE_PLUGIN_ROOT", root)

	_, ok := Resolve()
	if ok {
		t.Error("expected ok=false when manifest is missing")
	}
}

func TestResolveUnparseableManifest(t *testing.T) {
	root := t.TempDir()
	writeManifest(t, root, `not json`)
	t.Setenv("CLAUDE_PLUGIN_ROOT", root)

	_, ok := Resolve()
	if ok {
		t.Error("expected ok=false when manifest is unparseable")
	}
}

func TestResolveNoName(t *testing.T) {
	root := t.TempDir()
	writeManifest(t, root, `{"version":"1.2.3"}`)
	t.Setenv("CLAUDE_PLUGIN_ROOT", root)

	_, ok := Resolve()
	if ok {
		t.Error("expected ok=false when manifest has no name")
	}
}

func TestResolveMissingVersionDefaultsUnknown(t *testing.T) {
	root := t.TempDir()
	writeManifest(t, root, `{"name":"carta-crm"}`)
	t.Setenv("CLAUDE_PLUGIN_ROOT", root)

	ident, ok := Resolve()
	if !ok {
		t.Fatal("expected ok=true")
	}
	if ident.Version != "unknown" {
		t.Errorf("Version = %q, want %q", ident.Version, "unknown")
	}
}
