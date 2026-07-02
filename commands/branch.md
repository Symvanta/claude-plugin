---
description: Pin this session's Symvanta reads to a tracked feature/RFC branch (or clear the pin) so graph queries resolve that branch instead of the default.
argument-hint: [branch-name | clear]
allowed-tools: mcp__plugin_symvanta_symvanta__ref, mcp__plugin_symvanta_symvanta__freshness
---

Point Symvanta at a specific branch for this session:

$ARGUMENTS

Steps:

1. If the argument is `clear` (or empty while a pin is active), call `ref` with `op: "clear"` to revert reads to the default branch, then confirm.
2. Otherwise call `ref` with `op: "use"` and `branch` set to the argument. The branch must already be tracked (an open same-repo GitHub PR, added from the dashboard Branches panel, or registered by the SessionStart hook).
3. If `ref` returns status `indexing_in_progress` or the branch is not yet indexed, tell the user it is still indexing and to retry shortly; do not read an empty graph.
4. On success, call `freshness` and report the active `pinnedBranch` / `pinnedSha` so it is clear which revision later tool calls will resolve.
5. Remind that the pin holds for the rest of this session until `/symvanta:branch clear`, and that an explicit `commitSha` on any tool call still overrides it.

For uncommitted edits that are not yet on a pushed branch, use `/symvanta:working-tree` to overlay them instead of pinning a branch.
