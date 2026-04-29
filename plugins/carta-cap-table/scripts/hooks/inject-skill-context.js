#!/usr/bin/env node
/**
 * SessionStart hook: inject skill-first reminder and cached session data.
 *
 * Ensures Claude loads the relevant carta-cap-table skill before making
 * any tool calls, even in subagents that don't inherit session context.
 *
 * When CLAUDE_PLUGIN_DATA has cached welcome/accounts data (from a
 * previous session's PostToolUse hook), injects it into additionalContext
 * so the LLM can skip the welcome() and list_accounts() tool calls.
 *
 * Part of the official Carta AI Agent Plugin.
 */

const fs = require('fs');
const path = require('path');

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

let inputData = '';
process.stdin.on('data', chunk => (inputData += chunk));

process.stdin.on('end', () => {
    let hookEventName = 'SessionStart';
    try {
        const input = JSON.parse(inputData);
        hookEventName = input.hook_event_name || hookEventName;
    } catch {}

    let sessionContext = '';
    const dataDir = process.env.CLAUDE_PLUGIN_DATA;
    if (dataDir) {
        const welcome = readCachedText(path.join(dataDir, 'cache', 'welcome.json'));
        const accounts = readCachedText(path.join(dataDir, 'cache', 'accounts.json'));
        if (welcome || accounts) {
            const parts = [];
            if (welcome) parts.push(stripTags(welcome));
            if (accounts) parts.push(stripTags(accounts));
            sessionContext = '<session-context>\n' + parts.join('\n\n') + '\n</session-context>\n';
        }
    }

    // Canonical auth gate prompt lives in carta-interaction-reference/SKILL.md Section 6.2.
    // Keep the wording below in sync with that source.
    const output = {
        hookSpecificOutput: {
            hookEventName,
            additionalContext:
                sessionContext +
                '<EXTREMELY_IMPORTANT>You have carta-cap-table tools available. Before ANY tool call, invoke the matching Skill(\'carta-cap-table:...\') first. The skill defines what to fetch, what inputs are required, and how to present results. If no skill matches, invoke Skill(\'carta-cap-table:carta-discover-commands\') to find the right command via discover(). Additionally, ALWAYS invoke Skill(\'carta-cap-table:carta-interaction-reference\') alongside any domain skill to load Carta\'s voice, tone, and data provenance rules before presenting results. IMPORTANT: Skill is a deferred tool — if its schema is not yet loaded, you MUST call ToolSearch with query "select:Skill" first, then invoke the Skill tool.</EXTREMELY_IMPORTANT>\n' +
                '<EXTREMELY_IMPORTANT>AI COMPUTATION AUTHORIZATION GATE: When a carta-cap-table skill\'s Gates section declares "AI computation: Yes", you MUST call AskUserQuestion BEFORE fetching data or computing. Use this prompt, replacing [X]: "No saved Carta model matches these terms. I can compute [X] using AI — this would be Claude\'s analysis, not Carta data. Would you like me to proceed?" Do NOT write this as plain text — use the AskUserQuestion tool so execution blocks. User says yes: proceed, label output as Claude\'s analysis. User says no: stop — no output, no fallback.</EXTREMELY_IMPORTANT>',
        },
    };

    process.stdout.write(JSON.stringify(output));
    process.exit(0);
});

function stripTags(text) {
    return text ? text.replace(/<[^>]*>/g, '') : text;
}

function readCachedText(filePath) {
    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const cachedAt = new Date(data.cached_at).getTime();
        if (Date.now() - cachedAt > CACHE_TTL_MS) return null;
        return data.text || null;
    } catch {
        return null;
    }
}
