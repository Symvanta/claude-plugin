#!/usr/bin/env node
// Reads ~/.symvanta/grep-augment.log and prints a compact summary of how the
// Grep/Glob augmenter is performing locally: match rate, cache-hit rate,
// cold-lookup latency, busiest repos, and any token problems that silently
// degraded it to pass-through. Run by /symvanta:status, or directly:
//   node hooks/augment-stats.js
//
// Read-only and best-effort: prints a one-line notice when there is no log yet,
// never throws.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const LOG_FILE = path.join(os.homedir(), '.symvanta', 'grep-augment.log');

function main() {
    let raw;
    try {
        raw = fs.readFileSync(LOG_FILE, 'utf8');
    } catch {
        process.stdout.write('Grep augmenter: no activity logged yet (~/.symvanta/grep-augment.log absent).\n');
        return;
    }
    const recs = [];
    for (const l of raw.split('\n')) {
        if (!l) continue;
        try { recs.push(JSON.parse(l)); } catch { /* skip malformed line */ }
    }
    if (recs.length === 0) {
        process.stdout.write('Grep augmenter: log present but empty.\n');
        return;
    }

    let injected = 0;
    let noMatch = 0;
    let cacheHits = 0;
    let lookups = 0; // runs that resolved a graph result (injected or no-matches)
    const repos = {};
    const outcomes = {};
    const coldMs = [];
    for (const r of recs) {
        const o = r.outcome || 'unknown';
        outcomes[o] = (outcomes[o] || 0) + 1;
        const resolved = o === 'injected' || o === 'no-matches';
        if (o === 'injected') injected++;
        if (o === 'no-matches') noMatch++;
        if (resolved) {
            lookups++;
            if (r.cache === true) cacheHits++;
            if (r.repo) repos[r.repo] = (repos[r.repo] || 0) + 1;
            if (r.cache !== true && typeof r.ms === 'number' && r.ms > 0) coldMs.push(r.ms);
        }
    }

    const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
    coldMs.sort((a, b) => a - b);
    const at = (q) => (coldMs.length ? coldMs[Math.min(coldMs.length - 1, Math.floor(coldMs.length * q))] : 0);
    const topRepos = Object.entries(repos).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const degraded = Object.entries(outcomes)
        .filter(([o]) => o.startsWith('no-token') || o === 'disabled' || o === 'timeout')
        .sort((a, b) => b[1] - a[1]);

    const out = [];
    out.push(`Grep augmenter (local): ${recs.length} runs since ${recs[0].time || '?'}`);
    out.push(`  match rate:  ${injected}/${lookups} graph lookups had a hit (${pct(injected, lookups)}%); ${noMatch} no-match`);
    out.push(`  cache:       ${cacheHits}/${lookups} served from the 60s cache (${pct(cacheHits, lookups)}%)`);
    out.push(`  cold latency: p50 ${at(0.5)}ms, p95 ${at(0.95)}ms (cache-miss network lookups)`);
    if (topRepos.length) out.push(`  top repos:   ${topRepos.map(([r, n]) => `${r}=${n}`).join(', ')}`);
    if (degraded.length) {
        out.push(`  degraded:    ${degraded.map(([o, n]) => `${o}=${n}`).join(', ')}`);
        if (outcomes['no-token:token-expired']) {
            out.push('               token-expired means the stored Symvanta token lapsed; reconnect the MCP server to restore augmentation.');
        }
        if (outcomes['timeout']) {
            out.push(`               timeout means the lookup exceeded the budget; raise SYMVANTA_HOOK_TIMEOUT_MS if frequent.`);
        }
    }
    process.stdout.write(out.join('\n') + '\n');
}

main();
