#!/usr/bin/env node
// PreToolUse hook: on Bash, detect a code-search command (rg, git grep, or a
// recursive / path-scoped grep) and inject the matching indexed definitions as
// additionalContext, so an agent that searches through the shell still sees
// the graph answer. Additive, never corrective; every other Bash command
// passes through untouched on the silent fast path.
//
// Filter greps (`docker ps | grep worker`: piped input, no path, no -r) are
// deliberately skipped. They are output filtering, not code search, and an
// injection there is noise.
//
// ON BY DEFAULT. Same narrow token read and privacy contract as the rest of
// the family (hooks/lib.js): only extracted search terms leave the machine,
// never the command line itself.
//
// Controls:
//   SYMVANTA_AUGMENT=off        disable the whole augment hook family.
//   SYMVANTA_GREP_AUGMENT=off   legacy switch, still disables the whole family.
//   SYMVANTA_BASH_AUGMENT=off   disable only this hook.
//   SYMVANTA_MCP_TOKEN=<token>  use your own token instead (creds file unread).
//   SYMVANTA_MCP_URL            override the endpoint.
//   SYMVANTA_HOOK_TIMEOUT_MS    lookup cap for every hook (this hook: 1500).
//   SYMVANTA_HOOK_DEBUG=1       log skips + timing to stderr.

const fs = require('node:fs');
const path = require('node:path');
const lib = require('./lib');

const HOOK = 'bash';
lib.setCallOrigin(HOOK);
const BUDGET_MS = lib.budget(1500);
const SEARCH_CMDS = new Set(['grep', 'egrep', 'fgrep', 'rg']);

// Split a shell command into pipeline/list segments at unquoted | ; & while
// tracking quote state, so a quoted "a|b" pattern never splits its segment.
// Approximate by design: hooks only need the invocation shape, not a shell.
function splitSegments(command) {
    const segments = [];
    let current = '';
    let quote = null;
    for (let i = 0; i < command.length; i++) {
        const ch = command[i];
        if (quote) {
            current += ch;
            if (ch === quote && command[i - 1] !== '\\') quote = null;
            continue;
        }
        if (ch === "'" || ch === '"' || ch === '`') {
            quote = ch;
            current += ch;
            continue;
        }
        if (ch === '|' || ch === ';' || ch === '&') {
            if (current.trim()) segments.push(current.trim());
            current = '';
            // Swallow doubled operators (&&, ||).
            if (command[i + 1] === ch) i++;
            continue;
        }
        current += ch;
    }
    if (current.trim()) segments.push(current.trim());
    return segments;
}

// Tokenize one segment, keeping quoted spans whole (quotes stripped).
function tokenize(segment) {
    const tokens = [];
    const re = /'([^']*)'|"([^"]*)"|(\S+)/g;
    let m;
    while ((m = re.exec(segment)) !== null) {
        tokens.push({ value: m[1] ?? m[2] ?? m[3], quoted: m[3] === undefined });
    }
    return tokens;
}

// Flags that consume the NEXT token as their value; without this, `rg -t ts
// createUser` would read "ts" as the pattern. `=`-joined forms (--include=x)
// arrive as one token starting with "-" and are skipped as plain flags.
const VALUE_FLAGS = new Set([
    '-A', '-B', '-C', '-m', '-d', '-D', '-f', '--file',
    '-t', '-T', '-g', '-j', '-E', '-M',
    '--glob', '--iglob', '--type', '--type-not', '--max-count', '--max-depth',
    '--max-columns', '--threads', '--encoding', '--include', '--exclude',
    '--exclude-dir', '--color', '--colour', '--context', '--after-context',
    '--before-context',
]);

// Find the first code-search invocation across segments. Returns
// { pattern, paths, viaXargs } or null. Wrappers (env assignments, sudo,
// command, xargs, time) are skipped so `... | xargs grep -l foo` resolves,
// with xargs implying the file list arrives on stdin.
function findSearchInvocation(command) {
    for (const segment of splitSegments(command.replace(/\\\n/g, ' '))) {
        const tokens = tokenize(segment);
        let i = 0;
        let viaXargs = false;
        while (
            i < tokens.length &&
            (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i].value) ||
                ['sudo', 'command', 'xargs', 'time', 'nice'].includes(tokens[i].value))
        ) {
            if (tokens[i].value === 'xargs') viaXargs = true;
            i++;
        }
        if (i >= tokens.length) continue;

        let cmd = path.basename(tokens[i].value);
        let argStart = i + 1;
        if (cmd === 'git' && tokens[i + 1] && tokens[i + 1].value === 'grep') {
            cmd = 'git-grep';
            argStart = i + 2;
        } else if (!SEARCH_CMDS.has(cmd)) {
            continue;
        }

        let pattern = null;
        let recursive = cmd === 'rg' || cmd === 'git-grep';
        const paths = [];
        for (let j = argStart; j < tokens.length; j++) {
            const t = tokens[j];
            if (!t.quoted && t.value.startsWith('-')) {
                if (/^-[a-zA-Z]*[rR]/.test(t.value) || t.value === '--recursive') recursive = true;
                if ((t.value === '-e' || t.value === '--regexp') && tokens[j + 1]) {
                    if (pattern === null) pattern = tokens[++j].value;
                } else if (t.value.startsWith('--regexp=')) {
                    if (pattern === null) pattern = t.value.slice('--regexp='.length);
                } else if (VALUE_FLAGS.has(t.value)) {
                    j++;
                }
                continue;
            }
            if (pattern === null) pattern = t.value;
            else paths.push(t.value);
        }
        if (pattern === null) continue;

        // Plain grep with no path, no recursion, and no xargs-fed file list
        // is output filtering (`docker ps | grep worker`), not code search.
        if (cmd !== 'rg' && cmd !== 'git-grep' && paths.length === 0 && !recursive && !viaXargs) continue;

        return { pattern, paths };
    }
    return null;
}

async function main() {
    // Disabled: no read, no network, no log.
    if (lib.isOff('SYMVANTA_BASH_AUGMENT')) lib.done(HOOK, 'disabled', false);

    const payload = lib.readStdinJson();
    if (!payload) lib.done(HOOK, 'no-stdin', false);
    if (payload.tool_name !== 'Bash') lib.done(HOOK, `skip-tool:${payload.tool_name}`, false);

    const command = (payload.tool_input || {}).command;
    if (!command || typeof command !== 'string') lib.done(HOOK, 'no-command', false);

    // Silent fast path for the overwhelming majority of Bash calls: nothing
    // is logged so the local JSONL only carries actual search encounters.
    const invocation = findSearchInvocation(command);
    if (!invocation) lib.done(HOOK, 'skip-not-search', false);

    const terms = lib.extractTerms(invocation.pattern);
    if (terms.length === 0) lib.done(HOOK, 'no-terms');

    let searchPath = null;
    for (const p of invocation.paths) {
        const abs = path.isAbsolute(p) ? p : path.join(payload.cwd || '', p);
        try {
            if (fs.existsSync(abs)) { searchPath = abs; break; }
        } catch { /* keep looking */ }
    }
    const repo = lib.repoInfo(searchPath, payload.cwd).repo;

    // Shared cache namespace with the Grep-tool hook: same lookup, same
    // answer, so a term searched through either surface hits the other's entry.
    const key = lib.cacheKey(['grep', repo || '-', terms.join(',')]);
    const cached = lib.cacheGet(key);
    if (cached) {
        if (lib.DEBUG) process.stderr.write(`[symvanta-augment:bash] cache hit ${key} (${cached.length})\n`);
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
    if (lib.DEBUG) process.stderr.write(`[symvanta-augment:bash] ${terms.join(',')} repo=${repo || '-'} -> ${matches.length} in ${ms}ms${aborted ? ' (timed out, not cached)' : ''}\n`);
    if (matches.length === 0) lib.done(HOOK, aborted ? 'timeout' : 'no-matches', { repo, terms, cache: false, ms });

    emit(terms, matches, { repo, terms, matches: matches.length, cache: false, ms });
}

function emit(terms, matches, rec) {
    const rows = matches.slice(0, lib.MAX_ROWS);
    const lead = `[symvanta] ${rows.length} indexed definition(s) match ${terms.map((t) => `"${t}"`).join(' / ')} `
        + '(structured context; your shell command runs unaffected). '
        + 'The graph answers this directly: prefer locate (mode:text) / find_node / relate / ask_codebase:';
    const text = [lead, ...lib.formatDefinitionRows(rows, lib.MAX_ROWS)].join('\n');
    lib.emitContext(HOOK, 'PreToolUse', text, rec);
}

main().catch((e) => lib.done(HOOK, `error:${(e && e.message) || e}`));
