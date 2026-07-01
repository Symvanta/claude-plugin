# Changelog

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
