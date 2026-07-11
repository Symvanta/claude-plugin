#!/usr/bin/env node
// PreToolUse hook: on Grep/Glob, ask the Symvanta graph which indexed symbols
// match the search term and inject them as additionalContext, so the agent
// sees the structured answer alongside its raw search and learns to reach for
// the graph tools. Additive, never corrective.
//
// ON BY DEFAULT. Reuses the Symvanta MCP token Claude Code already stored (see
// hooks/lib.js: the read is narrow, only the Symvanta entry's access token,
// never your Anthropic token). Only the SEARCH TERM (not file contents) leaves
// the machine.
//
//   Query: quick_lookup returns the matching DEFINITIONS (name + path), scoped
//   to the repo you are searching (derived from the search path / cwd, memoized
//   on disk). A 60s local cache makes repeated searches instant. Up to two
//   distinct identifiers from the pattern are looked up in parallel.
//
// Controls:
//   SYMVANTA_AUGMENT=off        disable the whole augment hook family.
//   SYMVANTA_GREP_AUGMENT=off   legacy switch, still disables the whole family.
//   SYMVANTA_MCP_TOKEN=<token>  use your own token instead (creds file unread).
//   SYMVANTA_MCP_URL            override the endpoint.
//   SYMVANTA_HOOK_TIMEOUT_MS    lookup cap for every hook (this hook: 1500).
//   SYMVANTA_HOOK_DEBUG=1       log skips + timing to stderr.

const lib = require('./lib');

const HOOK = 'grep';
const BUDGET_MS = lib.budget(1500);

async function main() {
    // Disabled: no read, no network, no log.
    if (lib.isOff()) lib.done(HOOK, 'disabled', false);

    const payload = lib.readStdinJson();
    if (!payload) lib.done(HOOK, 'no-stdin');
    const tool = payload.tool_name;
    if (tool !== 'Grep' && tool !== 'Glob') lib.done(HOOK, `skip-tool:${tool}`, false);

    const ti = payload.tool_input || {};
    const terms = lib.extractTerms(ti.pattern || ti.query || ti.name);
    if (terms.length === 0) lib.done(HOOK, 'no-terms');

    const repo = lib.repoInfo(ti.path, payload.cwd).repo;

    const key = lib.cacheKey([HOOK, repo || '-', terms.join(',')]);
    const cached = lib.cacheGet(key);
    if (cached) {
        if (lib.DEBUG) process.stderr.write(`[symvanta-augment:grep] cache hit ${key} (${cached.length})\n`);
        if (cached.length === 0) lib.done(HOOK, 'no-matches', { repo, terms, cache: true });
        emit(terms, cached, { repo, terms, matches: cached.length, cache: true, ms: 0 });
    }

    const auth = lib.loadAuth();
    if (!auth.token) lib.done(HOOK, `no-token:${auth.error || 'unknown'}`, { repo, terms });

    const t0 = Date.now();
    const { matches, aborted } = await lib.runDefinitionLookups(auth, repo, terms, BUDGET_MS);
    const ms = Date.now() - t0;
    // Cache real answers (including a genuine zero), but never a timed-out empty.
    if (!aborted) lib.cacheSet(key, matches);
    if (lib.DEBUG) process.stderr.write(`[symvanta-augment:grep] ${terms.join(',')} repo=${repo || '-'} -> ${matches.length} in ${ms}ms${aborted ? ' (timed out, not cached)' : ''}\n`);
    if (matches.length === 0) lib.done(HOOK, aborted ? 'timeout' : 'no-matches', { repo, terms, cache: false, ms });

    emit(terms, matches, { repo, terms, matches: matches.length, cache: false, ms });
}

function emit(terms, matches, rec) {
    const rows = matches.slice(0, lib.MAX_ROWS);
    const lead = `[symvanta] ${rows.length} indexed definition(s) match ${terms.map((t) => `"${t}"`).join(' / ')} `
        + '(structured context; your search results below are unaffected). '
        + 'Prefer find_node / relate / ask_codebase to navigate these:';
    const text = [lead, ...lib.formatDefinitionRows(rows, lib.MAX_ROWS)].join('\n');
    lib.emitContext(HOOK, 'PreToolUse', text, rec);
}

main().catch((e) => lib.done(HOOK, `error:${(e && e.message) || e}`));
