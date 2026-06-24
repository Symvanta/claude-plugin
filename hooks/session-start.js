#!/usr/bin/env node
// SessionStart hook: inject standing context so the agent reaches for the
// Symvanta code-graph MCP tools from the first turn, even without a CLAUDE.md.
// Plain Node so it runs identically on Windows, macOS, and Linux.

const context = [
    'The Symvanta MCP server is connected. Call the Symvanta `init` tool first to confirm whether this workspace is attached to a Symvanta project and which repositories are indexed.',
    'If it is indexed, prefer the Symvanta MCP tools (find_node, locate (mode:text), relate (kind:callers), relate (kind:dependencies), relate (kind:blast_radius), find_http_route, list_file_symbols, map (whole-repo / subtree skeleton), ask_codebase for behavior questions) over Grep/Glob for locating and understanding code, and use local Read only to open a file the graph already located.',
    'If init reports no attached repositories, ignore this and work normally.',
].join(' ');

process.stdout.write(
    JSON.stringify({
        hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: context,
        },
    }),
);
