// Package captable implements PostToolUse handlers specific to the
// carta-cap-table plugin: caching the MCP command registry after a
// discover() call, and tracking the most-recently-used corporation id after
// a fetch() call.
package captable

import "time"

// nowISO formats the current time the way JS's Date.toISOString() would.
func nowISO() string {
	return time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
}
