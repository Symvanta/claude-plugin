---
description: "Symvanta connection and index health snapshot: attached project, indexed repositories, freshness, and graph edge counts."
allowed-tools: mcp__plugin_symvanta_symvanta__init, mcp__plugin_symvanta_symvanta__freshness, mcp__plugin_symvanta_symvanta__list_repositories, Bash, Read
---

Report the Symvanta connection and index health for this workspace.

Steps:

1. Call `init` with `repository` set to this checkout's GitHub remote as `owner/name` (from `git config --get remote.origin.url`; omit it when the directory has no remote). If `workspace.attached` is false, tell the user this checkout is not attached to any Symvanta project, that the projects `init` lists are other codebases, and that it can be attached with `add_repository` (private repositories: `installation_id` from `list_installations`) or `create_project` first, both needing an mcp:admin token or the dashboard; then stop. If `repositoryCount` is 0, tell the user no repositories are attached to their active Symvanta project and that they should attach one, then stop.
2. For each indexed repository, report its name, last indexed time, and indexed commit SHA. Call `freshness` per repository to flag any that are stale relative to their default branch.
3. Flag any repository whose `edgeCount` is 0: graph traversal via `relate` (kind:callers / dependencies / blast_radius / implementers) will silently return empty for it, so recommend a reindex.
4. Report local augment hook activity under an "Augmenters (local)" heading: run `node "${CLAUDE_PLUGIN_ROOT}/hooks/augment-stats.js"` and include its output verbatim. It summarizes each hook (grep, edit, rescue, prompt, read): runs, match rate, cache-hit rate, cold-lookup latency, plus any degraded outcomes (an expired token silently degrades every hook to pass-through). If that command cannot run, read the last lines of `~/.symvanta/grep-augment.log` and summarize instead; if there is no log, omit this section.
5. Keep the output to a compact summary the user can scan at a glance.
