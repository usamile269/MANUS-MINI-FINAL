// ============================================================
// VIEW-ONCE RECOVERY — clean rewrite from scratch (2026-11-18)
// Ahmad: "sari file reweire karo" — rewrite the whole vv file,
// using the direct-quoted approach (download straight from the
// quoted message first), then cache / store / recent fallbacks.
// .vv / .vvhere send in the SAME chat. .vv2 / .vv3 send to DM.
// ============================================================
const { cmd } = require('../ahmad-core');
const fs = require('fs');
const { downloadContentFromMessage, jidNormalizedUser } = require('@whiskeysockets/baileys');
const { randomFooter } = require('../lib/menu-styles');

// Peel every wrapper WhatsApp can put around a view-once:
// ephemeralMessage (disappearing messages) -> viewOnceMessage / V2 /
// V2Extension -> imageMessage / videoMessage / audioMessage.
// Any order, any depth (guarded).
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

function pickMedia(content) {
    if (!content || typeof content !== 'object') return null;
    for (const type of ['imageMessage', 'videoMessage', 'audioMessage']) {
        if (content[type]) return { type, media: content[type] };
    }
    return null;
}

function scopedKey(botNumber, id) { return `${botNumber || 'unknown'}::${id}`; }

// Download one media object. Returns { buffer, type } or null.
// View-once media can stall forever once it has been viewed (WhatsApp
// deletes it from the CDN), so the download is capped at 20 seconds —
// on timeout it returns null and the next recovery stage runs instead
// of the command hanging with only the emoji reaction showing.
async function downloadMedia(content, type) {
    try {
        const media = content[type];
        if (!media || !media.mediaKey) return null;
        const mediaType = type === 'imageMessage' ? 'image' : type === 'videoMessage' ? 'video' : 'audio';
        const stream = await downloadContentFromMessage(media, mediaType);
        let buffer = Buffer.from([]);
        let timer = null;
        const timeoutPromise = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('DOWNLOAD_TIMEOUT')), 20000);
        });
        const readPromise = (async () => {
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
                if (buffer.length > 60 * 1024 * 1024) return null;
            }
            return { buffer, type };
        })();
        try {
            const result = await Promise.race([readPromise, timeoutPromise]);
            clearTimeout(timer);
            return result;
        } catch (e) {
            clearTimeout(timer);
            return null;
        }
    } catch (e) {
        return null;
    }
}

// Download from a stored message record (store / recent fallback).
async function downloadFromRecord(record) {
    try {
        if (!record || !record.message) return null;
        const content = unwrapMedia(record.message);
        if (!content) return null;
        const picked = pickMedia(content);
        if (!picked) return null;
        return await downloadMedia(content, picked.type);
    } catch (e) {
        return null;
    }
}

// The raw quoted message, straight from the reply's contextInfo —
// bypassing the rebuilt m.quoted, so the mediaKey survives if it is
// still there (unopened view-once).
function getRawQuoted(m) {
    try {
        return m.message?.extendedTextMessage?.contextInfo?.quotedMessage || null;
    } catch (e) {
        return null;
    }
}

// Recover view-once media. Returns { buffer, type } or null.
// Stages: (0) raw quoted message direct download; (1) cache;
// (2) store by id + scan all chats; (3) most-recent view-once in
// chat; (4) live download via m.quoted.
async function getViewOnceMedia(m, botNumber, conn, from) {
    const diag = { store: 'miss', chats: 0, cache: 'unavailable', noKey: 0, recent: 0 };

    // Stage 0 — raw quoted message, direct download.
    try {
        const rawQuoted = getRawQuoted(m);
        if (rawQuoted) {
            const content = unwrapMedia(rawQuoted);
            if (content) {
                const picked = pickMedia(content);
                if (picked) {
                    const direct = await downloadMedia(content, picked.type);
                    if (direct) return direct;
                }
            }
        }
    } catch (e) {}

    // Stage 1 — in-memory view-once cache.
    try {
        const cache = global.viewOnceCache;
        const quotedMsg = m.quoted;
        const stanzaId = quotedMsg && (quotedMsg.stanzaId || quotedMsg.id || (quotedMsg.key && quotedMsg.key.id));
        if (cache) {
            diag.cache = 'miss';
            let entry = null;
            if (stanzaId) entry = cache.get(scopedKey(botNumber, stanzaId));
            if (!entry && stanzaId) {
                for (const [key, val] of cache) {
                    if (key.endsWith('::' + stanzaId)) { entry = val; break; }
                }
            }
            if (entry && entry.filePath) {
                try {
                    const buffer = fs.readFileSync(entry.filePath);
                    if (buffer && buffer.length > 0) return { buffer, type: entry.type };
                } catch (e) {}
            }
        }
    } catch (e) {}

    // Stage 2 — message store, by id, across all chats.
    try {
        const store = conn && conn.ahmadStore;
        if (store) {
            let chats = 0;
            try { chats = typeof store.chats?.size === 'number' ? store.chats.size : 0; } catch (e) {}
            diag.chats = chats;
            const quotedMsg = m.quoted;
            const stanzaId = quotedMsg && (quotedMsg.stanzaId || quotedMsg.id || (quotedMsg.key && quotedMsg.key.id));
            if (stanzaId) {
                let record = null;
                try { record = await store.loadMessage(from, stanzaId); } catch (e) {}
                if (!record && typeof store.chats?.values === 'function') {
                    for (const chat of store.chats.values()) {
                        const msgs = chat && chat.messages;
                        if (!msgs) continue;
                        const list = Array.isArray(msgs) ? msgs : Array.from(msgs.values ? msgs.values() : []);
                        for (const msg of list) {
                            if (msg && msg.key && msg.key.id === stanzaId) { record = msg; break; }
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
                        if (got) return got;
                    }
                }
            }
        }
    } catch (e) {}

    // Stage 3 — most-recent view-once in the same chat (last 5 min).
    // Ignores message IDs entirely — catches ID mismatches.
    try {
        const store = conn && conn.ahmadStore;
        if (store && typeof store.chats?.get === 'function') {
            const chat = store.chats.get(from);
            const msgs = chat && chat.messages;
            if (msgs) {
                const list = Array.isArray(msgs) ? msgs.slice() : Array.from(msgs.values ? msgs.values() : []);
                list.sort((a, b) => {
                    const ta = (a.messageTimestamp || 0) * 1000;
                    const tb = (b.messageTimestamp || 0) * 1000;
                    return tb - ta;
                });
                const now = Date.now();
                let attempts = 0;
                for (const msg of list) {
                    if (attempts >= 2) break;
                    const ts = (msg.messageTimestamp || 0) * 1000;
                    if (now - ts > 5 * 60 * 1000) break;
                    const content = unwrapMedia(msg.message);
                    if (!content) continue;
                    const picked = pickMedia(content);
                    if (!picked) continue;
                    if (!picked.media.mediaKey) { diag.noKey++; continue; }
                    diag.recent++;
                    attempts++;
                    const got = await downloadFromRecord(msg);
                    if (got) return got;
                }
            }
        }
    } catch (e) {}

    // Stage 4 — live download via m.quoted (main.js rebuilt quoted).
    try {
        const quoted = m.quoted;
        if (quoted) {
            const content = unwrapMedia(quoted.message || quoted);
            if (content) {
                const picked = pickMedia(content);
                if (picked) {
                    const got = await downloadMedia(content, picked.type);
                    if (got) return got;
                }
            }
        }
    } catch (e) {}

    const diagStr = `[store=${diag.store} chats=${diag.chats} cache=${diag.cache}` +
        (diag.noKey ? ` noKey=${diag.noKey}` : '') +
        (diag.recent ? ` recent=${diag.recent}` : '') + ']';
    const err = new Error(`No mediaKey found for imageMessage. The quoted message may be too old or not cached. ${diagStr}`);
    err.diag = diagStr;
    throw err;
}

async function sendRecovered(conn, dest, result, m) {
    const { buffer, type } = result;
    if (type === 'imageMessage') {
        await conn.sendMessage(dest, { image: buffer, caption: '📸 View Once' }, { quoted: m });
    } else if (type === 'videoMessage') {
        await conn.sendMessage(dest, { video: buffer, caption: '🎥 View Once' }, { quoted: m });
    } else {
        await conn.sendMessage(dest, { audio: buffer, mimetype: 'audio/mp4', ptt: false }, { quoted: m });
    }
}

// .vv / .vvhere — send in the SAME chat.
cmd({
    pattern: 'vv',
    alias: ['viewonce', 'view', 'vvhere'],
    react: '👁️',
    category: 'tools',
    desc: 'Recover a view-once photo/video in this chat'
}, async (conn, m, { from }) => {
    try {
        const botNumber = jidNormalizedUser(conn.user.id).split('@')[0];
        const result = await Promise.race([
            getViewOnceMedia(m, botNumber, conn, from),
            new Promise((_, reject) => setTimeout(() => reject(new Error('VV_TIMEOUT')), 30000))
        ]);
        await sendRecovered(conn, from, result, m);
    } catch (e) {
        const diag = e.diag || '';
        await conn.sendMessage(from, { text: `❌ *ERROR:* No mediaKey found for imageMessage. The quoted message may be too old or not cached. ${diag}\n\n${randomFooter()}` }, { quoted: m });
    }
});

// .vv2 — send to the user's DM.
cmd({
    pattern: 'vv2',
    alias: ['viewonce2', 'getmedia'],
    react: '👁️',
    category: 'tools',
    desc: 'Recover a view-once photo/video to your DM'
}, async (conn, m, { from }) => {
    try {
        const botNumber = jidNormalizedUser(conn.user.id).split('@')[0];
        const result = await Promise.race([
            getViewOnceMedia(m, botNumber, conn, from),
            new Promise((_, reject) => setTimeout(() => reject(new Error('VV_TIMEOUT')), 30000))
        ]);
        await sendRecovered(conn, m.sender, result, m);
    } catch (e) {
        const diag = e.diag || '';
        await conn.sendMessage(from, { text: `❌ *ERROR:* No mediaKey found for imageMessage. The quoted message may be too old or not cached. ${diag}\n\n${randomFooter()}` }, { quoted: m });
    }
});

// .vv3 — send to the user's DM.
cmd({
    pattern: 'vv3',
    alias: ['👁️'],
    react: '👁️',
    category: 'tools',
    desc: 'Recover a view-once photo/video to your DM'
}, async (conn, m, { from }) => {
    try {
        const botNumber = jidNormalizedUser(conn.user.id).split('@')[0];
        const result = await Promise.race([
            getViewOnceMedia(m, botNumber, conn, from),
            new Promise((_, reject) => setTimeout(() => reject(new Error('VV_TIMEOUT')), 30000))
        ]);
        await sendRecovered(conn, m.sender, result, m);
    } catch (e) {
        const diag = e.diag || '';
        await conn.sendMessage(from, { text: `❌ *ERROR:* No mediaKey found for imageMessage. The quoted message may be too old or not cached. ${diag}\n\n${randomFooter()}` }, { quoted: m });
    }
});

module.exports = { getViewOnceMedia, unwrapMedia, downloadMedia, downloadFromRecord, scopedKey };
