#!/usr/bin/env node
// CI guard: every MCP tool reference in commands/ and agents/ must use this
// plugin's fully-qualified tool prefix. Claude Code names a plugin's MCP tools
// `mcp__plugin_<plugin-name>_<server-name>__<tool>` (here mcp__plugin_symvanta_symvanta__).
// The short `mcp__symvanta__` form matches no real tool, so an allowed-tools /
// agent-tools entry using it silently no-ops (the restriction is lost). This
// script catches that regression before release. Run: node scripts/check-tool-prefixes.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED = 'mcp__plugin_symvanta_symvanta__';
const DIRS = ['commands', 'agents'];
const TOKEN = /mcp__[A-Za-z0-9_]+/g;

const violations = [];
for (const dir of DIRS) {
    let files;
    try {
        files = readdirSync(join(root, dir)).filter((f) => f.endsWith('.md'));
    } catch {
        continue;
    }
    for (const file of files) {
        const text = readFileSync(join(root, dir, file), 'utf8');
        for (const match of text.matchAll(TOKEN)) {
            if (!match[0].startsWith(EXPECTED)) {
                violations.push(`${dir}/${file}: ${match[0]}`);
            }
        }
    }
}

if (violations.length > 0) {
    console.error(`Wrong MCP tool prefix (expected ${EXPECTED}*):`);
    for (const v of violations) console.error('  ' + v);
    console.error(
        `\n${violations.length} violation(s). A wrong prefix makes allowed-tools / agent tools match no real tool, so the restriction silently no-ops.`,
    );
    process.exit(1);
}
console.log(`OK: every MCP tool reference in ${DIRS.join(', ')} uses ${EXPECTED}*`);
