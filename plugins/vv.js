'use strict';
// ============================================================
// .vv — SIMPLE version (2026-11-19), now with the old working capture
// as a fallback for ALREADY-OPENED view-onces.
// Same approach as the working reference bots (BUNTY_MD / ALI_MD):
// download DIRECTLY from the raw quotedMessage of the .vv command
// message. If that fails (opened = mediaKey stripped), fall back to
// global.viewOnceCache — the capture-on-arrival cache from
// lib/viewonce-capture.js (old Ahmad MD working flow), which saved the
// media the moment it arrived. So .vv works whether the view-once was
// opened or not — as long as the bot received it after the latest deploy.
// Framework (code-verified): main.js calls
//   cmd.function(conn, mek, m, { from, reply, sender, ... })
// so handlers MUST take FOUR parameters.
// The raw quotedMessage lives on the ORIGINAL .vv command message m:
//   m.message.extendedTextMessage.contextInfo.quotedMessage
// (sms() preserves m.message for extendedTextMessage; it only unwraps
// when the message ITSELF is a view-once. m.quoted.message is the
// same raw quotedMessage, kept as a fallback.)
// Destinations (standing rule): .vv result+error -> SAME chat only.
// .vv2/.vv3 result+error -> requester's DM only, never the group,
// never the owner.
// Honest limit: this works ONLY when WhatsApp delivered a mediaKey
// for the quoted view-once — i.e. the photo/video is UNOPENED and
// was sent from ANOTHER number. An opened view-once has no key and
// no code can recover it.
// ============================================================
const { cmd } = require('../ahmad-core');
const fs = require('fs');
const { downloadContentFromMessage, jidNormalizedUser } = require('@whiskeysockets/baileys');
const { randomFooter } = require('../lib/menu-styles');
const vc = require('../lib/viewonce-capture');

const DOWNLOAD_TIMEOUT_MS = 15000;

// Peel every wrapper WhatsApp can put around a view-once.
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

function pickMedia(content) {
    if (!content || typeof content !== 'object') return null;
    for (const type of ['imageMessage', 'videoMessage', 'audioMessage']) {
        if (content[type]) return { type, media: content[type] };
    }
    return null;
}

// Raw quotedMessage from the ORIGINAL .vv command message.
function getRawQuoted(m) {
    try {
        return m?.message?.extendedTextMessage?.contextInfo?.quotedMessage
            || m?.msg?.contextInfo?.quotedMessage
            || m?.quoted?.message
            || null;
    } catch (_) { return null; }
}

// Core: download directly from the raw quotedMessage.
// Returns { buf, type }. Throws a plain-English error on failure.
async function downloadFromRawQuoted(m) {
    const raw = getRawQuoted(m);
    if (!raw) throw new Error('Reply to a view-once photo or video first.');
    const content = unwrapMedia(raw);
    if (!content) throw new Error('Not a view-once media message.');
    const picked = pickMedia(content);
    if (!picked) throw new Error('Not a view-once media message.');
    if (!picked.media.mediaKey) {
        throw new Error('Found the message but WhatsApp already stripped the media key (the view-once was opened before the bot could download it).');
    }
    const kind = picked.type === 'imageMessage' ? 'image' : picked.type === 'videoMessage' ? 'video' : 'audio';
    const stream = await Promise.race([
        downloadContentFromMessage(picked.media, kind),
        new Promise((_, reject) => setTimeout(() => reject(new Error('DOWNLOAD_TIMEOUT')), DOWNLOAD_TIMEOUT_MS))
    ]);
    let buf = Buffer.from([]);
    for await (const chunk of stream) {
        buf = Buffer.concat([buf, chunk]);
        if (buf.length > 60 * 1024 * 1024) throw new Error('Media too large.');
    }
    if (!buf.length) throw new Error('Failed to download view-once media.');
    return { buf, type: picked.type };
}

// Backward-compatible dispatcher for plugins/recovery-tools.js
// (.vvpost/.vvdoc call the OLD signature getViewOnceMedia(m, botNumber,
// conn, from) and expect { buffer, type } with type in
// imageMessage/videoMessage/audioMessage, throwing on failure).
async function getViewOnceMedia(a, b, c, d) {
    // New style: (conn, quotedMek, { botNumber, from }) — not used by
    // the simple version, but kept so old callers don't crash.
    if (a && a.user && b && b.key) {
        throw new Error('Reply to a view-once photo or video first.');
    }
    // Old style: (m, botNumber, conn, from)
    const m = a;
    const res = await downloadFromRawQuoted(m);
    return { buffer: res.buf, type: res.type };
}

async function sendRecovered(conn, dest, result) {
    const buf = result.buf || result.buffer;
    const type = result.type || result.mediaType;
    if (type === 'imageMessage') {
        await conn.sendMessage(dest, { image: buf, caption: `📸 View Once\n\n> ${randomFooter()}` });
    } else if (type === 'videoMessage') {
        await conn.sendMessage(dest, { video: buf, caption: `🎥 View Once\n\n> ${randomFooter()}` });
    } else {
        await conn.sendMessage(dest, { audio: buf, mimetype: 'audio/mp4', ptt: false });
    }
}

// Send an error to the RIGHT destination only.
// .vv -> same chat (reply, then sendMessage(from)); never any DM.
// .vv2/.vv3 -> requester's DM only; never the chat, never the owner.
async function sendErr(conn, from, sender, reply, msg, toDM) {
    if (toDM) {
        const dest = sender;
        if (dest) {
            try { await conn.sendMessage(dest, { text: msg }); return; } catch (_) {}
        }
        if (typeof reply === 'function') {
            try { await reply(msg); return; } catch (_) {}
        }
        try { await conn.sendMessage(from, { text: msg }); } catch (_) {}
        return;
    }
    if (typeof reply === 'function') {
        try { await reply(msg); return; } catch (_) {}
    }
    try { await conn.sendMessage(from, { text: msg }); } catch (_) {}
}

function errorText(e) {
    if (e?.message === 'DOWNLOAD_TIMEOUT') {
        return '❌ *Timed out while downloading the media. Please try again with a fresh view-once.*';
    }
    return `❌ *ERROR:* ${e.message || 'Failed to recover media.'}`;
}

// Fallback for an ALREADY-OPENED view-once: the live download above
// fails (no mediaKey), but capture-on-arrival saved the media to
// global.viewOnceCache the moment it arrived. Look it up by the quoted
// message's stanzaId, keyed the same way the capture file writes it
// (botNumber::messageId). Returns { buf, type } or null.
function downloadFromCache(conn, m) {
    try {
        const botNumber = jidNormalizedUser(conn?.user?.id || '').split('@')[0];
        const ids = [];
        const q = m?.quoted;
        if (q?.stanzaId) ids.push(q.stanzaId);
        if (q?.id && !ids.includes(q.id)) ids.push(q.id);
        const ctx = m?.message?.extendedTextMessage?.contextInfo || m?.msg?.contextInfo;
        if (ctx?.stanzaId && !ids.includes(ctx.stanzaId)) ids.push(ctx.stanzaId);
        const cache = global.viewOnceCache;
        if (!cache || !ids.length) return null;
        for (const id of ids) {
            const key = vc.scopedKey ? vc.scopedKey(botNumber, id) : `${botNumber || 'unknown'}::${id}`;
            const entry = cache.get(key);
            if (entry?.filePath) {
                const buf = fs.readFileSync(entry.filePath);
                if (buf?.length) return { buf, type: entry.type };
            }
        }
        return null;
    } catch (_) { return null; }
}

async function runRecovery(conn, mek, m, { from, reply, sender }, toDM) {
    try {
        let result = null;
        try {
            result = await downloadFromRawQuoted(m);
        } catch (e) {
            // Raw download failed (usually: already opened, key stripped).
            // Fall back to the capture-on-arrival cache.
            result = downloadFromCache(conn, m);
            if (!result) throw e;
        }
        const dest = toDM ? (sender || m?.sender) : from;
        await sendRecovered(conn, dest, result);
        if (toDM) {
            await sendErr(conn, from, sender || m?.sender, reply, '✅ *View-once media sent to your DM.*', true);
        }
    } catch (e) {
        console.log('[VV ERROR]', e && e.message);
        await sendErr(conn, from, sender || m?.sender, reply, errorText(e), toDM);
    }
}

// .vv / .vvhere — result to the SAME chat
cmd({
    pattern: 'vv',
    alias: ['viewonce', 'view', 'vvhere'],
    react: '👁️',
    category: 'tools',
    desc: 'Recover a view-once photo/video in this chat'
}, async (conn, mek, m, { from, reply, sender }) => {
    await runRecovery(conn, mek, m, { from, reply, sender }, false);
});

// .vv2 — result to the requester's DM
cmd({
    pattern: 'vv2',
    alias: ['viewonce2', 'getmedia'],
    react: '👁️',
    category: 'tools',
    desc: 'Recover a view-once photo/video to your DM'
}, async (conn, mek, m, { from, reply, sender }) => {
    await runRecovery(conn, mek, m, { from, reply, sender }, true);
});

// .vv3 / 👁️ — result to the requester's DM
cmd({
    pattern: 'vv3',
    alias: ['👁️'],
    react: '👁️',
    category: 'tools',
    desc: 'Recover a view-once photo/video to your DM'
}, async (conn, mek, m, { from, reply, sender }) => {
    await runRecovery(conn, mek, m, { from, reply, sender }, true);
});

module.exports = { getViewOnceMedia, unwrapMedia, downloadFromRawQuoted };
