# Changelog

## 1.3.1

- The SessionStart primer now points at `/symvanta:setup` once per project per
  machine, and only while the routing block is absent. Presence is checked
  against the `symvanta:routing:begin` marker in the project's `CLAUDE.md` and
  `CLAUDE.local.md` (so a hand-pasted block also counts); a shown nudge is
  remembered in `~/.symvanta/setup-nudge/`. Once the block exists, or after the
  one nudge, sessions say nothing. All failure paths (no stdin, unreadable
  files, read-only home dir) fall back to the normal primer.

## 1.3.0

- New `/symvanta:setup [local]` command. Writes the Symvanta routing block
  into the project's `CLAUDE.md`, or `CLAUDE.local.md` when called with
  `local`. The block points sessions at `locate` / `find_node` / `relate` /
  `ask_codebase` first, with Grep as the fallback on empty results. Subagents
  read CLAUDE.md but skip the SessionStart primer and the skill, so this is
  the only plugin surface that reaches them. The block sits between
  `symvanta:routing` markers; re-running the command replaces the marked
  section and leaves the rest of the file alone.

## 1.2.8

- Every hook call now sends the installed plugin version as
  `X-Symvanta-Plugin-Version`. When the MCP server sees an install older than
  the latest release, it echoes an `X-Symvanta-Plugin-Notice` response header;
  the next hook that emits context appends it (`/plugin update
  symvanta@symvanta` then restart), at most once a day per machine.
- The SessionStart primer (`hooks/session-start.js`) previously named only 7
  of the ~30 available tools inline, and relied on the agent separately
  calling `init` (whose response happens to carry the full decision matrix)
  or loading the `symvanta` skill to learn the rest exist. Neither is
  guaranteed, so a session could run entirely on the 7 named tools. The
  primer now inlines a one-line-each enumeration of all 19 agent-facing
  tools (everything except `quick_lookup`, which is hook-internal) directly
  into `additionalContext`, since that field is guaranteed to land in every
  session's context, unlike a skill load or an `init` call. Deeper routing
  rules, anti-patterns, and edge cases stay in the `symvanta` skill, which
  the primer still points the agent to first (a local, no-network operation,
  so it works even when `init`/the MCP connection is degraded). Adds
  ~630 tokens to every session's context.
- Fix: `commands/architecture.md`'s frontmatter `description` had an
  unquoted mid-sentence colon, which is invalid YAML for a plain scalar.
  The command silently loaded with empty frontmatter at runtime (no
  description, no argument hint, and no `allowed-tools` restriction).
  Quoted the description; `claude plugin validate` now passes clean.

## 1.2.7

- Fix: on macOS, Claude Code stores its OAuth credentials in the login
  Keychain (service `Claude Code-credentials`), not in
  `~/.claude/.credentials.json`. `loadAuth()` in `hooks/lib.js` only read the
  JSON file, so every augment hook (grep, edit, read, rescue, prompt) silently
  degraded to pass-through (`no-creds-file`) on every macOS install, even with
  a live, working MCP connection. Added a Keychain fallback read via the
  `security` CLI when the JSON file is absent, used only on `darwin`, memoized
  to disk for 5 minutes (`~/.symvanta/keychain-cache.json`) so a busy session
  does not shell out on every hook call.
- The Keychain fallback's failure modes are now distinguishable in the log
  and in `/symvanta:status` / `augment-stats.js`: `no-creds-file:keychain-empty`
  (nothing in the Keychain yet, reconnect the MCP server) versus
  `no-creds-file:keychain-unreadable` (an entry exists but did not parse),
  instead of both collapsing into the same generic `no-creds-file`.

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
