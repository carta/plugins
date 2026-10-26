package tokenusage

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"com.carta.claude_plugins.hooks/internal/session"
)

func writeTranscript(t *testing.T, lines ...string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "session.jsonl")
	if err := os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestCumulativeSessionTokens_DedupesStreamedChunksByMessageID(t *testing.T) {
	path := writeTranscript(t,
		`{"type":"assistant","message":{"id":"msg_A","usage":{"input_tokens":5,"output_tokens":5}}}`,
		`{"type":"assistant","message":{"id":"msg_A","usage":{"input_tokens":5,"output_tokens":40}}}`,
		`{"type":"assistant","message":{"id":"msg_A","usage":{"input_tokens":5,"output_tokens":87}}}`,
	)
	total, ok := CumulativeSessionTokens(path)
	if !ok {
		t.Fatal("expected ok=true")
	}
	if total != 92 {
		t.Errorf("total = %d, want 92 (last snapshot only: 5 input + 87 output)", total)
	}
}

func TestCumulativeSessionTokens_SumsAcrossDistinctTurns(t *testing.T) {
	path := writeTranscript(t,
		`{"type":"assistant","message":{"id":"msg_A","usage":{"input_tokens":10,"output_tokens":20}}}`,
		`{"type":"assistant","message":{"id":"msg_B","usage":{"input_tokens":1,"output_tokens":2}}}`,
	)
	total, ok := CumulativeSessionTokens(path)
	if !ok {
		t.Fatal("expected ok=true")
	}
	if total != 33 {
		t.Errorf("total = %d, want 33", total)
	}
}

func TestCumulativeSessionTokens_IncludesCacheTokens(t *testing.T) {
	path := writeTranscript(t,
		`{"type":"assistant","message":{"id":"msg_A","usage":{"input_tokens":1,"output_tokens":1,`+
			`"cache_creation":{"ephemeral_5m_input_tokens":2,"ephemeral_1h_input_tokens":3},`+
			`"cache_read_input_tokens":4}}}`,
	)
	total, ok := CumulativeSessionTokens(path)
	if !ok {
		t.Fatal("expected ok=true")
	}
	if total != 11 {
		t.Errorf("total = %d, want 11 (1+1+2+3+4)", total)
	}
}

func TestCumulativeSessionTokens_FallsBackToLegacyCacheCreationField(t *testing.T) {
	path := writeTranscript(t,
		`{"type":"assistant","message":{"id":"msg_A","usage":{"input_tokens":1,"output_tokens":1,`+
			`"cache_creation_input_tokens":9}}}`,
	)
	total, ok := CumulativeSessionTokens(path)
	if !ok {
		t.Fatal("expected ok=true")
	}
	if total != 11 {
		t.Errorf("total = %d, want 11 (1+1+9 legacy cache field)", total)
	}
}

func TestCumulativeSessionTokens_IgnoresNonAssistantLines(t *testing.T) {
	path := writeTranscript(t,
		`{"type":"user","message":{"id":"msg_U","usage":{"input_tokens":100,"output_tokens":100}}}`,
		`{"type":"assistant","message":{"id":"msg_A","usage":{"input_tokens":1,"output_tokens":1}}}`,
	)
	total, ok := CumulativeSessionTokens(path)
	if !ok {
		t.Fatal("expected ok=true")
	}
	if total != 2 {
		t.Errorf("total = %d, want 2 (user line ignored)", total)
	}
}

func TestCumulativeSessionTokens_MissingFileReturnsNotOK(t *testing.T) {
	if _, ok := CumulativeSessionTokens(filepath.Join(t.TempDir(), "absent.jsonl")); ok {
		t.Error("expected ok=false for a missing transcript file")
	}
}

func TestCumulativeSessionTokens_EmptyPathReturnsNotOK(t *testing.T) {
	if _, ok := CumulativeSessionTokens(""); ok {
		t.Error("expected ok=false for an empty transcript path")
	}
}

func TestCumulativeSessionTokens_NoAssistantLinesReturnsNotOK(t *testing.T) {
	path := writeTranscript(t,
		`{"type":"user","message":{"content":"hi"}}`,
	)
	if _, ok := CumulativeSessionTokens(path); ok {
		t.Error("expected ok=false: no assistant line at all, so a real 0 can't be told apart from unknown")
	}
}

func TestCumulativeSessionTokens_AssistantLinesWithoutUsageReturnNotOK(t *testing.T) {
	path := writeTranscript(t,
		`{"type":"assistant","message":{"id":"msg_A"}}`,
	)
	if _, ok := CumulativeSessionTokens(path); ok {
		t.Error("expected ok=false: assistant line present but carries no usage object")
	}
}

func TestCumulativeSessionTokens_RealZeroUsageReportsZero(t *testing.T) {
	path := writeTranscript(t,
		`{"type":"assistant","message":{"id":"msg_A","usage":{"input_tokens":0,"output_tokens":0}}}`,
	)
	total, ok := CumulativeSessionTokens(path)
	if !ok {
		t.Fatal("expected ok=true: a real usage object summing to 0 is a genuine zero")
	}
	if total != 0 {
		t.Errorf("total = %d, want 0", total)
	}
}

func TestCumulativeSessionTokens_CountsTurnsAfterALineLongerThan10MB(t *testing.T) {
	longLine := `{"type":"user","message":{"content":"` + strings.Repeat("x", 11*1024*1024) + `"}}`
	path := writeTranscript(t, longLine, assistant("msg_A", 10, 20))
	total, ok := CumulativeSessionTokens(path)
	if !ok {
		t.Fatal("expected ok=true")
	}
	if total != 30 {
		t.Errorf("total = %d, want 30", total)
	}
}

func assistant(id string, input, output int) string {
	return fmt.Sprintf(`{"type":"assistant","message":{"id":%q,"usage":{"input_tokens":%d,"output_tokens":%d}}}`, id, input, output)
}

// sessionTokens computes a session total with an empty token usage cache.
func sessionTokens(t *testing.T, transcriptPath string) (int64, bool) {
	t.Helper()
	t.Setenv("CARTA_SESSION_STATE_DIR", t.TempDir())
	return CumulativeSessionTokensForSession("s1", transcriptPath)
}

func appendToFile(t *testing.T, path, content string) {
	t.Helper()
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if _, err := f.WriteString(content); err != nil {
		t.Fatal(err)
	}
}

// writeSession lays out a main transcript plus subagents/ sidechains on disk
// and returns the main path and each sidechain path, keyed by agent id.
func writeSession(t *testing.T, mainLines []string, sidechains map[string][]string) (mainPath string, sidechainPaths map[string]string) {
	t.Helper()
	dir := t.TempDir()
	mainPath = filepath.Join(dir, "session.jsonl")
	if err := os.WriteFile(mainPath, []byte(strings.Join(mainLines, "\n")+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	sidechainDir := filepath.Join(dir, "session", "subagents")
	if err := os.MkdirAll(sidechainDir, 0o755); err != nil {
		t.Fatal(err)
	}
	sidechainPaths = map[string]string{}
	for agentID, lines := range sidechains {
		p := filepath.Join(sidechainDir, "agent-"+agentID+".jsonl")
		if err := os.WriteFile(p, []byte(strings.Join(lines, "\n")+"\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		sidechainPaths[agentID] = p
	}
	return mainPath, sidechainPaths
}

func TestCumulativeSessionTokensForSession_SumsMainAndSidechainsRegardlessOfEntryPath(t *testing.T) {
	mainPath, sidechains := writeSession(t,
		[]string{`{"type":"assistant","message":{"id":"msg_main","usage":{"input_tokens":10,"output_tokens":10}}}`},
		map[string][]string{
			"a1": {`{"type":"assistant","message":{"id":"msg_sub","usage":{"input_tokens":5,"output_tokens":5}}}`},
		},
	)
	for name, path := range map[string]string{"main path": mainPath, "sidechain path": sidechains["a1"]} {
		total, ok := sessionTokens(t, path)
		if !ok {
			t.Fatalf("%s: expected ok=true", name)
		}
		if total != 30 {
			t.Errorf("%s: total = %d, want 30 (20 main + 10 sidechain)", name, total)
		}
	}
}

func TestCumulativeSessionTokensForSession_UsageFreeSidechainStillUsesMainTotal(t *testing.T) {
	_, sidechains := writeSession(t,
		[]string{`{"type":"assistant","message":{"id":"msg_main","usage":{"input_tokens":10,"output_tokens":10}}}`},
		map[string][]string{
			"a1": {`{"type":"user","message":{"content":"hi"}}`},
		},
	)
	total, ok := sessionTokens(t, sidechains["a1"])
	if !ok {
		t.Fatal("expected ok=true: main file still carries usage")
	}
	if total != 20 {
		t.Errorf("total = %d, want 20 (main only; sidechain has no assistant usage yet)", total)
	}
}

func TestCumulativeSessionTokensForSession_MissingSubagentsDirUsesMainTotal(t *testing.T) {
	mainPath, _ := writeSession(t,
		[]string{`{"type":"assistant","message":{"id":"msg_main","usage":{"input_tokens":10,"output_tokens":10}}}`},
		nil,
	)
	total, ok := sessionTokens(t, mainPath)
	if !ok {
		t.Fatal("expected ok=true")
	}
	if total != 20 {
		t.Errorf("total = %d, want 20", total)
	}
}

func TestCumulativeSessionTokensForSession_DedupesMessageIDAcrossFiles(t *testing.T) {
	mainPath, _ := writeSession(t,
		[]string{`{"type":"assistant","message":{"id":"msg_shared","usage":{"input_tokens":10,"output_tokens":10}}}`},
		map[string][]string{
			"a1": {`{"type":"assistant","message":{"id":"msg_shared","usage":{"input_tokens":999,"output_tokens":999}}}`},
		},
	)
	total, ok := sessionTokens(t, mainPath)
	if !ok {
		t.Fatal("expected ok=true")
	}
	// Which file's snapshot wins for a shared id isn't the contract here — only
	// that it's counted once. 20 (main) + 1998 (sidechain) would mean double-counting.
	if total != 20 && total != 1998 {
		t.Errorf("total = %d, want 20 or 1998 (counted once, not the sum 2018)", total)
	}
}

func TestCumulativeSessionTokensForSession_BothUsageFreeReturnsNotOK(t *testing.T) {
	_, sidechains := writeSession(t,
		[]string{`{"type":"user","message":{"content":"hi"}}`},
		map[string][]string{
			"a1": {`{"type":"user","message":{"content":"hi"}}`},
		},
	)
	if _, ok := sessionTokens(t, sidechains["a1"]); ok {
		t.Error("expected ok=false: neither main nor sidechain has any usage-bearing turn")
	}
}

func TestCumulativeSessionTokensForSession_MainUnopenableReturnsNotOK(t *testing.T) {
	if _, ok := sessionTokens(t, filepath.Join(t.TempDir(), "absent.jsonl")); ok {
		t.Error("expected ok=false")
	}
}

func TestCumulativeSessionTokensForSession_IncrementalTotalEqualsFullTotalAsTranscriptGrows(t *testing.T) {
	t.Setenv("CARTA_SESSION_STATE_DIR", t.TempDir())
	mainPath, sidechains := writeSession(t,
		[]string{assistant("msg_A", 10, 20)},
		map[string][]string{"a1": {assistant("msg_S1", 1, 2)}},
	)
	newSidechainPath := filepath.Join(strings.TrimSuffix(mainPath, ".jsonl"), "subagents", "agent-a2.jsonl")
	steps := []struct {
		name   string
		grow   func()
		wanted int64
	}{
		{"initial transcripts", func() {}, 33},
		{"main transcript grows", func() {
			appendToFile(t, mainPath, assistant("msg_B", 3, 4)+"\n"+`{"type":"user","message":{"content":"hi"}}`+"\n")
		}, 40},
		{"streamed chunk updates a message already read", func() {
			appendToFile(t, sidechains["a1"], assistant("msg_S1", 1, 50)+"\n")
		}, 88},
		{"new subagent transcript", func() {
			appendToFile(t, newSidechainPath, assistant("msg_S2", 7, 7)+"\n")
		}, 102},
	}
	for i, step := range steps {
		step.grow()
		incremental, ok := CumulativeSessionTokensForSession("s1", mainPath)
		if !ok {
			t.Fatalf("%s: expected ok=true", step.name)
		}
		full, _ := CumulativeSessionTokensForSession(fmt.Sprintf("full-%d", i), mainPath)
		if incremental != step.wanted || full != step.wanted {
			t.Errorf("%s: incremental = %d, full = %d, want %d", step.name, incremental, full, step.wanted)
		}
	}
}

func TestCumulativeSessionTokensForSession_SecondCallReadsOnlyAppendedBytes(t *testing.T) {
	t.Setenv("CARTA_SESSION_STATE_DIR", t.TempDir())
	mainPath, _ := writeSession(t, []string{assistant("msg_A", 10, 20)}, nil)
	if total, _ := CumulativeSessionTokensForSession("s1", mainPath); total != 30 {
		t.Fatalf("first total = %d, want 30", total)
	}

	// Rewrite the bytes already read at the same length: a call that read them again would count 90 + 20.
	rewritten := assistant("msg_A", 90, 20) + "\n" + assistant("msg_B", 1, 1) + "\n"
	if err := os.WriteFile(mainPath, []byte(rewritten), 0o644); err != nil {
		t.Fatal(err)
	}

	total, _ := CumulativeSessionTokensForSession("s1", mainPath)
	if total != 32 {
		t.Errorf("second total = %d, want 32 (cached 30 + appended msg_B 2)", total)
	}
}

func TestCumulativeSessionTokensForSession_CountsALineOnlyWhenItIsComplete(t *testing.T) {
	t.Setenv("CARTA_SESSION_STATE_DIR", t.TempDir())
	mainPath, _ := writeSession(t, []string{assistant("msg_A", 10, 20)}, nil)
	appendToFile(t, mainPath, `{"type":"assistant","message":{"id":"msg_B","usage":{"input_tokens":1,`)
	if total, _ := CumulativeSessionTokensForSession("s1", mainPath); total != 30 {
		t.Fatalf("total with a partial line = %d, want 30", total)
	}

	appendToFile(t, mainPath, `"output_tokens":1}}}`+"\n")

	total, _ := CumulativeSessionTokensForSession("s1", mainPath)
	if total != 32 {
		t.Errorf("total after the line completes = %d, want 32", total)
	}
}

func TestCumulativeSessionTokensForSession_RereadsAllWhenATranscriptShrinks(t *testing.T) {
	t.Setenv("CARTA_SESSION_STATE_DIR", t.TempDir())
	mainPath, _ := writeSession(t, []string{assistant("msg_A", 10, 20), assistant("msg_B", 3, 4)}, nil)
	if total, _ := CumulativeSessionTokensForSession("s1", mainPath); total != 37 {
		t.Fatalf("first total = %d, want 37", total)
	}

	if err := os.WriteFile(mainPath, []byte(assistant("msg_C", 1, 1)+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	total, _ := CumulativeSessionTokensForSession("s1", mainPath)
	if total != 2 {
		t.Errorf("total after the transcript shrinks = %d, want 2", total)
	}
}

func TestCumulativeSessionTokensForSession_RereadsAllWhenTheCacheIsUnreadable(t *testing.T) {
	t.Setenv("CARTA_SESSION_STATE_DIR", t.TempDir())
	mainPath, _ := writeSession(t, []string{assistant("msg_A", 10, 20)}, nil)
	cachePath := session.TokenUsagePath("s1")
	if err := os.MkdirAll(filepath.Dir(cachePath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(cachePath, []byte("not json"), 0o644); err != nil {
		t.Fatal(err)
	}

	total, _ := CumulativeSessionTokensForSession("s1", mainPath)
	if total != 30 {
		t.Errorf("total = %d, want 30", total)
	}
}

func TestCumulativeSessionTokensForSession_IgnoresTheCacheOfAnotherTranscript(t *testing.T) {
	t.Setenv("CARTA_SESSION_STATE_DIR", t.TempDir())
	firstPath, _ := writeSession(t, []string{assistant("msg_A", 10, 20)}, nil)
	secondPath, _ := writeSession(t, []string{assistant("msg_Z", 5, 5)}, nil)
	if total, _ := CumulativeSessionTokensForSession("s1", firstPath); total != 30 {
		t.Fatalf("first transcript total = %d, want 30", total)
	}

	total, _ := CumulativeSessionTokensForSession("s1", secondPath)
	if total != 10 {
		t.Errorf("second transcript total = %d, want 10", total)
	}
}
