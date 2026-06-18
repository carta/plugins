#!/usr/bin/env node
/**
 * PreToolUse hook: populate the Carta `welcome` tool's `claude_plugins`
 * (dict of installed plugin name -> version), whether or not the model passes it.
 *
 * Each Carta plugin registers this hook. Claude Code runs matching plugin hooks
 * sequentially (alphabetical) and the LAST updatedInput REPLACES the rest — no
 * merge across plugins. So hooks coordinate via a shared, session-scoped dir:
 * each writes its own {name: version} file and emits the union of all files (the
 * last/winning hook has seen the earlier writes). The model's value is merged in
 * too — registry wins on conflicts — so a partial rollout (tags present but the
 * hook not yet everywhere) doesn't downgrade Claude's full set.
 *
 * Fail-open: any error -> plain allow. Part of the official Carta AI Agent Plugin.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const PLUGIN_NAME = 'carta-cap-table';

let version = 'unknown';
try {
    const p = path.resolve(__dirname, '../../.claude-plugin/plugin.json');
    version = JSON.parse(fs.readFileSync(p, 'utf8')).version || 'unknown';
} catch {}

let input = '';
process.stdin.on('data', c => (input += c));
process.stdin.on('end', () => {
    try {
        const { tool_name, tool_input, session_id } = JSON.parse(input);
        if (!String(tool_name).endsWith('__welcome')) return done();

        // Shared cross-plugin registry (CLAUDE_PLUGIN_DATA is per-plugin so unusable).
        // CARTA_WELCOME_REGISTRY_DIR overrides the base for tests.
        const base = process.env.CARTA_WELCOME_REGISTRY_DIR
            || path.join(os.tmpdir(), 'carta-welcome-plugins');
        const dir = path.join(base, String(session_id || 'no-session').replace(/[^A-Za-z0-9._-]/g, '_'));
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${PLUGIN_NAME}.json`), JSON.stringify(version));

        // Model value first, registry overlays it (registry wins on conflicts).
        const claude_plugins = asObject(tool_input && tool_input.claude_plugins);
        for (const f of fs.readdirSync(dir)) {
            if (!f.endsWith('.json')) continue;
            try {
                claude_plugins[f.slice(0, -5)] = String(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
            } catch {}
        }
        done({ ...tool_input, claude_plugins });
    } catch (err) {
        process.stderr.write(`inject-welcome-plugins error: ${err.message}\n`);
        done();
    }
});

// Normalize a model-supplied value (object | JSON string | null | junk) to {string: string}.
function asObject(v) {
    if (typeof v === 'string') {
        try { v = JSON.parse(v); } catch { return {}; }
    }
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = String(val);
    return out;
}

function done(updatedInput) {
    process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow',
            ...(updatedInput ? { updatedInput } : {}),
        },
    }));
    process.exit(0);
}
