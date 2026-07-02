---
description: Pre-flight scope/impact estimate for a change before you size it. Grounds "how big / can we just / is this safe" in the graph instead of a guess.
argument-hint: [symbol or change description]
allowed-tools: mcp__plugin_symvanta_symvanta__estimate_scope, mcp__plugin_symvanta_symvanta__find_node
---

Estimate the scope of this change before sizing it:

$ARGUMENTS

Steps:

1. If a symbol is named and ambiguous, resolve it with `find_node` first.
2. Call `estimate_scope` for the change. This is the pre-flight for multi-file work: do not eyeball call sites and guess.
3. Report the estimated blast: how many files, which architectural layers, whether it crosses repositories, and a rough size (small / medium / large).
4. End with a one-line read: a contained edit, or one that needs a plan and scope sign-off with the user first. For a per-symbol "what breaks if I change X" view, use `/symvanta:blast`.
