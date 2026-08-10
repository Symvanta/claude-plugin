#!/usr/bin/env node
// SessionStart hook: inject standing context so the agent reaches for the
// Symvanta code-graph MCP tools from the first turn, even without a CLAUDE.md.
// The tool enumeration is deliberately inlined (not just pointed at via the
// `symvanta` skill): additionalContext is guaranteed to land in every session,
// while loading a skill is conditional on the model choosing to. It ships as
// hooks/tool-list.json, GENERATED from the canonical ruleset source
// (Symvanta/resources/js/data/agent-instructions.ts, AGENT_TOOL_SUMMARIES)
// by scripts/sync-plugin-skill.mjs: edit it there, never here. Routing rules,
// anti-patterns, and edge cases stay in the skill so this stays bounded.
// Plain Node so it runs identically on Windows, macOS, and Linux.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const TOOLS = require('./tool-list.json')
    .map((line) => `- ${line}`)
    .join('\n');

// /symvanta:setup nudge, shown ONCE per project per machine and only while
// the routing block is absent. The marker in CLAUDE.md / CLAUDE.local.md is
// the ground truth (covers a hand-pasted block and a later deletion); the
// flag file only remembers that the nudge was shown, so it never repeats.
// Every branch fails open to "no nudge": broken stdin, an unreadable file,
// or a read-only home dir must never break session start.
function setupNudge() {
    try {
        let cwd = process.cwd();
        try {
            const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
            if (typeof payload.cwd === 'string' && payload.cwd.length > 0) cwd = payload.cwd;
        } catch {
            // No or malformed stdin: fall back to process.cwd().
        }
        for (const name of ['CLAUDE.md', 'CLAUDE.local.md']) {
            try {
                if (fs.readFileSync(path.join(cwd, name), 'utf8').includes('symvanta:routing:begin')) return '';
            } catch {
                // Missing file counts as "no block".
            }
        }
        const flagDir = path.join(os.homedir(), '.symvanta', 'setup-nudge');
        const flag = path.join(flagDir, crypto.createHash('sha1').update(cwd).digest('hex'));
        if (fs.existsSync(flag)) return '';
        fs.mkdirSync(flagDir, { recursive: true });
        fs.writeFileSync(flag, new Date().toISOString());
        return 'One-time pointer: this project has no Symvanta routing block in CLAUDE.md. If init reports indexed repositories, suggest the user run /symvanta:setup once; the block also reaches subagents, which never see this session primer. Do not repeat this suggestion in later sessions.';
    } catch {
        return '';
    }
}

const context = [
    'A Symvanta code-graph MCP server may be connected. Before your first code lookup, load the `symvanta` skill for the full routing rules and anti-patterns (it goes deeper than the list below), then call the Symvanta `init` tool once to check attached repositories. If init reports zero attached repositories, this workspace is not a Symvanta project: ignore this notice and work normally (Grep/Read as usual).',
    `If init reports one or more indexed repositories, prefer these Symvanta MCP tools over Grep/Glob or shell grep/rg for locating and understanding code, and use local Read only to open a file the graph already located:\n${TOOLS}`,
    'Note index health before relying on graph traversal (from init.usage or freshness): a repo whose lastIndexedSha is behind your local HEAD is stale, so verify graph results against the live file; a repo with edge_count 0 has no traversable edges, so relate (callers/blast_radius) will be empty and you should fall back to text search there.',
    setupNudge(),
].filter(Boolean).join('\n\n');

process.stdout.write(
    JSON.stringify({
        hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: context,
        },
    }),
);
