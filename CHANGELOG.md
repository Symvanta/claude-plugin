# Changelog

## 1.2.0

- The Grep/Glob augmenter grows into a family of non-blocking augment hooks,
  all on by default with the same additive contract: they can only ADD
  context, never block a tool, and every error or timeout is a clean
  pass-through.
  - **Edit/Write** (PreToolUse): before an edit lands, injects the edited
    symbol's blast radius (upstream symbol count, files, layers, cross-repo
    edges, risk tier) via `list_file_symbols` + `relate` kind:blast_radius.
    A Write over an existing file lists the definitions the overwrite
    replaces. New files and non-code files stay silent.
  - **Read** (PreToolUse): the first Read of a code file per session injects
    the file's symbol skeleton (names, kinds, line bounds) plus any
    architecture decision records anchored to it. Repeat reads exit
    instantly via a local seen-marker.
  - **Grep rescue** (PostToolUse): only when a grep comes back EMPTY,
    suggests graph candidates via `locate` (auto text/semantic), turning a
    dead-end search into leads instead of a synonym-retry loop. A grep with
    results exits after the stdin parse.
  - **Prompt terms** (UserPromptSubmit): identifier-shaped tokens in the
    user's message (backticked spans, snake_case, camelCase) resolve to
    indexed definitions injected at turn start. Plain prose never qualifies,
    so conversational prompts stay silent, and only the extracted tokens are
    sent, never the message text.
- Shared hook core (`hooks/lib.js`): one implementation of the narrow token
  read, MCP transport, per-key atomic cache, and local JSONL log for the whole
  family. Repo derivation is now memoized on disk, saving one or two git
  subprocess spawns per intercepted tool call.
- Controls: `SYMVANTA_AUGMENT=off` disables the whole family (the legacy
  `SYMVANTA_GREP_AUGMENT=off` still does too); per-hook switches
  `SYMVANTA_EDIT_AUGMENT` / `SYMVANTA_READ_AUGMENT` / `SYMVANTA_GREP_RESCUE` /
  `SYMVANTA_PROMPT_AUGMENT` = `off`. `SYMVANTA_HOOK_TIMEOUT_MS` caps every
  hook's lookup budget.
- `augment-stats.js` (surfaced by `/symvanta:status`) now reports per-hook
  runs, match rate, cache rate, and latency percentiles from the same local
  log; pre-family log lines count under grep.

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
