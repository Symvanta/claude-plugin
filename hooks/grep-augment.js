#!/usr/bin/env node
// PreToolUse hook: on Grep/Glob, ask the Symvanta graph which indexed symbols
// match the search term and inject them as additionalContext, so the agent
// sees the structured answer alongside its raw search and learns to reach for
// the graph tools. Additive, never corrective.
//
// ON BY DEFAULT. Reuses the Symvanta MCP token Claude Code already stored. The
// read is narrow and auditable: ONLY the Symvanta entry's access token from
// ~/.claude/.credentials.json. Never your Anthropic token. The token is sent
// ONLY to the Symvanta MCP server, and only the SEARCH TERM (not file
// contents) leaves the machine.
//
//   Query: locate(mode:symbol) returns the matching DEFINITIONS (name + path),
//   scoped to the repo you are searching (derived from the search path / cwd).
//   A 60s local cache makes repeated searches instant. Up to two distinct
//   identifiers from the pattern are looked up in parallel.
//
//   Observability: every run appends one local JSONL line to
//   ~/.symvanta/grep-augment.log (term, repo, match count, latency, cache hit).
//   Local only, never sent anywhere.
//
// Controls:
//   SYMVANTA_GREP_AUGMENT=off   disable entirely (no read, no network, no log).
//   SYMVANTA_MCP_TOKEN=<token>  use your own token instead (creds file unread).
//   SYMVANTA_MCP_URL            override the endpoint.
//   SYMVANTA_HOOK_TIMEOUT_MS    fetch cap (default 1500).
//   SYMVANTA_HOOK_DEBUG=1       log skips + timing to stderr.
//
// CARDINAL RULE: can only ADD context, never block. Every disable, error,
// timeout, or empty result exits 0 with NO stdout. The Grep always runs.
//
// Plain CommonJS Node so it runs identically on Windows, macOS, and Linux.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');

const DEFAULT_ENDPOINT = 'https://mcp.symvanta.com/mcp';
const MCP_HOST = 'mcp.symvanta.com';
const TIMEOUT_MS = Number(process.env.SYMVANTA_HOOK_TIMEOUT_MS || 1500);
const MAX_ROWS = 6;
const MAX_TERMS = 2;
const CACHE_TTL_MS = 60_000;
const STATE_DIR = path.join(os.homedir(), '.symvanta');
const CACHE_DIR = path.join(STATE_DIR, 'grep-cache');
const LOG_FILE = path.join(STATE_DIR, 'grep-augment.log');
const DEBUG = process.env.SYMVANTA_HOOK_DEBUG === '1';

let LOGGED = false;
// Mandatory local observability: one JSONL line per run. Best-effort, never throws.
function logStats(rec) {
    if (LOGGED) return;
    LOGGED = true;
    try {
        fs.mkdirSync(STATE_DIR, { recursive: true });
        fs.appendFileSync(LOG_FILE, JSON.stringify({ time: new Date().toISOString(), ...rec }) + '\n');
    } catch { /* observability is best-effort */ }
}

function done(outcome, rec) {
    if (DEBUG && outcome) process.stderr.write(`[symvanta-grep-augment] ${outcome}\n`);
    if (rec !== false) logStats({ outcome, ...(rec || {}) });
    process.exit(0);
}

function readStdin() {
    try {
        return fs.readFileSync(0, 'utf8');
    } catch {
        return '';
    }
}

// Distinct identifiers from a grep/glob pattern, longest first, capped to
// MAX_TERMS. Strips glob/regex noise and bare file extensions so `**/*Service.ts`
// yields ["service"] and `getUser|getProfile` yields ["getprofile","getuser"].
const STOP = new Set([
    'function', 'class', 'const', 'let', 'var', 'return', 'import', 'export',
    'from', 'interface', 'type', 'public', 'private', 'async', 'await', 'this',
    'true', 'false', 'null', 'void', 'string', 'number', 'boolean',
]);
const EXT = new Set([
    'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'kt', 'rb',
    'php', 'cs', 'swift', 'json', 'yaml', 'yml', 'md', 'sql', 'html', 'css',
]);
function extractTerms(pattern) {
    if (!pattern || typeof pattern !== 'string') return [];
    const tokens = pattern.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) || [];
    const seen = new Set();
    const out = [];
    for (const t of tokens) {
        const low = t.toLowerCase();
        if (STOP.has(low) || EXT.has(low) || seen.has(low)) continue;
        seen.add(low);
        out.push(t);
    }
    out.sort((a, b) => b.length - a.length);
    return out.slice(0, MAX_TERMS);
}

// #1: scope the lookup to the repo being searched. Derive the repo name from
// the search path (preferred) or cwd via its git remote. Best-effort; returns
// null (search the default project) when there is no git remote.
function deriveRepository(searchPath, cwd) {
    let dir = cwd;
    try {
        if (searchPath && fs.existsSync(searchPath)) {
            dir = fs.statSync(searchPath).isDirectory() ? searchPath : path.dirname(searchPath);
        }
    } catch { /* fall back to cwd */ }
    if (!dir) return null;
    try {
        const url = cp.execFileSync('git', ['-C', dir, 'config', '--get', 'remote.origin.url'], {
            timeout: 500, stdio: ['ignore', 'pipe', 'ignore'],
        }).toString().trim();
        const m = url.replace(/\.git$/, '').match(/([^/:]+)$/);
        return m ? m[1] : null;
    } catch {
        return null;
    }
}

// #5: one file per key, written atomically (temp + rename), instead of a single
// shared JSON. Parallel grep hook processes each touch their own file, so they
// can never clobber each other's entries or read a half-written cache.
function cacheKey(repo, terms) {
    return `${repo || '-'}|${terms.join(',').toLowerCase()}`;
}
function cacheFile(key) {
    return path.join(CACHE_DIR, crypto.createHash('sha1').update(key).digest('hex') + '.json');
}
function cacheGet(key) {
    try {
        const hit = JSON.parse(fs.readFileSync(cacheFile(key), 'utf8'));
        if (hit && Date.now() - hit.t < CACHE_TTL_MS) return hit.m;
    } catch { /* no cache */ }
    return null;
}
function cacheSet(key, matches) {
    try {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        const file = cacheFile(key);
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify({ t: Date.now(), m: matches }));
        fs.renameSync(tmp, file);
        pruneCache();
    } catch { /* best-effort */ }
}
// Drop expired entries (and any orphaned temp files) so the dir stays small.
function pruneCache() {
    try {
        const now = Date.now();
        for (const f of fs.readdirSync(CACHE_DIR)) {
            const p = path.join(CACHE_DIR, f);
            try {
                if (now - fs.statSync(p).mtimeMs >= CACHE_TTL_MS) fs.unlinkSync(p);
            } catch { /* ignore */ }
        }
    } catch { /* ignore */ }
}

// Returns { token, endpoint } on success, or { error } naming why no token was
// usable. #7: the caller logs that reason, so an EXPIRED token (silent
// degradation to pass-through) is distinguishable from a never-connected one.
function loadAuth() {
    const envToken = process.env.SYMVANTA_MCP_TOKEN;
    if (envToken) {
        return { token: envToken, endpoint: process.env.SYMVANTA_MCP_URL || DEFAULT_ENDPOINT };
    }
    let creds;
    try {
        creds = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', '.credentials.json'), 'utf8'));
    } catch {
        return { error: 'no-creds-file' };
    }
    const mcp = creds && creds.mcpOAuth;
    if (!mcp || typeof mcp !== 'object') return { error: 'no-mcp-entries' };
    const entries = Array.isArray(mcp) ? mcp : Object.values(mcp);
    const live = [];
    let sawSymvanta = false;
    let sawExpired = false;
    for (const e of entries) {
        if (!e || typeof e !== 'object') continue;
        const url = String(e.serverUrl || '');
        const name = String(e.serverName || '');
        if (!url.includes(MCP_HOST) && !/symvanta/i.test(name)) continue;
        if (/staging/i.test(url) || /staging/i.test(name)) continue;
        sawSymvanta = true;
        if (typeof e.accessToken !== 'string' || e.accessToken.length === 0) continue;
        if (typeof e.expiresAt === 'number' && e.expiresAt < Date.now()) { sawExpired = true; continue; }
        live.push(e);
    }
    if (live.length === 0) {
        if (sawExpired) return { error: 'token-expired' };
        if (sawSymvanta) return { error: 'no-usable-token' };
        return { error: 'no-symvanta-entry' };
    }
    live.sort((a, b) => (b.expiresAt || 0) - (a.expiresAt || 0));
    const chosen = live[0];
    return { token: chosen.accessToken, endpoint: process.env.SYMVANTA_MCP_URL || chosen.serverUrl || DEFAULT_ENDPOINT };
}

function parseMcpBody(text) {
    const line = text.split('\n').find((l) => l.startsWith('data:'));
    try {
        return JSON.parse(line ? line.slice(5).trim() : text);
    } catch {
        return null;
    }
}

// One tools/call: returns the structuredContent.matches array, or null on a
// transport / tool error so the caller can fall back.
async function callTool(auth, name, args, signal) {
    const res = await fetch(auth.endpoint, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${auth.token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
        },
        signal,
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    if (!res.ok) return null;
    const body = parseMcpBody(await res.text());
    if (!body || body.error || !body.result || body.result.isError) return null;
    const matches = body.result.structuredContent && body.result.structuredContent.matches;
    return Array.isArray(matches) ? matches : null;
}

// Fast path: quick_lookup (thin, no ranker). Fall back to locate(mode:symbol)
// when quick_lookup is unavailable (older mcp-server) or errors, so the hook
// keeps working across server versions.
async function lookupOne(auth, repo, query, signal) {
    const quickArgs = repo ? { query, repository: repo, limit: MAX_ROWS } : { query, limit: MAX_ROWS };
    const fast = await callTool(auth, 'quick_lookup', quickArgs, signal);
    if (fast !== null) return fast;
    const locArgs = repo
        ? { mode: 'symbol', query, repository: repo, limit: MAX_ROWS }
        : { mode: 'symbol', query, limit: MAX_ROWS };
    return (await callTool(auth, 'locate', locArgs, signal)) || [];
}

// Look up each distinct term in parallel within one shared timeout budget.
// Reports `aborted` so the caller can avoid caching an empty result that is
// only empty because the lookup timed out (which would otherwise serve a false
// "no matches" for the whole cache TTL after a single slow request).
async function runQueries(auth, repo, terms) {
    const ctrl = new AbortController();
    let aborted = false;
    const timer = setTimeout(() => { aborted = true; ctrl.abort(); }, TIMEOUT_MS);
    try {
        const results = await Promise.allSettled(terms.map((t) => lookupOne(auth, repo, t, ctrl.signal)));
        const seen = new Set();
        const merged = [];
        for (const r of results) {
            if (r.status !== 'fulfilled') continue;
            for (const m of r.value) {
                const key = m.symbolPath || m.nodeId || `${m.filePath}:${m.name}`;
                if (seen.has(key)) continue;
                seen.add(key);
                merged.push(m);
            }
        }
        return { matches: merged, aborted };
    } catch {
        return { matches: [], aborted };
    } finally {
        clearTimeout(timer);
    }
}

function formatContext(terms, matches) {
    const rows = matches.slice(0, MAX_ROWS);
    const lead = `[symvanta] ${rows.length} indexed definition(s) match ${terms.map((t) => `"${t}"`).join(' / ')} `
        + '(structured context; your search results below are unaffected). '
        + 'Prefer find_node / relate / ask_codebase to navigate these:';
    const lines = [lead];
    for (const m of rows) {
        const kind = m.kind ? ` [${m.kind}]` : '';
        const where = m.filePath
            ? `${m.filePath}${m.startLine ? ':' + m.startLine : ''}`
            : (m.symbolPath || '');
        lines.push(`- ${m.name || m.displayName || 'match'}${kind}  ${where}`);
    }
    return lines.join('\n');
}

function emit(text, rec) {
    logStats({ outcome: 'injected', ...rec });
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: text } }));
    process.exit(0);
}

async function main() {
    // Disabled: no read, no network, no log.
    if (process.env.SYMVANTA_GREP_AUGMENT === 'off') done('disabled', false);

    const input = readStdin();
    if (!input) done('no-stdin');
    let payload;
    try {
        payload = JSON.parse(input);
    } catch {
        done('bad-json');
    }
    const tool = payload.tool_name;
    if (tool !== 'Grep' && tool !== 'Glob') done(`skip-tool:${tool}`, false);

    const ti = payload.tool_input || {};
    const terms = extractTerms(ti.pattern || ti.query || ti.name);
    if (terms.length === 0) done('no-terms');

    const repo = deriveRepository(ti.path, payload.cwd);

    const key = cacheKey(repo, terms);
    const cached = cacheGet(key);
    if (cached) {
        if (DEBUG) process.stderr.write(`[symvanta-grep-augment] cache hit ${key} (${cached.length})\n`);
        if (cached.length === 0) done('no-matches', { repo, terms, cache: true });
        emit(formatContext(terms, cached), { repo, terms, matches: cached.length, cache: true, ms: 0 });
    }

    const auth = loadAuth();
    if (!auth.token) done(`no-token:${auth.error || 'unknown'}`, { repo, terms });

    const t0 = Date.now();
    const { matches, aborted } = await runQueries(auth, repo, terms);
    const ms = Date.now() - t0;
    // Cache real answers (including a genuine zero), but never a timed-out empty.
    if (!aborted) cacheSet(key, matches);
    if (DEBUG) process.stderr.write(`[symvanta-grep-augment] ${terms.join(',')} repo=${repo || '-'} -> ${matches.length} in ${ms}ms${aborted ? ' (timed out, not cached)' : ''}\n`);
    if (matches.length === 0) done(aborted ? 'timeout' : 'no-matches', { repo, terms, cache: false, ms });

    emit(formatContext(terms, matches), { repo, terms, matches: matches.length, cache: false, ms });
}

main().catch((e) => done(`error:${(e && e.message) || e}`));
