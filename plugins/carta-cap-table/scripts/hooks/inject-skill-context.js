#!/usr/bin/env node
/**
 * SessionStart hook: inject skill-first reminder into every session.
 *
 * Ensures Claude loads the relevant carta-cap-table skill before making
 * any tool calls, even in subagents that don't inherit session context.
 */

let inputData = '';
process.stdin.on('data', chunk => (inputData += chunk));

process.stdin.on('end', () => {
    let hookEventName = 'SessionStart';
    try {
        const input = JSON.parse(inputData);
        hookEventName = input.hook_event_name || hookEventName;
    } catch {}

    const output = {
        hookSpecificOutput: {
            hookEventName,
            additionalContext:
                '<EXTREMELY_IMPORTANT>You have carta-cap-table tools available. Before ANY tool call, invoke the matching Skill(\'carta-cap-table:...\') first. The skill defines what to fetch, what inputs are required, and how to present results. If no skill matches, invoke Skill(\'carta-cap-table:discover-commands\') to find the right command via discover(). Additionally, ALWAYS invoke Skill(\'carta-cap-table:interaction-reference\') alongside any domain skill to load Carta\'s voice, tone, and data provenance rules before presenting results. IMPORTANT: Skill is a deferred tool — if its schema is not yet loaded, you MUST call ToolSearch with query "select:Skill" first, then invoke the Skill tool.</EXTREMELY_IMPORTANT>',
        },
    };

    process.stdout.write(JSON.stringify(output));
    process.exit(0);
});
