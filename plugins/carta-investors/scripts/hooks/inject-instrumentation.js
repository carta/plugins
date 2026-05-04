#!/usr/bin/env node
/**
 * PreToolUse hook: inject _instrumentation into Carta MCP tool calls.
 *
 * For tools that accept a params dict (fetch, mutate), injects _instrumentation
 * inside params. The MCP server middleware extracts it for Kafka events
 * and Datadog spans, then the gateway strips it before command processing.
 *
 * Schema:
 *   _instrumentation: {
 *     plugin:         string    — "carta-portfolio-valuations"
 *     plugin_version: string    — from plugin.json
 *     session_id:     string    — Claude Code session ID
 *   }
 *
 * Part of the official Carta AI Agent Plugin.
 */

const fs = require('fs');
const path = require('path');

// Read plugin.json for version
let pluginVersion = 'unknown';
try {
    const pluginJsonPath = path.resolve(__dirname, '../../.claude-plugin/plugin.json');
    const pluginJson = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf8'));
    pluginVersion = pluginJson.version || 'unknown';
} catch {}

// Tools where _instrumentation goes inside the params dict
// fetch and mutate both accept a params dict via the MCP gateway.
const PARAMS_TOOLS = new Set(['fetch', 'mutate']);

let inputData = '';
process.stdin.on('data', chunk => (inputData += chunk));

process.stdin.on('end', () => {
    try {
        const input = JSON.parse(inputData);
        const { tool_name, tool_input, session_id } = input;

        // Extract the short tool name from mcp__<server>__<tool>
        const parts = (tool_name || '').split('__');
        const shortName = parts.length >= 3 ? parts[parts.length - 1] : tool_name;

        const instrumentation = {
            plugin: 'carta-investors',
            plugin_version: pluginVersion,
            session_id: session_id || null,
        };

        if (PARAMS_TOOLS.has(shortName)) {
            // Gateway tools: inject inside params dict
            let params = tool_input.params;
            if (typeof params === 'string') {
                try {
                    params = JSON.parse(params);
                } catch {
                    params = {};
                }
            }
            params = params || {};
            params._instrumentation = instrumentation;

            const output = {
                hookSpecificOutput: {
                    hookEventName: 'PreToolUse',
                    permissionDecision: 'allow',
                    updatedInput: { ...tool_input, params },
                },
            };

            process.stdout.write(JSON.stringify(output));
            process.exit(0);
        } else {
            // Non-gateway tools (list_accounts, list_contexts, set_context, etc.):
            // Fixed-signature tools — allow without modification.
            allow();
        }
    } catch (err) {
        // Never block a tool call due to instrumentation failure
        process.stderr.write(`inject-instrumentation error: ${err.message}\n`);
        allow();
    }
});

function allow() {
    process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow',
        },
    }));
    process.exit(0);
}
