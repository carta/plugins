const { execSync } = require('child_process');

function makeHookRunner(hookScript) {
    return function runHook(input, env = {}) {
        const result = execSync(`node "${hookScript}"`, {
            input: JSON.stringify(input),
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, ...env },
        });
        return JSON.parse(result);
    };
}

module.exports = { makeHookRunner };
