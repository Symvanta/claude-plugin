---
description: "Trace how a function or symbol works: its full call chain, callers, and dependencies, using the Symvanta graph instead of reading files by hand."
argument-hint: [symbol]
allowed-tools: mcp__plugin_symvanta_symvanta__find_node, mcp__plugin_symvanta_symvanta__relate, Read
---

Trace the execution path of:

$ARGUMENTS

Steps:

1. Resolve the symbol with `find_node` if the name is ambiguous.
2. Call `relate` (kind:chain) to map the path through it. If you only need direct neighbors, use `relate` (kind:callers) (who calls it) and `relate` (kind:dependencies) (what it calls) instead.
3. Present the chain as an ordered list of `filePath:line` steps, each with a one-line note on its role. Do not open files one by one to reconstruct the chain: the graph already has it. Open a file with `Read` only to quote or edit a specific step.
