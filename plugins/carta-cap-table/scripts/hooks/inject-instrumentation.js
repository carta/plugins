#!/usr/bin/env node
/**
 * PreToolUse hook: inject _instrumentation into Carta MCP tool calls.
 *
 * For tools that accept a params dict (fetch), injects _instrumentation
 * inside params. The MCP server middleware extracts it for Kafka events
 * and Datadog spans, then the gateway strips it before command processing.
 *
 * Reads the loaded skills from the session-scoped state file written
 * by the track-active-skill PreToolUse hook.
 *
 * Schema:
 *   _instrumentation: {
 *     skills:         string[]  — skills loaded in the session (e.g. ["pro-forma-model", "interaction-reference"])
 *     plugin:         string    — "carta-cap-table"
 *     plugin_version: string    — from plugin.json
 *     session_id:     string    — Claude Code session ID
 *   }
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
// Only fetch has a params dict where we can inject _instrumentation.
// discover has (domain, scope, search) — no params dict.
const PARAMS_TOOLS = new Set(['fetch']);

let inputData = '';
process.stdin.on('data', chunk => (inputData += chunk));

process.stdin.on('end', () => {
    try {
        const input = JSON.parse(inputData);
        const { tool_name, tool_input, session_id } = input;

        // Extract the short tool name from mcp__<server>__<tool>
        const parts = (tool_name || '').split('__');
        const shortName = parts.length >= 3 ? parts[parts.length - 1] : tool_name;

        // Read active skill state
        const skillState = readSkillState(session_id);

        const instrumentation = {
            skills: skillState.skills || [],
            plugin: 'carta-cap-table',
            plugin_version: pluginVersion,
            session_id: session_id || null,
        };

        // Build updated input with _instrumentation injected
        let updatedInput;

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

            updatedInput = { ...tool_input, params };
        } else {
            // Non-gateway tools (list_accounts, get_current_user, etc.):
            // Can't inject into fixed-signature tools. The middleware still
            // captures tool_name + session context from the MCP framework.
            // Allow without modification.
            allow();
            return;
        }

        const output = {
            hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'allow',
                updatedInput,
            },
        };

        process.stdout.write(JSON.stringify(output));
        process.exit(0);
    } catch (err) {
        // Never block a tool call due to instrumentation failure
        process.stderr.write(`inject-instrumentation error: ${err.message}\n`);
        allow();
    }
});

/**
 * Read skill tracking state for this session.
 * State file: /tmp/claude-carta-cap-table/<session_id>.json
 */
function readSkillState(sessionId) {
    if (!sessionId) return {};
    try {
        const stateDir = '/tmp/claude-carta-cap-table';
        const statePath = path.join(stateDir, `${sessionId}.json`);
        return JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch {
        return {};
    }
}

function allow() {
    process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow',
        },
    }));
    process.exit(0);
}
