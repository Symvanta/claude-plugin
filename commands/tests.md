---
description: Find the existing tests that cover a symbol, using the Symvanta graph instead of guessing at test file names.
argument-hint: [symbol]
allowed-tools: mcp__plugin_symvanta_symvanta__find_node, mcp__plugin_symvanta_symvanta__list_tests_for, Read
---

Find the tests that cover:

$ARGUMENTS

Steps:

1. If the symbol name is ambiguous, resolve it first with `find_node` and confirm `node.kind` matches what the user means.
2. Call `list_tests_for` on the resolved symbol.
3. Report each test as a clickable `filePath:line` reference with its test name. If none are found, say so plainly: the symbol may be untested, or its tests may live in a path that is not indexed.
4. Offer to open a test with `Read`, or to trace the symbol with `/symvanta:trace`.
