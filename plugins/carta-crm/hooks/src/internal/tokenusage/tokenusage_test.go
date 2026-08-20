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
