# Changelog

All notable changes to the Symvanta Claude Code plugin are documented here.

## 1.0.0

Initial release.

- Registers the Symvanta code-graph MCP server
  (`https://mcp.symvanta.com/mcp`, OAuth on first connection).
- Injects standing context once at the start of every session
  (`session-start.js`) so the agent reaches for the Symvanta graph tools
  instead of shell search. No hook runs on a tool call.
- Bundles the `symvanta` skill with the full tool decision matrix and
  conventions.
- Adds slash commands: `/symvanta:ask`, `/symvanta:blast`, `/symvanta:trace`,
  `/symvanta:route`, `/symvanta:status`.
