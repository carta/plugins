#!/usr/bin/env node
/**
 * PostToolUse Hook: Warn on empty execute_query responses
 *
 * When execute_query returns no rows, outputs a reminder to stderr
 * (exit 2) which gets fed to Claude.
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

        // Parse and check for empty results
        let parsed;
        try {
            parsed = typeof resultStr === 'string' ? JSON.parse(resultStr) : resultStr;
        } catch {
            process.exit(0);
            return;
        }

        const isEmpty =
            (parsed && parsed._warning) ||
            (Array.isArray(parsed) && parsed.length === 0) ||
            (parsed?.rows && parsed.rows.length === 0) ||
            (parsed?.count === 0);

        if (isEmpty) {
            const sql = tool_input?.sql || 'query';
            process.stderr.write(
                `⚠️ EMPTY DATA: execute_query returned no results. ` +
                `Tell the user what data was expected but missing and suggest next steps ` +
                `(check firm context with list_contexts, verify table names with list_tables, etc.).`
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
