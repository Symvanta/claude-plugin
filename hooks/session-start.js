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
//
// This hook sends nothing anywhere. Its one local read beyond the tool list
// is the checkout's git remote (via lib.repoInfo, memoized), so the agent's
// first init call can bind the session to the project that holds THIS tree.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const lib = require('./lib');

const TOOLS = require('./tool-list.json')
    .map((line) => `- ${line}`)
    .join('\n');

// The working directory Claude Code reports for this session, else the
// process cwd. Read once; stdin can only be consumed once.
function payloadCwd() {
    try {
        const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
        if (typeof payload.cwd === 'string' && payload.cwd.length > 0) return payload.cwd;
    } catch {
        // No or malformed stdin: fall back to process.cwd().
    }
    return process.cwd();
}

// The binding line comes first: which project init should bind this session
// to depends on the checkout, and "zero repositories means not a Symvanta
// project" was wrong whenever the workspace had a default project full of
// some other codebase. Three shapes:
//   - a checkout with a GitHub remote: bind through init({ repository });
//   - a checkout with no remote: Symvanta cannot index it, say so;
//   - not a checkout (a workspace root holding several checkouts, a scratch
//     dir): plain init, the default or pinned project is the active one.
function checkoutLine(cwd) {
    let info;
    try {
        info = lib.repoInfo(null, cwd);
    } catch {
        return '';
    }
    if (info.slug) {
        return `This checkout's GitHub remote is ${info.slug}. Call init with repository: "${info.slug}" first: it binds the session to the project that holds this checkout and reports it as the active project, so later calls without projectId resolve there. If init answers workspace.attached=false, this checkout is not indexed: nothing init reports describes it, so work normally with Grep/Read here, do not route through the other projects it lists, and offer to attach it (add_repository; a private repository needs installation_id from list_installations; create_project first when it needs its own project; all three need an mcp:admin token, otherwise the dashboard).`;
    }
    if (info.root) {
        return 'This directory is a git checkout with no GitHub remote, so Symvanta cannot index it. Whatever init reports describes other repositories, not this tree: work normally with Grep/Read here.';
    }
    return 'This directory is not a git checkout (a workspace root holding several checkouts, or a scratch directory). Call init without repository; the active project is the workspace default or the session\'s pinned project (project_source says which). To bind to one checkout under it, pass that checkout\'s remote as repository.';
}

// /symvanta:setup nudge, shown ONCE per project per machine and only while
// the routing block is absent. The marker in CLAUDE.md / CLAUDE.local.md is
// the ground truth (covers a hand-pasted block and a later deletion); the
// flag file only remembers that the nudge was shown, so it never repeats.
// Every branch fails open to "no nudge": an unreadable file or a read-only
// home dir must never break session start.
function setupNudge(cwd) {
    try {
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

const cwd = payloadCwd();

const context = [
    'A Symvanta code-graph MCP server may be connected. Before your first code lookup, load the `symvanta` skill for the full routing rules and anti-patterns (it goes deeper than the list below), then call the Symvanta `init` tool once, as described next. Treat this checkout as unindexed only when init answers workspace.attached=false for it, or reports zero repositories with no other project: then work normally (Grep/Read as usual). A workspace default project full of some other codebase is not this checkout.',
    checkoutLine(cwd),
    `If init reports one or more indexed repositories for this checkout, prefer these Symvanta MCP tools over Grep/Glob or shell grep/rg for locating and understanding code, and use local Read only to open a file the graph already located:\n${TOOLS}`,
    'Note index health before relying on graph traversal (from init.usage or freshness): a repo whose lastIndexedSha is behind your local HEAD is stale, so verify graph results against the live file; a repo with edge_count 0 has no traversable edges, so relate (callers/blast_radius) will be empty and you should fall back to text search there.',
    setupNudge(cwd),
].filter(Boolean).join('\n\n');

process.stdout.write(
    JSON.stringify({
        hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: context,
        },
    }),
);
