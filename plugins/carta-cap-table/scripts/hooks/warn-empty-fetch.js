#!/usr/bin/env node
/**
 * PostToolUse Hook: Warn on empty fetch() responses
 *
 * When carta-cap-table's fetch() returns a _warning (empty data),
 * outputs a reminder to stderr (exit 2) which gets fed to Claude.
 */

let inputData = '';
process.stdin.on('data', chunk => (inputData += chunk));

process.stdin.on('end', () => {
    try {
        const input = JSON.parse(inputData);
        const { tool_input, tool_response } = input;

        // Extract the result string from the MCP response
        let resultStr = tool_response?.result || tool_response;
        if (Array.isArray(resultStr) && resultStr[0]?.type === 'text') {
            resultStr = resultStr[0].text;
        } else if (resultStr?.content && Array.isArray(resultStr.content)) {
            resultStr = resultStr.content[0]?.text || resultStr;
        }

        // Parse JSON and check for _warning
        let parsed;
        try {
            parsed = typeof resultStr === 'string' ? JSON.parse(resultStr) : resultStr;
        } catch {
            process.exit(0);
            return;
        }

        if (parsed && parsed._warning) {
            const command = tool_input?.command || 'unknown command';
            // Exit 2 = stderr fed back to Claude
            process.stderr.write(
                `⚠️ EMPTY DATA: ${command} returned no results. ` +
                `Per the golden rule, any values you derive from this gap are BEST EFFORT. ` +
                `Tell the user what's missing and ask before computing substitutes.`
            );
            process.exit(2);
            return;
        }

        process.exit(0);
    } catch (err) {
        // Never block on hook errors
        process.exit(0);
    }
});
