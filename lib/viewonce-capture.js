'use strict';
// ============================================================
// VIEW-ONCE CAPTURE — old working flow (Ahmad MD old zip), 2026-11-19
// Capture-on-arrival: the moment a view-once arrives, download it and
// save it to os.tmpdir() + global.viewOnceCache, so .vv can recover it
// LATER even if it was already OPENED (opened = mediaKey stripped, so
// a live download is impossible — only the captured copy survives).
// Cache key is namespaced by botNumber (2-part: botNumber::messageId)
// so multiple paired sessions in one process never collide.
// Adaptations vs the old zip (standing rules, do not revert):
//  - Auto-forward destination: 'private' AND 'same' both go to the
//    SAME chat (never the owner/bot DM). Only an explicit JID in the
//    sendTo setting is honoured. (Leak fix, commit 3f256b9; Ahmad:
//    "Auto forward too you chat may anii Hoti user kay".)
//  - AHMAD MD footer on auto-forward / auto-recovered captions.
//  - scopedKey is exported so plugins/vv.js can read the same cache.
//  - No fromMe skip: self-sent view-onces ARE captured (the bot does
//    receive its own sent view-onces via upsert).
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { downloadContentFromMessage, jidNormalizedUser } = require('@whiskeysockets/baileys');
const { getAntiViewOnceStatus, getAntiViewOnceSendTo } = require('../data/AntiViewOnce.js');
const { randomFooter } = require('../lib/menu-styles');

function unwrapViewOnce(message) {
    if (!message) return null;
    if (message.viewOnceMessage) return message.viewOnceMessage.message;
    if (message.viewOnceMessageV2) return message.viewOnceMessageV2.message;
    if (message.viewOnceMessageV2Extension) return message.viewOnceMessageV2Extension.message;
    // Some clients set a `.viewOnce` flag directly on the media node instead
    // of wrapping it — handle that shape too.
    for (const key of ['imageMessage', 'videoMessage', 'audioMessage']) {
        if (message[key] && message[key].viewOnce) return { [key]: message[key] };
    }
    return null;
}

// Cache key namespaced by botNumber so each paired session's captured
// media is fully isolated from every other session.
function scopedKey(botNumber, id) { return `${botNumber || 'unknown'}::${id}`; }

async function captureViewOnce(mek, botNumber) {
    try {
        const content = unwrapViewOnce(mek.message);
        if (!content) return;
        const type = Object.keys(content)[0];
        if (!['imageMessage', 'videoMessage', 'audioMessage'].includes(type)) return;

        const MAX_CACHE_BYTES = 4 * 1024 * 1024; // 4MB — videos bigger than this are not written to disk
        const MAX_DOWNLOAD_BYTES = 60 * 1024 * 1024; // 60MB — abort the download itself past this (OOM guard)
        const mediaType = type === 'imageMessage' ? 'image' : type === 'videoMessage' ? 'video' : 'audio';
        const stream = await downloadContentFromMessage(content[type], mediaType);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
            if (buffer.length > MAX_DOWNLOAD_BYTES) return null; // too large — skip capture entirely rather than risk OOM
        }

        if (type === 'videoMessage' && buffer.length > MAX_CACHE_BYTES) {
            // Still return the buffer for immediate use (e.g. .antiviewonce
            // auto-forward right now), just don't write it to disk for later.
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

// .antiviewonce: on top of the always-on caching above, when enabled for a
// chat this immediately auto-forwards the view-once media (no need to
// manually reply with .vv) as soon as it's captured.
async function handleAntiViewOnce(conn, mek) {
    try {
        // Cheap check FIRST: skip the DB lookup entirely unless this
        // message actually is a view-once (99% of messages aren't).
        const vvContent = unwrapViewOnce(mek.message);
        if (!vvContent) return;

        const chatId = mek.key.remoteJid;
        const botNumber = jidNormalizedUser(conn.user.id).split('@')[0];
        const isEnabled = await getAntiViewOnceStatus(botNumber, chatId);

        const captured = await captureViewOnce(mek, botNumber);
        if (!isEnabled || !captured) return;

        const { buffer, type } = captured;
        const sendTo = await getAntiViewOnceSendTo(botNumber);
        // Standing rule: auto-forward goes to the SAME chat, never the
        // owner/bot DM. Only an explicit JID in sendTo is honoured.
        let destination = chatId;
        if (sendTo && sendTo !== 'private' && sendTo !== 'same') destination = sendTo;
        const participant = mek.key.participant || chatId;

        let content = {};
        if (type === 'imageMessage') content = { image: buffer, caption: `👁️ Auto-captured view-once from @${participant.split('@')[0]}\n\n> ${randomFooter()}` };
        else if (type === 'videoMessage') content = { video: buffer, caption: `👁️ Auto-captured view-once from @${participant.split('@')[0]}\n\n> ${randomFooter()}` };
        else content = { audio: buffer, mimetype: 'audio/mp4', ptt: false };
        if (content.caption) content.mentions = [participant];

        await conn.sendMessage(destination, content);
    } catch (e) {
        console.log('[ANTIVIEWONCE] failed:', e.message);
    }
}

// NO-COMMAND RECOVERY: user replies to a view-once with literally
// anything (not the .vv command) — the media still gets sent to their
// own private DM automatically. Works for two cases:
//   1. The view-once is still unopened — unwrap + download it live.
//   2. It was already opened, but captureViewOnce() cached it the moment
//      it first arrived — read that cached copy.
// Deduped per (replier + message) so replying twice doesn't spam their DM.
async function autoRecoverOnReply(conn, quotedMsg, senderJid, from, botNumber) {
    try {
        if (!quotedMsg || !quotedMsg.message) return;

        let type, buffer;
        const unwrapped = unwrapViewOnce(quotedMsg.message);
        if (unwrapped) {
            type = Object.keys(unwrapped)[0];
            if (!['imageMessage', 'videoMessage', 'audioMessage'].includes(type)) return;
            const mediaType = type === 'imageMessage' ? 'image' : type === 'videoMessage' ? 'video' : 'audio';
            const stream = await downloadContentFromMessage(unwrapped[type], mediaType);
            buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
                if (buffer.length > 60 * 1024 * 1024) return; // too large — skip rather than risk OOM
            }
        } else if (quotedMsg.stanzaId && global.viewOnceCache && global.viewOnceCache.has(scopedKey(botNumber, quotedMsg.stanzaId))) {
            const cached = global.viewOnceCache.get(scopedKey(botNumber, quotedMsg.stanzaId));
            type = cached.type;
            buffer = fs.readFileSync(cached.filePath);
        } else {
            return; // not a view-once reply — nothing to recover
        }

        const dedupeKey = `${botNumber || 'unknown'}:${senderJid}:${quotedMsg.stanzaId}`;
        if (!global.vvAutoReplySent) global.vvAutoReplySent = new Set();
        if (global.vvAutoReplySent.has(dedupeKey)) return;
        global.vvAutoReplySent.add(dedupeKey);
        if (global.vvAutoReplySent.size > 500) global.vvAutoReplySent.clear();

        let content;
        if (type === 'imageMessage') content = { image: buffer, caption: `📸 View Once (auto-recovered)\n\n> ${randomFooter()}` };
        else if (type === 'videoMessage') content = { video: buffer, caption: `🎥 View Once (auto-recovered)\n\n> ${randomFooter()}` };
        else content = { audio: buffer, mimetype: 'audio/mp4', ptt: false };

        // Always goes to the replier's own private DM — never back into
        // the chat it came from.
        await conn.sendMessage(senderJid, content);
    } catch (e) {
        console.log('[AUTO-VV-REPLY] failed:', e.message);
    }
}

module.exports = { captureViewOnce, handleAntiViewOnce, autoRecoverOnReply, unwrapViewOnce, scopedKey };
