---
description: Ask a behavior question about the indexed codebase (how does X work, why does Y happen, what triggers Z). Routes to Symvanta ask_codebase and returns a synthesized answer with file citations.
argument-hint: [question]
allowed-tools: mcp__plugin_symvanta_symvanta__init, mcp__plugin_symvanta_symvanta__ask_codebase, mcp__plugin_symvanta_symvanta__find_node, mcp__plugin_symvanta_symvanta__relate, mcp__plugin_symvanta_symvanta__find_http_route, Read
---

Answer this behavior question using the Symvanta code graph. Do not grep or read files by hand to reconstruct the answer:

$ARGUMENTS

Steps:

1. If you have not called `init` yet this session, call it once to confirm the workspace is attached to a Symvanta project and see which repositories are indexed. If `repositoryCount` is 0, tell the user no repositories are attached to their active Symvanta project and stop.
2. Call `ask_codebase` with the question above. If the question clearly spans more than one repository (or `init` shows relevant linked repositories), call `ask_codebase` with `scope: "all"` instead.
3. Present the synthesized answer, then list the citations as clickable `filePath:startLine` references. Only open a cited file with `Read` when you need verbatim source to quote or act on.
4. If the response has `sufficient_to_answer: false`, follow `notice.gaps` to make ONE targeted follow-up (`find_node`, `relate` (kind:callers), or `find_http_route`) and then answer.
