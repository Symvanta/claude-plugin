---
description: Find the handler for an HTTP route by method and path, then offer to open or trace it.
argument-hint: [METHOD /path]
allowed-tools: mcp__plugin_symvanta_symvanta__find_http_route, mcp__plugin_symvanta_symvanta__find_node, Read
---

Find the handler for this HTTP route:

$ARGUMENTS

Steps:

1. Parse the method and path from the argument. If only a path is given, default the method to GET.
2. Call `find_http_route` with that method and path.
3. Report the handler symbol and its `filePath:startLine-endLine`. If there are several matches, list them and ask which one.
4. Offer to open the handler with `Read`, or to map its call chain with `/symvanta:trace`.
