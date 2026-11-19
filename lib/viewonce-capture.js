'use strict';
// lib/viewonce-capture.js — capture, persist, auto-forward view-once media
// Context: AHMAD-MD, Baileys @whiskeysockets/baileys, Node.js, Railway
// Exports: handleAntiViewOnce, autoRecoverOnReply, unwrapMedia, captureViewOnce, scopedKey
// Also exposes: captureCache (Map), loadDiskRecord (async fn)

const fs = require('fs');
const path = require('path');
const os = require('os');
const { downloadContentFromMessage, jidNormalizedUser } = require('@whiskeysockets/baileys');
const { randomFooter } = require('./menu-styles');

// ─── disk cache directory ─────────────────────────────────────────────────────
// Railway wipes os.tmpdir() on REDEPLOY (new build), but the bot's session dir
// lives on a Railway Volume (or in /data/ahmad-db which is a persistent path
// set by the Railway service config). We prefer that over /tmp so captures
// survive process restarts.  Falls back to os.tmpdir() if the persistent path
// is unavailable (local dev, Katabump, etc.).
//
// Priority:
//   1. process.env.JSONDB_DIR/viewonce-cache   (Railway Volume path)
//   2. /data/ahmad-db/viewonce-cache           (Railway conventional data dir)
//   3. os.tmpdir()/ahmadmd-viewonce-cache      (last resort)
function resolveCacheDir() {
  const candidates = [
    process.env.JSONDB_DIR && path.join(process.env.JSONDB_DIR, 'viewonce-cache'),
    '/data/ahmad-db/viewonce-cache',
    path.join(os.tmpdir(), 'ahmadmd-viewonce-cache'),
  ].filter(Boolean);

  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      // Write-test
      const test = path.join(dir, '.write-test');
      fs.writeFileSync(test, '1');
      fs.unlinkSync(test);
      return dir;
    } catch (_) {}
  }
  return os.tmpdir();
}

const CACHE_DIR = resolveCacheDir();
const MAX_DISK_ENTRIES = 60;   // purge oldest when exceeded
const MAX_DISK_AGE_MS  = 30 * 60 * 1000; // 30 minutes
const DL_TIMEOUT_MS    = 25_000;

// ─── in-memory cache ──────────────────────────────────────────────────────────
// Map<cacheKey, { mediaObj, buf, mediaType, caption, ts }>
const captureCache = new Map();
const MAX_MEM_ENTRIES = 100;

// ─── scoped key ───────────────────────────────────────────────────────────────
function scopedKey(botNumber, jid, msgId) {
  const bot = (botNumber || '').replace(/[^0-9]/g, '');
  return `${bot}::${jid}::${msgId}`;
}

// ─── layer unwrap (mirror of vv.js, kept self-contained) ─────────────────────
const VIEWONCE_WRAPPERS = [
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
];
const PASSTHROUGH_WRAPPERS = [
  'ephemeralMessage',
  'documentWithCaptionMessage',
  'templateMessage',
  'buttonsMessage',
  'interactiveMessage',
  'productMessage',
];
const MEDIA_TYPES = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage'];

function unwrapMedia(msgObj) {
  if (!msgObj || typeof msgObj !== 'object') return null;
  let obj = msgObj;
  for (let depth = 0; depth < 12; depth++) {
    for (const mt of MEDIA_TYPES) {
      if (obj[mt]) return obj[mt];
    }
    for (const vw of VIEWONCE_WRAPPERS) {
      if (obj[vw]) {
        const inner = obj[vw].message || obj[vw];
        if (inner && inner !== obj) { obj = inner; break; }
      }
    }
    let descended = false;
    for (const pw of PASSTHROUGH_WRAPPERS) {
      if (obj[pw]) {
        const inner = obj[pw].message || obj[pw];
        if (inner && inner !== obj) { obj = inner; descended = true; break; }
      }
    }
    if (!descended) break;
  }
  for (const mt of MEDIA_TYPES) {
    if (obj[mt]) return obj[mt];
  }
  return null;
}

// ─── detect view-once ─────────────────────────────────────────────────────────
function isViewOnceMsg(mek) {
  const content = mek?.message;
  if (!content) return false;
  for (const vw of VIEWONCE_WRAPPERS) {
    if (content[vw]) return true;
  }
  const eph = content.ephemeralMessage?.message;
  if (eph) {
    for (const vw of VIEWONCE_WRAPPERS) {
      if (eph[vw]) return true;
    }
  }
  return false;
}

// ─── media type ───────────────────────────────────────────────────────────────
function mediaTypeOf(mediaObj) {
  if (!mediaObj) return null;
  if (mediaObj.mimetype?.startsWith('video/')) return 'video';
  if (mediaObj.mimetype?.startsWith('audio/')) return 'audio';
  return 'image';
}

// ─── stream download ──────────────────────────────────────────────────────────
async function downloadMedia(mediaObj, typeHint) {
  const type = typeHint || mediaTypeOf(mediaObj) || 'image';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Download timed out after ${DL_TIMEOUT_MS / 1000}s`)),
      DL_TIMEOUT_MS
    );
    const chunks = [];
    (async () => {
      try {
        const stream = await downloadContentFromMessage(mediaObj, type);
        for await (const chunk of stream) chunks.push(chunk);
        clearTimeout(timer);
        resolve(Buffer.concat(chunks));
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    })();
  });
}

// ─── disk I/O ─────────────────────────────────────────────────────────────────
// Each record: <cacheKey-safe>.json (metadata) + <cacheKey-safe>.buf (raw media)
// cacheKey contains '::' and digits — safe for filenames after replacing '::'

function diskSafeName(cacheKey) {
  return cacheKey.replace(/::/g, '__');
}

function diskMetaPath(cacheKey) {
  return path.join(CACHE_DIR, diskSafeName(cacheKey) + '.json');
}
function diskBufPath(cacheKey) {
  return path.join(CACHE_DIR, diskSafeName(cacheKey) + '.buf');
}

async function saveDiskRecord(cacheKey, record) {
  try {
    const meta = {
      mediaType: record.mediaType,
      caption:   record.caption || '',
      ts:        record.ts || Date.now(),
      hasMedia:  !!(record.buf && record.buf.length > 0),
    };
    fs.writeFileSync(diskMetaPath(cacheKey), JSON.stringify(meta));
    if (meta.hasMedia) {
      fs.writeFileSync(diskBufPath(cacheKey), record.buf);
    }
    purgeDiskCache(); // async, fire and forget
  } catch (_) {}
}

async function loadDiskRecord(cacheKey) {
  try {
    const metaPath = diskMetaPath(cacheKey);
    if (!fs.existsSync(metaPath)) return null;
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    // Age check
    if (Date.now() - (meta.ts || 0) > MAX_DISK_AGE_MS) {
      try { fs.unlinkSync(metaPath); } catch (_) {}
      try { fs.unlinkSync(diskBufPath(cacheKey)); } catch (_) {}
      return null;
    }
    let buf = null;
    if (meta.hasMedia) {
      const bufPath = diskBufPath(cacheKey);
      if (fs.existsSync(bufPath)) {
        buf = fs.readFileSync(bufPath);
      }
    }
    return { buf, mediaType: meta.mediaType, caption: meta.caption, ts: meta.ts };
  } catch (_) {
    return null;
  }
}

function purgeDiskCache() {
  try {
    const files = fs.readdirSync(CACHE_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => ({ f, stat: fs.statSync(path.join(CACHE_DIR, f)) }))
      .sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs);

    const now = Date.now();
    for (const { f } of files) {
      const full = path.join(CACHE_DIR, f);
      try {
        const meta = JSON.parse(fs.readFileSync(full, 'utf8'));
        if (now - (meta.ts || 0) > MAX_DISK_AGE_MS) {
          fs.unlinkSync(full);
          const bufFile = full.replace(/\.json$/, '.buf');
          if (fs.existsSync(bufFile)) fs.unlinkSync(bufFile);
        }
      } catch (_) {}
    }

    // Count remaining and purge oldest if over limit
    const remaining = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.json'));
    if (remaining.length > MAX_DISK_ENTRIES) {
      const sorted = remaining
        .map(f => ({ f, stat: fs.statSync(path.join(CACHE_DIR, f)) }))
        .sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs);
      const toDelete = sorted.slice(0, sorted.length - MAX_DISK_ENTRIES);
      for (const { f } of toDelete) {
        try {
          const full = path.join(CACHE_DIR, f);
          fs.unlinkSync(full);
          const bufFile = full.replace(/\.json$/, '.buf');
          if (fs.existsSync(bufFile)) fs.unlinkSync(bufFile);
        } catch (_) {}
      }
    }
  } catch (_) {}
}

// ─── captureViewOnce ──────────────────────────────────────────────────────────
// Called on EVERY incoming message. If it's a view-once, download and cache.
// MUST handle fromMe === true (owner self-sent view-onces).
// Returns the cache key if captured, null otherwise.
async function captureViewOnce(conn, mek) {
  if (!isViewOnceMsg(mek)) return null;

  const jid   = mek?.key?.remoteJid;
  const msgId = mek?.key?.id;
  const bot   = conn?.user?.id || '';
  if (!jid || !msgId) return null;

  const cacheKey = scopedKey(bot, jid, msgId);

  // Already captured?
  if (captureCache.has(cacheKey)) return cacheKey;

  const media = unwrapMedia(mek.message);
  if (!media) return null;

  const mediaType = mediaTypeOf(media);
  const caption   = media.caption || '';

  // If no mediaKey, store the reference only (may still be downloadable briefly)
  const record = { mediaObj: media, buf: null, mediaType, caption, ts: Date.now() };

  if (media.mediaKey) {
    try {
      const buf = await downloadMedia(media, mediaType);
      if (buf && buf.length > 0) record.buf = buf;
    } catch (_) {
      // Store without buf — will re-try from mediaObj on demand
    }
  }

  // Memory cache (evict oldest if full)
  if (captureCache.size >= MAX_MEM_ENTRIES) {
    const firstKey = captureCache.keys().next().value;
    captureCache.delete(firstKey);
  }
  captureCache.set(cacheKey, record);

  // Disk cache (async, non-blocking)
  saveDiskRecord(cacheKey, record).catch(() => {});

  return cacheKey;
}

// ─── build media payload for send ────────────────────────────────────────────
function mediaContentFor(buf, mediaType, caption) {
  const foot = `📸 View Once\n\n> ${randomFooter()}`;
  const cap  = caption ? `${caption}\n\n${foot}` : foot;
  if (mediaType === 'video') return { video: buf, caption: cap };
  if (mediaType === 'audio') return { audio: buf, mimetype: 'audio/mp4', ptt: false };
  return { image: buf, caption: cap };
}

// ─── load a buf from a record (memory or disk) ────────────────────────────────
async function resolveBuf(record) {
  if (record.buf && Buffer.isBuffer(record.buf) && record.buf.length > 0) {
    return record.buf;
  }
  if (record.mediaObj) {
    try {
      const buf = await downloadMedia(record.mediaObj, record.mediaType);
      if (buf && buf.length > 0) {
        record.buf = buf; // fill in cache for next time
        return buf;
      }
    } catch (_) {}
  }
  return null;
}

// ─── handleAntiViewOnce ───────────────────────────────────────────────────────
// Called by main.js on EVERY incoming message (background, must not throw).
// 1. Captures the view-once if present.
// 2. If auto-forward is enabled for this chat, forwards to the configured destination.
async function handleAntiViewOnce(conn, mek) {
  try {
    if (!isViewOnceMsg(mek)) return;

    const jid       = mek?.key?.remoteJid;
    const msgId     = mek?.key?.id;
    // Settings are keyed by the BARE bot number (e.g. '923044975027'),
    // not the full JID — passing the full JID would never match a
    // stored setting and auto-forward would never trigger.
    const botNumber = jidNormalizedUser(conn?.user?.id || '').split('@')[0];
    if (!jid || !msgId) return;

    // Always capture first
    const cacheKey = await captureViewOnce(conn, mek);

    // Check auto-forward setting
    let isEnabled, sendTo;
    try {
      const { getAntiViewOnceStatus, getAntiViewOnceSendTo } = require('../data/AntiViewOnce');
      isEnabled = await getAntiViewOnceStatus(botNumber, jid);
      sendTo    = await getAntiViewOnceSendTo(botNumber);
    } catch (_) {
      return; // settings module unavailable — just capture, skip forward
    }

    if (!isEnabled) return;

    // Determine destination JID
    // Default / 'same' / null → same chat (never the owner DM)
    let destJid = jid;
    if (sendTo && sendTo !== 'same' && sendTo !== 'private') {
      // Explicit JID configured
      destJid = sendTo;
    }
    // 'private' handled by antiviewonce-settings.js (sends to their own DM); we default to same chat

    // Retrieve buf
    const record = captureCache.get(cacheKey);
    if (!record) return;

    const buf = await resolveBuf(record);
    if (!buf || buf.length === 0) return;

    // Forward as normal (non-viewOnce) media — won't re-trigger capture
    const payload = mediaContentFor(buf, record.mediaType, record.caption);
    await conn.sendMessage(destJid, payload);

  } catch (_) {
    // Never throw — this runs in the background on every message
  }
}

// ─── autoRecoverOnReply ───────────────────────────────────────────────────────
// Called by main.js when a bot-sent message quotes a view-once (isMe && !isCmd).
// Sends the recovered media to `from` (same chat).
async function autoRecoverOnReply(conn, quotedMsg, sender, from, botNumber) {
  try {
    if (!quotedMsg) return;

    const jid   = from;
    const msgId = quotedMsg?.key?.id || quotedMsg?.id;
    const bot   = botNumber || conn?.user?.id || '';
    if (!jid || !msgId) return;

    const cacheKey = scopedKey(bot, jid, msgId);

    // Try memory cache first
    let record = captureCache.get(cacheKey);
    if (!record) {
      // Try disk
      record = await loadDiskRecord(cacheKey);
    }
    if (!record) return;

    const buf = await resolveBuf(record);
    if (!buf || buf.length === 0) return;

    const payload = mediaContentFor(buf, record.mediaType, record.caption);
    await conn.sendMessage(from, payload);

  } catch (_) {
    // Silent — this is a background auto-feature
  }
}

// ─── exports ──────────────────────────────────────────────────────────────────
module.exports = {
  handleAntiViewOnce,
  autoRecoverOnReply,
  unwrapMedia,
  captureViewOnce,
  scopedKey,
  // Exposed so vv.js can read them without re-importing
  captureCache,
  loadDiskRecord,
};
