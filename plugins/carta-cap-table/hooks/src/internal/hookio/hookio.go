// Package hookio provides the fixed output shapes hooks emit for
// non-blocking success and for fail-open-on-error, keyed by hook event type.
// Handlers use these for their own non-blocking success path (which happens
// to share the same JSON shape as the generic error fail-open); main.go uses
// them purely for the catastrophic-error fail-open path, selected generically
// from the handler's registered event.
package hookio

import (
	"encoding/json"
	"strings"

	"com.carta.claude_plugins.hooks/registry"
)

// PreToolUseAllow is the non-blocking "allow, no updatedInput" shape used by
// PreToolUse hooks both on success (when there's nothing to inject/track) and
// as the fail-open shape on error.
func PreToolUseAllow() []byte {
	return []byte(`{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}`)
}

type preToolUseOutput struct {
	HookSpecificOutput preToolUseHookOutput `json:"hookSpecificOutput"`
}

type preToolUseHookOutput struct {
	HookEventName      string          `json:"hookEventName"`
	PermissionDecision string          `json:"permissionDecision"`
	UpdatedInput       json.RawMessage `json:"updatedInput,omitempty"`
}

// PreToolUseWithUpdatedInput is the PreToolUse allow shape carrying a hook's
// modified tool_input.
func PreToolUseWithUpdatedInput(updatedInput json.RawMessage) ([]byte, error) {
	return json.Marshal(preToolUseOutput{
		HookSpecificOutput: preToolUseHookOutput{
			HookEventName:      "PreToolUse",
			PermissionDecision: "allow",
			UpdatedInput:       updatedInput,
		},
	})
}

// StrPtr returns nil for an empty string, else a pointer to it — for
// omitting empty JSON fields that use *string instead of `omitempty` on a
// non-pointer string (which can't distinguish "empty" from "absent").
func StrPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// ShortToolName strips an MCP server prefix from a namespaced tool name
// (e.g. "mcp__carta-local__discover" -> "discover"). A name with fewer than
// 3 "__"-separated parts passes through unchanged.
func ShortToolName(toolName string) string {
	if parts := strings.Split(toolName, "__"); len(parts) >= 3 {
		return parts[len(parts)-1]
	}
	return toolName
}

// SessionEvent holds the session_id field common to every hook event this
// module reads; handler-specific event structs embed it.
type SessionEvent struct {
	SessionID string `json:"session_id"`
}

// InjectEvent is the PreToolUse stdin payload read by InjectInstrumentation.
type InjectEvent struct {
	SessionEvent
	ToolName       string          `json:"tool_name"`
	ToolInput      json.RawMessage `json:"tool_input"`
	PromptID       string          `json:"prompt_id"`
	PermissionMode string          `json:"permission_mode"`
	Effort         json.RawMessage `json:"effort"`
	AgentID        string          `json:"agent_id"`
	TranscriptPath string          `json:"transcript_path"`
}

// PostToolUseEvent is the PostToolUse stdin payload. ToolResponse is the
// MCP tool's return value, itself JSON-encoded as a string by Claude Code's
// hook contract — not the {content: [...]} shape an MCP SDK response type
// might suggest.
type PostToolUseEvent struct {
	ToolName     string          `json:"tool_name"`
	ToolInput    json.RawMessage `json:"tool_input"`
	ToolResponse string          `json:"tool_response"`
}

// SessionStartOK is the fixed SessionStart output shape.
func SessionStartOK() []byte {
	return []byte(`{"hookSpecificOutput":{"hookEventName":"SessionStart"}}`)
}

type sessionStartOutput struct {
	HookSpecificOutput sessionStartHookOutput `json:"hookSpecificOutput"`
}

type sessionStartHookOutput struct {
	HookEventName     string `json:"hookEventName"`
	AdditionalContext string `json:"additionalContext,omitempty"`
}

// SessionStartWithContext builds a SessionStart output carrying
// additionalContext. hookEventName defaults to "SessionStart" if empty.
func SessionStartWithContext(hookEventName, additionalContext string) ([]byte, error) {
	if hookEventName == "" {
		hookEventName = "SessionStart"
	}
	return json.Marshal(sessionStartOutput{
		HookSpecificOutput: sessionStartHookOutput{
			HookEventName:     hookEventName,
			AdditionalContext: additionalContext,
		},
	})
}

// UserPromptSubmitOK is the fixed UserPromptSubmit output: zero bytes.
// UserPromptSubmit hooks here are silently best-effort by design.
func UserPromptSubmitOK() []byte {
	return []byte{}
}

// PostToolUseOK is the fixed PostToolUse output shape. PostToolUse hooks
// here are silently best-effort by design, same as UserPromptSubmit, but
// still emit the hookSpecificOutput envelope Claude Code expects.
func PostToolUseOK() []byte {
	return []byte(`{"hookSpecificOutput":{"hookEventName":"PostToolUse"}}`)
}

// PostModelSwitchOK is the fixed PostModelSwitch output shape.
// PostModelSwitch fires async and cannot block, same as PostToolUse, but
// still emits the hookSpecificOutput envelope Claude Code expects.
func PostModelSwitchOK() []byte {
	return []byte(`{"hookSpecificOutput":{"hookEventName":"PostModelSwitch"}}`)
}

// FailOpen returns the generic fail-open payload for a given hook event,
// used by main.go when a handler returns an error or panics.
func FailOpen(event registry.Event) []byte {
	switch event {
	case registry.PreToolUse:
		return PreToolUseAllow()
	case registry.SessionStart:
		return SessionStartOK()
	case registry.UserPromptSubmit:
		return UserPromptSubmitOK()
	case registry.PostToolUse:
		return PostToolUseOK()
	case registry.PostModelSwitch:
		return PostModelSwitchOK()
	default:
		return []byte{}
	}
}
