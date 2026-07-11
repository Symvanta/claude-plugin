// Shared core for the Symvanta augment hook family (grep, edit, rescue,
// prompt, read). Each hook is a short-lived node process spawned by Claude
// Code; this module carries what they share: the narrow token read, the
// one-shot MCP tools/call transport, identifier extraction, repo derivation
// with a small disk memo, the per-key atomic result cache, and the mandatory
// local JSONL activity log at ~/.symvanta/grep-augment.log (one line per run,
// local only, never sent anywhere).
//
// CARDINAL RULE (every hook): only ADD context, never block. Each disable,
// error, timeout, or empty result exits 0 with no stdout, so the intercepted
// tool always runs untouched.
//
// Plain CommonJS Node so it runs identically on Windows, macOS, and Linux.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');

const DEFAULT_ENDPOINT = 'https://mcp.symvanta.com/mcp';
const MCP_HOST = 'mcp.symvanta.com';
const MAX_ROWS = 6;
const MAX_TERMS = 2;
const CACHE_TTL_MS = 60_000;
const STATE_DIR = path.join(os.homedir(), '.symvanta');
const CACHE_DIR = path.join(STATE_DIR, 'grep-cache');
const LOG_FILE = path.join(STATE_DIR, 'grep-augment.log');
const DEBUG = process.env.SYMVANTA_HOOK_DEBUG === '1';

// Per-hook lookup budget: SYMVANTA_HOOK_TIMEOUT_MS overrides every hook's
// default when set, so one knob still governs the family.
function budget(defaultMs) {
    const env = Number(process.env.SYMVANTA_HOOK_TIMEOUT_MS);
    return Number.isFinite(env) && env > 0 ? env : defaultMs;
}

// SYMVANTA_AUGMENT=off is the family-wide kill switch. SYMVANTA_GREP_AUGMENT=off
// predates it as the documented "no reads, no network on tool calls" control,
// so it keeps that meaning and also disables every hook, not just grep.
// Each hook additionally has its own =off variable.
function isOff(perHookVar) {
    if (process.env.SYMVANTA_AUGMENT === 'off') return true;
    if (process.env.SYMVANTA_GREP_AUGMENT === 'off') return true;
    return perHookVar ? process.env[perHookVar] === 'off' : false;
}

let LOGGED = false;
// Mandatory local observability: one JSONL line per run. Best-effort, never throws.
function logStats(hook, rec) {
    if (LOGGED) return;
    LOGGED = true;
    try {
        fs.mkdirSync(STATE_DIR, { recursive: true });
        fs.appendFileSync(LOG_FILE, JSON.stringify({ time: new Date().toISOString(), hook, ...rec }) + '\n');
    } catch { /* observability is best-effort */ }
}

function done(hook, outcome, rec) {
    if (DEBUG && outcome) process.stderr.write(`[symvanta-augment:${hook}] ${outcome}\n`);
    if (rec !== false) logStats(hook, { outcome, ...(rec || {}) });
    process.exit(0);
}

function emitContext(hook, eventName, text, rec) {
    logStats(hook, { outcome: 'injected', ...rec });
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: eventName, additionalContext: text } }));
    process.exit(0);
}

function readStdinJson() {
    try {
        return JSON.parse(fs.readFileSync(0, 'utf8'));
    } catch {
        return null;
    }
}

// Distinct identifiers from a pattern / snippet, longest first, capped to max.
// Strips glob/regex noise, keywords, and bare file extensions so
// `**/*Service.ts` yields ["service"] and `getUser|getProfile` yields both.
const STOP = new Set([
    'function', 'class', 'const', 'let', 'var', 'return', 'import', 'export',
    'from', 'interface', 'type', 'public', 'private', 'async', 'await', 'this',
    'true', 'false', 'null', 'void', 'string', 'number', 'boolean',
]);
const EXT = new Set([
    'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'kt', 'rb',
    'php', 'cs', 'swift', 'json', 'yaml', 'yml', 'md', 'sql', 'html', 'css',
]);
// File extensions the graph indexes as code; the edit and read hooks stay
// silent for everything else.
const CODE_EXT = new Set([
    'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'kt',
    'kts', 'rb', 'php', 'cs', 'swift', 'scala',
]);
function extractTerms(pattern, max) {
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
    return out.slice(0, max || MAX_TERMS);
}

// Stricter extraction for free-form user prompts: only tokens that LOOK like
// code identifiers qualify (backticked spans, snake_case, camelCase). Plain
// prose words, including sentence-initial Capitalized ones, never do, so
// conversational prompts stay silent.
function promptTerms(prompt) {
    if (!prompt || typeof prompt !== 'string') return [];
    const seen = new Set();
    const out = [];
    const push = (t) => {
        const low = t.toLowerCase();
        if (t.length < 3 || STOP.has(low) || EXT.has(low) || seen.has(low)) return;
        seen.add(low);
        out.push(t);
    };
    for (const span of prompt.match(/`[^`\n]{2,120}`/g) || []) {
        for (const t of span.slice(1, -1).match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) || []) push(t);
    }
    for (const t of prompt.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) || []) {
        if (/_/.test(t) || /[a-z][A-Z]/.test(t)) push(t);
    }
    out.sort((a, b) => b.length - a.length);
    return out.slice(0, MAX_TERMS);
}

function git(dir, args) {
    return cp.execFileSync('git', ['-C', dir, ...args], {
        timeout: 500, stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
}

// Repo name + checkout root for a path, derived from the git remote.
// Memoized on disk because a miss costs one or two git subprocess spawns,
// the slowest client-side step (especially on Windows). Negative results
// (not a repo) are memoized too, so reads outside any checkout stay cheap.
const REPO_MEMO_FILE = path.join(STATE_DIR, 'repo-cache.json');
const REPO_MEMO_TTL_MS = 24 * 60 * 60 * 1000;
function repoInfo(searchPath, cwd) {
    let dir = cwd;
    try {
        if (searchPath && fs.existsSync(searchPath)) {
            dir = fs.statSync(searchPath).isDirectory() ? searchPath : path.dirname(searchPath);
        }
    } catch { /* fall back to cwd */ }
    if (!dir) return { repo: null, root: null };
    let memo = {};
    try { memo = JSON.parse(fs.readFileSync(REPO_MEMO_FILE, 'utf8')) || {}; } catch { /* no memo yet */ }
    const hit = memo[dir];
    if (hit && Date.now() - hit.t < REPO_MEMO_TTL_MS) return { repo: hit.repo, root: hit.root };
    let repo = null;
    let root = null;
    try {
        root = git(dir, ['rev-parse', '--show-toplevel']);
        const url = git(dir, ['config', '--get', 'remote.origin.url']);
        const m = url.replace(/\.git$/, '').match(/([^/:]+)$/);
        repo = m ? m[1] : null;
    } catch { /* not a git checkout, or no remote */ }
    try {
        const now = Date.now();
        for (const k of Object.keys(memo)) {
            if (!memo[k] || now - memo[k].t >= REPO_MEMO_TTL_MS) delete memo[k];
        }
        memo[dir] = { repo, root, t: now };
        fs.mkdirSync(STATE_DIR, { recursive: true });
        const tmp = `${REPO_MEMO_FILE}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(memo));
        fs.renameSync(tmp, REPO_MEMO_FILE);
    } catch { /* memo is best-effort */ }
    return { repo, root };
}

// Repo-relative logical path (forward slashes) for an absolute path, or null
// when the path is not under the checkout root. Case-insensitive prefix match
// because Windows paths arrive in mixed casing.
function repoRelative(absPath, root) {
    if (!absPath || !root) return null;
    const norm = (p) => path.resolve(p).replace(/\\/g, '/');
    const a = norm(absPath);
    const r = norm(root);
    if (!a.toLowerCase().startsWith(r.toLowerCase() + '/')) return null;
    return a.slice(r.length + 1);
}

// One file per cache key, written atomically (temp + rename), so parallel hook
// processes can never clobber each other's entries or read a half-written
// cache. Values are arbitrary JSON under {t, v}; pre-family entries used
// {t, m} and are still readable during the 60s they stay fresh.
function cacheKey(parts) {
    return parts.join('|').toLowerCase();
}
function cacheFile(key) {
    return path.join(CACHE_DIR, crypto.createHash('sha1').update(key).digest('hex') + '.json');
}
function cacheGet(key) {
    try {
        const hit = JSON.parse(fs.readFileSync(cacheFile(key), 'utf8'));
        if (hit && Date.now() - hit.t < CACHE_TTL_MS) return 'v' in hit ? hit.v : hit.m;
    } catch { /* no cache */ }
    return null;
}
function cacheSet(key, value) {
    try {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        const file = cacheFile(key);
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify({ t: Date.now(), v: value }));
        fs.renameSync(tmp, file);
        pruneDir(CACHE_DIR, CACHE_TTL_MS);
    } catch { /* best-effort */ }
}
// Drop expired entries (and any orphaned temp files) so a state dir stays small.
function pruneDir(dir, ttlMs) {
    try {
        const now = Date.now();
        for (const f of fs.readdirSync(dir)) {
            const p = path.join(dir, f);
            try {
                if (now - fs.statSync(p).mtimeMs >= ttlMs) fs.unlinkSync(p);
            } catch { /* ignore */ }
        }
    } catch { /* ignore */ }
}

// Returns { token, endpoint } on success, or { error } naming why no token was
// usable, so an EXPIRED token (silent degradation to pass-through) stays
// distinguishable from a never-connected one in the log.
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

// One tools/call: returns result.structuredContent (whole object, since tools
// answer with different top-level keys: matches, symbols, results, decisions),
// or null on a transport / tool error so the caller can fall back or stay silent.
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
    return body.result.structuredContent || null;
}

// callTool narrowed to tools that answer with {matches: [...]}.
async function callMatches(auth, name, args, signal) {
    const sc = await callTool(auth, name, args, signal);
    const matches = sc && sc.matches;
    return Array.isArray(matches) ? matches : null;
}

// Fast path: quick_lookup (thin, no ranker). Fall back to locate(mode:symbol)
// when quick_lookup is unavailable (older mcp-server) or errors, so the hooks
// keep working across server versions.
async function lookupDefinitions(auth, repo, query, signal) {
    const quickArgs = repo ? { query, repository: repo, limit: MAX_ROWS } : { query, limit: MAX_ROWS };
    const fast = await callMatches(auth, 'quick_lookup', quickArgs, signal);
    if (fast !== null) return fast;
    const locArgs = repo
        ? { mode: 'symbol', query, repository: repo, limit: MAX_ROWS }
        : { mode: 'symbol', query, limit: MAX_ROWS };
    return (await callMatches(auth, 'locate', locArgs, signal)) || [];
}

// Look up each distinct term in parallel within one shared timeout budget.
// Reports `aborted` so the caller can avoid caching an empty result that is
// only empty because the lookup timed out (which would otherwise serve a false
// "no matches" for the whole cache TTL after a single slow request).
async function runDefinitionLookups(auth, repo, terms, budgetMs) {
    const ctrl = new AbortController();
    let aborted = false;
    const timer = setTimeout(() => { aborted = true; ctrl.abort(); }, budgetMs);
    try {
        const results = await Promise.allSettled(terms.map((t) => lookupDefinitions(auth, repo, t, ctrl.signal)));
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

// Run fn(signal) under a timeout budget. Reports `aborted` for the same
// reason as runDefinitionLookups: timed-out emptiness must never be cached.
async function withBudget(budgetMs, fn) {
    const ctrl = new AbortController();
    let aborted = false;
    const timer = setTimeout(() => { aborted = true; ctrl.abort(); }, budgetMs);
    try {
        const value = await fn(ctrl.signal);
        return { value, aborted };
    } catch {
        return { value: null, aborted };
    } finally {
        clearTimeout(timer);
    }
}

// One line per definition row, shared by the grep and prompt hooks.
function formatDefinitionRows(matches, max) {
    const lines = [];
    for (const m of matches.slice(0, max)) {
        const kind = m.kind ? ` [${m.kind}]` : '';
        const where = m.filePath
            ? `${m.filePath}${m.startLine ? ':' + m.startLine : ''}`
            : (m.symbolPath || '');
        lines.push(`- ${m.name || m.displayName || 'match'}${kind}  ${where}`);
    }
    return lines;
}

module.exports = {
    MAX_ROWS,
    MAX_TERMS,
    CACHE_TTL_MS,
    STATE_DIR,
    DEBUG,
    budget,
    isOff,
    logStats,
    done,
    emitContext,
    readStdinJson,
    STOP,
    EXT,
    CODE_EXT,
    extractTerms,
    promptTerms,
    repoInfo,
    repoRelative,
    cacheKey,
    cacheGet,
    cacheSet,
    pruneDir,
    loadAuth,
    callTool,
    callMatches,
    lookupDefinitions,
    runDefinitionLookups,
    withBudget,
    formatDefinitionRows,
};
