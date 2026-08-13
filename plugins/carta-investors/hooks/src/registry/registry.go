// Package registry provides a name-based handler registry for Claude Code
// hook events. Handlers self-register by name and hook event type; main.go
// dispatches to a named handler and uses its registered event to pick the
// correct fail-open shape on error.
package registry

import "fmt"

// Event identifies which Claude Code hook event a handler responds to.
type Event string

const (
	PreToolUse       Event = "PreToolUse"
	PostToolUse      Event = "PostToolUse"
	SessionStart     Event = "SessionStart"
	UserPromptSubmit Event = "UserPromptSubmit"
)

// Handler processes raw stdin bytes for a hook invocation and returns the
// exact bytes to write to stdout, or an error if it could not do so.
type Handler func(stdin []byte) ([]byte, error)

type entry struct {
	event   Event
	handler Handler
}

var handlers = map[string]entry{}

// Register associates a handler function with a name and the hook event it
// responds to. Intended to be called from package-level init() functions.
func Register(name string, event Event, fn Handler) {
	if name == "" {
		panic("registry: cannot register handler with empty name")
	}
	if fn == nil {
		panic(fmt.Sprintf("registry: cannot register nil handler for %q", name))
	}
	if _, exists := handlers[name]; exists {
		panic(fmt.Sprintf("registry: handler %q already registered", name))
	}
	handlers[name] = entry{event: event, handler: fn}
}

// Lookup returns the handler and event registered under name, and whether
// one was found.
func Lookup(name string) (Handler, Event, bool) {
	e, ok := handlers[name]
	if !ok {
		return nil, "", false
	}
	return e.handler, e.event, true
}
