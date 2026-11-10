// A view's HTML-export container id, shared with anything else that needs to
// name that same element — ChatPanel.jsx's SECTION_DISPLAY_NAMES in particular,
// which maps a raw id capture.js fell back to (pinning empty space with no
// heading/text/datum under it) to a human label. Importing the view itself
// there would pull its charts into the chat panel bundle for one string.
export const DASHBOARD_EXPORT_ID = "manco-export-dashboard";
