---
name: symvanta
description: How to navigate an indexed codebase with the Symvanta MCP tools. Load this when deciding which Symvanta tool to use, when a lookup returns empty, before editing a shared symbol, or when mapping a returned filePath to a local checkout. Covers the tool decision matrix, path conventions, behavior-question routing, and anti-patterns.
---

## Symvanta MCP

This project is indexed by Symvanta. To **find and navigate** code, use the
Symvanta MCP graph tools, not shell search: `find_node` / `locate` (mode:text) to
locate a symbol or string, `relate` (kind:callers) / `relate` (kind:dependencies) /
`relate` (kind:blast_radius) for relationships, `find_http_route` for endpoints,
`list_file_symbols` for what's in a file, `map` for a compact whole-repo / subtree skeleton, `ask_codebase` for a behavior
question (one call returns an answer plus citations). Do NOT `Grep` / `Glob` to find code in an indexed repo **even
when you have it checked out locally**: that is exactly what `locate` (mode:text) /
`find_node` replace. `locate` (mode:text) takes one term or several at once via
`queries: [...]` (up to 10, each tagged in the results): the in-graph
replacement for `grep -E 'a|b|c'`, so a multi-term hunt is one call, not a shell grep.

Local `Read` is only for **viewing** a file you have already located (with a
local checkout it is fine, and preferred over Symvanta's `source` tool). Reach
for Symvanta's `source` tool (op: read|grep) when you have no local checkout
(cloud agents, library-catalog dependencies) or need to pin to the indexed
commit SHA. Rule of thumb: locating or understanding code goes through
Symvanta; local `Read` only opens a file the graph already pointed you to.

A local checkout is for VIEWING a file the graph already located. It is NOT
license to answer who-calls / what-depends / what-breaks / how-big questions by
hand-tracing source: those stay graph queries (`relate` (kind:callers),
`relate` (kind:dependencies), `relate` (kind:blast_radius)) even with the repo checked out locally.
It is also NOT license to shell out (`git`, `ls`, `find`, `cat`) to discover or
explore the repo: locating code is `locate` (mode:text) / `find_node` / `locate` (mode:file),
never a shell. And a zip-uploaded repository has no clonable remote, so any local
checkout can be stale or absent and is never authoritative: rely on the graph and
search tools.

## Path convention

`filePath` shapes vary by tool and field. Normalize before passing between calls:

- `src/foo/bar.ts` (repo-relative, with `src/`): `locate` (mode:text), `find_node.selected.filePath`
- `foo/bar.ts` (repo-relative, no `src/`): `locate` (mode:symbol), `find_node.node.filePath`, `list_file_symbols`
- `Repo/src/foo/bar.ts` (repo-prefixed): `locate` (mode:config), `ask_codebase` citations

To map to your local checkout: strip any leading `<RepoName>/`, then prepend `src/` if missing. Inputs accept either form.

On a project with **multiple attached repositories**, a repo-prefixed path
also selects which repository the single-repo `source` tool
(op: read|list|grep|tree|stat|blame|diff) reads from: pass
`filePath: "<RepoName>/src/foo.ts"` and you can skip the explicit
`repository` argument. Omit both `repository` and a path prefix on a
multi-repo project and the tool returns an error listing the available
repositories to pick from.

## First call

- Call `init` at the start of the session. `repositoryCount > 0` means you're connected to a populated project; proceed.
- The `init` response carries a `usage` block in `structuredContent` (`principle`, `behavior_questions`, `behavior_question_triggers`, `decision_matrix`, `pre_edit_checklist`, `anti_patterns`). It is the authoritative in-session routing guide; introspect it instead of relying solely on this doc. The sections below are a cached copy for pre-init reference.
- If `repositoryCount === 0`, tell the user "no repositories are attached to your active Symvanta project" and ask them to attach one in the Symvanta dashboard. Do not silently fall back to grep over unrelated files.

## Response hints

Routing-critical tools (`locate`, `find_node`, `find_http_route`, `relate`, `ask_codebase`, `estimate_scope`) may attach a `next_steps: [{ tool, reason }]` array to `structuredContent` on empty results, partial answers, or unambiguous follow-ups. Follow these instead of guessing the next call: they enforce the graph -> text -> grep ordering (see "Behavior questions" below).

## Preferred workflow

1. `init` for project, repos, and index health
2. `find_node` / `locate` (mode:text) to LOCATE a symbol or string; `ask_codebase` for a behavior question (see "Behavior questions" below)
3. Local `Read` to view the returned filePath when you have the repo locally (otherwise the `source` tool, op:read). To find more code, go back to step 2 (`locate` (mode:text) / `find_node`), do not local-`Grep` the indexed repo.

## Behavior questions

For a genuine behavior question (the user's prompt contains "why", "how does", "how is", "what triggers", "what causes", "what makes", "walk me through", "explain", "trace"), call `ask_codebase` directly: one call returns a synthesized answer plus citations (filePath + line bounds). For questions that span repositories use `ask_codebase` with `scope: "all"`. If the ask is really a pinpoint lookup (a specific symbol, an HTTP route, who-calls-X), use the targeted tool instead (`find_node`, `find_http_route`, `relate` (kind:callers)): no need to pay for synthesis.

- Trust the answer and its citations as authoritative. Only `Read` a citation when you need verbatim source (you are about to quote or edit it).
- If `sufficient_to_answer: false`, follow `notice.gaps` to choose ONE targeted follow-up (`find_node`, `relate` (kind:callers), `find_http_route`, etc.) and stop.
- Fall back to `Grep`/`Read` only for files NOT in the citation list, and only when the question needs detail Symvanta did not surface.
- If you are about to open your 3rd file in a row to "trace" something by hand, stop and call `ask_codebase` with the question phrased as the user asked it.

## Delegating to subagents

A subagent you spawn does NOT inherit this priming: the SessionStart context
that steers the main session toward Symvanta never reaches a subagent, and the
Symvanta tools may arrive there as deferred tools. So a generic subagent will
default to `Grep`/`Glob`. When you delegate code search or understanding:

- Prefer the bundled `symvanta:symvanta-explorer` subagent (find / explain
  code) or `symvanta:symvanta-tracer` (pre-edit blast-radius / impact check):
  both are pre-primed and name the Symvanta tools in their own allowlist.
- If you spawn a generic subagent instead, put the routing in its prompt: tell
  it to load the Symvanta tools first (`ToolSearch` query "symvanta") and to use
  `find_node` / `locate` / `relate` / `ask_codebase`, NOT `Grep`/`Glob`, on this
  indexed repo.

## Decision matrix (intent -> tool)

A superset of `init.usage.decision_matrix` (the in-session value from `init` is authoritative).


| Intent                          | Tool                                                       |
|---------------------------------|------------------------------------------------------------|
| Behavior / "how does X work"    | `ask_codebase`                                            |
| Cross-repo behavior             | `ask_codebase` (scope:"all")                              |
| Look up a known symbol          | `find_node`                                               |
| Search symbols by name / pattern| `locate` (mode:symbol)                                    |
| Find a file by name fragment    | `locate` (mode:file)                                      |
| Literal identifier or string    | `locate` (mode:text)                                      |
| Several distinct terms at once  | `locate` (mode:text, queries:[...])                       |
| Fuzzy / pattern lookup          | `locate` (mode:semantic)                                  |
| Don't know which, just search   | `locate` (omit mode: text then semantic auto-route)       |
| HTTP route handler              | `find_http_route`                                         |
| Who calls X?                    | `relate` (kind:callers)                                   |
| What breaks if X changes?       | `relate` (kind:blast_radius)                              |
| What does X depend on?          | `relate` (kind:dependencies)                              |
| What implements interface I?    | `relate` (kind:implementers)                              |
| Full type hierarchy             | `relate` (kind:heritage)                                  |
| Full call chain                 | `relate` (kind:chain)                                     |
| Orient on a whole repo / subtree | `map`                                                    |
| Symbols in one file             | `list_file_symbols`                                       |
| Cross-repo candidate scan       | `locate` (mode:codebase)                                  |
| Config key / env var usage      | `locate` (mode:config)                                    |
| Existing tests for a symbol     | `list_tests_for`                                          |
| Pre-flight scope estimate       | `estimate_scope`                                          |
| Raw file/dir/grep/blame/diff    | `source` (op: read|list|grep|tree|stat|blame|diff)        |
| Commit history / recently changed | `history` (op: commits|commit|recently_changed)        |
| Library package list / version  | `library` (op: packages|version)                         |
| Read a feature / RFC branch     | `ref` (op:"use")  [revert with `ref` op:"clear"]        |
| Query uncommitted working-tree edits | `ref` (op:"index_working_tree")                      |

## Branch awareness

Symvanta indexes feature / RFC branches, not just the default branch. By
default every read resolves the default branch.

- **Read a branch:** `ref({ op: "use", repository, branch })` pins this session so
  later tool calls resolve that branch's latest indexed revision;
  `ref({ op: "clear", repository })` reverts. The pin is per (tenant, repository),
  holds the branch name (so it tracks new pushes without re-pinning), and an
  explicit `commitSha` on any call still overrides it. `freshness` echoes
  the active `pinnedBranch` / `pinnedSha`.
- **Track first.** A branch must be tracked before `ref` (op:"use") resolves it. It
  auto-tracks on an open same-repo GitHub PR (forks excluded); you can also add
  it from the dashboard Branches panel or the local Claude Code SessionStart
  hook. `ref` (op:"use") on an untracked / not-yet-indexed branch returns
  `indexing_in_progress`: wait and retry, do not read an empty graph. Quota:
  free 2, Pro 5 per seat, Enterprise unlimited.
- **Uncommitted edits:** `ref({ op: "index_working_tree", repository, changedFiles: [{ path, content }], baseSha?, deletedPaths? })`
  overlays your working-tree edits on `baseSha` (default: the tracked-branch /
  default tip), indexes a synthetic ephemeral revision, and auto-pins the
  session. Graph / text / symbol tools (`find_node`, `locate`,
  `list_file_symbols`, `relate`, `ask_codebase`)
  reflect the edits; the `source` tool and `locate` (mode:semantic) do NOT (the synthetic
  ref is not a real git commit). `ref` (op:"clear") unpins.

## Worked examples

```
// "Where does POST /api/users get handled?"
find_http_route({ method: "POST", path: "/api/users" })
  -> { filePath: "src/routes/users.ts", startLine: 42, endLine: 78 }
  -> then Read src/routes/users.ts lines 42-78

// "How does session refresh work?"
ask_codebase({ question: "How does session refresh work?" })
//   -> { answer: "...", citations: [{ filePath, startLine, endLine }, ...] }
//   -> one call returns the answer plus citations; Read a citation only to
//      see verbatim source.
```

## Before editing OR estimating scope

This fires the moment you *size* a change, not only when you edit it. Before you
call a change "easy", "a one-liner", "just wiring", or give any effort / risk
estimate: run `relate` (kind:blast_radius) on the symbol(s) you would touch and
`relate` (kind:callers) / `relate` (kind:dependencies) for the coupling. Comparing two
implementations (does B implement A's surface)? `list_file_symbols` both and
diff the method lists. Never extrapolate scope from one or two spot-checks;
`estimate_scope` is the pre-flight for multi-file work. Scope / impact triggers
in the prompt ("is this easy", "one-liner", "how big", "what would it take",
"what breaks", "can we just", "is it safe to change") route to `estimate_scope`
/ `relate` (kind:blast_radius) / `relate` (kind:callers) BEFORE you answer or plan.

Before changing any symbol, run `relate` (kind:blast_radius) on it. Stop and confirm
scope with the user if the result spans more than ~5 files, crosses
architectural layers, or includes cross-repo edges (`wide_blast_radius: true`
in the response). Skip only when the symbol was just created (no callers),
the task names every file to touch, or the change is ABI-compatible (new
param with a default value).

**Sequencing rule.** In any
session where you have used Symvanta, your first `Edit` / `MultiEdit` on an
existing symbol should be preceded by a `relate` (kind:blast_radius) (or
`estimate_scope`) call. If you reach for an edit without having run it, stop,
run the check, and only then edit. The `/symvanta:blast` command runs the check
on demand.

## Verify after editing

The decision matrix above is keyed by *intent*, not by *lifecycle*. After
you change a symbol, the graph tools become verification tools: they tell
you whether the change is actually isolated.

After editing a symbol:

1. `find_node({ selectors: [{ symbol, filePath }] })`: confirm the symbol
   still resolves at the expected location. Catches accidental renames or
   moves.
2. `relate` (kind:callers) on it: confirm no caller you didn't intend to touch.
   Pass `includeCrossRepo: true` if the symbol crosses repo boundaries.
3. For database writes, `locate` (mode:config, query: <table_name>) to
   catch other writers in raw SQL / ORM strings the graph doesn't link
   through method-call edges.

**Index lags your edits.** Verify these claims against the live file via
local `Read`, not the indexed revision. If
`freshness.lastIndexedSha != local HEAD`, every MCP result describes
pre-edit reality. Treat the index as stale until you see a `freshness`
that matches your post-push HEAD.

## Anti-patterns

Abridged. The full list lives in `init.usage.anti_patterns` and is enforced at the tool level via `next_steps` hints on empty / partial results.

- DON'T shell `grep` / `Glob` over an indexed repo. Use `locate` (mode:text) (or `locate` (mode:semantic) for fuzzy intent). For several terms at once pass `locate` (mode:text, queries:[...]) instead of `grep -E 'a|b|c'`.
- DON'T chain `find_node` -> `source` (op:read) -> manual grep for a behavior question. Call `ask_codebase`: one call returns the answer plus citations.
- DON'T fall back to local `Grep` when a graph tool (`relate` (kind:callers) / `relate` (kind:dependencies) / `relate` (kind:implementers)) returns empty. Empty graph results are NOT evidence of a stale index. Chain graph -> text -> grep: call `locate` (mode:text) on the symbol name first; only reach for `Grep` if that also returns empty.
- DON'T retry `locate` (mode:text) with synonyms when it returned empty. Call `locate` (mode:semantic) with the same query, or call `locate` with no mode to auto-route.
- DON'T use the `source` tool over MCP when a local clone exists. Local `Read` is faster.
- DON'T edit symbols returned by `relate` (kind:callers / dependencies / blast_radius / implementers) unless the task names them. That data is for comprehension.
- DON'T skip `relate` (kind:blast_radius) before editing a shared symbol. A one-line change that silently breaks 20 callers in a sibling repo is not an isolated fix.
- DON'T estimate a change's size / risk, or call it "easy" / "a wiring change", by reading the file and eyeballing call sites. That is a one-hop partial view that underestimates. Run `relate` (kind:blast_radius) + `relate` (kind:callers) (and a `list_file_symbols` diff when comparing implementations) FIRST, then estimate.

## Error envelopes (what to do when you see each code)

You cannot attach repos, reindex, or change scope yourself. Those are
dashboard actions the user does. Your job is to recognize the code,
take the right local action, and tell the user when something needs
their attention.

- `repository_not_indexed`: the repo isn't in the index yet. If you have a local clone, fall back to your own `Read` / `Grep` and proceed. Mention in your final answer that the repo isn't indexed in Symvanta so cross-repo signals (callers, library catalog) are missing.
- `stale_index`: the indexed SHA is behind live HEAD. Proceed against the latest indexed revision and note the staleness in your answer. If exact reproducibility matters (PR review, bug reproduction), pass the suggested `commitSha` to pin to the indexed revision instead.
- `file_not_found`: the file doesn't exist at the indexed SHA. Call `freshness` to check the index. If you have a local clone, re-check the path there (the file may have been added or renamed on a newer commit).
- `repository_not_attached`: the repo name you passed isn't in the user's active project scope. Re-check the spelling and try `list_repositories` (no args) to see what's available. If the user expected it to be there, tell them and ask them to attach it via the dashboard.
- `out_of_bounds`: your `startLine` / `endLine` exceed the file's `totalLines`. Drop the bounds or shrink them, then retry.
- `file_too_large`: the file exceeds the per-call byte cap. Retry with `startLine` + `endLine` to read a subset.

## SHA sync (run once per repo at session start)

Goal: decide whether to pass `commitSha` on Symvanta queries so your
results match the local files you'd `Read`.

Workspace shapes you'll see:

- **Single repo at workspace root** (`.git` directory at cwd).
- **Multi-repo workspace** where the root is NOT a git repo and each
  attached repository lives in a subdirectory (e.g.
  `workspace/Symvanta/`, `workspace/Parser/`). `git` from cwd will
  fail; resolve the per-repo path first.
- **Cloud agent / no local clone**: skip this whole section; you have
  nothing to sync against. Symvanta queries against latest indexed
  revision are your only option.

### Steps (per repository)

1. Resolve the local checkout directory for the repo. Try, in order:
   a. `<cwd>/<repo_name>` (matches `init`'s `repositories[i].name`).
   b. `<cwd>/<owner>/<repo_name>` (matches `fullName`).
   c. `<cwd>` itself if `<cwd>/.git` exists and only one repo is attached.
   d. If none of these resolve, treat this repo as no-local-clone for the session.
2. Get the local HEAD: `git -C <localPath> rev-parse HEAD`.
3. Get the indexed SHA: `freshness({ repository: <name> })` -> `lastIndexedSha`.
4. Compare and decide for the session:
   - **Match**: do not pass `commitSha`. Latest indexed = your HEAD; query results and local `Read` agree.
   - **Local AHEAD of indexed** (you have newer commits than the index): index is stale. For exact reproducibility (PR review, bug repro), pass `commitSha: <indexedSha>`. For general "what does this code do" work, proceed without `commitSha` and note the staleness in your final answer.
   - **Local BEHIND indexed** (rare: you deliberately checked out an older commit): pass `commitSha: <localHead>` on Symvanta queries so they match what you'd `Read`. Otherwise the index will reference symbols / files that don't exist at your local HEAD.

5. Check `edgeCount` from `list_repositories` (or `init`'s per-repo data). If `edgeCount === 0`, the repo has no graph edges indexed: `relate` (kind:callers / dependencies / blast_radius / implementers / chain) will silently return empty (no error, no warning). Fall back to `locate` (mode:text) or local `Grep` for caller-finding on that repo. Tell the user the repo needs a reindex if they're relying on graph traversal.

Cache the per-repo `{ localPath, localHead, indexedSha, edgeCount, decision }`
for the session. Don't re-check per query.

## Token and latency footprint

| Tool             | Tokens out  | Latency   | When to use                          |
|------------------|-------------|-----------|--------------------------------------|
| `init`          | ~1k         | ~300ms    | Once per session                     |
| `find_node`     | ~500/node   | ~200ms    | You have a symbol name               |
| `locate`        | ~1-3k       | ~400ms    | You have a literal string            |
| `ask_codebase`  | ~3-5k       | ~2-4s     | Behavior question                    |
| `source`        | size of file| ~200ms    | No local clone                       |

`ask_codebase` does find + read + synthesis in one call: reach for it on a behavior question. Chain `find_node` -> `Read` instead when you need a precise location plus full control over the source read.

## Source-access tools (fallback when you have no local clone)

The single `source` tool covers all file / directory / raw-source access, selected by `op`:

- `source({ op: "read", repository, filePath, startLine?, endLine? })`: read at the indexed commit.
- `source({ op: "list", repository, path })`: enumerate files / subdirs.
- `source({ op: "grep", repository, pattern, glob?, pathPrefix? })`: regex search across the indexed tree.
- `source` with `op: "tree" | "stat" | "blame" | "diff"`: same fallback intent.

**Known issue:** these ops can fail with "Repository ... has no indexed revision yet" even when `init` and `freshness` both confirm a `lastIndexedSha`. They read from an on-disk slot separate from the metadata store. If you hit this, fall back to local `Read` / `Grep`, and surface "the parser slot for this repo needs a redeploy" to the user. Metadata-only tools (`locate`, graph traversal, `ask_codebase`, `history`, `freshness`) are unaffected.

## Indexed-state views (use even with a local clone)

These reflect Symvanta's indexed state, not local HEAD, so they tell you something local git can't:

- `freshness({ repository })`: `{ lastIndexedSha, isStale }`.
- `history` (op: commits|commit|recently_changed).

## Rules

- All graph tools accept 1-10 selectors; pass multiple in one call instead of chaining.
- Pass `includeSource: true` to `find_node` only when source is needed (default false).
- When `find_node` returns `{ resolved: false, candidates }`, the index has no high-confidence match. Pick a candidate or narrow the selector; do not treat a low-confidence guess as the answer.
- `confidence: "high"` can still be the wrong symbol kind. `relate({ kind: "implementers", selector: "VectorRepository" })` may select a property named `vectorRepository` (lowercase) with high confidence. Verify `node.kind` matches what you asked for (interface vs property, class vs function) before acting.
- Repository IDs come in two shapes: base62 strings (`apcwr9`, `jmD7xn` from `init`, `find_node`, `freshness`) and numeric IDs (`564`, `684` from `estimate_scope`, `locate` (mode:codebase)). Both are opaque. Pass base62 IDs back when a tool asks for `repositoryId`; numeric IDs are internal.
- Test symbols are excluded from search by default. Mention test/spec/describe/it/should/expect/mock, or pass `kind: "test_case"`, to opt in.
- When `ask_codebase` returns `sufficient_to_answer: false`, the `notice` field lists specific gaps. Use it to choose follow-up queries instead of guessing.
- When index data contradicts a live file, trust the live file.
