package tokenusage

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
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
		total, ok := CumulativeSessionTokensForSession(path)
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
	total, ok := CumulativeSessionTokensForSession(sidechains["a1"])
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
	total, ok := CumulativeSessionTokensForSession(mainPath)
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
	total, ok := CumulativeSessionTokensForSession(mainPath)
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
	if _, ok := CumulativeSessionTokensForSession(sidechains["a1"]); ok {
		t.Error("expected ok=false: neither main nor sidechain has any usage-bearing turn")
	}
}

func TestCumulativeSessionTokensForSession_MainUnopenableReturnsNotOK(t *testing.T) {
	if _, ok := CumulativeSessionTokensForSession(filepath.Join(t.TempDir(), "absent.jsonl")); ok {
		t.Error("expected ok=false")
	}
}
