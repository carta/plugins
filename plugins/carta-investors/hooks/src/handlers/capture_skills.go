package handlers

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"com.carta.claude_plugins.hooks/internal/hookio"
	"com.carta.claude_plugins.hooks/internal/plugin"
	"com.carta.claude_plugins.hooks/internal/session"
	"com.carta.claude_plugins.hooks/registry"
)

func init() {
	registry.Register("capture-active-skill", registry.PreToolUse, CaptureActiveSkill)
	registry.Register("capture-slash-skill", registry.UserPromptSubmit, CaptureSlashSkill)
}

// recordSkillInvocation records skillName against pluginName+sessionID's
// per-plugin state, then marks it most-recent in the shared session state.
// Best-effort: a write failure here never blocks the caller's hook.
func recordSkillInvocation(pluginName, sessionID, skillName string) error {
	if err := session.AppendSkill(pluginName, sessionID, skillName); err != nil {
		return err
	}
	return session.WriteLastSkill(sessionID, pluginName+":"+skillName)
}

type captureActiveSkillEvent struct {
	hookio.SessionEvent
	ToolInput struct {
		Skill string `json:"skill"`
	} `json:"tool_input"`
}

// CaptureActiveSkill records a Skill tool invocation naming one of this
// plugin's own skills against the session's state, for InjectInstrumentation
// to read back.
func CaptureActiveSkill(stdin []byte) ([]byte, error) {
	var evt captureActiveSkillEvent
	if err := json.Unmarshal(stdin, &evt); err != nil {
		return nil, err
	}

	ident, ok := plugin.Resolve()
	if !ok {
		return hookio.PreToolUseAllow(), nil
	}

	prefix := ident.Name + ":"
	skillFull := evt.ToolInput.Skill
	if !strings.HasPrefix(skillFull, prefix) {
		return hookio.PreToolUseAllow(), nil
	}
	skillName := strings.TrimPrefix(skillFull, prefix)

	if evt.SessionID != "" {
		_ = recordSkillInvocation(ident.Name, evt.SessionID, skillName)
	}

	return hookio.PreToolUseAllow(), nil
}

var slashCommandRe = regexp.MustCompile(`^/([A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)?)(?:\s|$)`)

type captureSlashSkillEvent struct {
	hookio.SessionEvent
	Prompt string `json:"prompt"`
}

// CaptureSlashSkill records a skill invoked directly via a bare or
// namespace-qualified slash command (no Skill tool call fires for these, so
// CaptureActiveSkill can't see them). Never writes to stdout, success or
// failure — silently best-effort by design.
func CaptureSlashSkill(stdin []byte) ([]byte, error) {
	var evt captureSlashSkillEvent
	if err := json.Unmarshal(stdin, &evt); err != nil {
		return hookio.UserPromptSubmitOK(), nil
	}
	if evt.Prompt == "" || evt.SessionID == "" {
		return hookio.UserPromptSubmitOK(), nil
	}

	match := slashCommandRe.FindStringSubmatch(evt.Prompt)
	if match == nil {
		return hookio.UserPromptSubmitOK(), nil
	}
	command := match[1]

	ident, ok := plugin.Resolve()
	if !ok {
		return hookio.UserPromptSubmitOK(), nil
	}

	var skillName string
	if strings.Contains(command, ":") {
		prefix := ident.Name + ":"
		if !strings.HasPrefix(command, prefix) {
			return hookio.UserPromptSubmitOK(), nil
		}
		skillName = strings.TrimPrefix(command, prefix)
	} else {
		skillPath := filepath.Join(os.Getenv("CLAUDE_PLUGIN_ROOT"), "skills", command)
		if _, err := os.Stat(skillPath); err != nil {
			return hookio.UserPromptSubmitOK(), nil
		}
		skillName = command
	}

	_ = recordSkillInvocation(ident.Name, evt.SessionID, skillName)

	return hookio.UserPromptSubmitOK(), nil
}
