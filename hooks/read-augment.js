#!/usr/bin/env node
// PreToolUse hook: the FIRST time a session Reads a code file in an indexed
// repo, inject the file's symbol skeleton (list_file_symbols) plus any
// architecture decision records anchored to it, so structure and the recorded
// WHY arrive alongside the raw content. A per-session seen-marker keeps this
// to one injection per file per session; repeat Reads exit instantly with no
// reads and no network. Additive, never corrective.
//
// Only the repo-relative file path leaves the machine, never file contents.
//
// Controls: SYMVANTA_READ_AUGMENT=off disables this hook; SYMVANTA_AUGMENT=off
// (or legacy SYMVANTA_GREP_AUGMENT=off) disables the whole family.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const lib = require('./lib');

const HOOK = 'read';
const EVENT = 'PreToolUse';
const BUDGET_MS = lib.budget(1500);
const SEEN_DIR = path.join(lib.STATE_DIR, 'read-seen');
const SEEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SYMBOLS = 12;
const MAX_DECISIONS = 3;

function seenFile(sessionId, absPath) {
    const key = `${sessionId || 'global'}|${String(absPath).toLowerCase()}`;
    return path.join(SEEN_DIR, crypto.createHash('sha1').update(key).digest('hex'));
}

function markSeen(file) {
    try {
        fs.mkdirSync(SEEN_DIR, { recursive: true });
        fs.writeFileSync(file, '');
        lib.pruneDir(SEEN_DIR, SEEN_TTL_MS);
    } catch { /* best-effort */ }
}

async function main() {
    if (lib.isOff('SYMVANTA_READ_AUGMENT')) lib.done(HOOK, 'disabled', false);

    const payload = lib.readStdinJson();
    if (!payload) lib.done(HOOK, 'no-stdin', false);
    if (payload.tool_name !== 'Read') lib.done(HOOK, `skip-tool:${payload.tool_name}`, false);

    const ti = payload.tool_input || {};
    const filePath = ti.file_path;
    if (!filePath) lib.done(HOOK, 'no-file', false);
    const ext = String(filePath).split('.').pop().toLowerCase();
    if (!lib.CODE_EXT.has(ext)) lib.done(HOOK, 'non-code', false);

    const seen = seenFile(payload.session_id, filePath);
    try {
        if (Date.now() - fs.statSync(seen).mtimeMs < SEEN_TTL_MS) lib.done(HOOK, 'seen', false);
    } catch { /* not seen yet */ }

    const { repo, root } = lib.repoInfo(filePath, payload.cwd);
    const rel = lib.repoRelative(filePath, root);
    if (!repo || !rel) lib.done(HOOK, 'no-repo', false);

    const auth = lib.loadAuth();
    if (!auth.token) lib.done(HOOK, `no-token:${auth.error || 'unknown'}`, { repo, file: rel });

    const t0 = Date.now();
    const key = lib.cacheKey([HOOK, repo, rel]);
    let data = lib.cacheGet(key);
    const fromCache = !!data;
    if (!data) {
        const { value, aborted } = await lib.withBudget(BUDGET_MS, (signal) => Promise.all([
            lib.callTool(auth, 'list_file_symbols', { filePath: rel, repository: repo }, signal),
            lib.callTool(auth, 'adr', { op: 'list', repository: repo, filePath: rel, limit: MAX_DECISIONS }, signal),
        ]));
        if (!value) lib.done(HOOK, aborted ? 'timeout' : 'no-matches', { repo, file: rel, ms: Date.now() - t0 });
        data = {
            symbols: value[0] && Array.isArray(value[0].symbols) ? value[0].symbols : [],
            decisions: value[1] && Array.isArray(value[1].decisions) ? value[1].decisions : [],
        };
        lib.cacheSet(key, data);
    }

    // A resolved answer (even an empty one) marks the file seen for this
    // session; timeouts above do not, so the next Read retries.
    markSeen(seen);
    if (data.symbols.length === 0 && data.decisions.length === 0) {
        lib.done(HOOK, 'no-matches', { repo, file: rel, cache: fromCache, ms: Date.now() - t0 });
    }

    const lines = [`[symvanta] Indexed skeleton of ${rel} (${repo}):`];
    for (const s of data.symbols.slice(0, MAX_SYMBOLS)) {
        const kind = s.kind ? ` [${s.kind}]` : '';
        const span = s.startLine ? `  :${s.startLine}${s.endLine && s.endLine !== s.startLine ? '-' + s.endLine : ''}` : '';
        lines.push(`- ${s.name}${kind}${span}`);
    }
    if (data.symbols.length > MAX_SYMBOLS) lines.push(`- and ${data.symbols.length - MAX_SYMBOLS} more (list_file_symbols)`);
    for (const d of data.decisions.slice(0, MAX_DECISIONS)) {
        const decision = String(d.decision || '').replace(/\s+/g, ' ').slice(0, 160);
        lines.push(`- ADR "${d.title}" (${d.status}): ${decision}`);
    }
    lines.push('Line bounds above let you Read just the slice you need. Your read proceeds unaffected.');
    lib.emitContext(HOOK, EVENT, lines.join('\n'), {
        repo, file: rel, matches: data.symbols.length + data.decisions.length, cache: fromCache, ms: Date.now() - t0,
    });
}

main().catch((e) => lib.done(HOOK, `error:${(e && e.message) || e}`));
