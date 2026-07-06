---
name: symvanta
description: How to navigate an indexed codebase with the Symvanta MCP tools. Load this when deciding which Symvanta tool to use, when a lookup returns empty, before editing a shared symbol, or when mapping a returned filePath to a local checkout. Covers the tool decision matrix, path conventions, behavior-question routing, and anti-patterns.
---

## Symvanta MCP
This project is indexed by Symvanta. To **find and navigate** code, use the
Symvanta graph tools, not shell search (see the decision matrix below). Do NOT
`Grep` / `Glob` an indexed repo **even with a local checkout**: that is what
`locate` (mode:text) / `find_node` replace. `locate` (mode:text) takes several
terms at once via `queries: [...]` (up to 10, tagged in results): the in-graph
replacement for `grep -E 'a|b|c'`, one call not a shell grep.

Local `Read` only VIEWS a file the graph already located (preferred over `source`
when you have a clone). A local checkout does NOT license hand-tracing
who-calls / what-depends / what-breaks / how-big (those stay `relate` queries), nor
shelling out (`git`, `ls`, `find`, `cat`) to discover code (that is `locate` /
`find_node`). A zip-uploaded repo has no clonable remote, so any local checkout can
be stale or absent and is never authoritative: rely on the graph.

This doc is the pre-init cached copy. Once you call `init`, its `usage` block
(`structuredContent.usage`) is the authoritative in-session routing guide;
introspect it rather than this. The full usage block returns on every `init`
call.

## Path convention

Every `filePath` in a response is repo-relative logical (e.g. `src/user/email.ts`),
NOT `<repo>/<path>`. Map it to your local layout before reading; pass the logical
form for `filePath` inputs too. On a **multi-repo** project, prefix a path with
`<RepoName>/` to also select which repository the single-repo `source` tool reads
from (skips the explicit `repository` arg); omit both prefix and `repository` and
`source` returns an error listing the repos to pick from.

## First call

- Call `init` at session start. `repositoryCount > 0` means you're connected to a
  populated project; proceed.
- A tenant may hold several indexed projects (`init`'s `otherProjects`). Without
  `projectId` / `repository`, tools fan out across ALL of them: the response has a
  top-level `matchedProject` when every result resolved in one project, per-row when
  they span projects, plus per-row `alsoInProjects` for a symbol in more than one.
  Pass `repository` or `projectId` to scope to one; a repo outside the active
  project is not unindexed.
- If `repositoryCount === 0`, tell the user "no repositories are attached to your
  active Symvanta project" and ask them to attach one in the dashboard. Do not
  silently fall back to grep over unrelated files.
- Routing-critical tools may attach `next_steps: [{ tool, reason }]` on empty /
  partial results: follow it instead of guessing. It enforces graph -> text -> grep,
  never graph -> grep.

## Behavior questions

For a genuine behavior question (prompt has "why", "how does", "what triggers",
"what causes", "walk me through", "explain", "trace"), call `ask_codebase`
directly: one call returns a synthesized answer plus citations (filePath + line
bounds). Cross-repo: `scope: "all"`. If the ask is really a pinpoint lookup (a
symbol, a route, who-calls-X), use the targeted tool and skip synthesis.

- Trust the answer and its citations as authoritative. Only `Read` a citation to
  quote or edit its verbatim source.
- If `sufficient_to_answer: false`, follow `notice.gaps` to ONE targeted follow-up
  and stop. `Grep` / `Read` only for uncited files.
- About to open your 3rd file to hand-trace something? Stop and call `ask_codebase`.

## Delegating to subagents

A subagent you spawn does NOT inherit this priming (the SessionStart context never
reaches it, and Symvanta tools may arrive deferred), so a generic subagent defaults
to `Grep` / `Glob`. When you delegate code search or understanding:

- Prefer the bundled `symvanta:symvanta-explorer` (find / explain) or
  `symvanta:symvanta-tracer` (pre-edit blast-radius): both are pre-primed.
- If you spawn a generic subagent, put the routing in its prompt: load the Symvanta
  tools first (`ToolSearch` query "symvanta"), use `find_node` / `locate` /
  `relate` / `ask_codebase`, NOT `Grep` / `Glob`, on this indexed repo.

## Decision matrix (intent -> tool)

Aligned with `init.usage.decision_matrix` (the in-session value is authoritative).

| Intent | Tool |
|---|---|
| Behavior / "how does X work" | `ask_codebase` |
| Cross-repo behavior | `ask_codebase` (scope:"all") |
| Look up a known symbol | `find_node` |
| Search symbols by name / pattern | `locate` (mode:symbol) |
| Find a file by name fragment | `locate` (mode:file) |
| Literal identifier or string | `locate` (mode:text; queries:[...] for several) |
| Fuzzy / pattern lookup | `locate` (mode:semantic) |
| Don't know which, just search | `locate` (omit mode: text then semantic auto-route) |
| HTTP route handler | `find_http_route` |
| Who calls X? | `relate` (kind:callers) |
| What breaks if X changes? | `relate` (kind:blast_radius) |
| What does X depend on? | `relate` (kind:dependencies) |
| What implements interface I? | `relate` (kind:implementers) |
| Full type hierarchy | `relate` (kind:heritage) |
| Full call chain | `relate` (kind:chain) |
| Orient on a repo / subtree | `map` (view:"architecture" for the module map) |
| Symbols in one file | `list_file_symbols` |
| Cross-repo candidate scan | `locate` (mode:codebase) |
| Config key / env var usage | `locate` (mode:config) |
| Existing tests for a symbol | `list_tests_for` |
| What a diff / branch breaks | `diff_impact` (composes with `ref` op:"index_working_tree") |
| Record / read a decision (WHY) | `adr` (op:"record"|"list"); `find_node` attaches them |
| Pre-flight scope estimate | `estimate_scope` |
| Raw file/dir/grep/blame/diff | `source` |
| Commit history / recently changed | `history` |
| Library packages / version | `library` |
| Read a feature / RFC branch | `ref` (op:"use"; "clear" reverts) |
| Query uncommitted edits | `ref` (op:"index_working_tree") |

## Branch awareness

Symvanta indexes feature / RFC branches; reads default to the default branch.

- **Read a branch:** `ref({ op: "use", repository, branch })` pins this session's
  reads to that branch's latest indexed revision; `ref({ op: "clear" })` reverts.
  The pin is per (tenant, repository), holds the branch name (tracks new pushes),
  and a `commitSha` on any call overrides it. `freshness` echoes the active pin.
- **Track first.** A branch must be tracked before `ref` (op:"use") resolves it:
  auto on an open same-repo GitHub PR (no forks), or via the dashboard / SessionStart
  hook. Untracked / not-yet-indexed returns `indexing_in_progress`: wait and retry.
  Quota: free 2, Pro 5/seat, Enterprise unlimited.
- **Uncommitted edits:** `ref({ op: "index_working_tree", repository, changedFiles: [{ path, content }] })`
  overlays them on a synthetic auto-pinned revision. Graph / text / symbol tools
  reflect the edits; `source` and `locate` (mode:semantic) do NOT (it is not a real
  git commit). `ref` (op:"clear") unpins.

## Before editing OR estimating scope

This fires the moment you *size* a change, not only when you edit. Before you call a
change "easy", "a one-liner", "just wiring", or give any effort / risk estimate: run
`relate` (kind:blast_radius) on the symbol(s) you'd touch, plus `relate`
(kind:callers|dependencies) for coupling. Comparing two implementations? `list_file_symbols`
both and diff the method lists. `estimate_scope` is the pre-flight for multi-file
work. Scope triggers in the prompt ("is this easy", "how big", "what breaks", "can
we just", "is it safe to change") route to `estimate_scope` / `relate` BEFORE you
answer or plan.

Stop and confirm scope with the user if blast_radius spans more than ~5 files,
crosses architectural layers, or has cross-repo edges (`wide_blast_radius: true`).
Skip only when the symbol was just created (no callers), the task names every file
to touch, or the change is ABI-compatible (new param with a default). Also read a
symbol's attached `decisions` (`find_node` returns them): a recorded ADR may
forbid the change; supersede it with `adr` (op:"update"), don't silently violate it.

**Sequencing rule.** In any session where you have used Symvanta, your first `Edit`
on an existing symbol must be preceded by a `relate` (kind:blast_radius) (or
`estimate_scope`) call. Reaching for an edit without it? Stop, run the check, then
edit. `/symvanta:blast` runs it on demand.

## Verify after editing

The index lags your edits, so after changing a symbol the graph tools become
verification tools. Verify claims against the live file via local `Read`, not the
indexed revision: until `freshness.lastIndexedSha` matches your post-push HEAD,
every MCP result describes pre-edit reality.

1. `find_node`: confirm the symbol still resolves at the expected location.
2. `relate` (kind:callers): confirm no unintended caller (`includeCrossRepo: true`
   across repo boundaries).
3. For DB writes, `locate` (mode:config, query: <table_name>) to catch raw-SQL / ORM
   writers the graph doesn't link through call edges.
4. After a MULTI-FILE change (or before merging), one `diff_impact` replaces
   per-symbol loops: it unions the blast radius and lists tests, affected endpoints,
   and co-change reminders. For uncommitted edits, run `ref`
   (op:"index_working_tree") first, then `diff_impact` with no shas.
5. If the change embodies a non-obvious decision, record it: `adr` (op:"record")
   with the symbolPath from `find_node`.

## Anti-patterns

Abridged; the full list lives in `init.usage.anti_patterns` and is enforced via
`next_steps` hints. (The graph-not-grep principle above covers shelling out.)

- DON'T chain `find_node` -> `source` -> manual grep for a behavior question. One
  `ask_codebase` call returns the answer plus citations.
- DON'T fall back to `Grep` when a graph tool (`relate`) returns empty. Empty is
  NOT evidence of a stale index. Chain graph -> text -> grep: `locate` (mode:text) on
  the name first; only then `Grep`.
- DON'T retry `locate` (mode:text) with synonyms when it returned empty. Call
  `locate` (mode:semantic) with the same query, or `locate` with no mode.
- DON'T use `source` over MCP when a local clone exists: local `Read` is faster.
- DON'T edit symbols `relate` returned unless the task names them: that data is for
  comprehension, not edit targets.
- DON'T call a change "easy" by eyeballing call sites: run `relate` (blast_radius +
  callers) FIRST. A one-line change that breaks 20 callers in a sibling repo is not
  an isolated fix.

## Error envelopes

You cannot attach repos, reindex, or change scope: those are dashboard actions the
user does. Recognize the code, take the right local action, tell the user when they
need to act.

- `repository_not_indexed`: not in the index yet. With a local clone, fall back to
  `Read` / `Grep`; note that cross-repo signals (callers, library catalog) are missing.
- `stale_index`: indexed SHA behind live HEAD. Proceed against latest indexed and
  note it; for exact reproducibility pass the suggested `commitSha`.
- `file_not_found`: file absent at the indexed SHA. `freshness` to check; re-check
  the path in a local clone (may be added / renamed on a newer commit).
- `repository_not_attached`: the repo name isn't in the active project scope. Check
  spelling, try `list_repositories`; else ask the user to attach it via dashboard.
- `out_of_bounds`: `startLine` / `endLine` exceed `totalLines`. Drop or shrink, retry.
- `file_too_large`: exceeds the per-call byte cap. Retry with `startLine` + `endLine`.

## SHA sync (once per repo, if you have a local clone)

To decide whether to pass `commitSha` so results match the files you'd `Read`:
resolve the repo's local checkout (try `<cwd>/<repo_name>`, then
`<cwd>/<owner>/<repo_name>`, then `<cwd>` if it's the only attached repo; else no
clone), compare `git rev-parse HEAD` against `freshness` -> `lastIndexedSha`.

- **Match:** don't pass `commitSha`; index and local agree.
- **Local AHEAD** (index stale): for exact reproducibility (PR review, repro) pass
  `commitSha: <indexedSha>`; else proceed and note the staleness.
- **Local BEHIND** (you checked out an older commit): pass `commitSha: <localHead>`
  so queries match what you'd `Read`.

If `edgeCount === 0` (from `list_repositories` / `init`), the repo has no graph
edges: `relate` silently returns empty (no error). Fall back to `locate` (mode:text)
or `Grep` for caller-finding and tell the user it needs a reindex. Cloud agent / no
clone: skip this section, query latest indexed.

## Source and footprint

`ask_codebase` is the heavy call (~2-4s, ~3-5k tokens); everything else is
sub-second. A single `source` tool covers raw access
(op: read|list|grep|tree|stat|blame|diff) as the fallback when you have no local
clone. Known issue: `source` ops can fail with "no indexed revision yet" even when
`freshness` confirms a `lastIndexedSha` (a separate on-disk slot); fall back to
local `Read` / `Grep` and tell the user the parser slot needs a redeploy.
`freshness` and `history` reflect indexed state, not local HEAD, so they tell you
what local git can't.

## Rules

- All graph tools accept 1-10 selectors; pass multiple in one call, don't chain.
- `find_node`: pass `includeSource: true` only when source is needed (default false).
  `{ resolved: false, candidates }` means no high-confidence match: pick a candidate
  or narrow, don't treat a low-confidence guess as the answer.
- `confidence: "high"` can still be the wrong kind: `relate` (kind:implementers) on
  `VectorRepository` may select a property `vectorRepository` with high confidence.
  Verify `node.kind` matches what you asked for before acting.
- Separately, each `relate` caller / dependency ROW may carry its own `confidence`
  tier for the edge: `high` = compiler-grade (SCIP), `medium` = framework /
  heuristic, `low` = string-heuristic, `correlational` = git co-change. Treat `low` /
  `correlational` as leads to verify; absent means the row predates tiering.
- Repository IDs come in two shapes, both opaque: base62 strings (`apcwr9` from
  `init`, `find_node`, `freshness`) and numeric IDs (`564` from `estimate_scope`,
  `locate` mode:codebase). Pass base62 back when a tool asks for `repositoryId`.
- Test symbols are excluded from search by default. Mention
  test/spec/describe/it/should/expect/mock, or pass `kind: "test_case"`, to opt in.
- `locate` text rows carry nearest-symbol context only on the first row per file per
  term, and omit `matchType` when it's a plain identifier match.
- When index data contradicts a live file, trust the live file.
