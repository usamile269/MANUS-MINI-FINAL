'use strict';
// ============================================================
// .vv — professional & simple (2026-11-19)
//
// One job: give back a view-once photo/video when someone replies
// to it with .vv (same chat), .vv2 or .vv3 (requester's DM).
//
// How it works (two steps, in order)
//   1. Live download — straight from the raw quotedMessage of the
//      .vv command message. Works while the view-once is unopened.
//   2. Cache fallback — if the live download fails (already opened,
//      key stripped), read the copy that lib/viewonce-capture.js saved
//      the moment the view-once arrived.
// So .vv works opened or not, as long as the bot received the
// view-once after the latest deploy.
//
// Framework: main.js calls cmd.function(conn, mek, m, {from, reply,
// sender, ...}), so handlers MUST take FOUR parameters.
// Destinations: .vv -> SAME chat only. .vv2/.vv3 -> requester's DM
// only, never the group, never the owner.
// ============================================================
const { cmd } = require('../ahmad-core');
const fs = require('fs');
const { downloadContentFromMessage, jidNormalizedUser } = require('@whiskeysockets/baileys');
const { randomFooter } = require('../lib/menu-styles');
const vc = require('../lib/viewonce-capture');

const DOWNLOAD_TIMEOUT_MS = 15000;
const MAX_MEDIA_BYTES = 60 * 1024 * 1024; // 60 MB

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
// (sms() keeps m.message for extendedTextMessage; m.quoted.message is
// the same raw quotedMessage, kept as a fallback.)
function getRawQuoted(m) {
    try {
        return m?.message?.extendedTextMessage?.contextInfo?.quotedMessage
            || m?.msg?.contextInfo?.quotedMessage
            || m?.quoted?.message
            || null;
    } catch (_) {
        return null;
    }
}

// Step 1: live download from the raw quotedMessage.
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
        new Promise((_, reject) => setTimeout(() => reject(new Error('DOWNLOAD_TIMEOUT')), DOWNLOAD_TIMEOUT_MS)),
    ]);

    let buf = Buffer.from([]);
    for await (const chunk of stream) {
        buf = Buffer.concat([buf, chunk]);
        if (buf.length > MAX_MEDIA_BYTES) throw new Error('Media too large.');
    }
    if (!buf.length) throw new Error('Failed to download view-once media.');
    return { buf, type: picked.type };
}

// Step 2: read the capture-on-arrival copy (for already-opened view-onces).
// Returns { buf, type } or null.
function downloadFromCache(conn, m) {
    try {
        const botNumber = jidNormalizedUser(conn?.user?.id || '').split('@')[0];
        const ids = [];
        const q = m?.quoted;
        if (q?.stanzaId) ids.push(q.stanzaId);
        if (q?.id && !ids.includes(q.id)) ids.push(q.id);
        const ctx = m?.message?.extendedTextMessage?.contextInfo || m?.msg?.contextInfo;
        if (ctx?.stanzaId && !ids.includes(ctx.stanzaId)) ids.push(ctx.stanzaId);
        for (const id of ids) {
            const cached = vc.readCached ? vc.readCached(botNumber, id) : null;
            if (cached) return { buf: cached.buffer, type: cached.type };
        }
        return null;
    } catch (_) {
        return null;
    }
}

// Backward-compatible wrapper for plugins/recovery-tools.js
// (.vvpost/.vvdoc call the OLD signature and expect { buffer, type }).
async function getViewOnceMedia(a, b, c, d) {
    if (a && a.user && b && b.key) {
        throw new Error('Reply to a view-once photo or video first.');
    }
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
async function sendErr(conn, from, sender, reply, msg, toDM) {
    if (toDM) {
        if (sender) {
            try { await conn.sendMessage(sender, { text: msg }); return; } catch (_) {}
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

async function runRecovery(conn, mek, m, { from, reply, sender }, toDM) {
    try {
        let result = null;
        try {
            result = await downloadFromRawQuoted(m);
        } catch (e) {
            // Live download failed (usually: already opened). Fall back
            // to the capture-on-arrival copy.
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
    desc: 'Recover a view-once photo/video in this chat',
}, async (conn, mek, m, { from, reply, sender }) => {
    await runRecovery(conn, mek, m, { from, reply, sender }, false);
});

// .vv2 — result to the requester's DM
cmd({
    pattern: 'vv2',
    alias: ['viewonce2', 'getmedia'],
    react: '👁️',
    category: 'tools',
    desc: 'Recover a view-once photo/video to your DM',
}, async (conn, mek, m, { from, reply, sender }) => {
    await runRecovery(conn, mek, m, { from, reply, sender }, true);
});

// .vv3 — result to the requester's DM
cmd({
    pattern: 'vv3',
    alias: ['👁️'],
    react: '👁️',
    category: 'tools',
    desc: 'Recover a view-once photo/video to your DM',
}, async (conn, mek, m, { from, reply, sender }) => {
    await runRecovery(conn, mek, m, { from, reply, sender }, true);
});

module.exports = { getViewOnceMedia, unwrapMedia, downloadFromRawQuoted, downloadFromCache };
