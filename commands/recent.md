---
description: Show recently changed files (and recent commits) from Symvanta's indexed git history.
argument-hint: [path or count (optional)]
allowed-tools: mcp__plugin_symvanta_symvanta__history, Read
---

Show what changed recently in this repository:

$ARGUMENTS

Steps:

1. Call `history` with `op: "recently_changed"` to list files by how recently they were touched. Scope to the path if the argument names one.
2. If the user wants commit-level detail, also call `history` with `op: "commits"` and summarize the recent commits (sha, message, touched files).
3. Present a compact, most-recent-first list. Offer to open a file with `Read`, trace a symbol with `/symvanta:trace`, or check impact with `/symvanta:blast`.
