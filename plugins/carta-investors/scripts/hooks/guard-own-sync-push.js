#!/usr/bin/env node
/**
 * PreToolUse Hook: carta-manco-reporting's own-sync pushes go out exactly as planned
 *
 * When the `claude` CLI can't reach Carta, a Claude session pushes a dashboard's reports
 * to the hosted app itself, copying each call's `arguments` from the file
 * `own_sync.py --plan` wrote (<dashboard>/.own-sync-plan/<report_id>.arguments.json).
 * A payload is up to 256 KB of amounts, and Carta checks only its shape, so a mistyped
 * number would reach the hosted app. This denies a budget_report create or update that
 * belongs to a plan but differs from it, the check share_bridge.py makes on its own
 * relay session.
 *
 * A call belongs to a plan when its command and fund_uuid match and it is shared with
 * exactly the planner's own user: a deliberate share can't be shared with only yourself
 * (Carta refuses it), so this never touches one. Anything else passes untouched, and so
 * does every call in share_bridge.py's own relay session (MANCO_OWN_SYNC_BRIDGE), which
 * already checks each call against the arguments it was given.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const COMMANDS = new Set(['fa__create__budget_report', 'fa__mutate__budget_report']);

// manco_paths.cache_root()/dashboard_dir_for()/own_sync_plan_dir()/own_sync_plan_files():
// <root>/<firm>/<manco>/.own-sync-plan/<report_id>.plan.json.
function planFiles() {
    const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
    const root = path.join(base, 'manco-reporting');
    const files = [];
    const dirs = (dir) => {
        try {
            return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => path.join(dir, d.name));
        } catch {
            return [];
        }
    };
    for (const firm of dirs(root)) {
        for (const dashboard of dirs(firm)) {
            const planDir = path.join(dashboard, '.own-sync-plan');
            let names = [];
            try {
                names = fs.readdirSync(planDir);
            } catch {
                continue;
            }
            for (const name of names) {
                if (name.endsWith('.plan.json')) files.push(path.join(planDir, name));
            }
        }
    }
    return files;
}

function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
        return Object.keys(value).sort().reduce((out, key) => ({ ...out, [key]: canonical(value[key]) }), {});
    }
    return value;
}

const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

const sameAudience = (a, b) => Array.isArray(a) && a.length === 1 && Array.isArray(b) && b.length === 1 && a[0] === b[0];

function deny(reason) {
    process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
    }));
}

let inputData = '';
process.stdin.on('data', chunk => (inputData += chunk));
process.stdin.on('end', () => {
    if (process.env.MANCO_OWN_SYNC_BRIDGE) process.exit(0);
    let input;
    try {
        input = JSON.parse(inputData);
    } catch {
        process.exit(0);
    }
    const toolInput = input?.tool_input || {};
    const command = String(toolInput.name || '').replace(/:/g, '__');
    if (!COMMANDS.has(command)) process.exit(0);
    let args = toolInput.arguments;
    if (typeof args === 'string') {
        try {
            args = JSON.parse(args);
        } catch {
            process.exit(0);
        }
    }
    if (!args || typeof args !== 'object') process.exit(0);

    const plans = [];
    for (const file of planFiles()) {
        try {
            const plan = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (plan.command === command && plan.arguments?.fund_uuid === args.fund_uuid
                && sameAudience(plan.arguments?.shared_with, args.shared_with)) {
                plans.push(plan);
            }
        } catch {
            // A plan being rewritten right now; the next call reads it whole.
        }
    }
    if (!plans.length || plans.some(plan => same(plan.arguments, args))) process.exit(0);
    deny('These arguments differ from the planned own-sync push. Read the plan\'s ' +
        '<report_id>.arguments.json and pass its content as `arguments` exactly as written: ' +
        'no field added, dropped, reordered into a string, or retyped.');
    process.exit(0);
});
