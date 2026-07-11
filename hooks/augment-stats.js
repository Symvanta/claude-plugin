#!/usr/bin/env node
// Reads ~/.symvanta/grep-augment.log and prints a compact summary of how the
// augment hook family is performing locally, one line per hook (grep, edit,
// rescue, prompt, read): match rate, cache-hit rate, cold-lookup latency,
// plus busiest repos and any degraded outcomes (timeouts, token problems)
// that silently fell back to pass-through. Run by /symvanta:status, or:
//   node hooks/augment-stats.js
//
// Read-only and best-effort: prints a one-line notice when there is no log yet,
// never throws. Log lines written before the hook family carry no `hook` field
// and count as grep.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const LOG_FILE = path.join(os.homedir(), '.symvanta', 'grep-augment.log');
const HOOK_ORDER = ['grep', 'edit', 'rescue', 'prompt', 'read'];
// Outcomes that mean the hook got a real answer from the graph (or its cache).
const RESOLVED = new Set(['injected', 'no-matches', 'no-symbols', 'no-symbol-overlap', 'no-blast']);

function main() {
    let raw;
    try {
        raw = fs.readFileSync(LOG_FILE, 'utf8');
    } catch {
        process.stdout.write('Augmenters: no activity logged yet (~/.symvanta/grep-augment.log absent).\n');
        return;
    }
    const recs = [];
    for (const l of raw.split('\n')) {
        if (!l) continue;
        try { recs.push(JSON.parse(l)); } catch { /* skip malformed line */ }
    }
    if (recs.length === 0) {
        process.stdout.write('Augmenters: log present but empty.\n');
        return;
    }

    const byHook = {};
    const repos = {};
    const degraded = {};
    for (const r of recs) {
        const hook = r.hook || 'grep';
        const a = byHook[hook] || (byHook[hook] = { runs: 0, injected: 0, lookups: 0, cacheHits: 0, coldMs: [] });
        a.runs++;
        const o = r.outcome || 'unknown';
        if (o.startsWith('no-token') || o === 'timeout') degraded[o] = (degraded[o] || 0) + 1;
        if (!RESOLVED.has(o)) continue;
        a.lookups++;
        if (o === 'injected') a.injected++;
        if (r.cache === true) a.cacheHits++;
        if (r.repo) repos[r.repo] = (repos[r.repo] || 0) + 1;
        if (r.cache !== true && typeof r.ms === 'number' && r.ms > 0) a.coldMs.push(r.ms);
    }

    const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
    const quantile = (arr, q) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * q))] : 0);
    const hooks = HOOK_ORDER.filter((h) => byHook[h]).concat(Object.keys(byHook).filter((h) => !HOOK_ORDER.includes(h)));

    const out = [];
    out.push(`Symvanta augmenters (local): ${recs.length} runs since ${recs[0].time || '?'}`);
    for (const h of hooks) {
        const a = byHook[h];
        a.coldMs.sort((x, y) => x - y);
        out.push(`  ${h.padEnd(7)} runs ${String(a.runs).padStart(5)}  hit ${pct(a.injected, a.lookups)}% (${a.injected}/${a.lookups})`
            + `  cache ${pct(a.cacheHits, a.lookups)}%`
            + `  p50 ${quantile(a.coldMs, 0.5)}ms  p95 ${quantile(a.coldMs, 0.95)}ms`);
    }
    const topRepos = Object.entries(repos).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (topRepos.length) out.push(`  top repos: ${topRepos.map(([r, n]) => `${r}=${n}`).join(', ')}`);
    const deg = Object.entries(degraded).sort((a, b) => b[1] - a[1]);
    if (deg.length) {
        out.push(`  degraded:  ${deg.map(([o, n]) => `${o}=${n}`).join(', ')}`);
        if (degraded['no-token:token-expired']) {
            out.push('             token-expired means the stored Symvanta token lapsed; reconnect the MCP server to restore augmentation.');
        }
        if (degraded['timeout']) {
            out.push('             timeout means a lookup exceeded its budget; raise SYMVANTA_HOOK_TIMEOUT_MS if frequent.');
        }
    }
    process.stdout.write(out.join('\n') + '\n');
}

main();
