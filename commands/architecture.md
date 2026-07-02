---
description: Show the codebase's high-level architecture: Louvain functional modules with their PageRank hubs, cross-module coupling, and the repo-wide load-bearing functions.
argument-hint: [repository (optional)]
allowed-tools: mcp__plugin_symvanta_symvanta__map, mcp__plugin_symvanta_symvanta__index_health, mcp__plugin_symvanta_symvanta__init, mcp__plugin_symvanta_symvanta__find_node
---

Show the module-level architecture of this codebase (not the file tree).

$ARGUMENTS

Steps:

1. Call `map` with `view: "architecture"`. Pass `repository` if the argument names one; otherwise omit it to use the default (or only) repo.
2. Report the modules Symvanta detected: for each, its name, size, and PageRank hub (the module's most depended-upon symbol). Call out the notable cross-module coupling ("calls into") so the reader sees how the modules depend on each other.
3. Surface the repo-wide **load-bearing functions** line from the top of the map: the functions the whole codebase leans on most, by PageRank. This is the "start here" list for onboarding.
4. Optionally call `index_health` to add the modularity Q (how cleanly separated the modules are; a low Q flags a tangled codebase).
5. Offer to drill into a module: `find_node` on one of its members, or `/symvanta:trace` to follow a hub's call chain.
