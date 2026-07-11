#!/usr/bin/env node
// UserPromptSubmit hook: extract code-identifier-looking terms from the user's
// message (backticked spans, snake_case, camelCase; plain prose never
// qualifies) and inject the matching indexed definitions, so the turn starts
// with graph anchors instead of a shell search. Conversational prompts with no
// identifier-shaped tokens stay completely silent. Additive, never corrective.
//
// PRIVACY: only the extracted identifier tokens (at most two) are sent to the
// Symvanta MCP server, NEVER the message text itself.
//
// Controls: SYMVANTA_PROMPT_AUGMENT=off disables this hook;
// SYMVANTA_AUGMENT=off (or legacy SYMVANTA_GREP_AUGMENT=off) disables the
// whole family.

const lib = require('./lib');

const HOOK = 'prompt';
const EVENT = 'UserPromptSubmit';
const BUDGET_MS = lib.budget(1200);

async function main() {
    if (lib.isOff('SYMVANTA_PROMPT_AUGMENT')) lib.done(HOOK, 'disabled', false);

    const payload = lib.readStdinJson();
    if (!payload) lib.done(HOOK, 'no-stdin', false);
    const prompt = typeof payload.prompt === 'string' ? payload.prompt
        : (typeof payload.user_input === 'string' ? payload.user_input : '');
    // Slash commands route through their own skill machinery; stay out of the way.
    if (payload.slash_command || prompt.trimStart().startsWith('/')) lib.done(HOOK, 'slash-command', false);

    const terms = lib.promptTerms(prompt);
    if (terms.length === 0) lib.done(HOOK, 'no-terms');

    const repo = lib.repoInfo(null, payload.cwd).repo;

    const key = lib.cacheKey([HOOK, repo || '-', terms.join(',')]);
    const cached = lib.cacheGet(key);
    if (cached) {
        if (cached.length === 0) lib.done(HOOK, 'no-matches', { repo, terms, cache: true });
        emit(terms, cached, { repo, terms, matches: cached.length, cache: true, ms: 0 });
    }

    const auth = lib.loadAuth();
    if (!auth.token) lib.done(HOOK, `no-token:${auth.error || 'unknown'}`, { repo, terms });

    const t0 = Date.now();
    const { matches, aborted } = await lib.runDefinitionLookups(auth, repo, terms, BUDGET_MS);
    const ms = Date.now() - t0;
    if (!aborted) lib.cacheSet(key, matches);
    if (matches.length === 0) lib.done(HOOK, aborted ? 'timeout' : 'no-matches', { repo, terms, cache: false, ms });

    emit(terms, matches, { repo, terms, matches: matches.length, cache: false, ms });
}

function emit(terms, matches, rec) {
    const rows = matches.slice(0, lib.MAX_ROWS);
    const text = [
        `[symvanta] Indexed definitions match ${terms.map((t) => `"${t}"`).join(' / ')} from this message:`,
        ...lib.formatDefinitionRows(rows, lib.MAX_ROWS),
        'Navigate these with find_node / relate / ask_codebase instead of shell search.',
    ].join('\n');
    lib.emitContext(HOOK, EVENT, text, rec);
}

main().catch((e) => lib.done(HOOK, `error:${(e && e.message) || e}`));
