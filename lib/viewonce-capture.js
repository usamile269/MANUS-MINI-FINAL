// ============================================================
// VIEW-ONCE CAPTURE — 2026-11-19
// Pre-captures every incoming view-once the moment it arrives
// so .vv can recover it even after it is opened.
// Now also writes a small disk cache that survives restarts.
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { downloadContentFromMessage, jidNormalizedUser } = require('@whiskeysockets/baileys');
const { getAntiViewOnceStatus, getAntiViewOnceSendTo } = require('../data/AntiViewOnce.js');
const { randomFooter } = require('./menu-styles');
const config = require('../config');

const DISK_CACHE_DIR = path.join(os.tmpdir(), 'ahmad-vv-cache');
const MAX_DISK_ENTRIES = 60;
const MAX_DISK_AGE_MS = 30 * 60 * 1000; // 30 minutes

function ensureDiskDir() {
    try {
        if (!fs.existsSync(DISK_CACHE_DIR)) {
            fs.mkdirSync(DISK_CACHE_DIR, { recursive: true });
        }
    } catch (_) {}
}

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
    // Also accept media that still has a mediaKey even if the viewOnce
    // flag was already stripped (some clients send it this way).
    for (const key of ['imageMessage', 'videoMessage', 'audioMessage']) {
        if (inner[key] && inner[key].mediaKey) return { [key]: inner[key] };
    }
    return null;
}

function scopedKey(botNumber, id) {
    return `${botNumber || 'unknown'}::${id}`;
}

function pickMediaType(content) {
    if (!content || typeof content !== 'object') return null;
    for (const type of ['imageMessage', 'videoMessage', 'audioMessage']) {
        if (content[type]) return type;
    }
    return null;
}

function mediaContentFor(buffer, type) {
    const caption = `📸 View Once\n\n> ${randomFooter()}`;
    if (type === 'imageMessage') return { image: buffer, caption };
    if (type === 'videoMessage') return { video: buffer, caption };
    if (type === 'audioMessage') return { audio: buffer, mimetype: 'audio/mp4', ptt: false };
    return null;
}

function safeUnlink(filePath) {
    try { fs.unlink(filePath, () => {}); } catch (_) {}
}

function pruneDiskCache() {
    try {
        ensureDiskDir();
        const files = fs.readdirSync(DISK_CACHE_DIR).filter(f => f.endsWith('.json'));
        const now = Date.now();
        const entries = [];

        for (const f of files) {
            const metaPath = path.join(DISK_CACHE_DIR, f);
            try {
                const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
                if (!meta?.cachedAt || now - meta.cachedAt > MAX_DISK_AGE_MS) {
                    if (meta?.filePath) safeUnlink(meta.filePath);
                    safeUnlink(metaPath);
                    continue;
                }
                entries.push({ metaPath, meta, age: now - meta.cachedAt });
            } catch (_) {
                safeUnlink(metaPath);
            }
        }

        if (entries.length > MAX_DISK_ENTRIES) {
            entries.sort((a, b) => b.meta.cachedAt - a.meta.cachedAt);
            for (const old of entries.slice(MAX_DISK_ENTRIES)) {
                if (old.meta?.filePath) safeUnlink(old.meta.filePath);
                safeUnlink(old.metaPath);
            }
        }
    } catch (_) {}
}

function writeDiskCache(botNumber, msgId, type, buffer) {
    try {
        ensureDiskDir();
        const key = scopedKey(botNumber, msgId);
        const safeName = key.replace(/[^a-zA-Z0-9_-]/g, '_');
        const ext = type === 'imageMessage' ? '.jpg' : type === 'videoMessage' ? '.mp4' : '.m4a';
        const filePath = path.join(DISK_CACHE_DIR, safeName + ext);
        const metaPath = path.join(DISK_CACHE_DIR, safeName + '.json');

        fs.writeFileSync(filePath, buffer);
        fs.writeFileSync(metaPath, JSON.stringify({
            filePath,
            type,
            cachedAt: Date.now(),
            key
        }));

        if (Math.random() < 0.2) pruneDiskCache();
    } catch (e) {
        console.log('[VIEWONCE DISK] write failed:', e.message);
    }
}

async function captureViewOnce(mek, botNumber) {
    try {
        if (!mek?.message || !mek?.key?.id) return null;

        const content = unwrapMedia(mek.message);
        if (!content) return null;
        const type = pickMediaType(content);
        if (!type) return null;

        const media = content[type];
        if (!media || !media.mediaKey) return null;

        const MAX_DOWNLOAD_BYTES = 60 * 1024 * 1024;
        const MAX_CACHE_BYTES = 6 * 1024 * 1024;
        const mediaType = type === 'imageMessage' ? 'image'
            : type === 'videoMessage' ? 'video' : 'audio';

        const stream = await Promise.race([
            downloadContentFromMessage(media, mediaType),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('CAPTURE_TIMEOUT')), 15000)
            )
        ]);

        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
            if (buffer.length > MAX_DOWNLOAD_BYTES) return null;
        }
        if (!buffer.length) return null;

        if (!global.viewOnceCache) global.viewOnceCache = new Map();

        if (type === 'videoMessage' && buffer.length > MAX_CACHE_BYTES) {
            if (buffer.length <= 25 * 1024 * 1024) {
                const ext = '.mp4';
                const filePath = path.join(os.tmpdir(), `vvcache_${Date.now()}_${crypto.randomBytes(3).toString('hex')}${ext}`);
                try {
                    fs.writeFileSync(filePath, buffer);
                    global.viewOnceCache.set(scopedKey(botNumber, mek.key.id), {
                        filePath,
                        type,
                        cachedAt: Date.now(),
                        chatId: mek.key.remoteJid,
                        senderJid: mek.key.participant || mek.key.remoteJid
                    });
                } catch (_) {}
            }
            return { buffer, type };
        }

        const ext = type === 'imageMessage' ? '.jpg' : type === 'videoMessage' ? '.mp4' : '.m4a';
        const filePath = path.join(os.tmpdir(), `vvcache_${Date.now()}_${crypto.randomBytes(3).toString('hex')}${ext}`);
        fs.writeFileSync(filePath, buffer);

        global.viewOnceCache.set(scopedKey(botNumber, mek.key.id), {
            filePath,
            type,
            cachedAt: Date.now(),
            chatId: mek.key.remoteJid,
            senderJid: mek.key.participant || mek.key.remoteJid
        });

        // Persistent disk cache (survives restarts for ~30 min)
        writeDiskCache(botNumber, mek.key.id, type, buffer);

        const MAX_CACHE_ENTRIES = 50;
        const MAX_CACHE_AGE_MS = 20 * 60 * 1000;
        const now = Date.now();
        for (const [key, entry] of global.viewOnceCache) {
            if (now - entry.cachedAt > MAX_CACHE_AGE_MS) {
                safeUnlink(entry.filePath);
                global.viewOnceCache.delete(key);
            }
        }
        while (global.viewOnceCache.size > MAX_CACHE_ENTRIES) {
            const oldestKey = global.viewOnceCache.keys().next().value;
            const old = global.viewOnceCache.get(oldestKey);
            if (old) safeUnlink(old.filePath);
            global.viewOnceCache.delete(oldestKey);
        }

        return { buffer, type };
    } catch (e) {
        console.log('[VIEWONCE CAPTURE] failed:', e.message);
        return null;
    }
}

// Always send auto-forward to the SAME chat (never owner DM).
function resolveDest(sendTo, chatId) {
    if (sendTo && typeof sendTo === 'string' && sendTo.includes('@')) return sendTo;
    return chatId;
}

async function handleAntiViewOnce(conn, mek) {
    try {
        if (!mek?.key || mek.key.fromMe) return;

        const botNumber = jidNormalizedUser(conn.user.id).split('@')[0];
        const chatId = mek.key.remoteJid;
        if (!chatId) return;

        const [status, captured] = await Promise.all([
            getAntiViewOnceStatus(botNumber, chatId).catch(() => false),
            captureViewOnce(mek, botNumber)
        ]);

        if (!status || !captured || !captured.buffer) return;

        const sendTo = await getAntiViewOnceSendTo(botNumber).catch(() => null);
        const dest = resolveDest(sendTo, chatId);
        if (!dest) return;

        const content = mediaContentFor(captured.buffer, captured.type);
        if (!content) return;

        await conn.sendMessage(dest, content);
    } catch (e) {
        console.log('[VIEWONCE] handleAntiViewOnce failed:', e.message);
    }
}

async function autoRecoverOnReply(conn, quotedMsg, senderJid, from, botNumber) {
    try {
        if (!quotedMsg || !quotedMsg.stanzaId) return;
        if (!global.viewOnceCache) return;

        const cached = global.viewOnceCache.get(scopedKey(botNumber, quotedMsg.stanzaId));
        if (!cached) return;

        let buffer;
        try {
            buffer = fs.readFileSync(cached.filePath);
        } catch (_) {
            return;
        }

        const content = mediaContentFor(buffer, cached.type);
        if (!content) return;

        await conn.sendMessage(from, content);
    } catch (_) {
        return;
    }
}

module.exports = {
    handleAntiViewOnce,
    autoRecoverOnReply,
    unwrapMedia,
    captureViewOnce,
    scopedKey
};
