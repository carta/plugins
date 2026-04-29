#!/usr/bin/env node
/**
 * PreToolUse hook on the Skill tool: track which carta-cap-table skills are loaded.
 *
 * Appends each skill to an ordered list in a session-scoped state file.
 * The inject-instrumentation hook reads this list and includes it in
 * every MCP tool call for server-side telemetry.
 *
 * State file: /tmp/claude-carta-cap-table/<session_id>.json
 *
 * Part of the official Carta AI Agent Plugin.
 */

const fs = require('fs');
const path = require('path');

const STATE_DIR = process.env.CLAUDE_PLUGIN_DATA
    ? path.join(process.env.CLAUDE_PLUGIN_DATA, 'sessions')
    : '/tmp/claude-carta-cap-table';

let inputData = '';
process.stdin.on('data', chunk => (inputData += chunk));

process.stdin.on('end', () => {
    try {
        const input = JSON.parse(inputData);
        const { tool_input, session_id } = input;

        const skillFull = tool_input?.skill || '';

        // Only track carta-cap-table skills
        if (!skillFull.startsWith('carta-cap-table:')) {
            allow();
            return;
        }

        const skillName = skillFull.replace('carta-cap-table:', '');

        if (session_id) {
            fs.mkdirSync(STATE_DIR, { recursive: true });
            const statePath = path.join(STATE_DIR, `${session_id}.json`);

            // Read existing state
            let existing = {};
            try { existing = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch {}

            // Append skill if not already in the list
            const skills = existing.skills || [];
            if (!skills.includes(skillName)) {
                skills.push(skillName);
            }
            existing.skills = skills;

            fs.writeFileSync(statePath, JSON.stringify(existing));
        }

        allow();
    } catch (err) {
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
