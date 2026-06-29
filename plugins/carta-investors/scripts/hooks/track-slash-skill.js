#!/usr/bin/env node
/**
 * UserPromptSubmit hook: track explicitly-invoked carta-investors skills.
 *
 * When a user types /carta-investors:<name> or /<name> as a bare slash command,
 * Claude Code expands the skill inline without emitting a Skill tool call —
 * so the PreToolUse:Skill hook never fires. This hook closes that attribution gap
 * by writing the skill name into the same session file that inject-instrumentation.js reads.
 *
 * Best effort — never throws, emits no stdout on success.
 *
 * Part of the official Carta AI Agent Plugin.
 */

const fs = require('fs');
const path = require('path');

const PREFIX = 'carta-investors:';
const STATE_DIR = process.env.CLAUDE_PLUGIN_DATA
    ? path.join(process.env.CLAUDE_PLUGIN_DATA, 'sessions')
    : '/tmp/claude-carta-investors';

const PLUGIN_ROOT = path.resolve(__dirname, '../..');
const SLASH_COMMAND_RE = /^\/([A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)?)(?:\s|$)/;

let inputData = '';
process.stdin.on('data', chunk => (inputData += chunk));

process.stdin.on('end', () => {
    try {
        const input = JSON.parse(inputData);
        const { prompt, session_id } = input;

        if (!prompt || !session_id) {
            process.exit(0);
        }

        const match = SLASH_COMMAND_RE.exec(prompt);
        if (!match) {
            process.exit(0);
        }

        const command = match[1];
        let skillName;

        if (command.includes(':')) {
            // Qualified form: carta-investors:<name>
            if (!command.startsWith(PREFIX)) {
                process.exit(0);
            }
            skillName = command.slice(PREFIX.length);
        } else {
            // Bare form: /<name> — accept only if it's our own skill
            if (!fs.existsSync(path.join(PLUGIN_ROOT, 'skills', command))) {
                process.exit(0);
            }
            skillName = command;
        }

        fs.mkdirSync(STATE_DIR, { recursive: true });
        const safeSessionId = String(session_id).replace(/[^A-Za-z0-9._-]/g, '_');
        const statePath = path.join(STATE_DIR, `${safeSessionId}.json`);

        let existing = {};
        try { existing = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch {}

        const skills = Array.isArray(existing.skills) ? existing.skills : [];
        if (!skills.includes(skillName)) {
            skills.push(skillName);
        }
        existing.skills = skills;

        fs.writeFileSync(statePath, JSON.stringify(existing));
    } catch (_) {
        // Best effort — never block the prompt
    }

    process.exit(0);
});
