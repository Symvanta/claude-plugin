#!/usr/bin/env node
// PostToolUse hook: when a local Grep comes back EMPTY inside an indexed repo,
// ask the graph what the pattern might have meant (locate with no mode, which
// auto-routes text -> semantic) and inject the candidates, so a dead-end
// search becomes a lead instead of a synonym-retry loop. Fires only on empty
// results; a Grep WITH results exits right after the stdin parse, no reads,
// no network. Additive, never corrective.
//
// Only the extracted identifier terms leave the machine, never file contents.
//
// Controls: SYMVANTA_GREP_RESCUE=off disables this hook; SYMVANTA_AUGMENT=off
// (or legacy SYMVANTA_GREP_AUGMENT=off) disables the whole family.

const lib = require('./lib');

const HOOK = 'rescue';
const EVENT = 'PostToolUse';
// Wider budget than the definition hooks: the no-mode locate may route to
// semantic search (embedding round trip), and it only ever runs on a grep
// that already came back empty.
const BUDGET_MS = lib.budget(3500);

// The Grep tool_response shape is not pinned by the hooks docs; recognize the
// known empty forms and default to "has results" (stay silent) on anything
// unrecognized, which fails toward doing nothing.
function grepIsEmpty(resp) {
    if (resp === null || resp === undefined) return false;
    if (typeof resp === 'string') return /^\s*$/.test(resp) || /no (files|matches|lines|content) found/i.test(resp);
    if (typeof resp !== 'object') return false;
    if (typeof resp.numFiles === 'number') return resp.numFiles === 0;
    if (typeof resp.numMatches === 'number') return resp.numMatches === 0;
    if (typeof resp.numLines === 'number') return resp.numLines === 0;
    if (Array.isArray(resp.filenames)) return resp.filenames.length === 0;
    if (typeof resp.content === 'string') return grepIsEmpty(resp.content);
    if (typeof resp.stdout === 'string') return grepIsEmpty(resp.stdout);
    return false;
}

async function main() {
    if (lib.isOff('SYMVANTA_GREP_RESCUE')) lib.done(HOOK, 'disabled', false);

    const payload = lib.readStdinJson();
    if (!payload) lib.done(HOOK, 'no-stdin', false);
    if (payload.tool_name !== 'Grep') lib.done(HOOK, `skip-tool:${payload.tool_name}`, false);
    if (payload.success === false) lib.done(HOOK, 'tool-error', false);

    const resp = payload.tool_response !== undefined ? payload.tool_response : payload.tool_output;
    if (lib.DEBUG) process.stderr.write(`[symvanta-augment:rescue] tool_response=${JSON.stringify(resp).slice(0, 200)}\n`);
    if (!grepIsEmpty(resp)) lib.done(HOOK, 'has-results', false);

    const ti = payload.tool_input || {};
    const pattern = ti.pattern || '';
    const terms = lib.extractTerms(pattern);
    if (terms.length === 0) lib.done(HOOK, 'no-terms');

    const repo = lib.repoInfo(ti.path, payload.cwd).repo;

    const key = lib.cacheKey([HOOK, repo || '-', terms.join(',')]);
    const cached = lib.cacheGet(key);
    if (cached) {
        if (cached.length === 0) lib.done(HOOK, 'no-matches', { repo, terms, cache: true });
        emit(pattern, cached, { repo, terms, matches: cached.length, cache: true, ms: 0 });
    }

    const auth = lib.loadAuth();
    if (!auth.token) lib.done(HOOK, `no-token:${auth.error || 'unknown'}`, { repo, terms });

    const t0 = Date.now();
    const query = terms.join(' ');
    const { value, aborted } = await lib.withBudget(BUDGET_MS, (signal) =>
        lib.callTool(auth, 'locate', repo ? { query, repository: repo, limit: lib.MAX_ROWS } : { query, limit: lib.MAX_ROWS }, signal));
    const matches = value && Array.isArray(value.matches) ? value.matches : [];
    const ms = Date.now() - t0;
    if (!aborted && value) lib.cacheSet(key, matches);
    if (matches.length === 0) lib.done(HOOK, aborted ? 'timeout' : 'no-matches', { repo, terms, cache: false, ms });

    emit(pattern, matches, { repo, terms, matches: matches.length, cache: false, ms });
}

function emit(pattern, matches, rec) {
    const shown = String(pattern).slice(0, 60);
    const rows = matches.slice(0, lib.MAX_ROWS).map((m) => {
        if (m.name || m.displayName) return lib.formatDefinitionRows([m], 1)[0];
        const where = `${m.filePath || ''}${m.lineNumber ? ':' + m.lineNumber : ''}`;
        const snippet = m.snippet ? `  ${String(m.snippet).trim().slice(0, 70)}` : '';
        return `- ${where}${snippet}`;
    });
    const text = [
        `[symvanta] Local grep for "${shown}" found no matches, but the indexed graph suggests:`,
        ...rows,
        'From locate (auto text/semantic). For meaning-level search use locate (mode:semantic) or ask_codebase. The empty grep result above stands.',
    ].join('\n');
    lib.emitContext(HOOK, EVENT, text, rec);
}

main().catch((e) => lib.done(HOOK, `error:${(e && e.message) || e}`));
