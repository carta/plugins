// Package tokenusage sums a Claude Code session's cumulative token usage from its transcript JSONL.
package tokenusage

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// usageSnapshot is the subset of an assistant message's usage object needed
// to sum session tokens.
type usageSnapshot struct {
	InputTokens          int64 `json:"input_tokens"`
	OutputTokens         int64 `json:"output_tokens"`
	CacheReadInputTokens int64 `json:"cache_read_input_tokens"`
	// Legacy single-bucket field; used only when both ephemeral buckets below are absent.
	CacheCreationInputTokens int64 `json:"cache_creation_input_tokens"`
	CacheCreation            struct {
		Ephemeral5mInputTokens int64 `json:"ephemeral_5m_input_tokens"`
		Ephemeral1hInputTokens int64 `json:"ephemeral_1h_input_tokens"`
	} `json:"cache_creation"`
}

func (u usageSnapshot) total() int64 {
	cacheWrite := u.CacheCreation.Ephemeral5mInputTokens + u.CacheCreation.Ephemeral1hInputTokens
	if cacheWrite == 0 {
		cacheWrite = u.CacheCreationInputTokens
	}
	return u.InputTokens + u.OutputTokens + cacheWrite + u.CacheReadInputTokens
}

type assistantLine struct {
	Type    string `json:"type"`
	Message struct {
		ID    string         `json:"id"`
		Usage *usageSnapshot `json:"usage"`
	} `json:"message"`
}

// accumulateFile folds one transcript's assistant-turn usage into seen, keyed
// by message id so streamed chunks collapse to their final snapshot.
func accumulateFile(path string, seen map[string]usageSnapshot) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 0, 64*1024), 10*1024*1024)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.Contains(line, `"type":"assistant"`) {
			continue
		}
		var a assistantLine
		if err := json.Unmarshal([]byte(line), &a); err != nil || a.Type != "assistant" {
			continue
		}
		if a.Message.ID == "" || a.Message.Usage == nil {
			continue
		}
		seen[a.Message.ID] = *a.Message.Usage
	}
	return scanner.Err()
}

// CumulativeSessionTokens sums usage across every assistant turn in a single
// transcript. ok is false when no usage-bearing turn was found — not just 0.
func CumulativeSessionTokens(transcriptPath string) (int64, bool) {
	if transcriptPath == "" {
		return 0, false
	}
	seen := map[string]usageSnapshot{}
	if err := accumulateFile(transcriptPath, seen); err != nil {
		return 0, false
	}
	return sumSeen(seen), len(seen) > 0
}

// CumulativeSessionTokensForSession sums usage across a whole conversation:
// the main transcript plus every subagent sidechain. transcriptPath may point
// at either — a subagent's own turns still count toward the session total.
func CumulativeSessionTokensForSession(transcriptPath string) (int64, bool) {
	mainPath := mainTranscriptPath(transcriptPath)
	if mainPath == "" {
		return 0, false
	}

	// A read failure on one file shouldn't drop usage already folded from the rest.
	seen := map[string]usageSnapshot{}
	_ = accumulateFile(mainPath, seen)
	for _, sidechain := range sidechainFiles(mainPath) {
		_ = accumulateFile(sidechain, seen)
	}

	return sumSeen(seen), len(seen) > 0
}

func sumSeen(seen map[string]usageSnapshot) int64 {
	var total int64
	for _, usage := range seen {
		total += usage.total()
	}
	return total
}

// mainTranscriptPath maps a sidechain path (<session>/subagents/agent-X.jsonl)
// to its main transcript (<session>.jsonl); any other path is already main.
func mainTranscriptPath(transcriptPath string) string {
	if transcriptPath == "" {
		return ""
	}
	dir := filepath.Dir(transcriptPath)
	if filepath.Base(dir) != "subagents" {
		return transcriptPath
	}
	sessionDir := filepath.Dir(dir)
	return sessionDir + ".jsonl"
}

// sidechainFiles lists a session's subagent transcripts. A missing or empty
// subagents/ directory is not an error — it just means no sidechains exist.
func sidechainFiles(mainPath string) []string {
	sessionDir := strings.TrimSuffix(mainPath, filepath.Ext(mainPath))
	matches, err := filepath.Glob(filepath.Join(sessionDir, "subagents", "agent-*.jsonl"))
	if err != nil {
		return nil
	}
	return matches
}
