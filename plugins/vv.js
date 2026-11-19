'use strict';
// ============================================================
// VIEW-ONCE RECOVERY — written from scratch by Muse (2026-11-19)
// Framework (code-verified): main.js calls
//   cmd.function(conn, mek, m, { from, reply, sender, ... })
// so handlers MUST take FOUR parameters. The old (conn, m, {from})
// signature left `from` undefined and every send failed silently.
// Recovery order (cache is the source of truth — a stored message
// without a mediaKey is useless):
//   0. Memory cache (captureCache) — with a short WAIT, because .vv
//      can arrive before the capture download finishes. This wait
//      closes the race that caused most "cache=miss" failures.
//   1. Disk cache (Railway volume, survives process restarts).
//   2. Raw quotedMessage (direct download, needs mediaKey).
//   3. ahmadStore (loadMessage + scan, needs mediaKey).
//   4. Live m.quoted (needs mediaKey).
// Destinations (standing rule): .vv result+error -> SAME chat only.
// .vv2/.vv3 result+error -> requester's DM only, never the group,
// never the owner. .antiviewonce auto-forward -> same chat.
// NEVER return a different message's media (the old "most-recent
// media in this chat" fallback returned a photo for a video .vv).
// ============================================================
const { cmd } = require('../ahmad-core');
const { downloadContentFromMessage, jidNormalizedUser } = require('@whiskeysockets/baileys');
const { randomFooter } = require('../lib/menu-styles');
const vc = require('../lib/viewonce-capture');

const CAPTURE_WAIT_MS = 3000;   // max time to wait for capture to finish
const CAPTURE_POLL_MS = 500;    // poll interval while waiting
const OVERALL_TIMEOUT_MS = 20000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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

function scopedKey(botNumber, jid, msgId) {
    return vc.scopedKey(botNumber, jid, msgId);
}

async function downloadMedia(content, type) {
    try {
        const media = content[type];
        if (!media || !media.mediaKey) return null;
        const kind = type === 'imageMessage' ? 'image' : type === 'videoMessage' ? 'video' : 'audio';
        const stream = await Promise.race([
            downloadContentFromMessage(media, kind),
            new Promise((_, reject) => setTimeout(() => reject(new Error('DOWNLOAD_TIMEOUT')), 12000))
        ]);
        let buf = Buffer.from([]);
        for await (const chunk of stream) {
            buf = Buffer.concat([buf, chunk]);
            if (buf.length > 60 * 1024 * 1024) return null;
        }
        return buf.length ? { buffer: buf, type } : null;
    } catch (_) { return null; }
}

async function downloadFromRecord(record) {
    try {
        if (!record) return null;
        if (record.buf && record.buf.length) {
            return { buffer: record.buf, type: record.mediaType };
        }
        if (!record.message) return null;
        const content = unwrapMedia(record.message);
        if (!content) return null;
        const picked = pickMedia(content);
        if (!picked) return null;
        return await downloadMedia(content, picked.type);
    } catch (_) { return null; }
}

// Raw quotedMessage from contextInfo (survives even when m.quoted is rebuilt).
function getRawQuoted(m) {
    try {
        return m?.message?.extendedTextMessage?.contextInfo?.quotedMessage
            || m?.msg?.contextInfo?.quotedMessage
            || null;
    } catch (_) { return null; }
}

function getQuotedIds(m) {
    const ids = [];
    try {
        const q = m.quoted;
        if (q) {
            if (q.stanzaId) ids.push(q.stanzaId);
            if (q.id && !ids.includes(q.id)) ids.push(q.id);
            if (q.key?.id && !ids.includes(q.key.id)) ids.push(q.key.id);
        }
        const ctx = m?.message?.extendedTextMessage?.contextInfo || m?.msg?.contextInfo;
        if (ctx?.stanzaId && !ids.includes(ctx.stanzaId)) ids.push(ctx.stanzaId);
    } catch (_) {}
    return ids;
}

// Core recovery. Returns { buf, mediaType, caption, source, diag }.
// Throws a plain-English error (message already embeds the diag once).
async function getViewOnceMediaCore(conn, quotedMek, opts) {
    const { botNumber, from } = opts || {};
    const diag = { store: 'miss', chats: 0, cache: 'miss', disk: 'miss', noKey: 0 };
    const qKey = quotedMek?.key || {};
    const jid = qKey.remoteJid || from;
    const msgId = qKey.id;
    const bot = botNumber || conn?.user?.id || '';
    const cacheKey = msgId ? scopedKey(bot, jid, msgId) : null;

    // ---- Stage 0: memory cache, with a WAIT for the capture race ----
    // .vv can arrive before the capture download finishes. Poll briefly
    // so a just-arriving view-once is found instead of reported missing.
    if (cacheKey) {
        const deadline = Date.now() + CAPTURE_WAIT_MS;
        while (Date.now() <= deadline) {
            const rec = vc.captureCache?.get(cacheKey);
            if (rec && rec.buf && rec.buf.length) {
                diag.cache = 'hit';
                return { buf: rec.buf, mediaType: rec.mediaType, caption: rec.caption || '', source: 'memory', diag };
            }
            // Also try the legacy global cache (filePath entries).
            try {
                const g = global.viewOnceCache;
                if (g) {
                    const twoPart = `${String(bot).replace(/[^0-9]/g, '')}::${msgId}`;
                    let entry = g.get(twoPart);
                    if (!entry) {
                        for (const [k, v] of g) {
                            if (k.endsWith('::' + msgId)) { entry = v; break; }
                        }
                    }
                    if (entry?.filePath) {
                        const fs = require('fs');
                        const buffer = fs.readFileSync(entry.filePath);
                        if (buffer?.length) {
                            diag.cache = 'hit';
                            return { buf: buffer, mediaType: entry.type, caption: '', source: 'memory', diag };
                        }
                    }
                }
            } catch (_) {}
            await sleep(CAPTURE_POLL_MS);
        }
    }

    // ---- Stage 1: disk cache (survives process restarts) ----
    if (cacheKey) {
        try {
            const rec = vc.loadDiskRecord(cacheKey);
            if (rec && rec.buf && rec.buf.length) {
                diag.disk = 'hit';
                return { buf: rec.buf, mediaType: rec.mediaType, caption: rec.caption || '', source: 'disk', diag };
            }
        } catch (_) {}
    }

    // ---- Stage 2: raw quotedMessage (direct download) ----
    // This MUST come from the ORIGINAL .vv command message
    // (m.message.extendedTextMessage.contextInfo.quotedMessage), NOT
    // from the rebuilt quotedMek — the reference bot (BUNTY_MD) works
    // precisely because it reads the raw quotedMessage straight from
    // the command message. The old code looked at quotedMek.message
    // (the view-once itself), which has no extendedTextMessage, so
    // this stage always missed.
    try {
        const raw = opts.rawQuoted || null;
        const content = raw ? unwrapMedia(raw) : null;
        if (content) {
            const picked = pickMedia(content);
            if (picked) {
                if (!picked.media.mediaKey) diag.noKey++;
                else {
                    const got = await downloadMedia(content, picked.type);
                    if (got) return { buf: got.buffer, mediaType: got.type, caption: '', source: 'quoted', diag };
                }
            }
        }
    } catch (_) {}

    // ---- Stage 3: ahmadStore (needs mediaKey in the stored copy) ----
    try {
        const store = conn?.ahmadStore;
        if (store) {
            const msgMap = store.messages || {};
            diag.chats = Object.keys(msgMap).length;
            let record = null;
            if (msgId && typeof store.loadMessage === 'function') {
                try { record = await store.loadMessage(jid, msgId); } catch (_) {}
            }
            if (!record && msgId) {
                for (const cjid of Object.keys(msgMap)) {
                    const arr = msgMap[cjid] || [];
                    for (let i = arr.length - 1; i >= 0; i--) {
                        if (arr[i]?.key?.id === msgId) { record = arr[i]; break; }
                    }
                    if (record) break;
                }
            }
            if (record) {
                const content = unwrapMedia(record.message);
                if (content) {
                    const picked = pickMedia(content);
                    if (picked && !picked.media.mediaKey) diag.noKey++;
                    const got = await downloadFromRecord(record);
                    if (got) {
                        diag.store = 'hit';
                        return { buf: got.buffer, mediaType: got.type, caption: '', source: 'store', diag };
                    }
                }
            }
        }
    } catch (_) {}

    // ---- Stage 4: live m.quoted ----
    try {
        const quoted = quotedMek?.message ? { message: quotedMek.message } : null;
        if (quoted) {
            const content = unwrapMedia(quoted.message);
            if (content) {
                const picked = pickMedia(content);
                if (picked) {
                    if (!picked.media.mediaKey) diag.noKey++;
                    else {
                        const got = await downloadMedia(content, picked.type);
                        if (got) return { buf: got.buffer, mediaType: got.type, caption: '', source: 'quoted', diag };
                    }
                }
            }
        }
    } catch (_) {}

    const diagStr = `[store=${diag.store} chats=${diag.chats} cache=${diag.cache} disk=${diag.disk}` +
        (diag.noKey ? ` noKey=${diag.noKey}` : '') + ']';
    const reason = diag.noKey
        ? 'Found the message but WhatsApp already stripped the media key (the view-once was opened before the bot could download it).'
        : 'Could not find this view-once in the bot cache. Send a brand-new view-once AFTER the latest deploy and reply .vv without opening it first.';
    const err = new Error(`${reason} ${diagStr}`);
    err.diag = diagStr;
    throw err;
}

// Backward-compatible dispatcher for plugins/recovery-tools.js
// (.vvpost/.vvdoc call the OLD signature and expect { buffer, type }
// with type in imageMessage/videoMessage/audioMessage, throwing on
// failure). New-style callers pass (conn, quotedMek, {botNumber, from})
// and get { buf, mediaType, caption, source, diag }.
async function getViewOnceMedia(a, b, c, d) {
    // New style: (conn, quotedMek, { botNumber, from })
    if (a && a.user && b && b.key) {
        return getViewOnceMediaCore(a, b, c || {});
    }
    // Old style: (m, botNumber, conn, from)
    const m = a;
    const botNumber = b;
    const conn = c;
    const from = d;
    const quoted = m?.quoted;
    if (!quoted) throw new Error('Reply to a view-once photo or video first.');
    const quotedMek = {
        key: {
            remoteJid: from,
            id: quoted.id || quoted.stanzaId,
            fromMe: false,
            participant: quoted.sender
        },
        message: quoted.message || quoted
    };
    const res = await getViewOnceMediaCore(conn, quotedMek, { botNumber, from, rawQuoted: getRawQuoted(m) });
    return { buffer: res.buf, type: res.mediaType };
}

async function sendRecovered(conn, dest, result) {
    const buf = result.buf || result.buffer;
    const type = result.mediaType || result.type;
    const caption = `📸 View Once\n\n> ${randomFooter()}`;
    if (type === 'imageMessage') {
        await conn.sendMessage(dest, { image: buf, caption });
    } else if (type === 'videoMessage') {
        await conn.sendMessage(dest, { video: buf, caption: '🎥 View Once\n\n> ' + randomFooter() });
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
    if (e?.message?.includes('VV_TIMEOUT')) {
        return '❌ *Timed out while recovering the media. Please try again with a fresh view-once.*';
    }
    // e.message already embeds the diag once — never append it again.
    return `❌ *ERROR:* ${e.message || 'Failed to recover media.'}`;
}

async function runRecovery(conn, mek, m, { from, reply, sender }, toDM) {
    const botNumber = jidNormalizedUser(conn.user.id).split('@')[0];
    const quoted = m?.quoted;
    const raw = getRawQuoted(m);
    if (!quoted && !raw) {
        const msg = '❌ *Reply to a view-once photo or video with .vv*';
        await sendErr(conn, from, sender || m?.sender, reply, msg, toDM);
        return;
    }
    const quotedMek = {
        key: {
            remoteJid: from,
            id: quoted?.id || quoted?.stanzaId,
            fromMe: false,
            participant: quoted?.sender
        },
        message: quoted?.message || quoted || raw
    };
    try {
        const result = await Promise.race([
            getViewOnceMediaCore(conn, quotedMek, { botNumber, from, rawQuoted: getRawQuoted(m) }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('VV_TIMEOUT')), OVERALL_TIMEOUT_MS))
        ]);
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

module.exports = { getViewOnceMedia, unwrapMedia, downloadMedia, downloadFromRecord, scopedKey };
