package handlers

import (
	"encoding/json"

	"com.carta.claude_plugins.hooks/internal/hookio"
	"com.carta.claude_plugins.hooks/internal/plugin"
	"com.carta.claude_plugins.hooks/internal/session"
	"com.carta.claude_plugins.hooks/registry"
)

func init() {
	registry.Register("inject-instrumentation", registry.PreToolUse, InjectInstrumentation)
}

// paramsTools is the set of MCP tool short names whose _instrumentation_v2
// payload must be nested inside tool_input.params rather than injected at
// the top level of tool_input.
var paramsTools = map[string]bool{"fetch": true, "mutate": true}

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
	selfOnly := instrumentationV2{
		Plugins:        []session.PluginRef{{Name: ident.Name, Version: ident.Version}},
		Skills:         namespaced,
		SessionID:      hookio.StrPtr(evt.SessionID),
		PromptID:       hookio.StrPtr(evt.PromptID),
		PermissionMode: hookio.StrPtr(evt.PermissionMode),
		Effort:         evt.Effort,
		AgentID:        hookio.StrPtr(evt.AgentID),
		Model:          nil,
		FromHook:       true,
	}

	if err := session.WriteRecord(evt.SessionID, ident.Name, ident.Version, namespaced); err != nil {
		return selfOnly
	}

	plugins, mergedSkills, model, ok := session.MergeSessionState(evt.SessionID)
	if !ok {
		return selfOnly
	}

	return instrumentationV2{
		Plugins:        plugins,
		Skills:         mergedSkills,
		SessionID:      hookio.StrPtr(evt.SessionID),
		PromptID:       hookio.StrPtr(evt.PromptID),
		PermissionMode: hookio.StrPtr(evt.PermissionMode),
		Effort:         evt.Effort,
		AgentID:        hookio.StrPtr(evt.AgentID),
		Model:          hookio.StrPtr(model),
		FromHook:       true,
	}
}

// buildUpdatedInput injects instr into tool_input, nesting it under
// tool_input.params (parsing params if it's itself a JSON-encoded string)
// for PARAMS_TOOLS, or at the top level of tool_input otherwise.
func buildUpdatedInput(toolInputRaw json.RawMessage, shortName string, instr instrumentationV2) (json.RawMessage, error) {
	toolInput := map[string]json.RawMessage{}
	if len(toolInputRaw) > 0 {
		_ = json.Unmarshal(toolInputRaw, &toolInput)
	}

	instrBytes, err := json.Marshal(instr)
	if err != nil {
		return nil, err
	}

	if paramsTools[shortName] {
		params := map[string]json.RawMessage{}
		canInject := true
		if raw, ok := toolInput["params"]; ok {
			var asString string
			if err := json.Unmarshal(raw, &asString); err == nil {
				var parsed map[string]json.RawMessage
				if err := json.Unmarshal([]byte(asString), &parsed); err == nil {
					params = parsed
				}
				// A JSON-encoded string that fails to parse as an object falls
				// back to an empty params object.
			} else if err := json.Unmarshal(raw, &params); err != nil {
				// params is neither an object nor a JSON-encoded object string
				// (e.g. an array or a number) — leave it untouched rather than
				// silently discarding whatever the caller actually sent.
				canInject = false
				toolInput["params"] = raw
			}
		}
		if canInject {
			params["_instrumentation_v2"] = instrBytes
			paramsBytes, err := json.Marshal(params)
			if err != nil {
				return nil, err
			}
			toolInput["params"] = paramsBytes
		}
	} else {
		toolInput["_instrumentation_v2"] = instrBytes
	}

	return json.Marshal(toolInput)
}
