#!/usr/bin/env node
// SessionStart hook: inject standing context so the agent reaches for the
// Symvanta code-graph MCP tools from the first turn, even without a CLAUDE.md.
// Plain Node so it runs identically on Windows, macOS, and Linux.

const context = [
    'A Symvanta code-graph MCP server may be connected. Call the Symvanta `init` tool once at the start to check. If init reports zero attached repositories, this workspace is not a Symvanta project: ignore this notice and work normally (Grep/Read as usual).',
    'If init reports one or more indexed repositories, prefer the Symvanta MCP tools (find_node, locate (mode:text), relate (kind:callers), relate (kind:dependencies), relate (kind:blast_radius), find_http_route, list_file_symbols, map (whole-repo / subtree skeleton, or view:"architecture" for the module map), ask_codebase for behavior questions) over Grep/Glob for locating and understanding code, and use local Read only to open a file the graph already located.',
    'Note index health before relying on graph traversal (from init.usage or freshness): a repo whose lastIndexedSha is behind your local HEAD is stale, so verify graph results against the live file; a repo with edge_count 0 has no traversable edges, so relate (callers/blast_radius) will be empty and you should fall back to text search there.',
].join(' ');

process.stdout.write(
    JSON.stringify({
        hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: context,
        },
    }),
);
