// ============================================================
// .vv — VIEW-ONCE RECOVERY (fresh rewrite, 2026-11-18)
// Ahmad: "new write karoo vv cmd"
// One clean file. Recovers a view-once photo/video/audio when you
// reply .vv to it. Sends in the SAME chat. .vv2/.vv3 send to your DM.
// Nobody else's media ever goes to the owner number.
// ============================================================
const { cmd } = require('../ahmad-core');
const fs = require('fs');
const { downloadContentFromMessage, jidNormalizedUser } = require('@whiskeysockets/baileys');
const { randomFooter } = require('../lib/menu-styles');

const MAX_BYTES = 60 * 1024 * 1024;      // 60 MB download cap
const FETCH_TIMEOUT_MS = 15000;          // 15 s to fetch media
const RECOVER_TIMEOUT_MS = 15000;        // 15 s for the whole recovery
const RECENT_WINDOW_MS = 5 * 60 * 1000;  // 5 min recent-photo window

// --- unwrap ---------------------------------------------------
// Peel ephemeralMessage / viewOnceMessage / V2 / V2Extension /
// documentWithCaption, any order, any depth. Returns the inner media
// content object, e.g. { imageMessage: {...} }, or null.
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

function stanzaIdOf(quoted) {
    if (!quoted) return null;
    return quoted.stanzaId || quoted.id || (quoted.key && quoted.key.id) || null;
}

// --- download -------------------------------------------------
// Download one media object. Returns { buffer, type } or null.
// Times out instead of hanging (view-once media is deleted from the
// CDN once viewed, so a stale fetch can stall forever).
async function downloadMedia(content, type) {
    try {
        const media = content[type];
        if (!media || !media.mediaKey) return null;
        const kind = type === 'imageMessage' ? 'image' : type === 'videoMessage' ? 'video' : 'audio';
        const stream = await Promise.race([
            downloadContentFromMessage(media, kind),
            new Promise((_, reject) => setTimeout(() => reject(new Error('FETCH_TIMEOUT')), FETCH_TIMEOUT_MS))
        ]);
        let buffer = Buffer.from([]);
        let timer = null;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('READ_TIMEOUT')), FETCH_TIMEOUT_MS);
        });
        const read = (async () => {
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
                if (buffer.length > MAX_BYTES) return null;
            }
            return { buffer, type };
        })();
        try {
            const out = await Promise.race([read, timeout]);
            clearTimeout(timer);
            return out;
        } catch (e) {
            clearTimeout(timer);
            return null;
        }
    } catch (e) {
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
    } catch (e) {
        return null;
    }
}

// --- recover --------------------------------------------------
// Tries, in order:
//   1. the RAW quoted message (works when the view-once is unopened)
//   2. the in-memory view-once cache (captured on arrival)
//   3. the message store, by id, across all chats
//   4. the most-recent view-once in this chat (last 5 min, ignores ids)
//   5. the rebuilt m.quoted
// Returns { buffer, type, source } or throws with a diagnostic.
async function recoverViewOnce(m, botNumber, conn, from) {
    const diag = { store: 'miss', chats: 0, cache: 'unavailable', noKey: 0, recent: 0 };
    const quoted = m.quoted;
    const stanzaId = stanzaIdOf(quoted);

    const rawQuoted = (() => {
        try { return m.message?.extendedTextMessage?.contextInfo?.quotedMessage || null; }
        catch (e) { return null; }
    })();

    // 1. Raw quoted message, direct download.
    if (rawQuoted) {
        const content = unwrapMedia(rawQuoted);
        const picked = content && pickMedia(content);
        if (picked) {
            const got = await downloadMedia(content, picked.type);
            if (got) return { ...got, source: 'quoted' };
        }
    }

    // 2. In-memory view-once cache.
    const cache = global.viewOnceCache;
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
                if (buffer && buffer.length > 0) return { buffer, type: entry.type, source: 'cache' };
            } catch (e) {}
        }
    }

    // 3. Message store, by id, across all chats.
    const store = conn && conn.ahmadStore;
    if (store) {
        try { diag.chats = typeof store.chats?.size === 'number' ? store.chats.size : 0; } catch (e) {}
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
                const picked = content && pickMedia(content);
                if (picked && !picked.media.mediaKey) diag.noKey++;
                const got = await downloadFromRecord(record);
                if (got) return { ...got, source: 'store' };
            }
        }
    }

    // 4. Most-recent view-once in this chat (ignores ids entirely).
    if (store && typeof store.chats?.get === 'function') {
        try {
            const chat = store.chats.get(from);
            const msgs = chat && chat.messages;
            if (msgs) {
                const list = Array.isArray(msgs) ? msgs.slice() : Array.from(msgs.values ? msgs.values() : []);
                list.sort((a, b) => ((b.messageTimestamp || 0) - (a.messageTimestamp || 0)));
                const now = Date.now();
                let attempts = 0;
                for (const msg of list) {
                    if (attempts >= 2) break;
                    if (now - ((msg.messageTimestamp || 0) * 1000) > RECENT_WINDOW_MS) break;
                    const content = unwrapMedia(msg.message);
                    const picked = content && pickMedia(content);
                    if (!picked) continue;
                    if (!picked.media.mediaKey) { diag.noKey++; continue; }
                    diag.recent++;
                    attempts++;
                    const got = await downloadFromRecord(msg);
                    if (got) return { ...got, source: 'recent' };
                }
            }
        } catch (e) {}
    }

    // 5. Live download via the rebuilt m.quoted.
    if (quoted) {
        const content = unwrapMedia(quoted.message || quoted);
        const picked = content && pickMedia(content);
        if (picked) {
            const got = await downloadMedia(content, picked.type);
            if (got) return { ...got, source: 'quoted2' };
        }
    }

    const diagStr = `[store=${diag.store} chats=${diag.chats} cache=${diag.cache}` +
        (diag.noKey ? ` noKey=${diag.noKey}` : '') +
        (diag.recent ? ` recent=${diag.recent}` : '') + ']';
    const err = new Error(`No mediaKey found for imageMessage. The quoted message may be too old or not cached. ${diagStr}`);
    err.diag = diagStr;
    throw err;
}

async function sendMedia(conn, dest, result) {
    const { buffer, type } = result;
    if (type === 'imageMessage') {
        await conn.sendMessage(dest, { image: buffer, caption: '📸 View Once' });
    } else if (type === 'videoMessage') {
        await conn.sendMessage(dest, { video: buffer, caption: '🎥 View Once' });
    } else {
        await conn.sendMessage(dest, { audio: buffer, mimetype: 'audio/mp4', ptt: false });
    }
}

// Runs recovery with an overall timeout. Always resolves to a result
// or throws — never hangs. The caller sends the reply.
async function runRecovery(m, botNumber, conn, from) {
    return await Promise.race([
        recoverViewOnce(m, botNumber, conn, from),
        new Promise((_, reject) => setTimeout(() => reject(new Error('VV_TIMEOUT')), RECOVER_TIMEOUT_MS))
    ]);
}

function errorText(e) {
    const diag = (e && e.diag) || '';
    return `❌ *ERROR:* No mediaKey found for imageMessage. The quoted message may be too old or not cached. ${diag}\n\n${randomFooter()}`;
}

// .vv / .vvhere — send in the SAME chat. The reply goes only to this
// chat; it never goes to the owner number.
cmd({
    pattern: 'vv',
    alias: ['viewonce', 'view', 'vvhere'],
    react: '👁️',
    category: 'tools',
    desc: 'Recover a view-once photo/video in this chat'
}, async (conn, m, { from }) => {
    try {
        await conn.sendMessage(from, { text: '⏳ Recovering your view-once...' });
        const botNumber = jidNormalizedUser(conn.user.id).split('@')[0];
        const result = await runRecovery(m, botNumber, conn, from);
        await sendMedia(conn, from, result);
    } catch (e) {
        try {
            await conn.sendMessage(from, { text: errorText(e) });
        } catch (sendErr) {
            console.log('[VV] error reply failed:', sendErr && sendErr.message);
        }
    }
});

// .vv2 — send to YOUR DM only (the person who ran it). Never the group,
// never the owner.
cmd({
    pattern: 'vv2',
    alias: ['viewonce2', 'getmedia'],
    react: '👁️',
    category: 'tools',
    desc: 'Recover a view-once photo/video to your DM'
}, async (conn, m, { from }) => {
    try {
        const botNumber = jidNormalizedUser(conn.user.id).split('@')[0];
        const result = await runRecovery(m, botNumber, conn, from);
        await sendMedia(conn, m.sender, result);
    } catch (e) {
        try {
            await conn.sendMessage(m.sender, { text: errorText(e) });
        } catch (sendErr) {
            console.log('[VV] error reply failed:', sendErr && sendErr.message);
        }
    }
});

// .vv3 — send to YOUR DM only (the person who ran it). Never the group,
// never the owner.
cmd({
    pattern: 'vv3',
    alias: ['👁️'],
    react: '👁️',
    category: 'tools',
    desc: 'Recover a view-once photo/video to your DM'
}, async (conn, m, { from }) => {
    try {
        const botNumber = jidNormalizedUser(conn.user.id).split('@')[0];
        const result = await runRecovery(m, botNumber, conn, from);
        await sendMedia(conn, m.sender, result);
    } catch (e) {
        try {
            await conn.sendMessage(m.sender, { text: errorText(e) });
        } catch (sendErr) {
            console.log('[VV] error reply failed:', sendErr && sendErr.message);
        }
    }
});

module.exports = { recoverViewOnce, unwrapMedia, downloadMedia, downloadFromRecord, scopedKey };
