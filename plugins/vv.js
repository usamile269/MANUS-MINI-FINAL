// ============================================================
// VIEW-ONCE RECOVERY — 2026-11-19
// Signature fixed. Destinations fixed. Footer kept.
// Focus: better diagnostics + stronger recovery when mediaKey
// is still present, and clear English errors when it is gone.
// ============================================================
const { cmd } = require('../ahmad-core');
const { randomFooter } = require('../lib/menu-styles');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { downloadContentFromMessage, jidNormalizedUser } = require('@whiskeysockets/baileys');

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

function scopedKey(botNumber, id) {
    return `${botNumber || 'unknown'}::${id}`;
}

function hasUsableMediaKey(media) {
    if (!media) return false;
    const k = media.mediaKey;
    if (!k) return false;
    if (Buffer.isBuffer(k) && k.length > 0) return true;
    if (k instanceof Uint8Array && k.length > 0) return true;
    if (typeof k === 'string' && k.length > 8) return true;
    return false;
}

async function downloadMedia(content, type) {
    try {
        const media = content[type];
        if (!hasUsableMediaKey(media)) return null;

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
                if (buffer.length > 60 * 1024 * 1024) return null;
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
            if (q.stanzaId) ids.push(String(q.stanzaId));
            if (q.id && !ids.includes(String(q.id))) ids.push(String(q.id));
            if (q.key?.id && !ids.includes(String(q.key.id))) ids.push(String(q.key.id));
        }
        const ctx = m?.message?.extendedTextMessage?.contextInfo
            || m?.msg?.contextInfo;
        if (ctx?.stanzaId && !ids.includes(String(ctx.stanzaId))) {
            ids.push(String(ctx.stanzaId));
        }
    } catch (_) {}
    return ids;
}

function loadFromDiskCache(botNumber, ids) {
    try {
        const dir = path.join(os.tmpdir(), 'ahmad-vv-cache');
        if (!fs.existsSync(dir)) return null;
        for (const id of ids) {
            const key = scopedKey(botNumber, id);
            const metaPath = path.join(dir, key.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json');
            if (!fs.existsSync(metaPath)) continue;
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            if (!meta?.filePath || !fs.existsSync(meta.filePath)) continue;
            const buffer = fs.readFileSync(meta.filePath);
            if (buffer?.length) return { buffer, type: meta.type };
        }
    } catch (_) {}
    return null;
}

async function getViewOnceMedia(m, botNumber, conn, from) {
    const diag = {
        store: 'miss',
        chats: 0,
        cache: 'unavailable',
        disk: 'miss',
        noKey: 0,
        recent: 0,
        hadRaw: false,
        hadQuoted: false
    };
    const ids = getQuotedIds(m);

    // Stage 0: raw quotedMessage
    try {
        const raw = getRawQuoted(m);
        if (raw) {
            diag.hadRaw = true;
            const content = unwrapMedia(raw);
            if (content) {
                const picked = pickMedia(content);
                if (picked) {
                    if (!hasUsableMediaKey(picked.media)) diag.noKey++;
                    else {
                        const got = await downloadMedia(content, picked.type);
                        if (got) return got;
                    }
                }
            }
        }
    } catch (_) {}

    // Stage 1: in-memory cache
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

    // Stage 1b: persistent disk cache
    try {
        const disk = loadFromDiskCache(botNumber, ids);
        if (disk) {
            diag.disk = 'hit';
            return disk;
        }
    } catch (_) {}

    // Stage 2: ahmadStore by id
    try {
        const store = conn?.ahmadStore;
        if (store) {
            const msgMap = store.messages || {};
            diag.chats = Object.keys(msgMap).length;

            for (const id of ids) {
                let record = null;
                try {
                    if (typeof store.loadMessage === 'function') {
                        record = await store.loadMessage(from, id);
                    }
                } catch (_) {}

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
                        if (picked && !hasUsableMediaKey(picked.media)) diag.noKey++;
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

    // Stage 3: most-recent media in this chat (last 8 min)
    try {
        const store = conn?.ahmadStore;
        const msgMap = store?.messages || {};
        const arr = msgMap[from] || [];
        const now = Date.now();
        let attempts = 0;

        for (let i = arr.length - 1; i >= 0 && attempts < 4; i--) {
            const cand = arr[i];
            if (!cand?.message) continue;
            const ts = Number(cand.messageTimestamp || 0) * 1000;
            if (ts && now - ts > 8 * 60 * 1000) break;

            const content = unwrapMedia(cand.message);
            if (!content) continue;
            const picked = pickMedia(content);
            if (!picked) continue;
            if (!hasUsableMediaKey(picked.media)) {
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

    // Stage 4: live m.quoted
    try {
        const quoted = m.quoted;
        if (quoted) {
            diag.hadQuoted = true;
            const content = unwrapMedia(quoted.message || quoted);
            if (content) {
                const picked = pickMedia(content);
                if (picked) {
                    if (!hasUsableMediaKey(picked.media)) diag.noKey++;
                    else {
                        const got = await downloadMedia(content, picked.type);
                        if (got) return got;
                    }
                }
            }
        }
    } catch (_) {}

    const parts = [
        `store=${diag.store}`,
        `chats=${diag.chats}`,
        `cache=${diag.cache}`,
        `disk=${diag.disk}`
    ];
    if (diag.noKey) parts.push(`noKey=${diag.noKey}`);
    if (diag.recent) parts.push(`recent=${diag.recent}`);
    if (diag.hadRaw) parts.push('raw=yes');
    if (diag.hadQuoted) parts.push('quoted=yes');

    const diagStr = `[${parts.join(' ')}]`;

    let reason;
    if (diag.cache === 'unavailable' && diag.chats === 0) {
        reason = 'Bot was restarted after this view-once arrived. Send a NEW view-once and try .vv again immediately.';
    } else if (diag.noKey > 0 && diag.cache === 'miss' && diag.disk === 'miss') {
        reason = 'This view-once was already opened (or never captured). The bot only recovers view-onces it saw when they first arrived.';
    } else if (!diag.hadRaw && !diag.hadQuoted) {
        reason = 'Reply directly to the view-once photo/video, then type .vv.';
    } else {
        reason = 'Media key is missing. The view-once was either already opened, sent before the last restart, or never received by the bot.';
    }

    const err = new Error(`${reason} ${diagStr}`);
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

// .vv / .vvhere — SAME chat only
cmd({
    pattern: 'vv',
    alias: ['viewonce', 'view', 'vvhere'],
    react: '👁️',
    category: 'tools',
    desc: 'Recover a view-once photo/video in this chat'
}, async (conn, mek, m, { from, reply, sender }) => {
    try {
        if (!m?.quoted && !getRawQuoted(m)) {
            if (typeof reply === 'function') {
                try { await reply('❌ *Reply to a view-once photo or video with .vv*'); return; } catch (_) {}
            }
            try { await conn.sendMessage(from, { text: '❌ *Reply to a view-once photo or video with .vv*' }); } catch (_) {}
            return;
        }

        const botNumber = jidNormalizedUser(conn.user.id).split('@')[0];
        const result = await Promise.race([
            getViewOnceMedia(m, botNumber, conn, from),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('VV_TIMEOUT')), 22000)
            )
        ]);

        await sendRecovered(conn, from, result);
    } catch (e) {
        console.log('[VV ERROR]', e && e.message);
        const msg = e?.message?.includes('VV_TIMEOUT')
            ? '❌ *Timed out while recovering the media. Please try again with a fresh view-once.*'
            : `❌ *ERROR:* ${e.message || 'Failed to recover media.'}`;

        if (typeof reply === 'function') {
            try { await reply(msg); return; } catch (_) {}
        }
        try { await conn.sendMessage(from, { text: msg }); } catch (_) {}
    }
});

// .vv2 — requester's DM only
cmd({
    pattern: 'vv2',
    alias: ['viewonce2', 'getmedia'],
    react: '👁️',
    category: 'tools',
    desc: 'Recover a view-once photo/video to your DM'
}, async (conn, mek, m, { from, reply, sender }) => {
    try {
        if (!m?.quoted && !getRawQuoted(m)) {
            const t = '❌ *Reply to a view-once photo or video with .vv2*';
            if (typeof reply === 'function') {
                try { await reply(t); return; } catch (_) {}
            }
            try { await conn.sendMessage(from, { text: t }); } catch (_) {}
            return;
        }

        const botNumber = jidNormalizedUser(conn.user.id).split('@')[0];
        const result = await Promise.race([
            getViewOnceMedia(m, botNumber, conn, from),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('VV_TIMEOUT')), 22000)
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

// .vv3 — requester's DM only
cmd({
    pattern: 'vv3',
    alias: ['👁️'],
    react: '👁️',
    category: 'tools',
    desc: 'Recover a view-once photo/video to your DM'
}, async (conn, mek, m, { from, reply, sender }) => {
    try {
        if (!m?.quoted && !getRawQuoted(m)) {
            const t = '❌ *Reply to a view-once photo or video with .vv3*';
            if (typeof reply === 'function') {
                try { await reply(t); return; } catch (_) {}
            }
            try { await conn.sendMessage(from, { text: t }); } catch (_) {}
            return;
        }

        const botNumber = jidNormalizedUser(conn.user.id).split('@')[0];
        const result = await Promise.race([
            getViewOnceMedia(m, botNumber, conn, from),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('VV_TIMEOUT')), 22000)
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
