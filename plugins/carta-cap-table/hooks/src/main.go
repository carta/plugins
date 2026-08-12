// Command hooks is the single Go binary shared across Carta plugins'
// PreToolUse/SessionStart/UserPromptSubmit hooks. It dispatches by handler
// name (os.Args[1]) to a function registered in the registry package, reads
// the hook event JSON from stdin, and writes the handler's output to stdout.
//
// On any catastrophic failure — an unknown handler name, a panic inside a
// handler, or (redundantly, since handlers already handle this themselves)
// a returned error — main falls back to the generic fail-open shape for the
// handler's registered event, so a broken hook never blocks the user's
// Claude Code session.
//
// This module has zero external dependencies; every import is a
// same-module subpackage resolved from local files, so building or running
// it never needs network or module-proxy access.
package main

import (
	"fmt"
	"io"
	"os"

	_ "com.carta.claude_plugins.hooks/handlers"
	_ "com.carta.claude_plugins.hooks/handlers/carta-cap-table"
	"com.carta.claude_plugins.hooks/internal/hookio"
	"com.carta.claude_plugins.hooks/registry"
)

func main() {
	os.Stdout.Write(run(os.Args, os.Stdin, os.Stderr))
}

// run performs the dispatch and returns the exact bytes to write to stdout.
// Factored out from main for testability (no os.Exit, no direct os.Stdout
// dependency).
func run(args []string, stdin io.Reader, stderr io.Writer) []byte {
	if len(args) < 2 {
		fmt.Fprintln(stderr, "hooks: missing handler name argument")
		return []byte{}
	}
	name := args[1]

	handler, event, ok := registry.Lookup(name)
	if !ok {
		fmt.Fprintf(stderr, "hooks: unknown handler %q\n", name)
		return []byte{}
	}

	return dispatch(handler, event, stdin, stderr)
}

// dispatch reads stdin, invokes handler with panic recovery, and returns the
// handler's output on success or the generic fail-open shape for event on
// any error or panic.
func dispatch(handler registry.Handler, event registry.Event, stdin io.Reader, stderr io.Writer) (out []byte) {
	defer func() {
		if r := recover(); r != nil {
			fmt.Fprintf(stderr, "hooks: panic: %v\n", r)
			out = hookio.FailOpen(event)
		}
	}()

	input, err := io.ReadAll(stdin)
	if err != nil {
		fmt.Fprintf(stderr, "hooks: failed to read stdin: %v\n", err)
		return hookio.FailOpen(event)
	}

	output, err := handler(input)
	if err != nil {
		fmt.Fprintf(stderr, "hooks: handler error: %v\n", err)
		return hookio.FailOpen(event)
	}
	return output
}
