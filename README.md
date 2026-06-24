# Symvanta plugin for Claude Code

One-step setup for working in a [Symvanta](https://symvanta.com)-indexed
codebase. Installing this plugin:

- registers the Symvanta MCP server (`https://mcp.symvanta.com/mcp`, OAuth on
  first connection), so you do not edit `.mcp.json` by hand;
- injects standing context once at the start of every session so the agent
  reaches for the Symvanta code-graph tools instead of shell search;
- ships a `symvanta` skill with the full tool decision matrix and conventions;
- adds slash commands that wrap the common graph workflows.

## Commands

Each command routes to the right Symvanta MCP tool so you do not have to
remember tool names:

- `/symvanta:ask [question]`: answer a behavior question (how does X work, why
  does Y happen) via `ask_codebase`, with file citations.
- `/symvanta:blast [symbol]`: blast-radius safety check before editing a symbol.
- `/symvanta:trace [symbol]`: map a function's call chain, callers, and
  dependencies.
- `/symvanta:route [METHOD /path]`: find the handler for an HTTP route.
- `/symvanta:status`: connection and index health snapshot (project,
  repositories, freshness, edge counts).

## Install

In Claude Code:

```
/plugin marketplace add https://symvanta.com/plugin/marketplace.json
/plugin install symvanta@symvanta
```

Sign in with OAuth when prompted on first connection. Your workspace's
Getting Started page in the Symvanta dashboard shows the exact marketplace URL
for your account.

## Updating

```
/plugin update symvanta@symvanta
```

Then **restart Claude Code**. Claude Code reads the plugin (including
`hooks/hooks.json`) when it loads, not continuously, so a running session keeps
the previously loaded version until you restart. Until then a `/plugin update` is
downloaded but not active.

## What runs on your machine

The only code this plugin executes locally is one small, readable Node hook
script:

- [`session-start.js`](hooks/session-start.js): prints standing context once at
  the start of a session. Sends nothing anywhere.

No hook runs on a tool call. Bash, Grep, Glob, Edit, and every other tool run
untouched, so the plugin can never intercept, delay, or interrupt a command. All
code navigation happens through the Symvanta MCP server over HTTPS, gated by
OAuth. No telemetry, no background processes, nothing leaves the machine.

## Uninstall

```
/plugin uninstall symvanta@symvanta
/plugin marketplace remove symvanta
```

## Layout

```
.claude-plugin/plugin.json   manifest + MCP server registration
hooks/hooks.json             SessionStart wiring (no tool-call hooks)
hooks/session-start.js       standing-context injector
commands/                    slash commands (ask, blast, trace, route, status)
skills/symvanta/SKILL.md     tool decision matrix and conventions
```

## License

MIT
