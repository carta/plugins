package handlers

import (
	"encoding/json"
	"os"
	"strings"

	"com.carta.claude_plugins.hooks/internal/hookio"
	"com.carta.claude_plugins.hooks/internal/plugin"
	"com.carta.claude_plugins.hooks/internal/session"
	"com.carta.claude_plugins.hooks/internal/tokenusage"
	"com.carta.claude_plugins.hooks/registry"
)

func init() {
	registry.Register("inject-instrumentation", registry.PreToolUse, InjectInstrumentation)
}

// paramsTools is the set of MCP tool short names whose _instrumentation_v2
// payload must be nested inside tool_input.params rather than injected at
// the top level of tool_input.
var paramsTools = map[string]bool{"fetch": true, "mutate": true}

// fallbackPreserveFields lists keys whose AI-supplied value survives when
// the hook has none. The hook stays authoritative for every other key.
var fallbackPreserveFields = map[string]bool{"model": true, "surface": true}

type instrumentationV2 struct {
	Plugins        []session.PluginRef `json:"plugins"`
	Skills         []string            `json:"skills"`
	SessionID      *string             `json:"session_id"`
	PromptID       *string             `json:"prompt_id"`
	PermissionMode *string             `json:"permission_mode"`
	Effort         json.RawMessage     `json:"effort"`
	AgentID        *string             `json:"agent_id"`
	Model          *string             `json:"model"`
	FromHook       bool                `json:"from_hook"`
	// Surface is the resolved Claude surface (e.g. "chat", "code-terminal"), or
	// nil when the hook has no signal — the AI fallback fills it in then.
	Surface          *string `json:"surface"`
	CumulativeTokens *int64  `json:"cumulative_tokens,omitempty"`
}

// InjectInstrumentation injects an _instrumentation_v2 payload into the tool
// call, unioning contributions from every plugin active in this session
// (so the last hook to run never clobbers the others' data) and ordering
// skills so the most recently invoked one is last.
func InjectInstrumentation(stdin []byte) ([]byte, error) {
	var evt hookio.InjectEvent
	if err := json.Unmarshal(stdin, &evt); err != nil {
		return nil, err
	}

	ident, ok := plugin.Resolve()
	if !ok {
		// Identity can't be resolved: fail open, and critically, perform no
		// filesystem writes (we return before touching disk at all).
		return hookio.PreToolUseAllow(), nil
	}

	shortName := hookio.ShortToolName(evt.ToolName)

	skills := session.ReadSkills(ident.Name, evt.SessionID)
	instr := buildInstrumentationV2(ident, evt, skills)

	updatedInput, err := buildUpdatedInput(evt.ToolInput, shortName, instr)
	if err != nil {
		return nil, err
	}

	return hookio.PreToolUseWithUpdatedInput(updatedInput)
}

func buildInstrumentationV2(ident plugin.Identity, evt hookio.InjectEvent, skills []string) instrumentationV2 {
	namespaced := make([]string, len(skills))
	for i, s := range skills {
		namespaced[i] = ident.Name + ":" + s
	}
	surface := resolveSurface()

	var tokens *int64
	if total, ok := tokenusage.CumulativeSessionTokensForSession(evt.TranscriptPath); ok {
		tokens = &total
	}

	selfOnly := instrumentationV2{
		Plugins:          []session.PluginRef{{Name: ident.Name, Version: ident.Version}},
		Skills:           namespaced,
		SessionID:        hookio.StrPtr(evt.SessionID),
		PromptID:         hookio.StrPtr(evt.PromptID),
		PermissionMode:   hookio.StrPtr(evt.PermissionMode),
		Effort:           evt.Effort,
		AgentID:          hookio.StrPtr(evt.AgentID),
		Model:            nil,
		FromHook:         true,
		Surface:          surface,
		CumulativeTokens: tokens,
	}

	if err := session.WriteRecord(evt.SessionID, ident.Name, ident.Version, namespaced); err != nil {
		return selfOnly
	}

	plugins, mergedSkills, model, ok := session.MergeSessionState(evt.SessionID)
	if !ok {
		return selfOnly
	}

	return instrumentationV2{
		Plugins:          plugins,
		Skills:           mergedSkills,
		SessionID:        hookio.StrPtr(evt.SessionID),
		PromptID:         hookio.StrPtr(evt.PromptID),
		PermissionMode:   hookio.StrPtr(evt.PermissionMode),
		Effort:           evt.Effort,
		AgentID:          hookio.StrPtr(evt.AgentID),
		Model:            hookio.StrPtr(model),
		FromHook:         true,
		Surface:          surface,
		CumulativeTokens: tokens,
	}
}

// entrypointToSurface maps a raw CLAUDE_CODE_ENTRYPOINT value to the reported
// surface. "sdk-typescript"/"sdk-python" never appear as raw entrypoint values
// (verified against the claude binary — those are its own pretty-printed names
// for "sdk-ts"/"sdk-py"), so they're not mapped here.
var entrypointToSurface = map[string]string{
	"cli":            "code-terminal",
	"claude-desktop": "code-desktop",
	"local-agent":    "cowork",
	"sdk-cli":        "sdk-cli",
	"sdk-ts":         "sdk-typescript",
	"sdk-py":         "sdk-python",
}

// resolveSurface returns nil only when there is no signal at all. An
// unmapped-but-present entrypoint passes through raw — carta-mcp coerces and
// logs it, since this hook can't emit metrics. CLAUDE_CODE_REMOTE wins over
// entrypoint: verified live that CLAUDE_CODE_ENTRYPOINT is reliable on its own.
func resolveSurface() *string {
	remote := strings.ToLower(strings.TrimSpace(os.Getenv("CLAUDE_CODE_REMOTE")))
	if remote == "1" || remote == "true" || remote == "yes" || remote == "on" {
		codeRemote := "code-remote"
		return &codeRemote
	}
	entrypoint := strings.ToLower(strings.TrimSpace(os.Getenv("CLAUDE_CODE_ENTRYPOINT")))
	if surface, ok := entrypointToSurface[entrypoint]; ok {
		return &surface
	}
	if entrypoint != "" {
		return &entrypoint
	}
	return nil
}

// buildUpdatedInput injects instr into tool_input, nesting it under
// tool_input.params (parsing params if it's itself a JSON-encoded string)
// for PARAMS_TOOLS, or at the top level of tool_input otherwise.
func buildUpdatedInput(toolInputRaw json.RawMessage, shortName string, instr instrumentationV2) (json.RawMessage, error) {
	toolInput := map[string]json.RawMessage{}
	if len(toolInputRaw) > 0 {
		_ = json.Unmarshal(toolInputRaw, &toolInput)
	}

	if paramsTools[shortName] {
		params := map[string]json.RawMessage{}
		canInject := true
		if raw, ok := toolInput["params"]; ok {
			var asString string
			if err := json.Unmarshal(raw, &asString); err == nil {
				var parsed map[string]json.RawMessage
				if err := json.Unmarshal([]byte(asString), &parsed); err == nil && parsed != nil {
					params = parsed
				}
				// A JSON-encoded string that fails to parse as an object, or that
				// decodes to JSON null, falls back to an empty params object.
			} else if err := json.Unmarshal(raw, &params); err != nil {
				// params is neither an object nor a JSON-encoded object string
				// (e.g. an array or a number) — leave it untouched rather than
				// silently discarding whatever the caller actually sent.
				canInject = false
				toolInput["params"] = raw
			}
		}
		if canInject {
			instrBytes, err := mergeFallback(instr, params["_instrumentation_v2"])
			if err != nil {
				return nil, err
			}
			params["_instrumentation_v2"] = instrBytes
			paramsBytes, err := json.Marshal(params)
			if err != nil {
				return nil, err
			}
			toolInput["params"] = paramsBytes
		}
	} else {
		instrBytes, err := mergeFallback(instr, toolInput["_instrumentation_v2"])
		if err != nil {
			return nil, err
		}
		toolInput["_instrumentation_v2"] = instrBytes
	}

	return json.Marshal(toolInput)
}

// mergeFallback backfills fallbackPreserveFields onto instr from the
// AI-supplied payload wherever the hook's own value is missing.
func mergeFallback(instr instrumentationV2, aiSupplied json.RawMessage) (json.RawMessage, error) {
	hook := map[string]json.RawMessage{}
	hookBytes, err := json.Marshal(instr)
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(hookBytes, &hook); err != nil {
		return nil, err
	}

	var aiFields map[string]json.RawMessage
	if len(aiSupplied) == 0 || json.Unmarshal(aiSupplied, &aiFields) != nil {
		return hookBytes, nil
	}

	for field := range fallbackPreserveFields {
		if !isMissingJSON(hook[field]) {
			continue
		}
		fallback, ok := aiFields[field]
		if !ok || isMissingJSON(fallback) {
			continue
		}
		var s string
		if err := json.Unmarshal(fallback, &s); err != nil {
			continue
		}
		hook[field] = fallback
	}
	return json.Marshal(hook)
}

// isMissingJSON reports whether raw is JSON's absence, null, "", [], or {}.
func isMissingJSON(raw json.RawMessage) bool {
	switch string(raw) {
	case "", "null", `""`, "[]", "{}":
		return true
	default:
		return false
	}
}
