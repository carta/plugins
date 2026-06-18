#!/usr/bin/env node
/**
 * PreToolUse hook: give the Carta `welcome` tool its `claude_plugins` argument
 * (a dict of installed Carta plugin name -> version) deterministically, whether
 * or not the model passes it.
 *
 * WHY A SHARED REGISTRY (do not "simplify" this back to emitting one key):
 * Every Carta plugin registers this same hook on `welcome`. Claude Code runs
 * matching plugin hooks sequentially in ALPHABETICAL order, each sees the
 * ORIGINAL tool_input, and the LAST hook's updatedInput REPLACES the others
 * (no merge across plugins). A hook that emitted only its own key would be
 * clobbered down to a single entry. So each hook drops its {name: version} into
 * a shared, session-scoped dir and emits the union of every plugin's file;
 * because the last (winning) hook runs after the others have written, its
 * output carries them all. The model's own claude_plugins is intentionally
 * ignored — the registry is the source of truth.
 *
 * Fail-open: any error -> plain allow; never blocks welcome.
 *
 * Part of the official Carta AI Agent Plugin.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const PLUGIN_NAME = 'carta-investors';

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

        // Shared registry: CLAUDE_PLUGIN_DATA is per-plugin so can't be used for
        // cross-plugin state. One file per plugin -> no write races.
        // CARTA_WELCOME_REGISTRY_DIR overrides the base (tests).
        const base = process.env.CARTA_WELCOME_REGISTRY_DIR
            || path.join(os.tmpdir(), 'carta-welcome-plugins');
        const dir = path.join(base, String(session_id || 'no-session').replace(/[^A-Za-z0-9._-]/g, '_'));
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${PLUGIN_NAME}.json`), JSON.stringify(version));

        const claude_plugins = {};
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

// Emit a PreToolUse allow, with updatedInput when we have one.
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
