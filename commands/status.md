---
description: "Symvanta connection and index health snapshot: attached project, indexed repositories, freshness, and graph edge counts."
allowed-tools: mcp__symvanta__init, mcp__symvanta__freshness, mcp__symvanta__list_repositories
---

Report the Symvanta connection and index health for this workspace.

Steps:

1. Call `init`. If `repositoryCount` is 0, tell the user no repositories are attached to their active Symvanta project and that they should attach one in the Symvanta dashboard, then stop.
2. For each indexed repository, report its name, last indexed time, and indexed commit SHA. Call `freshness` per repository to flag any that are stale relative to their default branch.
3. Flag any repository whose `edgeCount` is 0: graph traversal via `relate` (kind:callers / dependencies / blast_radius / implementers) will silently return empty for it, so recommend a reindex.
4. Keep the output to a compact summary the user can scan at a glance.
