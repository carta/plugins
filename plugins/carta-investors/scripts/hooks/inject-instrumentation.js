#!/usr/bin/env node
/**
 * PreToolUse hook: inject _instrumentation_v2 into Carta MCP tool calls.
 *
 * Every active Carta plugin fires this hook on the same tool call, and hooks'
 * updatedInput does not merge (last-writer-wins) — so with v1's per-plugin
 * _instrumentation key each plugin clobbered the others, dropping their signal.
 * v2 fixes this: each plugin writes its own record to a shared session registry,
 * then reads the whole registry and emits the fully-merged payload. Whichever
 * plugin's hook runs last still carries every plugin's data (KAF-2892).
 *
 * For tools that accept a params dict (fetch, mutate), the payload is nested in
 * params; other tools get it at the top level of tool_input. The MCP server
 * middleware extracts it for Kafka events and Datadog spans, then the gateway
 * strips it before command processing.
 *
 * Schema:
 *   _instrumentation_v2: {
 *     plugins:    { name: string, version: string }[]  — every active Carta plugin
 *     skills:     string[]  — union of loaded skills, namespaced "plugin:skill"
 *     session_id: string    — Claude Code session ID
 *     prompt_id:  string    — UUID of the user prompt currently being processed
 *     permission_mode: string — Claude Code's active permission mode
 *     effort:     string    — Claude Code's active reasoning effort level
 *     agent_id:   string    — subagent id; present only when the tool call originated inside a subagent
 *     model:      string    — Claude model id, captured at SessionStart (see capture-model.js)
 *     from_hook:  boolean   — always true; marks the payload as hook-emitted (vs the server's AI-generated fallback)
 *   }
 *
 * Part of the official Carta AI Agent Plugin.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const PLUGIN = 'carta-investors';

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

// Sanitize a session id into a filesystem-safe path segment.
function sanitize(sessionId) {
    return String(sessionId || 'no-session').replace(/[^A-Za-z0-9._-]/g, '_');
}

// Read this plugin's loaded skills for the session (bare names, no prefix). Fail open to [].
// Session id is used raw to match track-active-skill.js, this plugin's state writer.
function readSkills(sessionId) {
    if (!sessionId) return [];
    try {
        const p = path.join(STATE_DIR, `${sessionId}.json`);
        const s = JSON.parse(fs.readFileSync(p, 'utf8'));
        return Array.isArray(s.skills) ? s.skills : [];
    } catch { return []; }
}

// Cross-plugin merge: write this plugin's record to the shared session registry,
// then read every plugin's record and fold them into one v2 payload. Each hook
// emits the full union, so last-writer-wins never drops a plugin. Falls back to
// this plugin alone if the registry is unavailable.
function buildInstrumentationV2(sessionId, skills, promptId, permissionMode, effort, agentId) {
    const namespaced = skills.map(s => `${PLUGIN}:${s}`);
    const selfOnly = {
        plugins: [{ name: PLUGIN, version: pluginVersion }],
        skills: namespaced,
        session_id: sessionId || null,
        prompt_id: promptId || null,
        permission_mode: permissionMode || null,
        effort: effort || null,
        agent_id: agentId || null,
        model: null,
        from_hook: true,
    };
    try {
        const base = process.env.CARTA_INSTRUMENTATION_REGISTRY_DIR
            || path.join(os.tmpdir(), 'carta-instrumentation');
        const dir = path.join(base, sanitize(sessionId));
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
            path.join(dir, `${PLUGIN}.json`),
            JSON.stringify({ plugin: PLUGIN, version: pluginVersion, skills: namespaced }),
        );

        const plugins = [];
        const mergedSkills = [];
        const seen = new Set();
        for (const f of fs.readdirSync(dir).sort()) {
            if (!f.endsWith('.json')) continue;
            try {
                const rec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
                plugins.push({ name: rec.plugin || f.slice(0, -5), version: String(rec.version || '') });
                for (const s of Array.isArray(rec.skills) ? rec.skills : []) {
                    if (!seen.has(s)) { seen.add(s); mergedSkills.push(s); }
                }
            } catch {}
        }
        if (!plugins.length) return selfOnly;
        // Move the most-recently-invoked skill (the shared '.last-skill' marker written
        // cross-plugin by track-active-skill.js) to the end, so the server's positional
        // last_skill = skills[-1] signals recency, not alphabetical plugin order (KAF-2912).
        let last = '';
        try { last = fs.readFileSync(path.join(dir, '.last-skill'), 'utf8').trim(); } catch {}
        const i = last ? mergedSkills.indexOf(last) : -1;
        if (i > -1) mergedSkills.push(mergedSkills.splice(i, 1)[0]);
        // model is captured at SessionStart by capture-model.js (not on PreToolUse stdin).
        let model = null;
        try { model = fs.readFileSync(path.join(dir, '.model'), 'utf8').trim() || null; } catch {}
        return {
            plugins,
            skills: mergedSkills,
            session_id: sessionId || null,
            prompt_id: promptId || null,
            permission_mode: permissionMode || null,
            effort: effort || null,
            agent_id: agentId || null,
            model,
            from_hook: true,
        };
    } catch {
        return selfOnly;
    }
}

// Tools where _instrumentation_v2 goes inside the params dict (MCP gateway tools).
// fetch and mutate both accept a generic params dict; the Carta backend middleware
// extracts and strips _instrumentation_v2 before command processing.
// All other carta MCP tools receive it at the top level of tool_input.
const PARAMS_TOOLS = new Set(['fetch', 'mutate']);

let inputData = '';
process.stdin.on('data', chunk => (inputData += chunk));

process.stdin.on('end', () => {
    try {
        const input = JSON.parse(inputData);
        const { tool_name, tool_input, session_id, prompt_id, permission_mode, effort, agent_id } = input;

        // Extract the short tool name from mcp__<server>__<tool>
        const parts = (tool_name || '').split('__');
        const shortName = parts.length >= 3 ? parts[parts.length - 1] : tool_name;

        const instrumentation = buildInstrumentationV2(
            session_id, readSkills(session_id), prompt_id, permission_mode, effort, agent_id,
        );

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
            params._instrumentation_v2 = instrumentation;
            updatedInput = { ...tool_input, params };
        } else {
            // Non-gateway tools (discover, welcome, list_accounts, list_contexts, set_context, etc.):
            // Fixed-signature — inject _instrumentation_v2 at the top level of tool_input
            // so the MCP framework middleware can capture skill/plugin/session context.
            updatedInput = { ...tool_input, _instrumentation_v2: instrumentation };
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
