---
description: Blast-radius safety check before editing a symbol. Shows what would break across files, layers, and repositories so you know whether a change is isolated before you touch it.
argument-hint: [symbol or path:symbol]
allowed-tools: mcp__plugin_symvanta_symvanta__find_node, mcp__plugin_symvanta_symvanta__relate
---

Assess the blast radius of this symbol before any edit:

$ARGUMENTS

Steps:

1. If the name is ambiguous, resolve it first with `find_node` and confirm `node.kind` matches what the user means (a class vs a same-named property, an interface vs an implementation).
2. Call `relate` (kind:blast_radius) on the resolved symbol with `includeCrossRepo: true`.
3. Summarize: how many files are affected, whether it crosses architectural layers, and any cross-repo edges (each cross-repo node carries `repositoryName`).
4. End with a one-line verdict:
   - SAFE: isolated, few callers in one layer.
   - CAUTION: `wide_blast_radius` is true, more than ~5 files, or it crosses repos. Recommend confirming scope with the user and naming the risky callers before editing.
