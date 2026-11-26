'use strict';
// ============================================================
// VIEW-ONCE CAPTURE — professional & simple (2026-11-19)
//
// One job: the instant a view-once arrives, download it and keep it,
// so .vv can give it back later even after it was opened.
//
// How it works
//   1. captureViewOnce() runs on every incoming message (cheap check
//      first — it does nothing unless the message is a view-once).
//   2. It downloads the media and saves it to a temp file, indexed in
//      global.viewOnceCache by `botNumber::messageId` (40 entries,
//      15-minute life, so the disk never fills up).
//   3. .vv reads that cache when the live download fails (opened photo).
//   4. .antiviewonce auto-forwards the captured media to the same chat.
//
// Rules (do not break these)
//   - Never skip fromMe: the bot DOES receive its own sent view-onces.
//   - Never send to the owner DM. Auto-forward goes to the same chat.
//   - Never throw out of handleAntiViewOnce (it runs in the background).
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { downloadContentFromMessage, jidNormalizedUser } = require('@whiskeysockets/baileys');
const { getAntiViewOnceStatus, getAntiViewOnceSendTo } = require('../data/AntiViewOnce.js');
const { randomFooter } = require('../lib/menu-styles');

const MAX_CACHE_ENTRIES = 40;
const MAX_CACHE_AGE_MS = 15 * 60 * 1000; // 15 minutes
const MAX_CACHE_BYTES = 4 * 1024 * 1024; // 4 MB — bigger videos are not stored
const MAX_DOWNLOAD_BYTES = 60 * 1024 * 1024; // 60 MB — abort the download past this

// Peel every wrapper WhatsApp can put around a view-once.
function unwrapViewOnce(message) {
    if (!message) return null;
    if (message.viewOnceMessage) return message.viewOnceMessage.message;
    if (message.viewOnceMessageV2) return message.viewOnceMessageV2.message;
    if (message.viewOnceMessageV2Extension) return message.viewOnceMessageV2Extension.message;
    for (const key of ['imageMessage', 'videoMessage', 'audioMessage']) {
        if (message[key] && message[key].viewOnce) return { [key]: message[key] };
    }
    return null;
}

// Cache key, namespaced by bot number so paired sessions never collide.
function scopedKey(botNumber, id) {
    return `${botNumber || 'unknown'}::${id}`;
}

// Download a view-once the moment it arrives and keep it.
// Returns { buffer, type } or null.
async function captureViewOnce(mek, botNumber) {
    try {
        const content = unwrapViewOnce(mek.message);
        if (!content) return null;

        const type = Object.keys(content)[0];
        if (!['imageMessage', 'videoMessage', 'audioMessage'].includes(type)) return null;

        const kind = type === 'imageMessage' ? 'image' : type === 'videoMessage' ? 'video' : 'audio';
        const stream = await downloadContentFromMessage(content[type], kind);

        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
            if (buffer.length > MAX_DOWNLOAD_BYTES) return null;
        }
        if (!buffer.length) return null;

        // Big videos: usable right now, but not stored for later.
        if (type === 'videoMessage' && buffer.length > MAX_CACHE_BYTES) {
            return { buffer, type };
        }

        const ext = type === 'imageMessage' ? '.jpg' : type === 'videoMessage' ? '.mp4' : '.m4a';
        const filePath = path.join(os.tmpdir(), `vvcache_${Date.now()}_${crypto.randomBytes(3).toString('hex')}${ext}`);
        fs.writeFileSync(filePath, buffer);

        if (!global.viewOnceCache) global.viewOnceCache = new Map();
        global.viewOnceCache.set(scopedKey(botNumber, mek.key.id), {
            filePath,
            type,
            cachedAt: Date.now(),
            chatId: mek.key.remoteJid,
            senderJid: mek.key.participant || mek.key.remoteJid,
        });

        pruneCache();
        return { buffer, type };
    } catch (e) {
        console.log('[VIEWONCE CAPTURE] failed:', e.message);
        return null;
    }
}

// Drop expired entries and keep the cache within its size limit.
function pruneCache() {
    try {
        const cache = global.viewOnceCache;
        if (!cache) return;
        const now = Date.now();
        for (const [key, entry] of cache) {
            if (now - entry.cachedAt > MAX_CACHE_AGE_MS) {
                fs.unlink(entry.filePath, () => {});
                cache.delete(key);
            }
        }
        while (cache.size > MAX_CACHE_ENTRIES) {
            const oldestKey = cache.keys().next().value;
            const old = cache.get(oldestKey);
            if (old) fs.unlink(old.filePath, () => {});
            cache.delete(oldestKey);
        }
    } catch (_) {}
}

// Read a captured copy back by message id. Returns { buffer, type } or null.
function readCached(botNumber, messageId) {
    try {
        const cache = global.viewOnceCache;
        if (!cache || !messageId) return null;
        const entry = cache.get(scopedKey(botNumber, messageId));
        if (!entry || !entry.filePath) return null;
        const buffer = fs.readFileSync(entry.filePath);
        if (!buffer || !buffer.length) return null;
        return { buffer, type: entry.type };
    } catch (_) {
        return null;
    }
}

// .antiviewonce: when enabled for a chat, auto-forward the captured
// media to that same chat as soon as it arrives.
async function handleAntiViewOnce(conn, mek) {
    try {
        if (!unwrapViewOnce(mek.message)) return; // cheap check first

        const chatId = mek.key.remoteJid;
        const botNumber = jidNormalizedUser(conn.user.id).split('@')[0];
        const isEnabled = await getAntiViewOnceStatus(botNumber, chatId);
        const captured = await captureViewOnce(mek, botNumber);
        if (!isEnabled || !captured) return;

        const sendTo = await getAntiViewOnceSendTo(botNumber);
        // Same chat always. Only an explicit JID in the setting is honoured.
        const destination = (sendTo && sendTo !== 'private' && sendTo !== 'same') ? sendTo : chatId;
        const participant = mek.key.participant || chatId;
        const { buffer, type } = captured;

        let content;
        if (type === 'imageMessage') {
            content = { image: buffer, caption: `👁️ Auto-captured view-once from @${participant.split('@')[0]}\n\n> ${randomFooter()}` };
        } else if (type === 'videoMessage') {
            content = { video: buffer, caption: `👁️ Auto-captured view-once from @${participant.split('@')[0]}\n\n> ${randomFooter()}` };
        } else {
            content = { audio: buffer, mimetype: 'audio/mp4', ptt: false };
        }
        if (content.caption) content.mentions = [participant];
        await conn.sendMessage(destination, content);
    } catch (e) {
        console.log('[ANTIVIEWONCE] failed:', e.message);
    }
}

// Reply-to-a-view-once recovery (no command needed): if the quoted
// view-once is still unopened, download it live; if it was already
// opened, read the captured copy. Always sends to the replier's own DM.
async function autoRecoverOnReply(conn, quotedMsg, senderJid, from, botNumber) {
    try {
        if (!quotedMsg || !quotedMsg.message) return;

        let type;
        let buffer;
        const unwrapped = unwrapViewOnce(quotedMsg.message);
        if (unwrapped) {
            type = Object.keys(unwrapped)[0];
            if (!['imageMessage', 'videoMessage', 'audioMessage'].includes(type)) return;
            const kind = type === 'imageMessage' ? 'image' : type === 'videoMessage' ? 'video' : 'audio';
            const stream = await downloadContentFromMessage(unwrapped[type], kind);
            buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
                if (buffer.length > MAX_DOWNLOAD_BYTES) return;
            }
            if (!buffer.length) return;
        } else if (quotedMsg.stanzaId) {
            const cached = readCached(botNumber, quotedMsg.stanzaId);
            if (!cached) return;
            type = cached.type;
            buffer = cached.buffer;
        } else {
            return;
        }

        const dedupeKey = `${botNumber || 'unknown'}:${senderJid}:${quotedMsg.stanzaId}`;
        if (!global.vvAutoReplySent) global.vvAutoReplySent = new Set();
        if (global.vvAutoReplySent.has(dedupeKey)) return;
        global.vvAutoReplySent.add(dedupeKey);
        if (global.vvAutoReplySent.size > 500) global.vvAutoReplySent.clear();

        let content;
        if (type === 'imageMessage') {
            content = { image: buffer, caption: `📸 View Once (auto-recovered)\n\n> ${randomFooter()}` };
        } else if (type === 'videoMessage') {
            content = { video: buffer, caption: `🎥 View Once (auto-recovered)\n\n> ${randomFooter()}` };
        } else {
            content = { audio: buffer, mimetype: 'audio/mp4', ptt: false };
        }
        await conn.sendMessage(senderJid, content);
    } catch (e) {
        console.log('[AUTO-VV-REPLY] failed:', e.message);
    }
}

module.exports = { captureViewOnce, handleAntiViewOnce, autoRecoverOnReply, unwrapViewOnce, scopedKey, readCached };
