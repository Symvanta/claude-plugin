# Changelog

## 1.1.0

- MCP server URL is now configurable via the `mcpUrl` plugin option (defaults to
  `https://mcp.symvanta.com/mcp`). Override it to point at a self-hosted, on-prem,
  or staging Symvanta server; Symvanta Cloud users need no change.
- New slash commands: `/symvanta:architecture` (module-level architecture map:
  Louvain functional modules, PageRank hubs, cross-module coupling, and the
  repo-wide load-bearing functions via `map` view:"architecture"),
  `/symvanta:scope` (`estimate_scope`), `/symvanta:branch` (pin/clear a tracked
  branch via `ref`), `/symvanta:working-tree` (overlay uncommitted edits via
  `ref` op:index_working_tree), `/symvanta:tests` (`list_tests_for`), and
  `/symvanta:recent` (`history`).
- Added `scripts/check-tool-prefixes.mjs`: a CI guard that fails if any command
  or agent uses a wrong MCP tool prefix, preventing the `allowed-tools` no-op
  regression fixed below.
- Fixed: command `allowed-tools` now use the correct
  `mcp__plugin_symvanta_symvanta__*` tool-name prefix. The old `mcp__symvanta__*`
  form matched no real tool, so the intended per-command tool restriction
  silently no-op'd (commands still ran, but with unrestricted tool access).
- SessionStart primer refined: reads as conditional (stay normal when the
  workspace is not a Symvanta project), advertises the architecture view, and
  flags index-health gotchas (stale sha, edge_count 0) before graph traversal.

## 1.0.0

- Registers the Symvanta code-graph MCP server (`https://mcp.symvanta.com/mcp`,
  OAuth on first connection).
- SessionStart primer that points the agent at the Symvanta graph tools.
- `symvanta` skill with the tool decision matrix and conventions.
- Slash commands: `/symvanta:ask`, `/symvanta:blast`, `/symvanta:trace`,
  `/symvanta:route`, `/symvanta:status`.
- Read-only subagents: `symvanta-explorer`, `symvanta-tracer`.
- Non-blocking Grep/Glob augmenter (on by default): adds matching graph symbol
  definitions as context, repo-scoped, with a 60s cache and a local activity
  log surfaced by `/symvanta:status`. `SYMVANTA_GREP_AUGMENT=off` disables it.
