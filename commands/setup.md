---
description: "Install the Symvanta routing block into this project's CLAUDE.md (or CLAUDE.local.md) so every session, including subagents, routes code lookups through the graph tools."
argument-hint: [local]
allowed-tools: mcp__plugin_symvanta_symvanta__init, Read, Edit, Write, Glob
---

Install or update the Symvanta routing block in this project's Claude memory
file. Subagents load the project's CLAUDE.md on every session, and this block
is how the routing reaches them.

Arguments: $ARGUMENTS

Steps:

1. Call `init`. If it reports zero attached repositories, tell the user this
   workspace is not indexed by Symvanta (attach a repository on the dashboard
   first) and stop. Do not write anything.
2. Pick the target file in the project root:
   - If the user passed `local`, use `CLAUDE.local.md` (personal, usually
     gitignored).
   - If they passed nothing, ask once: `CLAUDE.md` is team-shared and lands in
     git for every collaborator and CI agent; `CLAUDE.local.md` keeps the block
     personal to this machine.
3. Read the target file (create it if missing). Then place this exact block,
   including the markers:

   ```
   <!-- symvanta:routing:begin v1 -->
   This repository is indexed by Symvanta. To find or understand code, use the
   Symvanta MCP tools before local search: `locate` (search by text, symbol,
   file, or meaning), `find_node` (known symbol), `relate` (callers, impact,
   dependencies), `ask_codebase` (how and why questions). Fall back to Grep or
   file reading only when a Symvanta tool returns empty. This applies to
   subagents too.
   <!-- symvanta:routing:end -->
   ```

   - If both markers already exist in the file, replace everything between
     them (inclusive) with the block above, so re-running updates in place and
     never stacks duplicates.
   - Otherwise append the block at the end of the file, separated by one blank
     line.
   - Change nothing else in the file.
4. Confirm in one or two lines: which file was written, whether the block was
   added or updated, and (for `CLAUDE.md`) that the change is visible in git
   for review.
