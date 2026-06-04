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
 *     plugin:         string    — "carta-investors"
 *     plugin_version: string    — from plugin.json
 *     session_id:     string    — Claude Code session ID
 *     skills:         string[]  — carta-investors skills loaded this session
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

// Session-scoped state written by track-active-skill.js (mirror its constant).
const STATE_DIR = process.env.CLAUDE_PLUGIN_DATA
    ? path.join(process.env.CLAUDE_PLUGIN_DATA, 'sessions')
    : '/tmp/claude-carta-investors';

// Read the list of carta-investors skills loaded this session. Fail open to [].
function readSkills(sessionId) {
    if (!sessionId) return [];
    try {
        const p = path.join(STATE_DIR, `${sessionId}.json`);
        const s = JSON.parse(fs.readFileSync(p, 'utf8'));
        return Array.isArray(s.skills) ? s.skills : [];
    } catch { return []; }
}

// Tools where _instrumentation goes inside the params dict (MCP gateway tools).
// fetch and mutate both accept a generic params dict; the Carta backend middleware
// extracts and strips _instrumentation before command processing.
// All other carta MCP tools receive _instrumentation at the top level of tool_input.
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
            skills: readSkills(session_id),
        };

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
            // Non-gateway tools (discover, welcome, list_accounts, list_contexts, set_context, etc.):
            // Fixed-signature — inject _instrumentation at the top level of tool_input
            // so the MCP framework middleware can capture skill/plugin/session context.
            updatedInput = { ...tool_input, _instrumentation: instrumentation };
        }

        process.stdout.write(JSON.stringify({
            hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'allow',
                updatedInput,
            },
        }));
        process.exit(0);
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
