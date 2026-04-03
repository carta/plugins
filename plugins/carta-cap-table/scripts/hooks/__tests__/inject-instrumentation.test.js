const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const HOOK_SCRIPT = path.resolve(__dirname, '../inject-instrumentation.js');
const STATE_DIR = '/tmp/claude-carta-cap-table';

function runHook(input) {
    const result = execSync(`node "${HOOK_SCRIPT}"`, {
        input: JSON.stringify(input),
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    return JSON.parse(result);
}

function writeSkillState(sessionId, state) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(path.join(STATE_DIR, `${sessionId}.json`), JSON.stringify(state));
}

function cleanupState(sessionId) {
    try {
        fs.unlinkSync(path.join(STATE_DIR, `${sessionId}.json`));
    } catch {}
}

describe('inject-instrumentation hook', () => {
    const testSessionId = `test-${Date.now()}`;

    afterAll(() => {
        cleanupState(testSessionId);
    });

    test('injects _instrumentation into fetch params dict', () => {
        writeSkillState(testSessionId, { skills: ['portfolio-query', 'interaction-reference'] });

        const output = runHook({
            tool_name: 'mcp__carta-local__fetch',
            tool_input: {
                command: 'cap_table:get:cap_table_by_share_class',
                params: { corporation_id: 123 },
            },
            session_id: testSessionId,
        });

        expect(output.hookSpecificOutput.permissionDecision).toBe('allow');
        const updatedParams = output.hookSpecificOutput.updatedInput.params;
        expect(updatedParams.corporation_id).toBe(123);
        expect(updatedParams._instrumentation).toBeDefined();
        expect(updatedParams._instrumentation.skills).toEqual(['portfolio-query', 'interaction-reference']);
        expect(updatedParams._instrumentation.plugin).toBe('carta-cap-table');
        expect(updatedParams._instrumentation.session_id).toBe(testSessionId);
    });

    test('injects _instrumentation into fetch with string params', () => {
        writeSkillState(testSessionId, { skills: ['valuation-history'] });

        const output = runHook({
            tool_name: 'mcp__carta-local__fetch',
            tool_input: {
                command: 'cap_table:get:409a_valuations',
                params: '{"corporation_id": 456}',
            },
            session_id: testSessionId,
        });

        const updatedParams = output.hookSpecificOutput.updatedInput.params;
        expect(updatedParams.corporation_id).toBe(456);
        expect(updatedParams._instrumentation.skills).toEqual(['valuation-history']);
    });

    test('allows non-gateway tools without modification', () => {
        const output = runHook({
            tool_name: 'mcp__carta-local__list_accounts',
            tool_input: {},
            session_id: testSessionId,
        });

        expect(output.hookSpecificOutput.permissionDecision).toBe('allow');
        expect(output.hookSpecificOutput.updatedInput).toBeUndefined();
    });

    test('handles missing skill state gracefully', () => {
        cleanupState(testSessionId);

        const output = runHook({
            tool_name: 'mcp__carta-local__fetch',
            tool_input: {
                command: 'cap_table:get:grants',
                params: { corporation_id: 789 },
            },
            session_id: 'nonexistent-session',
        });

        const inst = output.hookSpecificOutput.updatedInput.params._instrumentation;
        expect(inst.skills).toEqual([]);
        expect(inst.plugin).toBe('carta-cap-table');
    });

    test('includes plugin_version from plugin.json', () => {
        writeSkillState(testSessionId, { skills: ['test'] });

        const output = runHook({
            tool_name: 'mcp__carta-local__fetch',
            tool_input: {
                command: 'cap_table:get:grants',
                params: { corporation_id: 1 },
            },
            session_id: testSessionId,
        });

        const inst = output.hookSpecificOutput.updatedInput.params._instrumentation;
        expect(inst.plugin_version).toBeDefined();
        expect(inst.plugin_version).not.toBe('unknown');
    });

    test('does not inject into discover tool', () => {
        const output = runHook({
            tool_name: 'mcp__carta-local__discover',
            tool_input: { domain: 'cap_table' },
            session_id: testSessionId,
        });

        expect(output.hookSpecificOutput.permissionDecision).toBe('allow');
        expect(output.hookSpecificOutput.updatedInput).toBeUndefined();
    });
});
