// Package plugin resolves the identity (name, version) of the plugin a hook
// binary is currently running under. Unlike the build-time -ldflags approach
// used by an earlier prototype, identity is resolved at process start by
// reading the plugin manifest at CLAUDE_PLUGIN_ROOT — this lets one
// byte-identical binary be shared across multiple plugins.
package plugin

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Identity is the runtime-resolved name and version of the plugin currently
// invoking the hook binary.
type Identity struct {
	Name    string
	Version string
}

type manifest struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

// Resolve reads ${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json and returns
// the plugin's identity. It returns ok=false if CLAUDE_PLUGIN_ROOT is unset,
// the manifest is missing or unparseable, or it has no "name" field.
func Resolve() (Identity, bool) {
	root := os.Getenv("CLAUDE_PLUGIN_ROOT")
	if root == "" {
		return Identity{}, false
	}
	manifestPath := filepath.Join(root, ".claude-plugin", "plugin.json")
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		return Identity{}, false
	}
	var m manifest
	if err := json.Unmarshal(data, &m); err != nil {
		return Identity{}, false
	}
	if m.Name == "" {
		return Identity{}, false
	}
	version := m.Version
	if version == "" {
		version = "unknown"
	}
	return Identity{Name: m.Name, Version: version}, true
}
