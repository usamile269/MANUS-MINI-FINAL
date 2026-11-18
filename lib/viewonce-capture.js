// ============================================================
// VIEW-ONCE CAPTURE — clean rewrite from scratch (2026-11-18)
// Ahmad: "new code likhoo naa vv ka"
// Runs on every incoming message. Pre-captures view-once media the
// moment it arrives (so .vv works even after the photo was opened),
// and auto-forwards it when .antiviewonce is enabled for the chat.
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { downloadContentFromMessage, jidNormalizedUser } = require('@whiskeysockets/baileys');
const { getAntiViewOnceStatus, getAntiViewOnceSendTo } = require('../data/AntiViewOnce.js');
const config = require('../config');

// Peel every wrapper WhatsApp can put around a view-once:
// ephemeralMessage (disappearing messages) -> viewOnceMessage / V2 /
// V2Extension -> imageMessage / videoMessage / audioMessage.
// Any order, any depth (guarded). Returns the inner media content
// object, e.g. { imageMessage: {...} }, or null.
function unwrapMedia(message) {
    let inner = message;
    let guard = 0;
    while (inner && typeof inner === 'object' && guard++ < 10) {
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

function scopedKey(botNumber, id) { return `${botNumber || 'unknown'}::${id}`; }

function pickMediaType(content) {
    if (!content || typeof content !== 'object') return null;
    for (const type of ['imageMessage', 'videoMessage', 'audioMessage']) {
        if (content[type]) return type;
    }
    return null;
}

function mediaContentFor(buffer, type) {
    if (type === 'imageMessage') return { image: buffer, caption: '📸 View Once' };
    if (type === 'videoMessage') return { video: buffer, caption: '🎥 View Once' };
    if (type === 'audioMessage') return { audio: buffer, mimetype: 'audio/mp4', ptt: false };
    return null;
}

// Download + cache one incoming view-once. Returns { buffer, type } on
// success (buffer is also returned for large videos that are usable now
// but too big to cache), or null when the message is not a view-once
// or the download fails / is too large.
async function captureViewOnce(mek, botNumber) {
    try {
        const content = unwrapMedia(mek.message);
        if (!content) return null;
        const type = pickMediaType(content);
        if (!type) return null;

        const MAX_DOWNLOAD_BYTES = 60 * 1024 * 1024; // 60MB — abort before OOM
        const MAX_CACHE_BYTES = 4 * 1024 * 1024;     // 4MB — do not cache big videos
        const mediaType = type === 'imageMessage' ? 'image' : type === 'videoMessage' ? 'video' : 'audio';
        const stream = await downloadContentFromMessage(content[type], mediaType);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
            if (buffer.length > MAX_DOWNLOAD_BYTES) return null;
        }

        // Large video: usable right now, just not written to disk.
        if (type === 'videoMessage' && buffer.length > MAX_CACHE_BYTES) {
            return { buffer, type };
        }

        const ext = type === 'imageMessage' ? '.jpg' : type === 'videoMessage' ? '.mp4' : '.m4a';
        const filePath = path.join(os.tmpdir(), `vvcache_${Date.now()}_${crypto.randomBytes(3).toString('hex')}${ext}`);
        fs.writeFileSync(filePath, buffer);

        if (!global.viewOnceCache) global.viewOnceCache = new Map();
        global.viewOnceCache.set(scopedKey(botNumber, mek.key.id), {
            filePath, type, cachedAt: Date.now(),
            chatId: mek.key.remoteJid,
            senderJid: mek.key.participant || mek.key.remoteJid
        });

        // Prune: 15-minute expiry, max 40 entries.
        const MAX_CACHE_ENTRIES = 40;
        const MAX_CACHE_AGE_MS = 15 * 60 * 1000;
        const now = Date.now();
        for (const [key, entry] of global.viewOnceCache) {
            if (now - entry.cachedAt > MAX_CACHE_AGE_MS) {
                fs.unlink(entry.filePath, () => {});
                global.viewOnceCache.delete(key);
            }
        }
        while (global.viewOnceCache.size > MAX_CACHE_ENTRIES) {
            const oldestKey = global.viewOnceCache.keys().next().value;
            const old = global.viewOnceCache.get(oldestKey);
            if (old) fs.unlink(old.filePath, () => {});
            global.viewOnceCache.delete(oldestKey);
        }

        return { buffer, type };
    } catch (e) {
        console.log('[VIEWONCE CAPTURE] failed:', e.message);
        return null;
    }
}

// Resolve the auto-forward destination for one bot number.
// sendTo is one overall value per number: a JID, 'same' (the chat the
// view-once arrived in), or 'private' (the owner's DM, the default).
function resolveDest(sendTo, chatId, conn) {
    if (sendTo && typeof sendTo === 'string' && sendTo.includes('@')) return sendTo;
    if (sendTo === 'same') return chatId;
    if (sendTo === 'private') {
        const owner = config && (config.OWNER_NUMBER || config.ownerNumber);
        if (owner) {
            const digits = String(owner).replace(/[^0-9]/g, '');
            if (digits) return `${digits}@s.whatsapp.net`;
        }
        // Fall back to the chat itself when no owner number is configured.
        return chatId;
    }
    return chatId;
}

// Called for every incoming message (off the critical path). Captures
// the media AND checks the per-chat auto-forward setting in parallel,
// then auto-forwards when enabled.
async function handleAntiViewOnce(conn, mek) {
    try {
        const botNumber = jidNormalizedUser(conn.user.id).split('@')[0];
        const chatId = mek.key && mek.key.remoteJid;
        const [status, captured] = await Promise.all([
            getAntiViewOnceStatus(botNumber, chatId),
            captureViewOnce(mek, botNumber)
        ]);
        if (!status || !captured || !captured.buffer) return;
        const sendTo = await getAntiViewOnceSendTo(botNumber);
        const dest = resolveDest(sendTo, chatId, conn);
        if (!dest) return;
        const content = mediaContentFor(captured.buffer, captured.type);
        if (!content) return;
        await conn.sendMessage(dest, content);
    } catch (e) {
        console.log('[VIEWONCE] handleAntiViewOnce failed:', e.message);
    }
}

// Called when the owner replies (casually, not a command) to a
// view-once. Recovers the media from the cache and sends it.
// Fails silently by design — a miss just means nothing is sent.
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
        let dest = from;
        try {
            const sendTo = await getAntiViewOnceSendTo(botNumber);
            dest = resolveDest(sendTo, from, conn) || from;
        } catch (_) {
            dest = from;
        }
        await conn.sendMessage(dest, content);
    } catch (_) {
        // Fail silently by design.
        return;
    }
}

module.exports = { handleAntiViewOnce, autoRecoverOnReply, unwrapMedia, captureViewOnce, scopedKey };
