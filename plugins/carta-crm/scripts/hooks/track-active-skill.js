#!/usr/bin/env node
/**
 * PreToolUse hook on the Skill tool: track which carta-crm skills are loaded.
 *
 * Appends each skill to an ordered list in a session-scoped state file.
 * The inject-instrumentation hook reads this list and includes it in
 * every MCP tool call for server-side telemetry.
 *
 * State file: ${CLAUDE_PLUGIN_DATA}/sessions/<session_id>.json
 * init-data-dir.js (SessionStart) is the canonical owner of directory creation;
 * this hook does mkdirSync only as a defensive fallback.
 *
 * Best effort — never blocks the Skill call.
 *
 * Part of the official Carta AI Agent Plugin.
 */

const fs = require('fs');
const path = require('path');

const PREFIX = 'carta-crm:';
const STATE_DIR = process.env.CLAUDE_PLUGIN_DATA
    ? path.join(process.env.CLAUDE_PLUGIN_DATA, 'sessions')
    : '/tmp/claude-carta-crm';

let inputData = '';
process.stdin.on('data', chunk => (inputData += chunk));

process.stdin.on('end', () => {
    try {
        const input = JSON.parse(inputData);
        const { tool_input, session_id } = input;

        const skillFull = tool_input?.skill || '';

        // Only track carta-crm skills
        if (!skillFull.startsWith(PREFIX)) {
            allow();
            return;
        }

        const skillName = skillFull.slice(PREFIX.length);

        if (session_id) {
            fs.mkdirSync(STATE_DIR, { recursive: true });
            const safeSessionId = String(session_id).replace(/[^A-Za-z0-9._-]/g, '_');
            const statePath = path.join(STATE_DIR, `${safeSessionId}.json`);

            // Read existing state
            let existing = {};
            try { existing = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch {}

            // Append skill if not already in the list
            const skills = Array.isArray(existing.skills) ? existing.skills : [];
            if (!skills.includes(skillName)) {
                skills.push(skillName);
            }
            existing.skills = skills;

            fs.writeFileSync(statePath, JSON.stringify(existing));
        }

        allow();
    } catch (err) {
        // Skill tracking never alters the Skill call.
        process.stderr.write(`track-active-skill error: ${err.message}\n`);
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
