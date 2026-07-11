#!/usr/bin/env node
// PreToolUse hook: on Edit/Write of a code file in an indexed repo, look up
// which graph symbol the change touches and inject its blast radius as
// additionalContext BEFORE the change lands, so the agent sees the impact
// surface (callers, files, layers, cross-repo edges) at the moment it matters.
// Additive, never corrective: the edit itself always proceeds.
//
//   Edit: identifiers in old_string are intersected with the file's indexed
//   symbol list (list_file_symbols, cached per file); the best match gets one
//   relate (kind:blast_radius) call. Write over an EXISTING file injects the
//   definitions the overwrite replaces. Write of a new file stays silent.
//
// Only the repo-relative file path and matched symbol names leave the machine,
// never the edit contents.
//
// Controls: SYMVANTA_EDIT_AUGMENT=off disables this hook; SYMVANTA_AUGMENT=off
// (or legacy SYMVANTA_GREP_AUGMENT=off) disables the whole family.

const fs = require('node:fs');
const lib = require('./lib');

const HOOK = 'edit';
const EVENT = 'PreToolUse';
const BUDGET_MS = lib.budget(2500);
const KIND_WEIGHT = { class: 4, interface: 3, function: 3, method: 3 };

async function main() {
    if (lib.isOff('SYMVANTA_EDIT_AUGMENT')) lib.done(HOOK, 'disabled', false);

    const payload = lib.readStdinJson();
    if (!payload) lib.done(HOOK, 'no-stdin', false);
    const tool = payload.tool_name;
    if (tool !== 'Edit' && tool !== 'Write') lib.done(HOOK, `skip-tool:${tool}`, false);

    const ti = payload.tool_input || {};
    const filePath = ti.file_path;
    if (!filePath) lib.done(HOOK, 'no-file', false);
    const ext = String(filePath).split('.').pop().toLowerCase();
    if (!lib.CODE_EXT.has(ext)) lib.done(HOOK, 'non-code', false);

    const { repo, root } = lib.repoInfo(filePath, payload.cwd);
    const rel = lib.repoRelative(filePath, root);
    if (!repo || !rel) lib.done(HOOK, 'no-repo', false);

    const isWrite = tool === 'Write';
    if (isWrite && !fs.existsSync(filePath)) lib.done(HOOK, 'new-file', false);

    // For an Edit, only symbols named in old_string can be the target; bail
    // early (before any network) when the edited snippet names none.
    const tokens = isWrite
        ? null
        : new Set(lib.extractTerms(ti.old_string || '', 12).map((t) => t.toLowerCase()));
    if (tokens && tokens.size === 0) lib.done(HOOK, 'no-terms', false);

    const auth = lib.loadAuth();
    if (!auth.token) lib.done(HOOK, `no-token:${auth.error || 'unknown'}`, { repo, file: rel });

    const t0 = Date.now();

    // Step 1: the file's indexed symbols, cached per file since edit bursts
    // hit the same file repeatedly.
    const symsKey = lib.cacheKey(['fsyms', repo, rel]);
    let symbols = lib.cacheGet(symsKey);
    if (!Array.isArray(symbols)) {
        const { value, aborted } = await lib.withBudget(BUDGET_MS, (signal) =>
            lib.callTool(auth, 'list_file_symbols', { filePath: rel, repository: repo }, signal));
        symbols = value && Array.isArray(value.symbols) ? value.symbols : null;
        if (symbols === null) lib.done(HOOK, aborted ? 'timeout' : 'no-symbols', { repo, file: rel, ms: Date.now() - t0 });
        lib.cacheSet(symsKey, symbols);
    }
    if (symbols.length === 0) lib.done(HOOK, 'no-symbols', { repo, file: rel, cache: false, ms: Date.now() - t0 });

    if (isWrite) {
        const rows = symbols.slice(0, 10).map(fmtSymbol);
        const lines = [
            `[symvanta] Write overwrites ${rel} (${repo}), which currently defines ${symbols.length} indexed symbol(s):`,
            ...rows,
        ];
        if (symbols.length > 10) lines.push(`- and ${symbols.length - 10} more`);
        lines.push('If a definition is removed or renamed, check its callers first: relate (kind:blast_radius). Your write proceeds unaffected.');
        lib.emitContext(HOOK, EVENT, lines.join('\n'), { repo, file: rel, matches: symbols.length, mode: 'write', ms: Date.now() - t0 });
    }

    // Step 2 (Edit): the best symbol the edited snippet names, then its blast
    // radius. Dotted names (Class.method) match on their last segment. A name
    // right after a definition keyword in old_string (a signature edit) wins
    // over anything merely referenced in the snippet.
    const defined = new Set();
    for (const m of String(ti.old_string || '').matchAll(/(?:function|class|interface|trait|enum|struct|def|fn|func)\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
        defined.add(m[1].toLowerCase());
    }
    let best = null;
    for (const s of symbols) {
        const name = String(s.name || '');
        const last = name.split('.').pop().toLowerCase();
        if (!tokens.has(last)) continue;
        const score = (defined.has(last) ? 1000 : 0) + (KIND_WEIGHT[s.kind] || 1) * 100 + last.length;
        if (!best || score > best.score) best = { s, score, last };
    }
    if (!best) lib.done(HOOK, 'no-symbol-overlap', { repo, file: rel, ms: Date.now() - t0 });

    const brKey = lib.cacheKey(['blast', repo, rel, best.s.name]);
    let br = lib.cacheGet(brKey);
    const fromCache = !!br;
    if (!br) {
        const left = Math.max(500, BUDGET_MS - (Date.now() - t0));
        const { value, aborted } = await lib.withBudget(left, (signal) =>
            lib.callTool(auth, 'relate', {
                kind: 'blast_radius',
                selectors: [{ symbol: best.last, filePath: rel }],
                repository: repo,
                minimal: true,
                expansionLimit: 5,
            }, signal));
        const r0 = value && Array.isArray(value.results) ? value.results[0] : null;
        if (!r0 || !r0.resolved) {
            lib.done(HOOK, aborted ? 'timeout' : 'no-blast', { repo, file: rel, term: best.s.name, ms: Date.now() - t0 });
        }
        br = {
            total: typeof r0.blastRadiusTotalCount === 'number' ? r0.blastRadiusTotalCount : (r0.blastRadius || []).length,
            risk: r0.risk || null,
            // Module nodes carry their path as the name; avoid printing it twice.
            top: (r0.blastRadius || []).slice(0, 3).map((n) =>
                (n.name && !String(n.name).includes('/') ? `${n.name} (${n.filePath})` : n.filePath)),
            wide: !!r0.wide_blast_radius,
        };
        lib.cacheSet(brKey, br);
    }

    const sig = (br.risk && br.risk.signals) || {};
    const lines = [
        `[symvanta] You are editing ${best.s.name}${best.s.kind ? ` [${best.s.kind}]` : ''} in ${rel} (${repo}).`,
        `Impact: ${br.total} upstream symbol(s)`
            + (typeof sig.fileCount === 'number' ? ` across ${sig.fileCount} file(s)` : '')
            + (Array.isArray(sig.layersCrossed) && sig.layersCrossed.length ? `, layers: ${sig.layersCrossed.join(', ')}` : '')
            + (sig.crossRepoCount ? `, cross-repo: ${sig.crossRepoCount}` : '')
            + (br.risk && br.risk.level ? `, risk: ${br.risk.level}` : '')
            + '.',
    ];
    if (br.top.length) lines.push(`Includes: ${br.top.join('; ')}.`);
    if (br.wide) lines.push('Wide blast radius: confirm scope before broad changes; relate (kind:blast_radius) lists the full set.');
    lines.push('Structured context only; your edit proceeds unaffected.');
    lib.emitContext(HOOK, EVENT, lines.join('\n'), {
        repo, file: rel, term: best.s.name, matches: br.total, cache: fromCache, ms: Date.now() - t0,
    });
}

function fmtSymbol(s) {
    const kind = s.kind ? ` [${s.kind}]` : '';
    const line = s.startLine ? `  :${s.startLine}${s.endLine && s.endLine !== s.startLine ? '-' + s.endLine : ''}` : '';
    return `- ${s.name}${kind}${line}`;
}

main().catch((e) => lib.done(HOOK, `error:${(e && e.message) || e}`));
