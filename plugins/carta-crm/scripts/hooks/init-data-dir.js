#!/usr/bin/env node
/**
 * SessionStart hook: initialize session directory and prune stale session files.
 *
 * Part of the official Carta AI Agent Plugin.
 */

const fs = require('fs');
const path = require('path');

const MAX_SESSION_AGE_MS = 24 * 60 * 60 * 1000;

let inputData = '';
process.stdin.on('data', chunk => (inputData += chunk));

process.stdin.on('end', () => {
    try {
        const dataDir = process.env.CLAUDE_PLUGIN_DATA;
        if (dataDir) {
            const sessionsDir = path.join(dataDir, 'sessions');
            fs.mkdirSync(sessionsDir, { recursive: true });

            try {
                const files = fs.readdirSync(sessionsDir);
                const now = Date.now();
                for (const file of files) {
                    const filePath = path.join(sessionsDir, file);
                    try {
                        const stat = fs.statSync(filePath);
                        if (now - stat.mtimeMs > MAX_SESSION_AGE_MS) {
                            fs.unlinkSync(filePath);
                        }
                    } catch {}
                }
            } catch {}
        }
    } catch (err) {
        process.stderr.write(`init-data-dir error: ${err.message}\n`);
    }

    process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
            hookEventName: 'SessionStart',
        },
    }));
    process.exit(0);
});
