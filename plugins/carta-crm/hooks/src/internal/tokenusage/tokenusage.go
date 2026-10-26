// Package tokenusage sums a Claude Code session's cumulative token usage from its transcript JSONL.
package tokenusage

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"

	"com.carta.claude_plugins.hooks/internal/session"
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

// sessionCache keeps a session's per-message totals and the byte offset read
// so far in each transcript file, so each call reads only the appended bytes.
type sessionCache struct {
	MainPath string           `json:"main_path"`
	Offsets  map[string]int64 `json:"offsets"`
	Usage    map[string]int64 `json:"usage"`
}

func newSessionCache(mainPath string) sessionCache {
	return sessionCache{MainPath: mainPath, Offsets: map[string]int64{}, Usage: map[string]int64{}}
}

// accumulateFrom folds the assistant-turn usage of path, from offset on, into
// usage, keyed by message id so streamed chunks collapse to their final
// snapshot. It returns the offset after the last complete line: a line still
// being written is read again on the next call.
func accumulateFrom(path string, offset int64, usage map[string]int64) (int64, error) {
	f, err := os.Open(path)
	if err != nil {
		return offset, err
	}
	defer f.Close()
	if _, err := f.Seek(offset, io.SeekStart); err != nil {
		return offset, err
	}

	reader := bufio.NewReaderSize(f, 64*1024)
	for {
		line, err := reader.ReadBytes('\n')
		if err == io.EOF {
			return offset, nil
		}
		if err != nil {
			return offset, err
		}
		offset += int64(len(line))
		if !bytes.Contains(line, []byte(`"type":"assistant"`)) {
			continue
		}
		var a assistantLine
		if err := json.Unmarshal(line, &a); err != nil || a.Type != "assistant" {
			continue
		}
		if a.Message.ID == "" || a.Message.Usage == nil {
			continue
		}
		usage[a.Message.ID] = a.Message.Usage.total()
	}
}

// CumulativeSessionTokens sums usage across every assistant turn in a single
// transcript. ok is false when no usage-bearing turn was found — not just 0.
func CumulativeSessionTokens(transcriptPath string) (int64, bool) {
	if transcriptPath == "" {
		return 0, false
	}
	usage := map[string]int64{}
	if _, err := accumulateFrom(transcriptPath, 0, usage); err != nil {
		return 0, false
	}
	return sumUsage(usage), len(usage) > 0
}

// CumulativeSessionTokensForSession sums usage across a whole conversation:
// the main transcript plus every subagent sidechain. transcriptPath may point
// at either — a subagent's own turns still count toward the session total.
// The sum is cached under the session's state dir, so a call reads only the
// bytes appended since the previous call.
func CumulativeSessionTokensForSession(sessionID, transcriptPath string) (int64, bool) {
	mainPath := mainTranscriptPath(transcriptPath)
	if mainPath == "" {
		return 0, false
	}

	cachePath := session.TokenUsagePath(sessionID)
	files := append([]string{mainPath}, sidechainFiles(mainPath)...)
	cache := loadSessionCache(cachePath, mainPath, files)

	// A read failure on one file shouldn't drop usage already folded from the rest.
	changed := false
	for _, path := range files {
		offset, _ := accumulateFrom(path, cache.Offsets[path], cache.Usage)
		if offset != cache.Offsets[path] {
			cache.Offsets[path] = offset
			changed = true
		}
	}
	if changed {
		_ = saveSessionCache(cachePath, cache)
	}

	return sumUsage(cache.Usage), len(cache.Usage) > 0
}

// loadSessionCache returns the cached state for mainPath, or an empty cache
// when there is none, it is unreadable, it belongs to another transcript, or
// a file is now shorter than its cached offset (so it was rewritten).
func loadSessionCache(cachePath, mainPath string, files []string) sessionCache {
	data, err := os.ReadFile(cachePath)
	if err != nil {
		return newSessionCache(mainPath)
	}
	var cache sessionCache
	if err := json.Unmarshal(data, &cache); err != nil || cache.MainPath != mainPath || cache.Offsets == nil || cache.Usage == nil {
		return newSessionCache(mainPath)
	}
	for _, path := range files {
		info, err := os.Stat(path)
		if err == nil && info.Size() < cache.Offsets[path] {
			return newSessionCache(mainPath)
		}
	}
	return cache
}

func saveSessionCache(cachePath string, cache sessionCache) error {
	if err := os.MkdirAll(filepath.Dir(cachePath), 0o755); err != nil {
		return err
	}
	data, err := json.Marshal(cache)
	if err != nil {
		return err
	}
	return session.WriteFileAtomic(cachePath, data, 0o644)
}

func sumUsage(usage map[string]int64) int64 {
	var total int64
	for _, tokens := range usage {
		total += tokens
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
