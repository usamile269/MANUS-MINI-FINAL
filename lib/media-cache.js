// ============================================================
// ALMARI (media cache) — built 2026-11-26 at the owner's request:
// commands that get used again and again (same song, same video,
// same sticker) shouldn't redo the full download/convert work
// every time. First successful result is saved on disk (in the
// "cache" folder next to the bot's files); later requests for the
// same thing are served from the saved copy instantly.
//
// Safety rails: max ~1.5 GB total (oldest files evicted first),
// single files over 80 MB are never cached, entries older than
// 14 days are dropped. Every operation is wrapped so a cache
// problem can NEVER break the actual command.
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CACHE_DIR = path.join(process.cwd(), 'cache');
const MAX_TOTAL_BYTES = 1500 * 1024 * 1024;
const MAX_FILE_BYTES = 80 * 1024 * 1024;
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

function ensureDir() { try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch {} }
function fileFor(key) { return path.join(CACHE_DIR, key + '.bin'); }
function hash(buf) { return crypto.createHash('sha1').update(buf).digest('hex').slice(0, 24); }

// Returns the cached file's path (and refreshes its timestamp so
// popular items survive eviction), or null on a miss.
function get(key) {
    ensureDir();
    const f = fileFor(key);
    try {
        if (fs.existsSync(f)) {
            const now = new Date();
            try { fs.utimesSync(f, now, now); } catch {}
            return f;
        }
    } catch {}
    return null;
}

function evict() {
    try {
        const now = Date.now();
        let total = 0;
        const alive = [];
        for (const name of fs.readdirSync(CACHE_DIR)) {
            if (!name.endsWith('.bin')) continue;
            const p = path.join(CACHE_DIR, name);
            let s;
            try { s = fs.statSync(p); } catch { continue; }
            if (now - s.mtimeMs > MAX_AGE_MS) { try { fs.unlinkSync(p); } catch {} continue; }
            total += s.size;
            alive.push({ p, size: s.size, mtime: s.mtimeMs });
        }
        if (total <= MAX_TOTAL_BYTES) return;
        alive.sort((a, b) => a.mtime - b.mtime);
        for (const f of alive) {
            if (total <= MAX_TOTAL_BYTES) break;
            try { fs.unlinkSync(f.p); total -= f.size; } catch {}
        }
    } catch {}
}

function put(key, buffer) {
    try {
        if (!buffer || !buffer.length || buffer.length > MAX_FILE_BYTES) return;
        ensureDir();
        const f = fileFor(key);
        const tmp = f + '.tmp-' + Date.now();
        fs.writeFileSync(tmp, buffer);
        fs.renameSync(tmp, f);
        evict();
    } catch {}
}

function putFile(key, srcPath) {
    try {
        const s = fs.statSync(srcPath);
        if (!s.size || s.size > MAX_FILE_BYTES) return;
        put(key, fs.readFileSync(srcPath));
    } catch {}
}

// Fire-and-forget: download a direct media URL into the cache in the
// background (used when WhatsApp fetched the file itself, so the bot
// never saw the bytes — the next request can then be served locally).
async function fillFromUrl(key, url) {
    try {
        if (get(key)) return;
        const res = await fetch(url);
        if (!res.ok) return;
        const buf = Buffer.from(await res.arrayBuffer());
        put(key, buf);
    } catch {}
}

module.exports = { get, put, putFile, fillFromUrl, hash };
