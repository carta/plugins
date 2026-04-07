#!/usr/bin/env node
/**
 * SessionStart hook: inject skill-first reminder into every session.
 *
 * Ensures Claude loads the relevant carta-investors skill before making
 * any tool calls, even in subagents that don't inherit session context.
 *
 * Part of the official Carta AI Agent Plugin.
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
                '<EXTREMELY_IMPORTANT>You have carta-investors tools available via the Carta MCP server (list_tables, describe_table, execute_query). Before ANY tool call, invoke the matching Skill(\'carta-investors:...\') first. The skill defines what to query, what inputs are required, and how to present results. If no skill matches the user\'s request, use list_tables to browse available datasets and describe_table to understand schemas. IMPORTANT: Skill is a deferred tool — if its schema is not yet loaded, you MUST call ToolSearch with query "select:Skill" first, then invoke the Skill tool.</EXTREMELY_IMPORTANT>',
        },
    };

    process.stdout.write(JSON.stringify(output));
    process.exit(0);
});
