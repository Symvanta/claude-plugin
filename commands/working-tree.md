---
description: Make your uncommitted working-tree edits queryable by Symvanta by overlaying them on a synthetic revision, so graph/text/symbol tools reflect changes you have not pushed yet.
argument-hint: (no args; overlays the current uncommitted changes)
allowed-tools: mcp__plugin_symvanta_symvanta__ref, mcp__plugin_symvanta_symvanta__freshness, Bash, Read
---

Overlay your uncommitted edits so Symvanta's graph reflects them:

$ARGUMENTS

Steps:

1. List the uncommitted changes: run `git status --porcelain` (and `git diff --name-only`) to get modified/added paths plus any deletions. If nothing is changed, say so and stop.
2. `Read` each changed file's current content. Skip binaries and very large files, and keep the set reasonable so the payload stays small.
3. Call `ref` with `op: "index_working_tree"`, passing `changedFiles: [{ path, content }, ...]` for the edits and `deletedPaths: [...]` for removals. Symvanta seeds a checkout at the base revision, overlays these, indexes a synthetic ephemeral revision, and auto-pins this session to it.
4. Confirm with `freshness` (it echoes the pinned synthetic sha). Note the limits: the `source` tool and `locate` (mode:semantic) do NOT reflect the overlay (it is not a real git commit); graph / text / symbol tools do. Run `/symvanta:branch clear` to unpin.
