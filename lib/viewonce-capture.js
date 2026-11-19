'use strict';
// ============================================================
// VIEW-ONCE CAPTURE — written from scratch by Muse (2026-11-19)
// Spine: capture-on-arrival. The bot must download a view-once the
// instant it arrives, BEFORE anyone can open it — once opened,
// WhatsApp strips the mediaKey and recovery is impossible.
// Design rules learned from 20+ failed pushes:
//  - Never skip fromMe (self-sent view-onces DO reach the bot and
//    MUST be captured; Grok's fromMe skip was a regression).
//  - Never send anything to the owner DM. .antiviewonce auto-forward
//    goes to the SAME chat; an explicit JID in sendTo is honoured.
//  - Store the downloaded bytes, not just a reference. A stored
//    message without a mediaKey is useless, so the cache is the only
//    source of truth. Memory Map + disk file (Railway volume first).
//  - Never throw out of handleAntiViewOnce — it runs in the
//    background of every incoming message.
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { downloadContentFromMessage, jidNormalizedUser } = require('@whiskeysockets/baileys');
const { getAntiViewOnceStatus, getAntiViewOnceSendTo } = require('../data/AntiViewOnce.js');
const { randomFooter } = require('./menu-styles');

const MAX_MEM_ENTRIES = 60;
const MAX_CACHE_AGE_MS = 30 * 60 * 1000; // 30 min
const MAX_DOWNLOAD_BYTES = 60 * 1024 * 1024; // 60 MB safety

// Disk dir: Railway volume first ($JSONDB_DIR), then /data, then /tmp.
function resolveCacheDir() {
    const candidates = [];
    if (process.env.JSONDB_DIR) candidates.push(path.join(process.env.JSONDB_DIR, 'viewonce-cache'));
    candidates.push('/data/ahmad-db/viewonce-cache');
    candidates.push(path.join(os.tmpdir(), 'ahmadmd-viewonce-cache'));
    for (const dir of candidates) {
        try { fs.mkdirSync(dir, { recursive: true }); return dir; } catch (_) {}
    }
    return os.tmpdir();
}
const CACHE_DIR = resolveCacheDir();

// In-memory cache: key -> { buf, mediaType, caption, ts }
const captureCache = new Map();

function scopedKey(botNumber, jid, msgId) {
    const bot = String(botNumber || '').replace(/[^0-9]/g, '') || 'unknown';
    return `${bot}::${jid}::${msgId}`;
}

// Peel every wrapper WhatsApp can put around a view-once.
// Returns the inner media content object, e.g. { imageMessage: {...} }.
function unwrapMedia(message) {
    let inner = message;
    let guard = 0;
    while (inner && typeof inner === 'object' && guard++ < 12) {
        if (inner.ephemeralMessage) { inner = inner.ephemeralMessage.message; continue; }
        if (inner.viewOnceMessage) { inner = inner.viewOnceMessage.message; continue; }
        if (inner.viewOnceMessageV2) { inner = inner.viewOnceMessageV2.message; continue; }
        if (inner.viewOnceMessageV2Extension) { inner = inner.viewOnceMessageV2Extension.message; continue; }
        if (inner.documentWithCaptionMessage) { inner = inner.documentWithCaptionMessage.message; continue; }
        break;
    }
    if (!inner || typeof inner !== 'object') return null;
    for (const key of ['imageMessage', 'videoMessage', 'audioMessage']) {
        if (inner[key] && inner[key].viewOnce) return { [key]: inner[key] };
    }
    if (inner.imageMessage || inner.videoMessage || inner.audioMessage) return inner;
    return null;
}

function mediaTypeOf(content) {
    if (!content || typeof content !== 'object') return null;
    if (content.imageMessage) return 'imageMessage';
    if (content.videoMessage) return 'videoMessage';
    if (content.audioMessage) return 'audioMessage';
    return null;
}

function isViewOnceMsg(mek) {
    const content = mek?.message;
    if (!content) return false;
    for (const vw of ['viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension']) {
        if (content[vw]) return true;
    }
    const eph = content.ephemeralMessage?.message;
    if (eph) {
        for (const vw of ['viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension']) {
            if (eph[vw]) return true;
        }
    }
    // Media flagged viewOnce without a wrapper (already partially unwrapped).
    const inner = unwrapMedia(content);
    if (inner) {
        for (const key of ['imageMessage', 'videoMessage', 'audioMessage']) {
            if (inner[key] && inner[key].viewOnce) return true;
        }
    }
    return false;
}

function diskPaths(cacheKey) {
    const safe = cacheKey.replace(/[^a-zA-Z0-9_-]/g, '_');
    return {
        json: path.join(CACHE_DIR, safe + '.json'),
        bin: path.join(CACHE_DIR, safe + '.bin')
    };
}

async function saveDiskRecord(cacheKey, record) {
    try {
        if (!record.buf || !record.buf.length) return;
        const { json, bin } = diskPaths(cacheKey);
        fs.writeFileSync(bin, record.buf);
        fs.writeFileSync(json, JSON.stringify({
            mediaType: record.mediaType, caption: record.caption || '', ts: record.ts
        }));
        // Prune oldest disk entries past the cap.
        const files = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.json'));
        if (files.length > MAX_MEM_ENTRIES) {
            const withTs = files.map(f => {
                try {
                    const j = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, f), 'utf8'));
                    return { f, ts: j.ts || 0 };
                } catch (_) { return { f, ts: 0 }; }
            }).sort((a, b) => a.ts - b.ts);
            for (const old of withTs.slice(0, files.length - MAX_MEM_ENTRIES)) {
                try { fs.unlinkSync(path.join(CACHE_DIR, old.f)); } catch (_) {}
                try { fs.unlinkSync(path.join(CACHE_DIR, old.f.replace(/\.json$/, '.bin'))); } catch (_) {}
            }
        }
    } catch (_) {}
}

function loadDiskRecord(cacheKey) {
    try {
        const { json, bin } = diskPaths(cacheKey);
        if (!fs.existsSync(json) || !fs.existsSync(bin)) return null;
        const meta = JSON.parse(fs.readFileSync(json, 'utf8'));
        if (Date.now() - (meta.ts || 0) > MAX_CACHE_AGE_MS) return null;
        const buf = fs.readFileSync(bin);
        if (!buf || !buf.length) return null;
        return { buf, mediaType: meta.mediaType, caption: meta.caption || '', ts: meta.ts };
    } catch (_) { return null; }
}

async function downloadMedia(mediaObj, mediaType) {
    if (!mediaObj || !mediaObj.mediaKey) return null;
    const kind = mediaType === 'imageMessage' ? 'image'
        : mediaType === 'videoMessage' ? 'video' : 'audio';
    const stream = await Promise.race([
        downloadContentFromMessage(mediaObj, kind),
        new Promise((_, reject) => setTimeout(() => reject(new Error('DOWNLOAD_TIMEOUT')), 12000))
    ]);
    let buf = Buffer.from([]);
    const timer = setTimeout(() => { throw new Error('DOWNLOAD_TIMEOUT'); }, 20000);
    try {
        for await (const chunk of stream) {
            buf = Buffer.concat([buf, chunk]);
            if (buf.length > MAX_DOWNLOAD_BYTES) return null;
        }
        return buf.length ? buf : null;
    } finally {
        clearTimeout(timer);
    }
}

// Capture ONE incoming view-once. Returns the cache key on success,
// null when the message is not a view-once or the download failed.
// NOTE: the record is stored ONLY when the bytes were actually
// downloaded. A message without a mediaKey cannot be downloaded, so
// there is deliberately no "store the reference and retry later"
// path — without a key there is nothing to retry with.
async function captureViewOnce(conn, mek) {
    try {
        if (!isViewOnceMsg(mek)) return null;
        const jid = mek?.key?.remoteJid;
        const msgId = mek?.key?.id;
        const bot = conn?.user?.id || '';
        if (!jid || !msgId) return null;
        const cacheKey = scopedKey(bot, jid, msgId);
        if (captureCache.has(cacheKey)) return cacheKey;

        const media = unwrapMedia(mek.message);
        if (!media) return null;
        const mediaType = mediaTypeOf(media);
        if (!mediaType) return null;
        const mediaObj = media[mediaType];
        const caption = mediaObj?.caption || '';
        if (!mediaObj?.mediaKey) {
            console.log('[VIEWONCE CAPTURE] no mediaKey at arrival, id=' + msgId);
            return null;
        }
        let buf = null;
        try { buf = await downloadMedia(mediaObj, mediaType); } catch (e) {
            console.log('[VIEWONCE CAPTURE] download failed: ' + (e && e.message));
            return null;
        }
        if (!buf || !buf.length) return null;

        const record = { buf, mediaType, caption, ts: Date.now() };
        if (captureCache.size >= MAX_MEM_ENTRIES) {
            const oldest = captureCache.keys().next().value;
            captureCache.delete(oldest);
        }
        captureCache.set(cacheKey, record);
        // Also publish to the legacy global cache (older vv.js readers).
        try {
            if (!global.viewOnceCache) global.viewOnceCache = new Map();
            const ext = mediaType === 'imageMessage' ? '.jpg' : mediaType === 'videoMessage' ? '.mp4' : '.m4a';
            const filePath = path.join(os.tmpdir(), `vvcache_${Date.now()}_${crypto.randomBytes(3).toString('hex')}${ext}`);
            fs.writeFileSync(filePath, buf);
            global.viewOnceCache.set(`${String(bot).replace(/[^0-9]/g, '')}::${msgId}`, {
                filePath, type: mediaType, cachedAt: Date.now(), chatId: jid
            });
        } catch (_) {}
        saveDiskRecord(cacheKey, record).catch(() => {});
        return cacheKey;
    } catch (e) {
        console.log('[VIEWONCE CAPTURE] failed: ' + (e && e.message));
        return null;
    }
}

// Resolve the auto-forward destination. 'private' and 'same' both mean
// the chat the view-once arrived in — NEVER the owner DM. An explicit
// JID in sendTo is still honoured.
function resolveDest(sendTo, chatId) {
    if (sendTo && typeof sendTo === 'string' && sendTo.includes('@')) return sendTo;
    return chatId;
}

function mediaContentFor(buffer, type) {
    const caption = `📸 View Once\n\n> ${randomFooter()}`;
    if (type === 'imageMessage') return { image: buffer, caption };
    if (type === 'videoMessage') return { video: buffer, caption };
    if (type === 'audioMessage') return { audio: buffer, mimetype: 'audio/mp4', ptt: false };
    return null;
}

// Called for every incoming message (off the critical path).
// Downloads FIRST (the race against the photo being opened), then
// checks the auto-forward setting.
async function handleAntiViewOnce(conn, mek) {
    try {
        if (!isViewOnceMsg(mek)) return;
        const jid = mek?.key?.remoteJid;
        const msgId = mek?.key?.id;
        const botNumber = jidNormalizedUser(conn?.user?.id || '').split('@')[0];
        if (!jid || !msgId) return;
        // Download first — the settings lookup must never delay the race.
        const cacheKey = await captureViewOnce(conn, mek);
        if (!cacheKey) return;
        let status = false;
        try { status = await getAntiViewOnceStatus(botNumber, jid); } catch (_) {}
        if (!status) return;
        const rec = captureCache.get(cacheKey);
        if (!rec || !rec.buf) return;
        let sendTo = 'same';
        try { sendTo = await getAntiViewOnceSendTo(botNumber); } catch (_) {}
        const dest = resolveDest(sendTo, jid);
        if (!dest) return;
        const content = mediaContentFor(rec.buf, rec.mediaType);
        if (!content) return;
        await conn.sendMessage(dest, content);
    } catch (e) {
        console.log('[VIEWONCE] handleAntiViewOnce failed: ' + (e && e.message));
    }
}

// Called when the owner replies (casually, not a command) to a
// view-once. Sends the cached media to the same chat. Silent on miss.
async function autoRecoverOnReply(conn, quotedMsg, senderJid, from, botNumber) {
    try {
        if (!quotedMsg || !quotedMsg.stanzaId) return;
        const cacheKey = scopedKey(botNumber, from, quotedMsg.stanzaId);
        let rec = captureCache.get(cacheKey);
        if (!rec) rec = loadDiskRecord(cacheKey);
        if (!rec || !rec.buf) return;
        const content = mediaContentFor(rec.buf, rec.mediaType);
        if (!content) return;
        await conn.sendMessage(from, content);
    } catch (_) { return; }
}

module.exports = {
    handleAntiViewOnce, autoRecoverOnReply, captureViewOnce,
    captureCache, loadDiskRecord, scopedKey, unwrapMedia, downloadMedia
};
