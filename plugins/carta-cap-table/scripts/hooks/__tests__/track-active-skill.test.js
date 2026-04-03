const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const HOOK_SCRIPT = path.resolve(__dirname, '../track-active-skill.js');
const STATE_DIR = '/tmp/claude-carta-cap-table';

function runHook(input) {
    const result = execSync(`node "${HOOK_SCRIPT}"`, {
        input: JSON.stringify(input),
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
    });
    return JSON.parse(result);
}

function readState(sessionId) {
    const statePath = path.join(STATE_DIR, `${sessionId}.json`);
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

function cleanupState(sessionId) {
    try {
        fs.unlinkSync(path.join(STATE_DIR, `${sessionId}.json`));
    } catch {}
}

describe('track-active-skill hook', () => {
    const testSessionId = `test-track-${Date.now()}`;

    afterAll(() => {
        cleanupState(testSessionId);
    });

    test('appends skill to skills array', () => {
        const output = runHook({
            tool_name: 'Skill',
            tool_input: { skill: 'carta-cap-table:portfolio-query' },
            session_id: testSessionId,
        });

        expect(output.hookSpecificOutput.permissionDecision).toBe('allow');

        const state = readState(testSessionId);
        expect(state.skills).toEqual(['portfolio-query']);
    });

    test('appends new skills without duplicates', () => {
        runHook({
            tool_name: 'Skill',
            tool_input: { skill: 'carta-cap-table:interaction-reference' },
            session_id: testSessionId,
        });
        const state1 = readState(testSessionId);
        expect(state1.skills).toEqual(['portfolio-query', 'interaction-reference']);

        // Call same skill again — should not duplicate
        runHook({
            tool_name: 'Skill',
            tool_input: { skill: 'carta-cap-table:interaction-reference' },
            session_id: testSessionId,
        });
        const state2 = readState(testSessionId);
        expect(state2.skills).toEqual(['portfolio-query', 'interaction-reference']);
    });

    test('accumulates across multiple domain skills', () => {
        runHook({
            tool_name: 'Skill',
            tool_input: { skill: 'carta-cap-table:pro-forma-model' },
            session_id: testSessionId,
        });
        const state = readState(testSessionId);
        expect(state.skills).toEqual(['portfolio-query', 'interaction-reference', 'pro-forma-model']);
    });

    test('ignores non-carta-cap-table skills', () => {
        const before = readState(testSessionId);

        runHook({
            tool_name: 'Skill',
            tool_input: { skill: 'some-other-plugin:do-stuff' },
            session_id: testSessionId,
        });

        const after = readState(testSessionId);
        expect(after.skills).toEqual(before.skills);
    });

    test('handles missing session_id gracefully', () => {
        const output = runHook({
            tool_name: 'Skill',
            tool_input: { skill: 'carta-cap-table:test' },
            // no session_id
        });

        expect(output.hookSpecificOutput.permissionDecision).toBe('allow');
    });
});
