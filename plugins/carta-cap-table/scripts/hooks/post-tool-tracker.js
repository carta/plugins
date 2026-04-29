#!/usr/bin/env node
/**
 * PostToolUse hook: cache discover() output and track user preferences.
 *
 * After a discover() call, caches the command registry to
 * ${CLAUDE_PLUGIN_DATA}/cache/commands.json for faster subsequent lookups.
 *
 * After a fetch() call, records the corporation_id to
 * ${CLAUDE_PLUGIN_DATA}/prefs.json for smart defaults.
 *
 * Part of the official Carta AI Agent Plugin.
 */

const fs = require('fs');
const path = require('path');

const MAX_RECENT_CORPORATIONS = 10;

let pluginVersion = 'unknown';
try {
    const pluginJsonPath = path.resolve(__dirname, '../../.claude-plugin/plugin.json');
    const pluginJson = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf8'));
    pluginVersion = pluginJson.version || 'unknown';
} catch {}

let inputData = '';
process.stdin.on('data', chunk => (inputData += chunk));

process.stdin.on('end', () => {
    try {
        const dataDir = process.env.CLAUDE_PLUGIN_DATA;
        if (!dataDir) {
            done();
            return;
        }

        const input = JSON.parse(inputData);
        const { tool_name, tool_input, tool_result } = input;

        const parts = (tool_name || '').split('__');
        const shortName = parts.length >= 3 ? parts[parts.length - 1] : tool_name;

        const resultText = extractResultText(tool_result);

        if (shortName === 'discover' && resultText) {
            cacheDiscoverResult(dataDir, resultText);
        }

        if (shortName === 'welcome' && resultText) {
            cacheToolResult(dataDir, 'welcome.json', resultText);
        }

        if (shortName === 'list_accounts' && resultText) {
            cacheToolResult(dataDir, 'accounts.json', resultText);
        }

        if (shortName === 'fetch' && tool_input) {
            trackCorporation(dataDir, tool_input);
        }
    } catch (err) {
        process.stderr.write(`post-tool-tracker error: ${err.message}\n`);
    }

    done();
});

function extractResultText(toolResult) {
    if (!toolResult || !toolResult.content) return null;
    for (const block of toolResult.content) {
        if (block.type === 'text' && block.text) return block.text;
    }
    return null;
}

// commands.json is read by the benchmark framework (carta-mcp agent_runner.py)
// and will be read by skills via ${CLAUDE_PLUGIN_DATA} substitution in SKILL.md
function cacheDiscoverResult(dataDir, resultText) {
    try {
        const commands = JSON.parse(resultText);
        if (!Array.isArray(commands)) return;

        const cacheDir = path.join(dataDir, 'cache');
        fs.mkdirSync(cacheDir, { recursive: true });

        const cacheData = {
            cached_at: new Date().toISOString(),
            plugin_version: pluginVersion,
            commands,
        };
        fs.writeFileSync(path.join(cacheDir, 'commands.json'), JSON.stringify(cacheData));
    } catch {}
}

const MAX_CACHE_SIZE = 500000;

function cacheToolResult(dataDir, filename, resultText) {
    try {
        if (resultText.length > MAX_CACHE_SIZE) return;
        const cacheDir = path.join(dataDir, 'cache');
        fs.mkdirSync(cacheDir, { recursive: true });
        const cacheData = {
            cached_at: new Date().toISOString(),
            text: resultText,
        };
        fs.writeFileSync(path.join(cacheDir, filename), JSON.stringify(cacheData));
    } catch {}
}

function trackCorporation(dataDir, toolInput) {
    try {
        let params = toolInput.params || {};
        if (typeof params === 'string') {
            try { params = JSON.parse(params); } catch { return; }
        }

        const corpId = params.corporation_id;
        if (corpId == null) return;

        const corpIdStr = String(corpId);
        const prefsPath = path.join(dataDir, 'prefs.json');

        let prefs = {};
        try { prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8')); } catch {}

        prefs.last_corporation_id = corpIdStr;

        const recent = prefs.recent_corporations || [];
        const idx = recent.indexOf(corpIdStr);
        if (idx !== -1) recent.splice(idx, 1);
        recent.push(corpIdStr);
        prefs.recent_corporations = recent.slice(-MAX_RECENT_CORPORATIONS);
        prefs.updated_at = new Date().toISOString();

        fs.writeFileSync(prefsPath, JSON.stringify(prefs));
    } catch {}
}

function done() {
    process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
            hookEventName: 'PostToolUse',
        },
    }));
    process.exit(0);
}
