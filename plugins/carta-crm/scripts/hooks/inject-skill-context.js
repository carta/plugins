#!/usr/bin/env node
/**
 * SessionStart hook: surface the carta-crm plugin name + version to the session.
 *
 * Emits a <carta-plugin name="..." version="..." /> tag into every session's
 * context so the running plugin/version is attributable, matching
 * carta-cap-table and carta-investors.
 *
 * Part of the official Carta AI Agent Plugin.
 */

const fs = require('fs');
const path = require('path');

// Read plugin name + version from the plugin manifest.
let pluginName = 'carta-crm';
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
            additionalContext: `<carta-plugin name="${pluginName}" version="${pluginVersion}" />`,
        },
    };

    process.stdout.write(JSON.stringify(output));
    process.exit(0);
});
