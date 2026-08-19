// Package tokenusage sums a Claude Code session's cumulative token usage from its transcript JSONL.
package tokenusage

import (
	"bufio"
	"encoding/json"
	"os"
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
		ID    string        `json:"id"`
		Usage usageSnapshot `json:"usage"`
	} `json:"message"`
}

// CumulativeSessionTokens sums token usage across every assistant turn.
// Streamed lines share one message id; keep only the last (final) usage per id.
func CumulativeSessionTokens(transcriptPath string) (int64, bool) {
	if transcriptPath == "" {
		return 0, false
	}
	f, err := os.Open(transcriptPath)
	if err != nil {
		return 0, false
	}
	defer f.Close()

	seen := map[string]usageSnapshot{}
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
		if a.Message.ID == "" {
			continue
		}
		seen[a.Message.ID] = a.Message.Usage
	}

	var total int64
	for _, usage := range seen {
		total += usage.total()
	}
	return total, true
}
