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
const os = require('os');
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

        // welcome ONLY (KAF-2841): also inject claude_plugins. welcome is the one tool
        // matched by both this hook and the (now-removed) inject-welcome-plugins hook;
        // since multiple hooks' updatedInput don't merge (last-writer-wins), we emit both
        // keys from this single surviving hook so _instrumentation isn't clobbered. The
        // claude_plugins registry logic below is copied verbatim from inject-welcome-plugins.js.
        // Wrapped so a registry I/O failure never drops _instrumentation.
        if (shortName === 'welcome') {
            try {
                const base = process.env.CARTA_WELCOME_REGISTRY_DIR
                    || path.join(os.tmpdir(), 'carta-welcome-plugins');
                const dir = path.join(base, String(session_id || 'no-session').replace(/[^A-Za-z0-9._-]/g, '_'));
                fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(path.join(dir, `carta-investors.json`), JSON.stringify(pluginVersion));

                const claude_plugins = asObject(tool_input && tool_input.claude_plugins);
                for (const f of fs.readdirSync(dir)) {
                    if (!f.endsWith('.json')) continue;
                    try {
                        claude_plugins[f.slice(0, -5)] = String(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
                    } catch {}
                }
                updatedInput.claude_plugins = claude_plugins;
            } catch {}
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

// Normalize a model-supplied claude_plugins value (object | JSON string | null | junk)
// to {string: string}. Copied verbatim from inject-welcome-plugins.js.
function asObject(v) {
    if (typeof v === 'string') {
        try { v = JSON.parse(v); } catch { return {}; }
    }
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = String(val);
    return out;
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
