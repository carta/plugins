#!/usr/bin/env node
/**
 * SessionStart hook: inject skill-first reminder into every session.
 *
 * Ensures Claude loads the relevant carta-investors skill before making
 * any tool calls, even in subagents that don't inherit session context.
 *
 * Part of the official Carta AI Agent Plugin.
 */

const fs = require('fs');
const path = require('path');

// Read plugin name + version (same safe pattern as inject-instrumentation.js)
let pluginName = 'carta-investors';
let pluginVersion = 'unknown';
try {
    const pluginJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../.claude-plugin/plugin.json'), 'utf8'));
    pluginName = pluginJson.name || pluginName;
    pluginVersion = pluginJson.version || 'unknown';
} catch {}

let inputData = '';
process.stdin.on('data', chunk => (inputData += chunk));

process.stdin.on('end', () => {
    let hookEventName = 'SessionStart';
    try {
        const input = JSON.parse(inputData);
        hookEventName = input.hook_event_name || hookEventName;
    } catch {}

    const output = {
        hookSpecificOutput: {
            hookEventName,
            additionalContext:
                '<EXTREMELY_IMPORTANT>You have carta-investors tools available via the Carta MCP server (list_tables, describe_table, execute_query). Before ANY tool call, invoke the matching Skill(\'carta-investors:...\') first. The skill defines what to query, what inputs are required, and how to present results. If no skill matches the user\'s request, use list_tables to browse available datasets and describe_table to understand schemas. IMPORTANT: Skill is a deferred tool — if its schema is not yet loaded, you MUST call ToolSearch with query "select:Skill" first, then invoke the Skill tool.</EXTREMELY_IMPORTANT>\n' +
                '<carta-investors-deep-links>When a Carta MCP tool result includes a `_links` object on a resource (e.g. `_links.web_url`), hyperlink the entity\'s own name (its name/title field — e.g. the fund name, corporation name, partner name) directly to `_links.web_url` — e.g. `[Acme Fund III](<_links.web_url>)`. The entity name itself IS the link. Never render the link as separate anchor text like "View", "Open", or "Link", and never add a separate link column/field next to the name. Use `_links.web_url` verbatim; never reconstruct, guess, or edit the URL yourself. If a resource has no `_links` block, do not fabricate or construct a link for it.</carta-investors-deep-links>\n' +
                `<carta-plugin name="${pluginName}" version="${pluginVersion}" />`,
        },
    };

    process.stdout.write(JSON.stringify(output));
    process.exit(0);
});
