#!/usr/bin/env node
// SessionStart hook: inject standing context so the agent reaches for the
// Symvanta code-graph MCP tools from the first turn, even without a CLAUDE.md.
// The tool enumeration below is deliberately inlined (not just pointed at via
// the `symvanta` skill): additionalContext is guaranteed to land in every
// session, while loading a skill is conditional on the model choosing to.
// Keep this list to names + one-line purpose only; routing rules, anti-
// patterns, and edge cases stay in the skill so this stays bounded.
// Plain Node so it runs identically on Windows, macOS, and Linux.

const TOOLS = [
    'find_node - known symbol by name or path',
    'locate - search by literal text, symbol name/pattern, file name, config key/env var, or semantic meaning when the name is unknown (mode: text|symbol|file|config|semantic|codebase; omit mode to just search)',
    'relate - who calls X (kind:callers), what X depends on (dependencies), blast radius of changing X (blast_radius), type hierarchy (heritage), call chain (chain), what implements an interface (implementers), or the path between two symbols (path)',
    'find_http_route - HTTP route handler by method + path',
    'list_file_symbols - symbols defined in one file',
    'map - repo/subtree orientation, or view:"architecture" for the module map',
    'ask_codebase - "how does X work" / why / behavior questions, scope:"all" for cross-repo',
    'context - first-touch task orientation: top 5 relevant files for a natural-language task in one call',
    'list_tests_for - existing tests that cover a symbol',
    'diff_impact - what a diff or branch breaks (symbols, tests, routes, co-changes)',
    'estimate_scope - scope estimate before a big traversal',
    'adr - record or read past architecture decisions',
    'source - raw file/dir/grep/blame/diff, no local clone needed',
    'history - commit history / recently-changed files',
    'library - library package and version info',
    'freshness - index drift vs the remote HEAD for one repository',
    'index_health - per-project index health (edge counts, unindexable repos, architecture stats)',
    'ref - pin a feature branch for reads, or make uncommitted edits queryable',
    'bundle - up to 10 independent lookups in one parallel round-trip',
]
    .map((line) => `- ${line}`)
    .join('\n');

const context = [
    'A Symvanta code-graph MCP server may be connected. Before your first code lookup, load the `symvanta` skill for the full routing rules and anti-patterns (it goes deeper than the list below), then call the Symvanta `init` tool once to check attached repositories. If init reports zero attached repositories, this workspace is not a Symvanta project: ignore this notice and work normally (Grep/Read as usual).',
    `If init reports one or more indexed repositories, prefer these Symvanta MCP tools over Grep/Glob for locating and understanding code, and use local Read only to open a file the graph already located:\n${TOOLS}`,
    'Note index health before relying on graph traversal (from init.usage or freshness): a repo whose lastIndexedSha is behind your local HEAD is stale, so verify graph results against the live file; a repo with edge_count 0 has no traversable edges, so relate (callers/blast_radius) will be empty and you should fall back to text search there.',
].join('\n\n');

process.stdout.write(
    JSON.stringify({
        hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: context,
        },
    }),
);
