#!/usr/bin/env node
/**
 * SessionStart hook: capture the active Claude model into the shared session registry.
 *
 * Claude Code only reports `model` on SessionStart input — it is absent from
 * PreToolUse input (and even from a later SessionStart after /clear, compact, or
 * session recovery). inject-instrumentation.js (PreToolUse) needs the model for
 * the _instrumentation_v2 payload but can't read it there, so we persist it here
 * to a per-session `.model` marker in the same registry dir that hook reads,
 * mirroring the cross-hook `.last-skill` marker flow. Model is session-scoped
 * (not per-plugin), so all Carta plugins share one `.model` file — last writer
 * wins with the same value.
 *
 * Part of the official Carta AI Agent Plugin.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// Sanitize a session id into a filesystem-safe path segment. Must match
// inject-instrumentation.js so the marker is written and read under the same dir.
function sanitize(sessionId) {
    return String(sessionId || 'no-session').replace(/[^A-Za-z0-9._-]/g, '_');
}

let inputData = '';
process.stdin.on('data', chunk => (inputData += chunk));

process.stdin.on('end', () => {
    try {
        const { session_id, model } = JSON.parse(inputData);
        // Skip when either is missing. A later /clear SessionStart omits model —
        // never clobber a previously-captured value with nothing.
        if (session_id && model) {
            const base = process.env.CARTA_INSTRUMENTATION_REGISTRY_DIR
                || path.join(os.tmpdir(), 'carta-instrumentation');
            const dir = path.join(base, sanitize(session_id));
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, '.model'), String(model));
        }
    } catch (err) {
        // Never let instrumentation capture break session start.
        process.stderr.write(`capture-model error: ${err.message}\n`);
    }

    process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
            hookEventName: 'SessionStart',
        },
    }));
    process.exit(0);
});
