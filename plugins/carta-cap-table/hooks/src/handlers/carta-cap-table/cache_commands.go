package captable

import (
	"encoding/json"
	"os"
	"path/filepath"

	"com.carta.claude_plugins.hooks/internal/hookio"
	"com.carta.claude_plugins.hooks/internal/plugin"
	"com.carta.claude_plugins.hooks/registry"
)

func init() {
	registry.Register("cache-commands", registry.PostToolUse, CacheCommands)
}

type commandCache struct {
	CachedAt      string          `json:"cached_at"`
	PluginVersion string          `json:"plugin_version"`
	Commands      json.RawMessage `json:"commands"`
}

// CacheCommands writes a discover() call's command registry to
// CLAUDE_PLUGIN_DATA/cache/commands.json, read back by the
// carta-discover-commands skill to skip a network round-trip on a warm
// session. commands is carried as raw JSON bytes rather than decoded and
// re-marshaled — Go marshals a decoded map's keys in sorted order, which
// would silently reshape the payload the skill parses.
func CacheCommands(stdin []byte) ([]byte, error) {
	var evt hookio.PostToolUseEvent
	if err := json.Unmarshal(stdin, &evt); err != nil {
		return hookio.PostToolUseOK(), nil
	}
	if hookio.ShortToolName(evt.ToolName) != "discover" {
		return hookio.PostToolUseOK(), nil
	}

	commands := extractCommands(evt.ToolResponse)
	if commands == nil {
		return hookio.PostToolUseOK(), nil
	}

	var probe []json.RawMessage
	if err := json.Unmarshal(commands, &probe); err != nil {
		return hookio.PostToolUseOK(), nil
	}

	dataDir := os.Getenv("CLAUDE_PLUGIN_DATA")
	if dataDir == "" {
		return hookio.PostToolUseOK(), nil
	}
	cacheDir := filepath.Join(dataDir, "cache")
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		return hookio.PostToolUseOK(), nil
	}

	pluginVersion := "unknown"
	if ident, ok := plugin.Resolve(); ok {
		pluginVersion = ident.Version
	}
	data, err := json.Marshal(commandCache{
		CachedAt:      nowISO(),
		PluginVersion: pluginVersion,
		Commands:      commands,
	})
	if err != nil {
		return hookio.PostToolUseOK(), nil
	}
	_ = os.WriteFile(filepath.Join(cacheDir, "commands.json"), data, 0o644)
	return hookio.PostToolUseOK(), nil
}

// extractCommands unwraps discover()'s response envelope to the raw
// "commands" array bytes, or nil if the shape doesn't match. carta-mcp's
// discover tool returns {"result": "<json-encoded-string>"}; Claude Code
// then JSON-encodes that whole return value again into tool_response — so
// unwrapping takes two string-decode passes, not one.
func extractCommands(toolResponse string) json.RawMessage {
	if toolResponse == "" {
		return nil
	}
	var envelope struct {
		Result string `json:"result"`
	}
	if err := json.Unmarshal([]byte(toolResponse), &envelope); err != nil || envelope.Result == "" {
		return nil
	}
	var payload struct {
		Commands json.RawMessage `json:"commands"`
	}
	if err := json.Unmarshal([]byte(envelope.Result), &payload); err != nil {
		return nil
	}
	return payload.Commands
}
