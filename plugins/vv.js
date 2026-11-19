// ============================================================
// VIEW-ONCE RECOVERY — fixed 2026-11-18
// Root cause of "emoji only, no reply": handlers had wrong arity.
// main.js calls: cmd.function(conn, mek, m, { from, reply, sender, ... })
// Previous code used (conn, m, { from }) so from/quoted/sender were broken
// and every sendMessage in the catch failed silently.
// ============================================================
const { cmd } = require('../ahmad-core');
const { randomFooter } = require('../lib/menu-styles');
const fs = require('fs');
const { downloadContentFromMessage, jidNormalizedUser } = require('@whiskeysockets/baileys');

// Peel every wrapper WhatsApp can put around a view-once:
// ephemeralMessage -> viewOnceMessage / V2 / V2Extension -> media.
// Also documentWithCaptionMessage. Guarded against loops.
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
    // Prefer explicit viewOnce flag when present
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

function scopedKey(botNumber, id) {
    return `${botNumber || 'unknown'}::${id}`;
}

// Download one media object. Returns { buffer, type } or null.
// Hard timeouts so a viewed/expired CDN object can never hang the command.
async function downloadMedia(content, type) {
    try {
        const media = content[type];
        if (!media || !media.mediaKey) return null;

        const mediaType = type === 'imageMessage' ? 'image'
            : type === 'videoMessage' ? 'video' : 'audio';

        const stream = await Promise.race([
            downloadContentFromMessage(media, mediaType),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('DOWNLOAD_TIMEOUT')), 12000)
            )
        ]);

        let buffer = Buffer.from([]);
        let timer = null;
        const timeoutPromise = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('DOWNLOAD_TIMEOUT')), 18000);
        });

        const readPromise = (async () => {
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
                if (buffer.length > 60 * 1024 * 1024) return null; // 60 MB safety
            }
            return { buffer, type };
        })();

        try {
            const result = await Promise.race([readPromise, timeoutPromise]);
            clearTimeout(timer);
            return result;
        } catch (_) {
            clearTimeout(timer);
            return null;
        }
    } catch (_) {
        return null;
    }
}

async function downloadFromRecord(record) {
    try {
        if (!record || !record.message) return null;
        const content = unwrapMedia(record.message);
        if (!content) return null;
        const picked = pickMedia(content);
        if (!picked) return null;
        return await downloadMedia(content, picked.type);
    } catch (_) {
        return null;
    }
}

// Raw quotedMessage from contextInfo (survives even when m.quoted is rebuilt).
function getRawQuoted(m) {
    try {
        return m?.message?.extendedTextMessage?.contextInfo?.quotedMessage
            || m?.msg?.contextInfo?.quotedMessage
            || null;
    } catch (_) {
        return null;
    }
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
        // Also from raw contextInfo
        const ctx = m?.message?.extendedTextMessage?.contextInfo
            || m?.msg?.contextInfo;
        if (ctx?.stanzaId && !ids.includes(ctx.stanzaId)) ids.push(ctx.stanzaId);
    } catch (_) {}
    return ids;
}

// Recovery stages (fastest / most reliable first):
// 0. Raw quoted message (direct download)
// 1. In-memory viewOnceCache (pre-captured on upsert)
// 2. ahmadStore by id (messages map + loadMessage)
// 3. Most-recent media in same chat (last 5 min, ignores IDs)
// 4. Live m.quoted
async function getViewOnceMedia(m, botNumber, conn, from) {
    const diag = { store: 'miss', chats: 0, cache: 'unavailable', noKey: 0, recent: 0 };
    const ids = getQuotedIds(m);

    // ---- Stage 0: raw quotedMessage ----
    try {
        const raw = getRawQuoted(m);
        if (raw) {
            const content = unwrapMedia(raw);
            if (content) {
                const picked = pickMedia(content);
                if (picked) {
                    if (!picked.media.mediaKey) diag.noKey++;
                    else {
                        const got = await downloadMedia(content, picked.type);
                        if (got) return got;
                    }
                }
            }
        }
    } catch (_) {}

    // ---- Stage 1: in-memory cache ----
    try {
        const cache = global.viewOnceCache;
        if (cache) {
            diag.cache = 'miss';
            for (const id of ids) {
                let entry = cache.get(scopedKey(botNumber, id));
                if (!entry) {
                    for (const [key, val] of cache) {
                        if (key.endsWith('::' + id)) { entry = val; break; }
                    }
                }
                if (entry?.filePath) {
                    try {
                        const buffer = fs.readFileSync(entry.filePath);
                        if (buffer?.length) {
                            diag.cache = 'hit';
                            return { buffer, type: entry.type };
                        }
                    } catch (_) {}
                }
            }
        }
    } catch (_) {}

    // ---- Stage 2: ahmadStore (custom shape: messages[jid][] + loadMessage) ----
    try {
        const store = conn?.ahmadStore;
        if (store) {
            const msgMap = store.messages || {};
            diag.chats = Object.keys(msgMap).length;

            for (const id of ids) {
                // Preferred API
                let record = null;
                try {
                    if (typeof store.loadMessage === 'function') {
                        record = await store.loadMessage(from, id);
                    }
                } catch (_) {}

                // Fallback: scan every chat's message array
                if (!record) {
                    for (const jid of Object.keys(msgMap)) {
                        const arr = msgMap[jid] || [];
                        for (let i = arr.length - 1; i >= 0; i--) {
                            const cand = arr[i];
                            if (cand?.key?.id === id) {
                                record = cand;
                                break;
                            }
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
                            return got;
                        }
                    }
                }
            }
        }
    } catch (_) {}

    // ---- Stage 3: most-recent media in this chat (last 5 min) ----
    // Ignores message IDs — catches ID / JID mismatches.
    try {
        const store = conn?.ahmadStore;
        const msgMap = store?.messages || {};
        const arr = msgMap[from] || [];
        const now = Date.now();
        let attempts = 0;

        for (let i = arr.length - 1; i >= 0 && attempts < 3; i--) {
            const cand = arr[i];
            if (!cand?.message) continue;
            const ts = Number(cand.messageTimestamp || 0) * 1000;
            if (ts && now - ts > 5 * 60 * 1000) break;

            const content = unwrapMedia(cand.message);
            if (!content) continue;
            const picked = pickMedia(content);
            if (!picked) continue;
            if (!picked.media.mediaKey) {
                diag.noKey++;
                continue;
            }
            attempts++;
            diag.recent++;
            const got = await downloadFromRecord(cand);
            if (got) {
                diag.store = 'hit';
                return got;
            }
        }
    } catch (_) {}

    // ---- Stage 4: live m.quoted ----
    try {
        const quoted = m.quoted;
        if (quoted) {
            const content = unwrapMedia(quoted.message || quoted);
            if (content) {
                const picked = pickMedia(content);
                if (picked) {
                    if (!picked.media.mediaKey) diag.noKey++;
                    else {
                        const got = await downloadMedia(content, picked.type);
                        if (got) return got;
                    }
                }
            }
        }
    } catch (_) {}

    const diagStr = `[store=${diag.store} chats=${diag.chats} cache=${diag.cache}` +
        (diag.noKey ? ` noKey=${diag.noKey}` : '') +
        (diag.recent ? ` recent=${diag.recent}` : '') + ']';
    const err = new Error(
        `No mediaKey found for imageMessage. The quoted message may be too old or not cached. ${diagStr}`
    );
    err.diag = diagStr;
    throw err;
}

async function sendRecovered(conn, dest, result) {
    const { buffer, type } = result;
    const caption = `📸 View Once\n\n> ${randomFooter()}`;
    if (type === 'imageMessage') {
        await conn.sendMessage(dest, { image: buffer, caption });
    } else if (type === 'videoMessage') {
        await conn.sendMessage(dest, { video: buffer, caption });
    } else {
        await conn.sendMessage(dest, { audio: buffer, mimetype: 'audio/mp4', ptt: false });
    }
}

async function safeErrorReply(conn, from, sender, replyFn, text) {
    // Prefer the framework reply() — it is already bound correctly.
    if (typeof replyFn === 'function') {
        try {
            await replyFn(text);
            return;
        } catch (_) {}
    }
    try {
        await conn.sendMessage(from, { text });
        return;
    } catch (_) {}
    if (sender && sender !== from) {
        try {
            await conn.sendMessage(sender, { text });
        } catch (_) {}
    }
}

// .vv / .vvhere — send recovered media in the SAME chat
cmd({
    pattern: 'vv',
    alias: ['viewonce', 'view', 'vvhere'],
    react: '👁️',
    category: 'tools',
    desc: 'Recover a view-once photo/video in this chat'
}, async (conn, mek, m, { from, reply, sender }) => {
    try {
        if (!m?.quoted && !getRawQuoted(m)) {
            return safeErrorReply(conn, from, sender, reply,
                '❌ *Reply to a view-once photo or video with .vv*');
        }

        const botNumber = jidNormalizedUser(conn.user.id).split('@')[0];
        const result = await Promise.race([
            getViewOnceMedia(m, botNumber, conn, from),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('VV_TIMEOUT')), 20000)
            )
        ]);

        await sendRecovered(conn, from, result);
    } catch (e) {
        console.log('[VV ERROR]', e && e.message);
        const msg = e?.message?.includes('VV_TIMEOUT')
            ? '❌ *Timed out while recovering the media. Please try again with a fresh view-once.*'
            : `❌ *ERROR:* ${e.message || 'Failed to recover media.'}`;
        // SAME CHAT ONLY — never send a .vv error to any DM. The old code
        // sent it to `sender` (the requester's DM), so when the owner ran
        // .vv in a group the error landed in his own DM.
        if (typeof reply === 'function') {
            try { await reply(msg); return; } catch (_) {}
        }
        try { await conn.sendMessage(from, { text: msg }); } catch (_) {}
    }
});

// .vv2 — send recovered media to the user's DM
cmd({
    pattern: 'vv2',
    alias: ['viewonce2', 'getmedia'],
    react: '👁️',
    category: 'tools',
    desc: 'Recover a view-once photo/video to your DM'
}, async (conn, mek, m, { from, reply, sender }) => {
    try {
        if (!m?.quoted && !getRawQuoted(m)) {
            return safeErrorReply(conn, from, sender, reply,
                '❌ *Reply to a view-once photo or video with .vv2*');
        }

        const botNumber = jidNormalizedUser(conn.user.id).split('@')[0];
        const result = await Promise.race([
            getViewOnceMedia(m, botNumber, conn, from),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('VV_TIMEOUT')), 20000)
            )
        ]);

        const dest = sender || m.sender;
        await sendRecovered(conn, dest, result);
    } catch (e) {
        console.log('[VV2 ERROR]', e && e.message);
        const msg = e?.message?.includes('VV_TIMEOUT')
            ? '❌ *Timed out while recovering the media. Please try again with a fresh view-once.*'
            : `❌ *ERROR:* ${e.message || 'Failed to recover media.'}`;
        const dest = sender || m?.sender;
        if (dest) {
            try { await conn.sendMessage(dest, { text: msg }); } catch (_) {}
        }
    }
});

// .vv3 / 👁️ — same as .vv2 (DM)
cmd({
    pattern: 'vv3',
    alias: ['👁️'],
    react: '👁️',
    category: 'tools',
    desc: 'Recover a view-once photo/video to your DM'
}, async (conn, mek, m, { from, reply, sender }) => {
    try {
        if (!m?.quoted && !getRawQuoted(m)) {
            return safeErrorReply(conn, from, sender, reply,
                '❌ *Reply to a view-once photo or video with .vv3*');
        }

        const botNumber = jidNormalizedUser(conn.user.id).split('@')[0];
        const result = await Promise.race([
            getViewOnceMedia(m, botNumber, conn, from),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('VV_TIMEOUT')), 20000)
            )
        ]);

        const dest = sender || m.sender;
        await sendRecovered(conn, dest, result);
    } catch (e) {
        console.log('[VV3 ERROR]', e && e.message);
        const msg = e?.message?.includes('VV_TIMEOUT')
            ? '❌ *Timed out while recovering the media. Please try again with a fresh view-once.*'
            : `❌ *ERROR:* ${e.message || 'Failed to recover media.'}`;
        const dest = sender || m?.sender;
        if (dest) {
            try { await conn.sendMessage(dest, { text: msg }); } catch (_) {}
        }
    }
});

module.exports = { getViewOnceMedia, unwrapMedia, downloadMedia, downloadFromRecord, scopedKey };
